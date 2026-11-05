"""Processor contract, audio integrity, speaker rules and compatibility with the recorder's transcript builder."""
import hashlib
import math
import struct
import sys
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from starlette.testclient import TestClient

from processor import (CHUNK_BYTES, FORMAT, Piece, Processor, Settings, Turn, Word, assemble, assign_roles,
                       chunk_segments, create_app, label_stats, repeated_word_run, timeline)
from bench import error_rate, percentile, summarise

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'recorder'))
from transcript import build_revision_segments, processor_metadata  # noqa: E402

TOKEN = 'synthetic-processor-token-0123456789'
HOST = 'audio-bucket.s3.ap-south-1.amazonaws.com'


def tone(seconds: float, amplitude: int) -> bytes:
    count = int(seconds * 16000)
    return b''.join(struct.pack('<h', int(amplitude * math.sin(i / 8))) for i in range(count))


class FakeEngine:
    provider, model = 'faster-whisper', 'large-v3'

    def __init__(self, pieces):
        self.pieces, self.calls = pieces, []

    def transcribe(self, pcm, turns):
        self.calls.append((len(pcm), turns))
        return self.pieces


class FakeDiarizer:
    provider = 'pyannote/speaker-diarization-3.1'

    def __init__(self, turns):
        self.turns = turns

    def diarize(self, pcm):
        return self.turns


def stack(chunks: dict[int, bytes], engine, diarizer=None, tamper: set[int] = frozenset()):
    def handle(request: httpx.Request):
        sequence = int(request.url.path.rsplit('/', 1)[-1])
        data = chunks[sequence]
        return httpx.Response(200, content=data[:-2] + b'\x01\x00' if sequence in tamper else data)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    processor = Processor(Settings(token=TOKEN, audio_hosts=(HOST,)), engine, diarizer, client)
    return TestClient(create_app(processor))


def body(chunks: dict[int, bytes], kind='final', host=HOST):
    return {'job_id': str(uuid4()), 'session_id': str(uuid4()), 'kind': kind, 'format': FORMAT,
            'chunks': [{'sequence': s, 'sha256': hashlib.sha256(d).hexdigest(), 'byte_count': len(d), 'url': f'https://{host}/recordings/x/{s}'} for s, d in chunks.items()]}


AUTH = {'Authorization': 'Bearer ' + TOKEN}


def test_final_job_contract_speakers_and_transcript_builder_parity():
    employee, customer = tone(2.0, 12000), tone(2.0, 1500)   # employee ~18 dB louder (worn mic)
    chunks = {0: employee, 1: customer, 2: employee[:8000]}  # last chunk is a paused partial
    words = (Word(0.1, 0.6, ' Namaste', 0.95), Word(0.6, 1.2, ' ji', 0.9), Word(2.1, 2.8, ' bridal', 0.8), Word(2.8, 3.5, ' necklace', 0.7))
    engine = FakeEngine([Piece(0.1, 3.5, 'Namaste ji bridal necklace', 0.85, 'hi', words), Piece(4.0, 4.2, 'haan', 0.9, 'hi')])
    turns = [Turn(0.0, 2.0, 'SPEAKER_00'), Turn(2.0, 4.0, 'SPEAKER_01'), Turn(4.0, 4.25, 'SPEAKER_00')]
    client = stack(chunks, engine, FakeDiarizer(turns))
    response = client.post('/v1/transcribe', json=body(chunks), headers=AUTH)
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result['provider'], result['model'], result['diarization_provider']) == ('faster-whisper', 'large-v3', 'pyannote/speaker-diarization-3.1')
    assert [s['sequence'] for s in result['segments']] == [0, 1, 2]       # every requested chunk answered
    first, second = result['segments'][0]['utterances'], result['segments'][1]['utterances']
    assert first[0]['text'] == 'Namaste ji' and first[0]['speaker_role'] == 'employee' and first[0]['speaker_confidence'] >= 0.85
    assert second[0]['text'] == 'bridal necklace' and second[0]['speaker_role'] == 'customer' and second[0]['offset_ms'] == 100
    assert second[0]['confidence'] == 0.75                               # mean word probability
    # The recorder builds its immutable revision from this result without changes.
    segments, meta = processor_metadata(result)
    revision = build_revision_segments(str(uuid4()), segments)
    assert meta == {'stt_provider': 'faster-whisper', 'stt_model': 'large-v3', 'diarization_provider': 'pyannote/speaker-diarization-3.1'}
    assert [(r['speaker'], r['start_ms'], r['raw_text']) for r in revision] == [('employee', 100, 'Namaste ji'), ('customer', 2100, 'bridal necklace'), ('employee', 4000, 'haan')]


