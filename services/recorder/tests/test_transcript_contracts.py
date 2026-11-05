import asyncio
import json
from pathlib import Path
from uuid import uuid4

import pytest

from contracts import SCHEMAS, SCHEMA_DIR, TranscriptFinalize, schema_text
from recorder import Fault, object_key, scope_from_session
from redact import quote_in, redact
from transcript import build_revision_segments, segment_id, speaker, strip_transcript_overlap
from worker import Worker

VECTORS = json.loads((Path(__file__).resolve().parents[1] / 'contracts' / 'redaction_vectors.json').read_text(encoding='utf-8'))['vectors']


@pytest.mark.parametrize('name', sorted(SCHEMAS))
def test_exported_json_schemas_match_models(name):
    assert (SCHEMA_DIR / f'{name}.schema.json').read_text(encoding='utf-8') == schema_text(name), 'run python contracts.py'


@pytest.mark.parametrize('text,expected', VECTORS)
def test_redaction_matches_shared_vectors(text, expected):
    assert redact(text) == expected


def test_quotes_match_original_or_redacted_text_only():
    raw = 'Mera number 98765 43210 hai, kal aayenge.'
    assert quote_in('mera number [PHONE] hai', raw)
    assert quote_in('Mera number 98765 43210', raw)
    assert not quote_in('kal nahi aayenge', raw)
    assert not quote_in('ka', raw)


def test_legacy_overlap_dedup():
    assert strip_transcript_overlap('customer asked about diamond certification', 'diamond certification and making charges') == 'and making charges'
    assert strip_transcript_overlap('a b', 'c d') == 'c d'
    assert strip_transcript_overlap('diamond certification', 'diamond certification') == ''


@pytest.mark.parametrize('role,conf,expected', [
    ('employee', .95, ('employee', .95, 'diarization')),
    ('customer', .85, ('customer', .85, 'diarization')),
    ('employee', .84, ('unknown', None, 'none')),
    ('employee', None, ('unknown', None, 'none')),
    ('employee', True, ('unknown', None, 'none')),
    ('salesperson', .99, ('unknown', None, 'none')),
])
def test_speaker_never_guessed(role, conf, expected):
    assert speaker(role, conf) == expected


def test_revision_segments_keep_identity_offsets_and_languages():
    session = str(uuid4())
    result = [
        {'sequence': 0, 'text': 'Namaste ji', 'started_ms': 0, 'ended_ms': 1900, 'language': 'hi', 'confidence': .91, 'speaker_role': 'employee', 'speaker_confidence': .97},
        {'sequence': 1, 'text': '', 'started_ms': 2000, 'ended_ms': 4000},
        {'sequence': 2, 'text': 'x', 'started_ms': 4000, 'ended_ms': 6000, 'utterances': [
            {'offset_ms': 0, 'end_offset_ms': 900, 'text': 'कितना है', 'display_text': 'Kitna hai', 'translation_en': 'How much is it', 'language': 'hi-Deva', 'speaker_role': 'customer', 'speaker_confidence': .6},
            {'offset_ms': 1000, 'end_offset_ms': 3500, 'text': 'kitna hai making charge', 'includes_context': True},
        ]},
    ]
    segments = build_revision_segments(session, result)
    assert [s['segment_id'] for s in segments] == [segment_id(session, 0), segment_id(session, 2), segment_id(session, 2, 1)]
    assert segments[0]['segment_id'] == str(__import__('uuid').uuid5(__import__('worker').SEGMENT_NAMESPACE, f'{session}:0')), 'same ID as the live recorder segment'
    assert (segments[1]['start_ms'], segments[1]['source_offset_ms'], segments[1]['speaker']) == (4000, 0, 'unknown')
    assert segments[1]['display_text'] == 'Kitna hai' and segments[1]['language'] == 'hi-Deva'
    assert (segments[2]['start_ms'], segments[2]['end_ms'], segments[2]['source_offset_ms']) == (5000, 7500, 1000)
    assert segments[2]['raw_text'] == 'kitna hai making charge', 'no overlap with a different-script previous line'
    TranscriptFinalize.model_validate_json(json.dumps({'stt_provider': 'gpu', 'stt_model': 'm', 'diarization_provider': None, 'segments': segments}))


def test_bad_offsets_fail_closed():
    with pytest.raises(Fault):
        build_revision_segments(str(uuid4()), [{'sequence': 0, 'text': 't', 'started_ms': 0, 'ended_ms': 1, 'utterances': [{'offset_ms': 500, 'end_offset_ms': 100, 'text': 'x'}]}])


@pytest.mark.parametrize('enabled', [True, False])
def test_final_job_finalizes_transcript_only_when_enabled(enabled):
    session = {key: str(uuid4()) for key in ('id', 'device_id', 'employee_id', 'branch_id', 'tenant_id')}
    digest = 'a' * 64
    chunks = [dict(sequence=0, sha256=digest, object_key=object_key(scope_from_session(session), 0, digest))]
    job = dict(id=str(uuid4()), lease_token=str(uuid4()), session=session, kind='final', sequence=-1, chunks=chunks)

    class Boundary:
        calls = []
        async def call(self, action, payload):
            self.calls.append((action, payload))
            return {'job': job} if action == 'claim_job' else {'accepted': True}

    class Objects:
        async def signed_read(self, key): return 'https://private.invalid/object'

    class Processor:
        async def transcribe(self, job, manifest):
            return {'provider': 'private-gpu', 'model': 'indic-conformer-600m', 'segments': [
                {'sequence': 0, 'text': 'Namaste', 'started_ms': 0, 'ended_ms': 900, 'speaker_role': 'employee', 'speaker_confidence': .5}]}

    boundary = Boundary()
    asyncio.run(Worker(boundary, Objects(), Processor(), finalize_transcripts=enabled).once())
    finals = [p for a, p in boundary.calls if a == 'transcript_finalize']
    assert len(finals) == (1 if enabled else 0)
    assert boundary.calls[-1][1]['success'] is True
    if enabled:
        assert finals[0]['stt_model'] == 'indic-conformer-600m'
        assert finals[0]['segments'][0]['speaker'] == 'unknown', 'weak diarization never labelled employee'
        assert finals[0]['lease_token'] == job['lease_token']
