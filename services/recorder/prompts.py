"""Versioned analysis prompt. Change PROMPT_VERSION whenever the text changes.

Calibration rules are carried from the legacy qwen3_triage.py and the owner's
2026-11-05 brief. The model only recommends; the server scores.
"""
from __future__ import annotations

import json
from typing import Any

from contracts import ModelResponse
from redact import redact

PROMPT_VERSION = 'mk-sales-prompt-v1'

SYSTEM_PROMPT = """You review one recorded MK Jewels store conversation for sales coaching.
Return ONLY one JSON object matching the supplied JSON Schema. No markdown, no prose outside JSON.

Evidence:
- Every claim, signal, dimension rating, coaching point, next action and policy finding cites
  evidence as {"segment_id", "quote"}: the quote is words copied exactly from that one segment.
- Never invent words, names, prices or facts. Only use the transcript and the supplied SOP clauses.
- Speaker labels may be "unknown". Do not assume who said an unknown line. Do not credit or blame
  the employee for words from an unknown or customer speaker.

Scoring each rubric dimension:
- "assessed" with an integer rating 0-10 only when the transcript shows the behaviour; cite it.
- "not_applicable" when the situation did not arise (for example no objection was raised).
- "insufficient_evidence" when it may have happened but the transcript cannot show it.
- Never give a neutral 5 to fill a gap. Do not compute totals; the server does that.

Calibration (conservative):
1. Asking the price, rate, making charges, discount or best price is NOT a price objection or
   price concern. price_concern needs clear dissatisfaction, inability to proceed, a walk-away
   signal or a broken negotiation.
2. An objection needs clear resistance, refusal, distrust or doubt. Short, garbled or ambiguous
   fragments are not signals.
3. A different but working sales style is not an SOP failure. Rapport, listening and adapting
   off-script are positive. Closing in a non-scripted way is positive.
4. Upsell opportunity is a separate signal. Report it only with a concrete customer cue; it is
   never a penalty by itself.
5. Policy findings must cite one SOP clause_id from the supplied version. "high" only when the
   employee states something that directly contradicts that clause, quoted from an employee
   segment. Otherwise use "low" or "medium", or report nothing.
6. Customer requirements (budget, occasion, requirement) only when the customer said them.
7. Do not infer or mention age, gender, emotional state, religion, caste, community, health or
   any other sensitive attribute, and do not guess identity from voice.
8. If the conversation is too short or unclear to judge, return status_hint
   "insufficient_evidence", output null and an empty dimensions list.
9. Write summary, points and coaching in plain English. Give 3-5 key points and 1-3 practical
   coaching interventions. analyzer_confidence is your confidence in the whole review (0-1)."""

REPAIR_PROMPT = ('Your previous answer was rejected: {errors}. Return the corrected JSON object only. '
                 'Quotes must be exact words from the cited segment.')


def _clock(ms: int) -> str:
    seconds = ms // 1000
    return f'{seconds // 60}:{seconds % 60:02d}'


def transcript_lines(segments: list[dict[str, Any]]) -> str:
    lines = []
    for segment in segments:
        if not (segment.get('raw_text') or '').strip():
            continue
        parts = [f"[{segment['segment_id']}] {_clock(segment['start_ms'])} {segment.get('speaker') or 'unknown'}: {redact(segment['raw_text'])}"]
        if segment.get('display_text') and segment['display_text'] != segment['raw_text']:
            parts.append(f'  display: {redact(segment["display_text"])}')
        if segment.get('translation_en'):
            parts.append(f'  english: {redact(segment["translation_en"])}')
        lines.append('\n'.join(parts))
    return '\n'.join(lines)


def build_user_prompt(job: dict[str, Any]) -> str:
    rubric = [{k: d[k] for k in ('key', 'label', 'weight', 'description') if k in d} for d in job['rubric']['dimensions']]
    sop = job.get('sop')
    sop_text = ('No approved SOP version. policy_findings must be [].' if not sop else
                f"SOP version {sop['version']} ({sop['title']}):\n" + '\n'.join(f"- {c['clause_id']} [{c['topic']}] {c['text']}" for c in sop['clauses']))
    return '\n\n'.join([
        f'Rubric dimensions (return exactly one entry per key):\n{json.dumps(rubric, ensure_ascii=False)}',
        sop_text,
        'JSON Schema:\n' + json.dumps(ModelResponse.model_json_schema(), separators=(',', ':')),
        'Transcript (segment id, time, speaker, text; contact numbers are masked):\n' + transcript_lines(job['segments']),
    ])