def test_provisional_job_has_no_diarization_and_unknown_speakers():
    chunks = {4: tone(2.0, 5000), 5: tone(2.0, 5000)}
    engine = FakeEngine([Piece(2.2, 3.0, 'kitna gram', 0.8, 'hi')])
    diarizer = FakeDiarizer([Turn(0, 4, 'A')])
    result = stack(chunks, engine, diarizer).post('/v1/transcribe', json=body(chunks, 'provisional'), headers=AUTH).json()
    assert result['diarization_provider'] is None and engine.calls[0][1] is None
    live = result['segments'][1]
    assert live['sequence'] == 5 and live['text'] == 'kitna gram' and live['started_ms'] == 10200
    assert live['utterances'][0]['speaker_role'] is None


def test_refuses_bad_auth_hosts_tampering_and_oversized_provisional():
    chunks = {0: tone(2.0, 3000)}
    client = stack(chunks, FakeEngine([]))
    assert client.post('/v1/transcribe', json=body(chunks)).status_code == 401
    assert client.post('/v1/transcribe', json=body(chunks), headers={'Authorization': 'Bearer wrong'}).status_code == 401
    assert client.post('/v1/transcribe', json=body(chunks, host='evil.example'), headers=AUTH).status_code == 403
    bad = body(chunks); bad['format'] = {**FORMAT, 'sample_rate': 8000}
    assert client.post('/v1/transcribe', json=bad, headers=AUTH).status_code == 422
    three = {0: chunks[0], 1: chunks[0], 2: chunks[0]}
    assert stack(three, FakeEngine([])).post('/v1/transcribe', json=body(three, 'provisional'), headers=AUTH).status_code == 422
    tampered = stack(chunks, FakeEngine([]), tamper={0}).post('/v1/transcribe', json=body(chunks), headers=AUTH)
    assert tampered.status_code == 409 and tampered.json() == {'error': 'audio_integrity'}


def test_model_failure_never_echoes_details():
    class Broken(FakeEngine):
        def transcribe(self, pcm, turns):
            raise RuntimeError('secret transcript text /models/path')
    chunks = {0: tone(2.0, 3000)}
    response = stack(chunks, Broken([])).post('/v1/transcribe', json=body(chunks), headers=AUTH)
    assert response.status_code == 503 and 'secret' not in response.text


def test_role_rules_are_conservative():
    assert assign_roles({'A': (30.0, -20.0), 'B': (20.0, -32.0)})['A'] == ('employee', 0.97)
    assert assign_roles({'A': (30.0, -20.0), 'B': (20.0, -24.0)})['A'][1] < 0.85        # 4 dB: not sure
    assert assign_roles({'A': (30.0, -20.0)}) == {'A': ('employee', 0.6)}                # one voice: never confident
    assert assign_roles({'A': (2.0, -20.0), 'B': (40.0, -30.0)})['A'][1] < 0.85          # barely speaking "employee"
    assert assign_roles({'A': (0.5, -10.0)}) == {}
    stats = label_stats(tone(1.0, 12000) + tone(1.0, 1200), [Turn(0, 1, 'A'), Turn(1, 2, 'B')])
    assert stats['A'][1] - stats['B'][1] == pytest.approx(20.0, abs=0.5)


def test_repeated_words_lower_confidence_and_timeline_alignment():
    assert repeated_word_run('ji ji ji ji ji ji') and not repeated_word_run('ji ji haan ji')
    utterance = assemble([Piece(0, 1, 'ji ji ji ji ji ji', 0.9, 'hi')], None, {})[0]
    assert utterance['confidence'] == 0.3 and utterance['speaker_role'] is None
    pcm = timeline([(3, b'\x01\x00' * 10), (5, b'\x02\x00' * 4)])
    assert len(pcm) == 2 * CHUNK_BYTES + 8 and pcm[:20] == b'\x01\x00' * 10 and pcm[-8:] == b'\x02\x00' * 4
    # Speech placed in a gap chunk is attached to the previous present chunk.
    segs = chunk_segments([{'start_s': 2.5, 'end_s': 3.0, 'text': 'x', 'confidence': None, 'language': None, 'translation_en': None, 'speaker_role': None, 'speaker_confidence': None}], {3: 20, 5: 8}, 3)
    assert segs[0]['utterances'][0]['offset_ms'] == 2500 and segs[1]['utterances'] == []


def test_bench_metrics():
    assert error_rate('namaste ji kaise ho', 'namaste ji kaise') == 0.25
    assert error_rate('abc', 'abd', 'char') == pytest.approx(0.3333, abs=1e-3)
    assert error_rate('', 'x') is None
    assert percentile([1, 2, 3, 4, 10], 0.95) == 10
    summary = summarise({'a': {'wer': 0.2, 'cer': 0.1, 'real_time_factor': 0.1, 'provisional_lag_p95_s': 1.2, 'unknown_speaker_share': 0.3, 'mean_confidence': 0.8, 'reference_language': 'hi'},
                         'b': {'wer': 0.4, 'cer': 0.2, 'real_time_factor': 0.3, 'provisional_lag_p95_s': 2.0, 'unknown_speaker_share': 0.1, 'mean_confidence': 0.6, 'reference_language': 'hi'}})
    assert summary['hi']['wer'] == 0.3 and summary['hi']['provisional_lag_p95_s'] == 2.0
