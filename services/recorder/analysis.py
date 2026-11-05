"""Store Intelligence analysis worker.

Claims a leased analysis job, runs one conservative review through a
private analyzer, validates it against the contract and the transcript,
and submits it. The database computes the score and status. Logs and
errors carry fixed codes only: never transcript, quote, prompt or model text.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Protocol
from uuid import uuid4

from pydantic import ValidationError

from contracts import ModelResponse
from prompts import PROMPT_VERSION, REPAIR_PROMPT, SYSTEM_PROMPT, build_user_prompt
from recorder import Boundary, Fault
from redact import quote_in

MIN_WORDS = 25
MIN_SPOKEN_SEGMENTS = 2


class Analyzer(Protocol):
    provider: str
    model: str
    async def complete(self, system: str, user: str) -> str: ...


class InvalidOutput(Exception):
    """Model output failed validation; `errors` are fixed codes, never model text."""
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(','.join(errors))


def insufficient_speech(job: dict[str, Any]) -> bool:
    quality = job.get('quality') or {}
    return int(quality.get('words') or 0) < MIN_WORDS or int(quality.get('spoken_segments') or 0) < MIN_SPOKEN_SEGMENTS


def _strip_fences(text: str) -> str:
    value = text.strip()
    if value.startswith('```'):
        value = value.split('\n', 1)[1] if '\n' in value else ''
        value = value.rsplit('```', 1)[0]
    return value.strip()


def _refs(response: ModelResponse) -> list[tuple[str, Any]]:
    """Every (location, evidence ref) pair in a response."""
    out: list[tuple[str, Any]] = [(f'dimension:{d.key}', e) for d in response.dimensions for e in d.evidence]
    o = response.output
    if o is None:
        return out
    groups: dict[str, list[Any]] = {
        'key_points': o.key_points, 'product_interests': o.product_interests, 'customer_concerns': o.customer_concerns,
        'competitor_mentions': o.competitor_mentions, 'purchase_blockers': o.purchase_blockers,
        'coaching_strengths': o.coaching_strengths, 'coaching_gaps': o.coaching_gaps,
        'coaching_interventions': o.coaching_interventions, 'next_best_actions': o.next_best_actions,
        'policy_findings': o.policy_findings, 'requirements': o.customer_requirements.requirements,
    }
    for name, items in groups.items():
        out += [(name, e) for item in items for e in item.evidence]
    for name in ('budget', 'occasion'):
        claim = getattr(o.customer_requirements, name)
        if claim is not None:
            out += [(name, e) for e in claim.evidence]
    for name in type(o.signals).model_fields:
        out += [(f'signal:{name}', e) for e in getattr(o.signals, name).evidence]
    return out


def validate_response(raw: str, job: dict[str, Any]) -> ModelResponse:
    try:
        response = ModelResponse.model_validate_json(_strip_fences(raw))
    except ValidationError as exc:
        # Field locations only; values may contain transcript text.
        raise InvalidOutput(sorted({'schema:' + '.'.join(str(p) for p in err['loc'][:3]) for err in exc.errors()})[:10]) from None
    errors: list[str] = []
    segments = {s['segment_id']: s for s in job['segments']}
    for location, ref in _refs(response):
        segment = segments.get(str(ref.segment_id))
        if segment is None:
            errors.append(f'unknown_segment:{location}')
        elif not quote_in(ref.quote, segment.get('raw_text'), segment.get('display_text'), segment.get('translation_en')):
            errors.append(f'quote_not_in_segment:{location}')
    if response.status_hint == 'scored':
        expected = [d['key'] for d in job['rubric']['dimensions']]
        if sorted(d.key for d in response.dimensions) != sorted(expected):
            errors.append('dimension_keys_mismatch')
        clauses = {c['clause_id'] for c in (job.get('sop') or {}).get('clauses', [])}
        for finding in response.output.policy_findings if response.output else []:
            if finding.clause_id not in clauses:
                errors.append('unknown_sop_clause')
            if finding.severity == 'high' and any((segments.get(str(e.segment_id)) or {}).get('speaker') != 'employee' for e in finding.evidence):
                errors.append('high_finding_without_employee_evidence')
    if errors:
        raise InvalidOutput(sorted(set(errors))[:10])
    return response


async def run_analyzer(analyzer: Analyzer, job: dict[str, Any], repair_attempts: int) -> ModelResponse:
    user = build_user_prompt(job)
    errors: list[str] = []
    for attempt in range(repair_attempts + 1):
        prompt = user if attempt == 0 else user + '\n\n' + REPAIR_PROMPT.format(errors=', '.join(errors))
        try:
            return validate_response(await analyzer.complete(SYSTEM_PROMPT, prompt), job)
        except InvalidOutput as exc:
            errors = exc.errors
    raise Fault(422, 'invalid_model_output')


def submission(response: ModelResponse | None, analyzer: Analyzer | None, fallback_reason: str | None) -> dict[str, Any]:
    if response is None or response.status_hint == 'insufficient_evidence':
        status, output, dimensions = 'insufficient_evidence', {}, []
    else:
        status = 'scored'
        output = response.output.model_dump(mode='json') if response.output else {}
        dimensions = [d.model_dump(mode='json') for d in response.dimensions]
    return {
        'status_hint': status,
        'analyzer': {
            'provider': analyzer.provider if analyzer else 'rules',
            'model': analyzer.model if analyzer else 'insufficient-speech-gate',
            'prompt_version': PROMPT_VERSION,
            'fallback_used': fallback_reason is not None,
            'fallback_reason': fallback_reason,
        },
        'output': output,
        'dimensions': dimensions,
    }


async def analyze_job(job: dict[str, Any], primary: Analyzer, fallback: Analyzer | None = None, repair_attempts: int = 2) -> dict[str, Any]:
    """Returns the analysis_submit `result`. A fallback is used only when configured and is always recorded."""
    if insufficient_speech(job):
        return submission(None, None, None)
    try:
        return submission(await run_analyzer(primary, job, repair_attempts), primary, None)
    except Fault as exc:
        if fallback is None:
            raise
        reason = 'primary_invalid_output' if exc.code == 'invalid_model_output' else 'primary_unavailable'
    return submission(await run_analyzer(fallback, job, repair_attempts), fallback, reason)


class AnalysisWorker:
    def __init__(self, boundary: Boundary, primary: Analyzer, fallback: Analyzer | None = None, worker_id: str | None = None,
                 supported_job_versions: frozenset[str] = frozenset({'mk-sales-v1'}), repair_attempts: int = 2, timeout_seconds: float = 240):
        self.boundary, self.primary, self.fallback = boundary, primary, fallback
        self.worker_id = worker_id or str(uuid4())
        self.supported = supported_job_versions
        self.repair_attempts = repair_attempts
        self.timeout = timeout_seconds  # Below the 5-minute database lease.

    async def once(self) -> bool:
        job = (await self.boundary.call('analysis_claim', {'worker_id': self.worker_id})).get('job')
        if not job:
            return False
        lease = {'job_id': job['id'], 'worker_id': job['worker_id'], 'lease_token': job['lease_token']}
        code, retryable = 'analysis_failed', True
        try:
            if job.get('job_version') not in self.supported:
                # Explicit versioning: an unknown pipeline version is never run with today's prompt.
                code, retryable = 'unsupported_job_version', False
                raise Fault(422, code)
            async with asyncio.timeout(self.timeout):
                result = await analyze_job(job, self.primary, self.fallback, self.repair_attempts)
            await self.boundary.call('analysis_submit', {**lease, 'result': result})
            return True
        except Fault as exc:
            code = exc.code if exc.code.replace('_', '').isalpha() else 'analysis_failed'
        except TimeoutError:
            code = 'analysis_timeout'
        except Exception:
            code = 'analysis_failed'
        await self.boundary.call('analysis_fail', {**lease, 'error_code': code[:64], 'retryable': retryable})
        return True

    async def run(self) -> None:
        next_reconcile = 0.0
        while True:
            try:
                if time.monotonic() >= next_reconcile:
                    await self.boundary.call('analysis_reconcile', {})
                    next_reconcile = time.monotonic() + 60
                worked = await self.once()
            except Exception:
                worked = False  # Lease expiry recovers the job; no sensitive logging.
            if not worked:
                await asyncio.sleep(2)
