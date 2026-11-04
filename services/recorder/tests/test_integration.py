import asyncio
import base64
import hashlib
import json
import socket
import threading
import time
from contextlib import contextmanager

import httpx
import pytest
import uvicorn
from websockets.sync.client import connect

from recorder import create_app, Settings
from worker import Worker
from support import Canonical, PrivateFiles


@contextmanager
def serving(app, **tls):
    sock = socket.socket()
    sock.bind(('127.0.0.1',0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app,log_level='critical',access_log=False,ws_max_size=100000,ws_max_queue=2,**tls))
    thread = threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True)
    thread.start()
    for _ in range(2000):
        if server.started: break
        time.sleep(.01)
    assert server.started
    try: yield f'http://127.0.0.1:{port}'
    finally:
        server.should_exit=True
        thread.join(5)
        sock.close()


@pytest.fixture
def stack(tmp_path):
    canonical = Canonical(tmp_path/'canonical.sqlite')
    objects = PrivateFiles(tmp_path/'objects')
    settings = Settings(allow_loopback_http=True,origins=('https://jewelos.example',),lease_seconds=2,max_leases=3,max_inflight=1)
    app = create_app(settings,canonical,objects)
    with serving(app) as url:
        with httpx.Client(base_url=url) as client:
            yield canonical,objects,client,url


def auth(canonical,client):
    response = client.post('/v1/connect',json={'ticket':canonical.ticket()})
    assert response.status_code==200,response.text
    return {'Authorization':'Bearer '+response.json()['ingest_token']}


def chunk(canonical,sequence=0,data=b'\x00\x01'*8):
    return dict(session_id=canonical.session['id'],**{k:canonical.session[k] for k in ('device_id','tenant_id','branch_id','employee_id')},sequence=sequence,sha256=hashlib.sha256(data).hexdigest(),data=base64.b64encode(data).decode())


def test_lost_ack_reconnect_partial_flush_eos_and_conflict(stack):
    c,o,http,url=stack
    with connect(url.replace('http:','ws:')+'/v1/stream') as ws:
        ws.send(json.dumps(dict(type='auth',ticket=c.ticket())))
        assert json.loads(ws.recv())['type']=='authenticated'
        ws.send(json.dumps(dict(type='chunk',**chunk(c))))
        # Drop connection after durable write, deliberately ignore the ACK.
        time.sleep(.05)
    headers=auth(c,http)
    assert http.post('/v1/chunks',headers=headers,json=chunk(c)).json()['next_sequence']==1
    assert http.post('/v1/chunks',headers=headers,json=chunk(c,data=b'\x02\x00')).status_code==409
    assert http.post('/v1/chunks',headers=headers,json=chunk(c,2)).status_code==409
    assert http.post('/v1/chunks',headers=headers,json=chunk(c,1,b'\x01\x00')).status_code==200
    assert http.post('/v1/commit',headers=headers,json={'last_sequence':3}).status_code==409
    for _ in range(2):
        assert http.post('/v1/commit',headers=headers,json={'last_sequence':1}).json()['session']['status']=='processing'
    with c.db() as db: assert db.execute('SELECT count(*) FROM chunks').fetchone()[0]==2


def test_ticket_replay_expiry_scope_and_checksum(stack):
    c,o,http,url=stack
    ticket=c.ticket()
    assert http.post('/v1/connect',json={'ticket':ticket}).status_code==200
    assert http.post('/v1/connect',json={'ticket':ticket}).status_code==401
    assert http.post('/v1/connect',json={'ticket':c.ticket(-1)}).status_code==401
    h=auth(c,http)
    bad=chunk(c);bad['employee_id']='00000000-0000-0000-0000-000000000000'
    assert http.post('/v1/chunks',headers=h,json=bad).status_code==403
    bad=chunk(c);bad['sha256']='0'*64
    assert http.post('/v1/chunks',headers=h,json=bad).status_code==422
    time.sleep(2.1)
    assert http.post('/v1/chunks',headers=h,json=chunk(c)).status_code==401


def test_no_ack_on_storage_failure_and_bounded_payloads(stack):
    c,o,http,url=stack
    h=auth(c,http);o.fail=True
    assert http.post('/v1/chunks',headers=h,json=chunk(c)).status_code==503
    with c.db() as db: assert db.execute('SELECT count(*) FROM chunks').fetchone()[0]==0
    assert http.post('/v1/chunks',headers=h,json=chunk(c,data=b'x'*64002)).status_code==413
    assert http.post('/v1/chunks',headers=h,json=chunk(c,data=b'x')).status_code==422
    assert http.post('/v1/connect',json={'ticket':'x'*100000}).status_code==413


def test_plaintext_fail_closed_ws_initial_auth_and_health(stack):
    c,o,http,url=stack
    with connect(url.replace('http:','ws:')+'/v1/stream') as ws:
        ws.send(json.dumps(dict(type='chunk',**chunk(c))))
        assert json.loads(ws.recv())['error']=='authentication_required'
    assert http.get('/healthz').json()=={'status':'alive'}
    assert http.get('/readyz').status_code==200
    with serving(create_app(Settings(),c,o)) as secure_url:
        assert httpx.post(secure_url+'/v1/connect',json={'ticket':c.ticket()}).status_code==426


def test_capacity_rejects_without_consuming_ticket(stack):
    c,o,http,url=stack
    for _ in range(3): auth(c,http)
    ticket=c.ticket()
    assert http.post('/v1/connect',json={'ticket':ticket}).status_code==429
    time.sleep(2.1)
    assert http.post('/v1/connect',json={'ticket':ticket}).status_code==200


