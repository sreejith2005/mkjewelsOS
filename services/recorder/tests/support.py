"""Synthetic persistence used ONLY by integration tests; never selectable by production config."""
import hashlib
import json
import sqlite3
import time
from pathlib import Path
from uuid import uuid4

from recorder import Fault


class Canonical:
    def __init__(self, path):
        self.path = path
        with self.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS tickets(ticket TEXT PRIMARY KEY, expires REAL, used INTEGER);
            CREATE TABLE IF NOT EXISTS chunks(sequence INTEGER PRIMARY KEY, hash TEXT, object_key TEXT, byte_count INTEGER);
            CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,revision INTEGER,final INTEGER,text TEXT);
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT,sequence INTEGER,state TEXT,attempt INTEGER,lease_token TEXT);''')
        self.session = dict(id=str(uuid4()), tenant_id=str(uuid4()),branch_id=str(uuid4()),employee_id=str(uuid4()),device_id=str(uuid4()),status='recording')

    def db(self):
        return sqlite3.connect(self.path)

    def ticket(self, ttl=60):
        ticket = str(uuid4())
        with self.db() as db:
            db.execute('INSERT INTO tickets VALUES(?,?,0)', (ticket,time.time()+ttl))
        return ticket

    async def call(self, action, payload):
        with self.db() as db:
            if action == 'redeem':
                row = db.execute('SELECT expires,used FROM tickets WHERE ticket=?',(payload['ticket'],)).fetchone()
                if not row or row[1] or row[0] < time.time(): raise Fault(401,'ticket_invalid')
                db.execute('UPDATE tickets SET used=1 WHERE ticket=?',(payload['ticket'],))
                return dict(session=self.session,next_sequence=db.execute('SELECT count(*) FROM chunks').fetchone()[0])
            if action == 'health': return dict(ready=True)
            if action in ('check_chunk', 'chunk'):
                row = db.execute('SELECT hash FROM chunks WHERE sequence=?',(payload['sequence'],)).fetchone()
                count = db.execute('SELECT count(*) FROM chunks').fetchone()[0]
                if row and row[0] != payload['sha256']: raise Fault(409,'hash_conflict')
                if not row:
                    if payload['sequence'] != count: raise Fault(409,'sequence_gap')
                    if db.execute("SELECT value FROM state WHERE key='commit'").fetchone(): raise Fault(409,'sealed')
                    if action == 'check_chunk': return dict(allowed=True,next_sequence=count)
                    db.execute('INSERT INTO chunks VALUES(?,?,?,?)',(payload['sequence'],payload['sha256'],payload['object_key'],payload['byte_count']))
                    db.execute('INSERT INTO jobs VALUES(?,?,?,\'pending\',0,\'\')',(str(uuid4()),'provisional',payload['sequence']))
                    count += 1
                return dict(type='ack',sequence=payload['sequence'],sha256=payload['sha256'],next_sequence=count)
            if action == 'commit':
                count = db.execute('SELECT count(*) FROM chunks').fetchone()[0]
                if payload['last_sequence'] != count-1: raise Fault(409,'sequence_gap')
                exists = db.execute("SELECT value FROM state WHERE key='commit'").fetchone()
                if not exists:
                    db.execute("INSERT INTO state VALUES('commit',?)",(str(payload['last_sequence']),))
                    db.execute('INSERT INTO jobs VALUES(?,\'final\',-1,\'pending\',0,\'\')',(str(uuid4()),))
                return dict(session={**self.session,'status':'processing'})
            if action == 'claim_job':
                row = db.execute("SELECT id,kind,sequence,attempt FROM jobs WHERE state='pending' ORDER BY CASE kind WHEN 'provisional' THEN 0 ELSE 1 END,sequence LIMIT 1").fetchone()
                if not row: return dict(job=None)
                token = str(uuid4())
                db.execute("UPDATE jobs SET state='leased',attempt=attempt+1,lease_token=? WHERE id=?",(token,row[0]))
                chunks = [dict(sequence=r[0],sha256=r[1],object_key=r[2],byte_count=r[3]) for r in db.execute('SELECT * FROM chunks ORDER BY sequence')]
                return dict(job=dict(id=row[0],kind=row[1],sequence=row[2],attempt=row[3]+1,lease_token=token,session=self.session,chunks=chunks,last_sequence=len(chunks)-1))
            if action == 'finish_job':
                row = db.execute('SELECT attempt,lease_token FROM jobs WHERE id=?',(payload['job_id'],)).fetchone()
                if row[1] != payload['lease_token']: raise Fault(409,'lease_mismatch')
                state = 'done' if payload['success'] else ('dead' if row[0]>=3 else 'pending')
                db.execute('UPDATE jobs SET state=? WHERE id=?',(state,payload['job_id']))
                return dict(job=dict(state=state))
            if action == 'event':
                row = db.execute('SELECT revision,final FROM events WHERE id=?',(payload['segment_id'],)).fetchone()
                if not row or (payload['revision']>row[0] and not row[1]):
                    db.execute('INSERT OR REPLACE INTO events VALUES(?,?,?,?)',(payload['segment_id'],payload['revision'],payload['is_final'],payload['text']))
                return dict(accepted=True)
            raise AssertionError(action)


class PrivateFiles:
    def __init__(self, path):
        self.root = Path(path)
        self.root.mkdir()
        self.fail = False

    async def put(self, key, data, sha256):
        if self.fail: raise Fault(503,'object_unavailable')
        path = self.root / key
        path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() != sha256: raise Fault(409,'hash_conflict')
        with path.open('wb') as out:
            out.write(data)
            out.flush()
            import os
            os.fsync(out.fileno())

    async def signed_read(self, key): return 'https://private.invalid/'+key
    async def health(self): return True
