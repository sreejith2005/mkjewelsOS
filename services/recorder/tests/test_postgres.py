"""Opt-in real canonical SQL + HTTPS/WSS integration on a dedicated synthetic Docker DB.
Never connects to a linked/hosted project or shared development database.
"""
import asyncio
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from websockets.sync.client import connect

from recorder import Fault, Settings, create_app
from worker import Worker
from support import PrivateFiles
from test_integration import serving, chunk, auth

CONTAINER='jewelos-recorder-contract'
pytestmark=pytest.mark.skipif(os.environ.get('RECORDER_POSTGRES_CONTAINER')!=CONTAINER,reason='requires dedicated synthetic recorder Docker contract DB')


class Postgres:
    def __init__(self,database): self.database=database

    def sql(self,sql,database=None,timeout=30):
        # Synthetic fixture/RPC SQL only; no customer data or real credentials. -c
        # avoids docker's Windows stdin writer lingering after EOF.
        result=subprocess.run(['docker','exec',CONTAINER,'psql','-U','supabase_admin','-d',database or self.database,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',sql],text=True,capture_output=True,timeout=timeout)
        if result.returncode:
            # No SQL/payload/psql stderr reflected: it can contain audio text or credentials.
            code=403 if 'denied' in result.stderr or 'service_only' in result.stderr else 409 if 'conflict' in result.stderr or 'order' in result.stderr or 'gap' in result.stderr else 503
            raise Fault(code,'canonical_rpc_rejected')
        lines=[line for line in result.stdout.splitlines() if line.startswith('{')]
        return json.loads(lines[-1]) if lines else {}

    async def call(self,action,payload):
        encoded=json.dumps(payload).replace("'","''")
        return await asyncio.to_thread(self.sql,"BEGIN; SET LOCAL request.jwt.claims = '{\"role\":\"service_role\"}'; SET LOCAL request.jwt.claim.role='service_role'; SELECT recorder_ingest('"+action+"','"+encoded+"'::jsonb); COMMIT;")

    def setup(self):
        t,b,d,a,u,device,request=[str(uuid4()) for _ in range(7)]
        self.employee=u;self.actor=a;self.device=device
        result=self.sql(f"""BEGIN;
INSERT INTO tenants(id,name,slug) VALUES('{t}','Synthetic recorder E2E','recorder-e2e-{t}');
INSERT INTO branches(id,tenant_id,name,code) VALUES('{b}','{t}','Recorder','REC');
INSERT INTO departments(id,tenant_id,branch_id,name,code) VALUES('{d}','{t}','{b}','Recorder','REC');
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) VALUES('{a}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{a}@test.local','x',now(),now());
INSERT INTO user_profiles(id,tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
VALUES('{u}','{t}','{a}','{b}','{d}','Synthetic','REC-{u}','{a}@test.local','super_admin','active',true,'active');
INSERT INTO recorder_config(tenant_id,enabled,employee_ids,branch_ids) VALUES('{t}',true,ARRAY['{u}'::uuid],ARRAY['{b}'::uuid]);
SET LOCAL request.jwt.claims='{{"sub":"{a}","role":"authenticated"}}';
SET LOCAL request.jwt.claim.sub='{a}'; SET LOCAL request.jwt.claim.role='authenticated';
SELECT recorder_issue_ticket('{device}','{request}',null,true,'pilot-v1');
COMMIT;""")
        self.session=result['session'];self.first_ticket=result['ticket']

    def ticket(self):
        result=self.sql(f"""BEGIN; SET LOCAL request.jwt.claims='{{"sub":"{self.actor}","role":"authenticated"}}'; SET LOCAL request.jwt.claim.sub='{self.actor}'; SET LOCAL request.jwt.claim.role='authenticated'; SELECT recorder_issue_ticket('{self.device}',null,'{self.session['id']}',false,null); COMMIT;""")
        return result['ticket']


@pytest.fixture
def postgres():
    name='recorder_e2e_'+uuid4().hex
    assert re.fullmatch(r'recorder_e2e_[0-9a-f]{32}',name)
    db=Postgres(name)
    # Independent schema+catalog copy avoids active pg-meta connections on source postgres.
    db.sql('CREATE DATABASE '+name+' TEMPLATE template0;',database='postgres',timeout=120)
    try:
        # A copied file avoids Windows/Docker large-stdin stalls. Schema restore needs
        # the local Supabase bootstrap owner for extension-owned functions/triggers.
        with tempfile.TemporaryDirectory(prefix='recorder-schema-') as directory:
            for index, flags in enumerate((['--schema-only'],['--data-only','--table=public.permission_catalog'])):
                local=Path(directory)/f'{index}.sql'
                with local.open('wb') as output:
                    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','-d','postgres','--no-owner','--no-acl',*flags],stdout=output,stderr=subprocess.PIPE,timeout=60)
                assert dump.returncode==0,'synthetic schema dump failed'
                remote=f'/tmp/{name}-{index}.sql'
                copied=subprocess.run(['docker','cp',str(local),CONTAINER+':'+remote],capture_output=True,timeout=30)
                assert copied.returncode==0,'synthetic schema copy failed'
                # Atomic schema restore avoids one fsync per DDL statement on slow test disks.
                restore=subprocess.run(['docker','exec',CONTAINER,'psql','-U','supabase_admin','-d',name,'-X','-q','--single-transaction','-v','ON_ERROR_STOP=1','-f',remote],capture_output=True,timeout=300)
                subprocess.run(['docker','exec',CONTAINER,'rm','--',remote],capture_output=True,timeout=30)
                assert restore.returncode==0,'synthetic schema restore failed'
            # Test the checked-in forward migration itself, not stale recorder RPCs
            # copied from a previous test run. This database is newly randomized and
            # schema-only: it contains no customers, sessions, jobs or tenant rows.
            db.sql("""DO $$ DECLARE f record; BEGIN
FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'recorder_%'
LOOP EXECUTE 'DROP FUNCTION '||f.signature||' CASCADE'; END LOOP; END $$;
DROP TABLE IF EXISTS recorder_alerts,recorder_segments,recorder_jobs,recorder_chunks,recorder_tickets,recorder_sessions,recorder_devices,recorder_config CASCADE;
DELETE FROM permission_catalog WHERE key IN ('module.sales_recording','recording.capture','recording.review','recording.coach');""")
            sources=list((Path(__file__).resolve().parents[3]/'supabase'/'migrations').glob('*_recording_lifecycle.sql'))
            assert len(sources)==1,'expected one unpublished recording migration source'
            remote=f'/tmp/{name}-migration.sql'
            copied=subprocess.run(['docker','cp',str(sources[0]),CONTAINER+':'+remote],capture_output=True,timeout=30)
            assert copied.returncode==0,'recording migration copy failed'
            applied=subprocess.run(['docker','exec',CONTAINER,'psql','-U','supabase_admin','-d',name,'-X','-q','-v','ON_ERROR_STOP=1','-f',remote],capture_output=True,timeout=120)
            subprocess.run(['docker','exec',CONTAINER,'rm','--',remote],capture_output=True,timeout=30)
            assert applied.returncode==0,'recording migration failed on isolated canonical schema'
        db.setup()
        yield db
    finally:
        db.sql('DROP DATABASE '+name+' WITH (FORCE);',database='postgres')


def test_real_postgres_receipts_replay_worker_and_final(postgres,tmp_path):
    pg=postgres;objects=PrivateFiles(tmp_path/'objects')
    with serving(create_app(Settings(allow_loopback_http=True),pg,objects)) as url:
        with httpx.Client(base_url=url,timeout=20) as http:
            with connect(url.replace('http:','ws:')+'/v1/stream') as ws:
                ws.send(json.dumps({'type':'auth','ticket':pg.first_ticket}))
                assert json.loads(ws.recv())['session']['id']==pg.session['id']
                ws.send(json.dumps({'type':'chunk',**chunk(pg)}))
                # Close before consuming ACK; canonical receipt survives transport disconnect.
                import time
                time.sleep(.1)
            renewed=auth(pg,http)
            assert http.post('/v1/chunks',headers=renewed,json=chunk(pg)).json()['next_sequence']==1
            assert http.post('/v1/chunks',headers=renewed,json=chunk(pg,2)).status_code==409
            assert http.post('/v1/chunks',headers=renewed,json=chunk(pg,1,b'\x01\x00')).status_code==200
            assert http.post('/v1/commit',headers=renewed,json={'last_sequence':1}).json()['session']['status']=='processing'
            assert http.post('/v1/commit',headers=renewed,json={'last_sequence':1}).status_code==200
    class SyntheticProcessor:
        async def transcribe(self,job,manifest):
            return [dict(sequence=c['sequence'],text='Synthetic '+job['kind'],started_ms=c['sequence']*2000,ended_ms=c['sequence']*2000+1) for c in manifest]
    worker=Worker(pg,objects,SyntheticProcessor())
    for _ in range(3): assert asyncio.run(worker.once())
    result=pg.sql(f"SELECT jsonb_build_object('status',(SELECT status FROM recorder_sessions WHERE id='{pg.session['id']}'),'chunks',(SELECT count(*) FROM recorder_chunks WHERE session_id='{pg.session['id']}'),'segments',(SELECT count(*) FROM recorder_segments WHERE session_id='{pg.session['id']}' AND is_final),'final_jobs',(SELECT count(*) FROM recorder_jobs WHERE session_id='{pg.session['id']}' AND kind='final')); ")
    assert result==dict(status='ready',chunks=2,segments=2,final_jobs=1)
