"""Bounded worker; DB owns leases, retry/backoff/dead-letter and final reconciliation."""
from __future__ import annotations
import asyncio
import math
import time
from typing import Any, Protocol
from uuid import UUID, uuid4, uuid5
from recorder import Boundary, Objects, Fault, integer, object_key, scope_from_session

SEGMENT_NAMESPACE = UUID('49daa17e-cbc0-43c5-81b8-a921ae221f22')


def critical_signal(segment: dict[str, Any]) -> str | None:
    """Fail closed: provider must ground one supported critical signal in full final text."""
    signal = segment.get('critical_signal')
    text = segment.get('text')
    if not isinstance(signal, dict) or not isinstance(text, str) or len(text.strip()) < 20:
        return None
    confidence = signal.get('confidence')
    if (signal.get('code') not in ('critical_compliance', 'critical_customer_safety')
            or signal.get('unambiguous') is not True
            or type(confidence) not in (int, float) or not math.isfinite(confidence) or not .99 <= confidence <= 1
            or signal.get('evidence_text') != text.strip()):
        return None
    return signal['code']


class Processor(Protocol):
    async def transcribe(self, job: dict[str, Any], manifest: list[dict[str, Any]]) -> list[dict[str, Any]]: ...


class Worker:
    def __init__(self, boundary: Boundary, objects: Objects, processor: Processor, worker_id: str | None = None, coaching_enabled: bool = False):
        self.boundary,self.objects,self.processor=boundary,objects,processor
        self.worker_id = worker_id or str(uuid4())
        self.coaching_enabled = coaching_enabled

    async def once(self) -> bool:
        job = (await self.boundary.call('claim_job', {'worker_id':self.worker_id})).get('job')
        if not job:
            return False
        success = False
        reason = 'processing_failed'
        try:
            # Less than DB job lease; no duplicate active processors after a slow GPU call.
            async with asyncio.timeout(100):
                claims = scope_from_session(job['session'])
                chunks = job['chunks']
                if not isinstance(chunks,list) or len(chunks)>7200:
                    raise Fault(422,'invalid_manifest')
                manifest=[]
                for chunk in chunks:
                    seq=integer(chunk['sequence'],0,7199)
                    if chunk['object_key'] != object_key(claims,seq,chunk['sha256']):
                        raise Fault(403,'object_scope_mismatch')
                    # Context overlap supplied to model only; never inserted as canonical samples.
                    if job['kind']=='provisional' and seq not in (job['sequence']-1,job['sequence']):
                        continue
                    manifest.append({**chunk,'url':await self.objects.signed_read(chunk['object_key'])})
                result = await self.processor.transcribe(job,manifest)
                if not isinstance(result,list) or len(result)>7200:
                    raise Fault(422,'invalid_processor_response')
                seen=set()
                for segment in result:
                    seq=integer(segment.get('sequence'),0,7199)
                    if seq in seen or seq not in {c['sequence'] for c in manifest}:
                        raise Fault(422,'invalid_processor_sequence')
                    seen.add(seq)
                    if job['kind']=='provisional' and seq!=job['sequence']:
                        continue  # Ignore overlap text; previous segment retains its identity.
                    text=segment.get('text')
                    if not isinstance(text,str) or len(text)>12000:
                        raise Fault(422,'invalid_processor_text')
                    start=integer(segment.get('started_ms'),0,14400000)
                    end=integer(segment.get('ended_ms'),start,14400000)
                    await self.boundary.call('event',{**claims,'job_id':job['id'],'worker_id':self.worker_id,'lease_token':job['lease_token'],'segment_id':str(uuid5(SEGMENT_NAMESPACE,f"{claims['session_id']}:{seq}")),'sequence':seq,'revision':2 if job['kind']=='final' else 1,'is_final':job['kind']=='final','text':text,'started_ms':start,'ended_ms':end})
                expected={c['sequence'] for c in manifest} if job['kind']=='final' else {job['sequence']}
                if not expected.issubset(seen):
                    raise Fault(422,'incomplete_processor_result')
                # No alerts until the complete final result and canonical event writes
                # have succeeded. SQL independently checks opt-in, final evidence,
                # job lease, rate limit and deduplication.
                if job['kind']=='final' and self.coaching_enabled and job.get('coaching_enabled') is True:
                    for segment in result:
                        code = critical_signal(segment)
                        if code is not None:
                            await self.boundary.call('alert', {**claims,'job_id':job['id'],'worker_id':self.worker_id,'lease_token':job['lease_token'],'segment_id':str(uuid5(SEGMENT_NAMESPACE,f"{claims['session_id']}:{segment['sequence']}")),'code':code,'unambiguous':True,'confidence':segment['critical_signal']['confidence'],'evidence_text':segment['text'].strip()})
                success=True
        except Fault as exc:
            reason=exc.code
        except Exception:
            pass
        await self.boundary.call('finish_job',{'job_id':job['id'],'worker_id':self.worker_id,'lease_token':job['lease_token'],'success':success,'error_reason':None if success else reason})
        return True

    async def run(self) -> None:
        next_reconcile = 0.0
        while True:
            try:
                if time.monotonic() >= next_reconcile:
                    await self.boundary.call('reconcile', {})
                    next_reconcile = time.monotonic() + 60
                worked=await self.once()
            except Exception:
                # DB lease recovery handles failures; do not log sensitive dependency exceptions.
                worked=False
            if not worked:
                await asyncio.sleep(2)
