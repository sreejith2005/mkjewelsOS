"""Private GPU processor for the JewelOS recorder worker.

Implements the request the worker's PrivateGPU adapter sends
(services/recorder/adapters.py) and the result services/recorder/transcript.py
turns into an immutable transcript revision:

  POST /v1/transcribe  Authorization: Bearer <processor token>
  {job_id, session_id, kind: provisional|final, format, chunks: [{sequence, sha256, byte_count, url}]}
  -> {provider, model, diarization_provider,
      segments: [{sequence, text, started_ms, ended_ms, utterances: [...]}]}

Rules kept from the legacy pipeline: original-language raw text, context audio
only for provisional jobs, repeated-word guard, diarization by pyannote.
Changed on purpose: the employee voice is never guessed from talk time alone;
a speaker role is reported with a confidence and the worker keeps it only at
>= 0.85, otherwise the line is "unknown". Text, audio and URLs are never logged.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import math
import re
import sys
from array import array
from dataclasses import dataclass
from typing import Any, Protocol, Sequence
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

SAMPLE_RATE = 16000
CHUNK_BYTES = 64000          # 2 s of mono 16-bit PCM, the canonical chunk.
CHUNK_MS = 2000
MAX_CHUNKS = 7200
MAX_BODY = 4 * 1024 * 1024
MAX_UTTERANCE_S = 60.0       # transcript.py accepts end offsets up to 120 s from the chunk start.
FORMAT = {'encoding': 'pcm_s16le', 'sample_rate': 16000, 'channels': 1}
_HEX64 = re.compile(r'^[0-9a-f]{64}$')
_LANGUAGE = re.compile(r'^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$')
_WORD = re.compile(r'[^\W_]+', re.UNICODE)

# Speaker-role calibration. Pilot defaults; measure with bench.py on store audio before relying on them.
ROLE_MIN_TALK_S = 1.0
ROLE_GAP_UNSURE_DB = 6.0     # Loudest voice must be this much louder than the next to be called the employee.
ROLE_BASE_CONFIDENCE = 0.88
ROLE_MAX_CONFIDENCE = 0.97


class Fault(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


@dataclass(frozen=True)
class Word:
    start_s: float
    end_s: float
    text: str
    probability: float | None = None


@dataclass(frozen=True)
class Piece:
    """One recognised stretch of speech, times relative to the start of the supplied audio."""
    start_s: float
    end_s: float
    text: str
    confidence: float | None = None
    language: str | None = None
    words: tuple[Word, ...] = ()
    translation_en: str | None = None


@dataclass(frozen=True)
class Turn:
    start_s: float
    end_s: float
    label: str


class Engine(Protocol):
    provider: str
    model: str
    def transcribe(self, pcm: bytes, turns: Sequence[Turn] | None) -> list[Piece]: ...


class Diarizer(Protocol):
    provider: str
    def diarize(self, pcm: bytes) -> list[Turn]: ...


@dataclass(frozen=True)
class Settings:
    token: str
    audio_hosts: tuple[str, ...]
    deadline_s: float = 80.0         # Below the worker adapter's 85 s HTTP deadline.
    fetch_concurrency: int = 8
    allow_http_audio: bool = False   # Test injection only; never set by production.py.


# ---------------------------------------------------------------------------
# Pure helpers (unit tested).

def repeated_word_run(text: str, limit: int = 5) -> bool:
    """Legacy guard: a word repeated more than `limit` times in a row means a decoding loop."""
    previous, run = '', 0
    for word in _WORD.findall(text.casefold()):
        run = run + 1 if word == previous else 1
        previous = word
        if run > limit:
            return True
    return False


def _samples(pcm: bytes) -> array:
    data = array('h')
    data.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if sys.byteorder == 'big':
        data.byteswap()
    return data


def label_stats(pcm: bytes, turns: Sequence[Turn], stride: int = 8) -> dict[str, tuple[float, float]]:
    """Per diarization label: (talk seconds, mean level in dBFS). Sampled for speed."""
    samples = _samples(pcm)
    totals: dict[str, list[float]] = {}
    for turn in turns:
        first = max(0, int(turn.start_s * SAMPLE_RATE))
        last = min(len(samples), int(turn.end_s * SAMPLE_RATE))
        if last <= first:
            continue
        energy = 0.0
        count = 0
        for index in range(first, last, stride):
            value = samples[index]
            energy += value * value
            count += 1
        entry = totals.setdefault(turn.label, [0.0, 0.0, 0])
        entry[0] += (last - first) / SAMPLE_RATE
        entry[1] += energy
        entry[2] += count
    return {label: (talk, 10 * math.log10(energy / max(count, 1) / (32768.0 ** 2) + 1e-12)) for label, (talk, energy, count) in totals.items()}


def assign_roles(stats: dict[str, tuple[float, float]]) -> dict[str, tuple[str, float]]:
    """Which diarized voice is the employee.

    The recorder is worn by (or sits next to) the employee, so the employee's
    voice is normally clearly the loudest. Only a clear level gap earns a
    confident role; everything else stays below the 0.85 cut-off and the worker
    stores "unknown". Talk time alone (the legacy rule) is never enough.
    """
    voices = {label: value for label, value in stats.items() if value[0] >= ROLE_MIN_TALK_S}
    if not voices:
        return {}
    ranked = sorted(voices, key=lambda label: voices[label][1], reverse=True)
    if len(ranked) == 1:
        return {ranked[0]: ('employee', 0.6)}
    gap = voices[ranked[0]][1] - voices[ranked[1]][1]
    if gap < ROLE_GAP_UNSURE_DB:
        confidence = 0.6 if gap < 3 else 0.8
    else:
        confidence = min(ROLE_MAX_CONFIDENCE, ROLE_BASE_CONFIDENCE + (gap - ROLE_GAP_UNSURE_DB) * 0.015)
    total = sum(talk for talk, _ in voices.values())
    if voices[ranked[0]][0] / total < 0.15:
        confidence -= 0.2           # A barely speaking "employee" is suspicious.
    if len(ranked) > 2:
        confidence -= 0.05          # Several voices: more room for a wrong split.
    confidence = round(max(0.0, confidence), 3)
    roles = {ranked[0]: ('employee', confidence)}
    for label in ranked[1:]:
        roles[label] = ('customer', confidence)
    return roles


def _overlap(start: float, end: float, turns: Sequence[Turn]) -> tuple[str | None, float]:
    if end <= start:
        end = start + 0.01
    by_label: dict[str, float] = {}
    for turn in turns:
        shared = min(end, turn.end_s) - max(start, turn.start_s)
        if shared > 0:
            by_label[turn.label] = by_label.get(turn.label, 0.0) + shared
    if not by_label:
        return None, 0.0
    label = max(by_label, key=lambda key: by_label[key])
    return label, min(1.0, by_label[label] / (end - start))


def _speaker(start: float, end: float, turns: Sequence[Turn] | None, roles: dict[str, tuple[str, float]]) -> tuple[str | None, float | None]:
    if not turns:
        return None, None
    label, share = _overlap(start, end, turns)
    if label is None or label not in roles:
        return None, None
    role, confidence = roles[label]
    return role, round(confidence * share, 3)


def _clean(text: str) -> str:
    return ' '.join(text.split())


def assemble(pieces: Sequence[Piece], turns: Sequence[Turn] | None, roles: dict[str, tuple[str, float]]) -> list[dict[str, Any]]:
    """Pieces -> speaker-attributed utterances (seconds relative to the supplied audio)."""
    out: list[dict[str, Any]] = []

    def emit(start: float, end: float, text: str, confidence: float | None, language: str | None, translation: str | None) -> None:
        text = _clean(text)
        if not text:
            return
        if repeated_word_run(text):
            confidence = min(confidence if confidence is not None else 1.0, 0.3)
        role, role_confidence = _speaker(start, end, turns, roles)
        out.append({'start_s': start, 'end_s': max(end, start), 'text': text, 'confidence': confidence,
                    'language': language if isinstance(language, str) and _LANGUAGE.match(language) else None,
                    'translation_en': _clean(translation) if translation else None,
                    'speaker_role': role, 'speaker_confidence': role_confidence})

    for piece in sorted(pieces, key=lambda item: item.start_s):
        if turns and piece.words:
            # Split a recognised stretch wherever the speaking voice changes (word timestamps).
            groups: list[tuple[str | None, list[Word]]] = []
            for word in piece.words:
                label, _ = _overlap(word.start_s, word.end_s, turns)
                if groups and groups[-1][0] == label:
                    groups[-1][1].append(word)
                else:
                    groups.append((label, [word]))
            for _, words in groups:
                probabilities = [w.probability for w in words if w.probability is not None]
                emit(words[0].start_s, words[-1].end_s, ''.join(w.text for w in words),
                     round(sum(probabilities) / len(probabilities), 3) if probabilities else piece.confidence,
                     piece.language, piece.translation_en if len(groups) == 1 else None)
        else:
            emit(piece.start_s, piece.end_s, piece.text, piece.confidence, piece.language, piece.translation_en)
    # Bound utterance length so offsets stay inside the transcript contract.
    bounded: list[dict[str, Any]] = []
    for utterance in out:
        if utterance['end_s'] - utterance['start_s'] > MAX_UTTERANCE_S:
            utterance = {**utterance, 'end_s': utterance['start_s'] + MAX_UTTERANCE_S}
        bounded.append(utterance)
    return bounded


def chunk_segments(utterances: Sequence[dict[str, Any]], sizes: dict[int, int], base_sequence: int) -> list[dict[str, Any]]:
    """Utterances -> one result per requested chunk; an utterance belongs to the chunk it starts in."""
    sequences = sorted(sizes)
    attached: dict[int, list[dict[str, Any]]] = {sequence: [] for sequence in sequences}
    base_ms = base_sequence * CHUNK_MS
    for utterance in utterances:
        start_ms = base_ms + round(utterance['start_s'] * 1000)
        end_ms = max(start_ms, base_ms + round(utterance['end_s'] * 1000))
        owner = start_ms // CHUNK_MS
        if owner not in attached:
            earlier = [sequence for sequence in sequences if sequence <= owner]
            owner = earlier[-1] if earlier else sequences[0]
            start_ms = max(start_ms, owner * CHUNK_MS)
            end_ms = max(end_ms, start_ms)
        attached[owner].append({**utterance, 'start_ms': start_ms, 'end_ms': end_ms})
    result: list[dict[str, Any]] = []
    for sequence in sequences:
        chunk_start = sequence * CHUNK_MS
        items = attached[sequence]
        utterance_list = [{
            'offset_ms': item['start_ms'] - chunk_start,
            'end_offset_ms': min(item['end_ms'] - chunk_start, 120000),
            'text': item['text'], 'language': item['language'], 'confidence': item['confidence'],
            'translation_en': item['translation_en'],
            'speaker_role': item['speaker_role'], 'speaker_confidence': item['speaker_confidence'],
        } for item in items]
        if items:
            started, ended = items[0]['start_ms'], max(item['end_ms'] for item in items)
        else:
            started, ended = chunk_start, chunk_start + sizes[sequence] // 32
        result.append({'sequence': sequence, 'text': ' '.join(item['text'] for item in items)[:12000],
                       'started_ms': started, 'ended_ms': max(ended, started), 'utterances': utterance_list})
    return result


def timeline(chunks: Sequence[tuple[int, bytes]]) -> bytes:
    """Contiguous PCM from the first to last requested chunk; gaps and paused partial chunks are silence."""
    ordered = sorted(chunks)
    present = dict(ordered)
    first, last = ordered[0][0], ordered[-1][0]
    pcm = bytearray()
    for sequence in range(first, last + 1):
        data = present.get(sequence)
        if data is None:
            pcm.extend(bytes(CHUNK_BYTES))
            continue
        pcm.extend(data)
        if sequence != last:
            pcm.extend(bytes(CHUNK_BYTES - len(data)))
    return bytes(pcm)


# ---------------------------------------------------------------------------
# Request handling.

def _uuid(value: Any, code: str) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        raise Fault(422, code) from None


def validate_request(body: Any, settings: Settings) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise Fault(422, 'invalid_request')
    kind = body.get('kind')
    if kind not in ('provisional', 'final'):
        raise Fault(422, 'invalid_kind')
    if body.get('format') != FORMAT:
        raise Fault(422, 'unsupported_format')
    chunks = body.get('chunks')
    if not isinstance(chunks, list) or not chunks or len(chunks) > MAX_CHUNKS or (kind == 'provisional' and len(chunks) > 2):
        raise Fault(422, 'invalid_chunks')
    seen: set[int] = set()
    parsed = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            raise Fault(422, 'invalid_chunks')
        sequence, digest, size, url = chunk.get('sequence'), chunk.get('sha256'), chunk.get('byte_count'), chunk.get('url')
        if type(sequence) is not int or not 0 <= sequence < MAX_CHUNKS or sequence in seen:
            raise Fault(422, 'invalid_chunks')
        if not isinstance(digest, str) or not _HEX64.match(digest) or type(size) is not int or not 2 <= size <= CHUNK_BYTES or size % 2:
            raise Fault(422, 'invalid_chunks')
        if not isinstance(url, str) or len(url) > 4096:
            raise Fault(422, 'invalid_audio_url')
        parts = urlsplit(url)
        scheme_ok = parts.scheme == 'https' or (settings.allow_http_audio and parts.scheme == 'http')
        if not scheme_ok or parts.username or parts.password or parts.hostname not in settings.audio_hosts:
            raise Fault(403, 'audio_host_denied')
        seen.add(sequence)
        parsed.append({'sequence': sequence, 'sha256': digest, 'byte_count': size, 'url': url})
    parsed.sort(key=lambda item: item['sequence'])
    if parsed[-1]['sequence'] - parsed[0]['sequence'] >= MAX_CHUNKS:
        raise Fault(422, 'invalid_chunks')
    return {'job_id': _uuid(body.get('job_id'), 'invalid_job'), 'session_id': _uuid(body.get('session_id'), 'invalid_session'), 'kind': kind, 'chunks': parsed}


class Processor:
    def __init__(self, settings: Settings, engine: Engine, diarizer: Diarizer | None, client: httpx.AsyncClient | None = None):
        if not settings.token or len(settings.token) < 24 or not settings.audio_hosts:
            raise ValueError('processor token (24+ chars) and audio host allowlist required')
        self.settings, self.engine, self.diarizer = settings, engine, diarizer
        self.client = client or httpx.AsyncClient(timeout=10, follow_redirects=False, limits=httpx.Limits(max_connections=settings.fetch_concurrency))
        self.gpu = asyncio.Lock()   # One model job at a time per process; scale with processes/GPUs.

    async def fetch(self, chunk: dict[str, Any]) -> bytes:
        try:
            async with self.client.stream('GET', chunk['url']) as response:
                if response.status_code != 200:
                    raise Fault(502, 'audio_unavailable')
                data = bytearray()
                async for part in response.aiter_bytes():
                    data.extend(part)
                    if len(data) > chunk['byte_count']:
                        raise Fault(409, 'audio_integrity')
        except httpx.HTTPError:
            raise Fault(502, 'audio_unavailable') from None
        if len(data) != chunk['byte_count'] or hashlib.sha256(data).hexdigest() != chunk['sha256']:
            raise Fault(409, 'audio_integrity')
        return bytes(data)

    async def run(self, request: dict[str, Any]) -> dict[str, Any]:
        gate = asyncio.Semaphore(self.settings.fetch_concurrency)

        async def bounded(chunk):
            async with gate:
                return chunk['sequence'], await self.fetch(chunk)
        async with asyncio.timeout(self.settings.deadline_s):
            fetched = await asyncio.gather(*(bounded(chunk) for chunk in request['chunks']))
            pcm = timeline(fetched)
            async with self.gpu:
                # Diarization only for the final pass: live text stays speaker "unknown".
                turns = await asyncio.to_thread(self.diarizer.diarize, pcm) if request['kind'] == 'final' and self.diarizer else None
                pieces = await asyncio.to_thread(self.engine.transcribe, pcm, turns)
        roles = assign_roles(label_stats(pcm, turns)) if turns else {}
        utterances = assemble(pieces, turns, roles)
        sizes = {chunk['sequence']: chunk['byte_count'] for chunk in request['chunks']}
        return {'provider': self.engine.provider, 'model': self.engine.model,
                'diarization_provider': self.diarizer.provider if self.diarizer and request['kind'] == 'final' else None,
                'segments': chunk_segments(utterances, sizes, request['chunks'][0]['sequence'])}


def create_app(processor: Processor) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    expected = ('Bearer ' + processor.settings.token).encode()

    @app.exception_handler(Fault)
    async def fault_handler(_request, exc: Fault):
        return JSONResponse({'error': exc.code}, status_code=exc.status, headers={'Cache-Control': 'no-store'})

    @app.get('/healthz')
    async def health():
        return {'status': 'alive'}

    @app.post('/v1/transcribe')
    async def transcribe(request: Request):
        if not hmac.compare_digest(request.headers.get('authorization', '').encode(), expected):
            raise Fault(401, 'unauthorized')
        if int(request.headers.get('content-length') or 0) > MAX_BODY:
            raise Fault(413, 'payload_too_large')
        raw = bytearray()
        async for part in request.stream():
            raw.extend(part)
            if len(raw) > MAX_BODY:
                raise Fault(413, 'payload_too_large')
        try:
            import json
            body = json.loads(raw)
        except (ValueError, UnicodeError):
            raise Fault(422, 'invalid_json') from None
        job = validate_request(body, processor.settings)
        try:
            result = await processor.run(job)
        except Fault:
            raise
        except TimeoutError:
            raise Fault(503, 'processor_deadline') from None
        except Exception:
            # Never echo model/library errors: they can contain audio paths or text.
            raise Fault(503, 'processor_failed') from None
        return JSONResponse(result, headers={'Cache-Control': 'no-store'})

    return app
