import asyncio
from uuid import uuid4

import pytest

from worker import Worker, critical_signal


TEXT = 'Confirmed critical customer safety evidence in this conversation.'


def segment(**signal):
    return dict(sequence=0, text=TEXT, started_ms=0, ended_ms=100,
                critical_signal=dict(code='critical_customer_safety', confidence=.995,
                                     unambiguous=True, evidence_text=TEXT, **signal))


@pytest.mark.parametrize('patch', [
    {'confidence': .98}, {'confidence': float('nan')}, {'confidence': True},
    {'unambiguous': False}, {'code': 'sale_lost'}, {'evidence_text': 'invented context'},
])
def test_uncertain_or_ungrounded_signal_fails_closed(patch):
    item = segment()
    item['critical_signal'].update(patch)
    assert critical_signal(item) is None


@pytest.mark.parametrize('kind,enabled,opt_in,complete,expected', [
    ('final', True, True, True, 1), ('provisional', True, True, True, 0),
    ('final', False, True, True, 0), ('final', True, False, True, 0),
    ('final', True, True, False, 0),
])
def test_only_complete_final_opted_in_jobs_emit_alerts(kind, enabled, opt_in, complete, expected):
    session = {key: str(uuid4()) for key in ('id','device_id','employee_id','branch_id','tenant_id')}
    from recorder import object_key, scope_from_session
    digest = 'a' * 64
    chunks = [dict(sequence=0, sha256=digest, object_key=object_key(scope_from_session(session), 0, digest))]
    if not complete:
        chunks.append(dict(sequence=1, sha256=digest, object_key=object_key(scope_from_session(session), 1, digest)))
    job = dict(id=str(uuid4()), lease_token=str(uuid4()), session=session, kind=kind,
               sequence=0, chunks=chunks, coaching_enabled=opt_in)

    class Boundary:
        calls = []
        async def call(self, action, payload):
            self.calls.append((action, payload))
            return {'job': job} if action == 'claim_job' else {'accepted': True}

    class Objects:
        async def signed_read(self, key): return 'https://private.invalid/object'

    class Processor:
        async def transcribe(self, job, manifest): return [segment()]

    boundary = Boundary()
    asyncio.run(Worker(boundary, Objects(), Processor(), coaching_enabled=enabled).once())
    assert len([a for a, _ in boundary.calls if a == 'alert']) == expected
    assert boundary.calls[-1][1]['success'] is complete


def test_worker_reconciles_before_claiming():
    class Boundary:
        calls = []
        async def call(self, action, payload):
            self.calls.append(action)
            if action == 'claim_job': raise asyncio.CancelledError()
            return {}
    boundary = Boundary()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(Worker(boundary, None, None).run())
    assert boundary.calls == ['reconcile', 'claim_job']
