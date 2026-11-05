"""Builds the finalized machine transcript revision from a final processor result.

Segment identity: uuid5(session:sequence) for the first utterance of a chunk
(the same ID the recorder's live segment uses, so evidence links survive
provisional -> final reconciliation) and uuid5(session:sequence:index) for
further utterances. Timestamps are session-relative; source offsets point
into the canonical 2-second chunk where the utterance starts.
"""
from __future__ import annotations

import math
import re
from typing import Any
from uuid import UUID, uuid5

from recorder import Fault

SEGMENT_NAMESPACE = UUID('49daa17e-cbc0-43c5-81b8-a921ae221f22')
CHUNK_MS = 2000
SPEAKER_CONFIDENCE_MIN = 0.85
MAX_TEXT_BYTES = 16000
_LANGUAGE = re.compile(r'^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$')


def segment_id(session_id: str, sequence: int, index: int = 0) -> str:
    name = f'{session_id}:{sequence}' if index == 0 else f'{session_id}:{sequence}:{index}'
    return str(uuid5(SEGMENT_NAMESPACE, name))


def strip_transcript_overlap(previous_text: str, current_text: str, max_words: int = 12) -> str:
    """Legacy overlap-dedup: drop leading words that repeat the previous tail (context audio)."""
    previous = (previous_text or '').split()
    current = (current_text or '').split()
    if not previous or not current:
        return ' '.join(current)
    for size in range(min(len(previous), len(current), max_words), 0, -1):
        if [w.casefold() for w in previous[-size:]] == [w.casefold() for w in current[:size]]:
            return ' '.join(current[size:])
    return ' '.join(current)


def confidence(value: Any) -> float | None:
    if type(value) in (int, float) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1:
        return round(float(value), 3)
    return None


def speaker(role: Any, value: Any) -> tuple[str, float | None, str]:
    """Never attribute words to employee/customer on a weak or missing diarization guess."""
    conf = confidence(value)
    if role in ('employee', 'customer') and conf is not None and conf >= SPEAKER_CONFIDENCE_MIN:
        return role, conf, 'diarization'
    return 'unknown', None, 'none'


def _text(value: Any, required: bool = False) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value.encode('utf-8')) > MAX_TEXT_BYTES:
        raise Fault(422, 'invalid_processor_text')
    return value.strip()


def _offset(value: Any, upper: int = 120000) -> int:
    if type(value) is not int or not 0 <= value <= upper:
        raise Fault(422, 'invalid_processor_offset')
    return value


def build_revision_segments(session_id: str, result: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Final processor result (validated per-chunk segments) -> transcript_finalize segments.

    A chunk segment may carry `utterances` ([{offset_ms, end_offset_ms, text,
    display_text?, translation_en?, language?, confidence?, speaker_role?,
    speaker_confidence?, includes_context?}]) relative to that chunk's start.
    Without utterances the chunk text is one segment. Silence is omitted.
    """
    out: list[dict[str, Any]] = []
    previous_text = ''
    for chunk in sorted(result, key=lambda item: item['sequence']):
        sequence = chunk['sequence']
        chunk_start = sequence * CHUNK_MS
        utterances = chunk.get('utterances')
        if utterances is None:
            started = chunk['started_ms']
            utterances = [{
                'offset_ms': max(0, started - chunk_start), 'end_offset_ms': max(0, chunk['ended_ms'] - chunk_start),
                'text': chunk.get('text'), 'display_text': chunk.get('display_text'), 'translation_en': chunk.get('translation_en'),
                'language': chunk.get('language'), 'confidence': chunk.get('confidence'),
                'speaker_role': chunk.get('speaker_role'), 'speaker_confidence': chunk.get('speaker_confidence'),
                'includes_context': chunk.get('includes_context'),
            }]
        if not isinstance(utterances, list) or len(utterances) > 50:
            raise Fault(422, 'invalid_processor_response')
        for index, utterance in enumerate(utterances):
            if not isinstance(utterance, dict):
                raise Fault(422, 'invalid_processor_response')
            raw = _text(utterance.get('text'), required=True) or ''
            if utterance.get('includes_context') is True:
                raw = strip_transcript_overlap(previous_text, raw)
            if not raw:
                continue
            offset = _offset(utterance.get('offset_ms'))
            end_offset = _offset(utterance.get('end_offset_ms'))
            if end_offset < offset:
                raise Fault(422, 'invalid_processor_offset')
            role, role_confidence, role_source = speaker(utterance.get('speaker_role'), utterance.get('speaker_confidence'))
            language = utterance.get('language')
            out.append({
                'segment_id': segment_id(session_id, sequence, index),
                'source_sequence': sequence, 'source_offset_ms': offset,
                'start_ms': chunk_start + offset, 'end_ms': chunk_start + end_offset,
                'speaker': role, 'speaker_confidence': role_confidence, 'speaker_source': role_source,
                'language': language if isinstance(language, str) and _LANGUAGE.match(language) else None,
                'raw_text': raw, 'display_text': _text(utterance.get('display_text')), 'translation_en': _text(utterance.get('translation_en')),
                'stt_confidence': confidence(utterance.get('confidence')),
            })
            previous_text = raw
    if len(out) > 20000:
        raise Fault(422, 'invalid_processor_response')
    return out


def processor_metadata(raw: Any) -> tuple[list[dict[str, Any]], dict[str, str | None]]:
    """Processors may return a list (legacy) or {segments, provider, model, diarization_provider}."""
    if isinstance(raw, list):
        return raw, {'stt_provider': None, 'stt_model': None, 'diarization_provider': None}
    if not isinstance(raw, dict) or not isinstance(raw.get('segments'), list):
        raise Fault(422, 'invalid_processor_response')
    meta: dict[str, str | None] = {}
    for key, source, limit in (('stt_provider', 'provider', 80), ('stt_model', 'model', 120), ('diarization_provider', 'diarization_provider', 120)):
        value = raw.get(source)
        meta[key] = value[:limit] if isinstance(value, str) and value.strip() else None
    return raw['segments'], meta