def test_worker_retry_dead_letter_and_final_reconciliation(stack):
    c,o,http,url=stack
    h=auth(c,http)
    http.post('/v1/chunks',headers=h,json=chunk(c))
    http.post('/v1/commit',headers=h,json={'last_sequence':0})
    class Processor:
        fail=True
        async def transcribe(self,job,manifest):
            if self.fail: raise RuntimeError('sensitive external response must not escape')
            assert manifest[0]['sequence']==0
            return [dict(sequence=0,text='synthetic final' if job['kind']=='final' else 'synthetic provisional',started_ms=0,ended_ms=1)]
    p=Processor();w=Worker(c,o,p)
    asyncio.run(w.once());p.fail=False
    asyncio.run(w.once());asyncio.run(w.once())
    with c.db() as db:
        assert db.execute('SELECT count(*),max(final),max(revision) FROM events').fetchone()==(1,1,2)
        assert db.execute("SELECT count(*) FROM jobs WHERE state='done'").fetchone()[0]==2
    # A fresh provisional job repeatedly fails and is dead-lettered durably.
    with c.db() as db: db.execute("INSERT INTO jobs VALUES('dead','provisional',1,'pending',0,'')")
    p.fail=True
    for _ in range(3): asyncio.run(w.once())
    with c.db() as db: assert db.execute("SELECT state FROM jobs WHERE id='dead'").fetchone()[0]=='dead'



def test_backpressure_returns_retryable_without_receipt(stack):
    c,o,http,url=stack
    h=auth(c,http)
    entered=threading.Event()
    released=threading.Event()
    original=o.put
    async def blocked(key,data,digest):
        entered.set()
        while not released.is_set(): await asyncio.sleep(.01)
        await original(key,data,digest)
    o.put=blocked
    # Reserve all service slots with separate clients; test config uses one slot.
    result=[]
    def upload(): result.append(httpx.post(url+'/v1/chunks',headers=h,json=chunk(c)))
    thread=threading.Thread(target=upload);thread.start()
    assert entered.wait(2)
    try:
        response=http.post('/v1/chunks',headers=h,json=chunk(c))
        assert response.status_code==429
        assert response.headers['retry-after']=='2'
    finally:
        released.set();thread.join(3)
    assert result[0].status_code==200


def test_service_restart_retains_receipts_and_replays_same_session(stack):
    c,o,http,url=stack
    headers=auth(c,http)
    first=http.post('/v1/chunks',headers=headers,json=chunk(c)).json()
    with serving(create_app(Settings(allow_loopback_http=True),c,o)) as second_url:
        with httpx.Client(base_url=second_url) as second:
            # Old in-memory lease is intentionally invalid after ingestion restart.
            assert second.post('/v1/chunks',headers=headers,json=chunk(c)).status_code==401
            renewed=auth(c,second)
            assert second.post('/v1/chunks',headers=renewed,json=chunk(c)).json()==first
    with c.db() as db: assert db.execute('SELECT count(*) FROM chunks').fetchone()[0]==1



def test_rejected_gap_does_not_write_orphan_audio(stack):
    c,o,http,url=stack
    h=auth(c,http)
    assert http.post('/v1/chunks',headers=h,json=chunk(c,3)).status_code==409
    assert list(o.root.rglob('*.pcm'))==[]


def test_real_tls_https_and_wss_with_trusted_certificate(tmp_path):
    import datetime
    import ssl
    import ipaddress
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'127.0.0.1')])
    now=datetime.datetime.now(datetime.timezone.utc)
    cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).sign(key,hashes.SHA256()))
    key_path=tmp_path/'key.pem';cert_path=tmp_path/'cert.pem'
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    trusted=ssl.create_default_context(cafile=str(cert_path))
    c=Canonical(tmp_path/'canonical.sqlite');o=PrivateFiles(tmp_path/'objects')
    with serving(create_app(Settings(),c,o),ssl_keyfile=str(key_path),ssl_certfile=str(cert_path)) as url:
        url=url.replace('http:','https:')
        with httpx.Client(base_url=url,verify=trusted) as http:
            headers=auth(c,http)
            assert http.post('/v1/chunks',headers=headers,json=chunk(c)).status_code==200
        with connect(url.replace('https:','wss:')+'/v1/stream',ssl=trusted) as ws:
            ws.send(json.dumps({'type':'auth','ticket':c.ticket()}))
            assert json.loads(ws.recv())['session']['id']==c.session['id']
            ws.send(json.dumps({'type':'chunk',**chunk(c,1,b'\x01\x00')}))
            assert json.loads(ws.recv())['next_sequence']==2
            ws.send(json.dumps({'type':'commit','last_sequence':1}))
            assert json.loads(ws.recv())['session']['status']=='processing'


def test_connect_attempt_rate_limit_does_not_consume_ticket(tmp_path):
    c=Canonical(tmp_path/'canonical.sqlite');o=PrivateFiles(tmp_path/'objects')
    settings=Settings(allow_loopback_http=True,connect_attempts_per_minute=2)
    with serving(create_app(settings,c,o)) as url:
        with httpx.Client(base_url=url) as http:
            for _ in range(2): assert http.post('/v1/connect',json={'ticket':'synthetic-invalid-ticket'}).status_code==401
            ticket=c.ticket()
            assert http.post('/v1/connect',json={'ticket':ticket}).status_code==429
            with c.db() as db: assert db.execute('SELECT used FROM tickets WHERE ticket=?',(ticket,)).fetchone()[0]==0
