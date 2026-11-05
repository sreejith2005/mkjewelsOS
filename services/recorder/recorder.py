"""Verified transport only. Canonical authorization/deduplication stays in recorder-ingest."""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import ipaddress
import json
import re
import secrets
import struct
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import UUID

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from starlette.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect

MAX_FRAME = 90000
MAX_CHUNK = 64000
SCOPE = ('session_id', 'device_id', 'employee_id', 'branch_id', 'tenant_id')
PLAYBACK_MAX_CHUNKS = 31  # Matches recording_playback_grants (at most a 60-second window).
PLAYBACK_PER_MINUTE = 60
_HEX64 = re.compile(r'^[0-9a-f]{64}$')


class Fault(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


class Boundary(Protocol):
    async def call(self, action: str, payload: dict[str, Any]) -> dict[str, Any]: ...


class Objects(Protocol):
    async def put(self, key: str, data: bytes, sha256: str) -> None: ...
    async def signed_read(self, key: str) -> str: ...
    async def get(self, key: str, maximum: int) -> bytes: ...
    async def health(self) -> bool: ...


@dataclass(frozen=True)
class Settings:
    allow_loopback_http: bool = False  # Test injection only; never enabled by environment factory.
    origins: tuple[str, ...] = ()
    lease_seconds: float = 300
    max_leases: int = 256
    max_inflight: int = 32
    max_connections: int = 128
    connect_attempts_per_minute: int = 20
    request_timeout: float = 20


def scope_from_session(session: dict[str, Any]) -> dict[str, str]:
    try:
        return {key: str(UUID(str(session['id' if key == 'session_id' else key]))) for key in SCOPE}
    except (KeyError, ValueError, TypeError):
        raise Fault(503, 'invalid_boundary_scope') from None


def object_key(claims: dict[str, str], sequence: int, sha256: str) -> str:
    return '/'.join(['recordings', claims['tenant_id'], claims['branch_id'], claims['employee_id'], claims['device_id'], claims['session_id'], f'{sequence:08d}-{sha256}.pcm'])


def wav(pcm: bytes) -> bytes:
    """Mono 16-bit 16 kHz PCM (the canonical chunk format) -> WAV."""
    return b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 16000, 32000, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm


def integer(value: Any, lower: int, upper: int) -> int:
    if type(value) is not int or not lower <= value <= upper:
        raise Fault(422, 'invalid_sequence')
    return value


class BodyLimit:
    """Enforce bytes before JSON parsing, including chunked HTTP bodies."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        total = 0

        async def bounded_receive():
            nonlocal total
            message = await receive()
            total += len(message.get('body', b''))
            if total > MAX_FRAME:
                raise Fault(413, 'payload_too_large')
            return message
        await self.app(scope, bounded_receive, send)


class Ingestion:
    def __init__(self, settings: Settings, boundary: Boundary, objects: Objects):
        self.settings, self.boundary, self.objects = settings, boundary, objects
        self.leases: dict[str, tuple[float, dict[str, str]]] = {}
        self.lease_lock = asyncio.Lock()
        self.inflight = 0
        self.connections = 0
        self.connect_attempts: dict[str, tuple[float, int]] = {}
        self.playback_attempts: dict[str, tuple[float, int]] = {}

    def expire(self) -> None:
        now = time.monotonic()
        for key in [k for k, (expiry, _) in self.leases.items() if expiry <= now]:
            del self.leases[key]

    async def connect(self, body: dict[str, Any], remote: str = '') -> dict[str, Any]:
        now=time.monotonic()
        for key in [k for k,(expiry,_) in self.connect_attempts.items() if expiry<=now]:
            del self.connect_attempts[key]
        expiry, count=self.connect_attempts.get(remote,(now+60,0))
        if count>=self.settings.connect_attempts_per_minute or (remote not in self.connect_attempts and len(self.connect_attempts)>=1024):
            raise Fault(429,'connect_rate_limit')
        self.connect_attempts[remote]=(expiry,count+1)
        ticket = body.get('ticket')
        if not isinstance(ticket, str) or not 16 <= len(ticket) <= 2048:
            raise Fault(401, 'ticket_invalid')
        # Atomic local capacity reservation; ticket redemption is atomic across replicas in SQL.
        async with self.lease_lock:
            self.expire()
            if len(self.leases) >= self.settings.max_leases:
                raise Fault(429, 'lease_capacity')
            result = await self.boundary.call('redeem', {'ticket': ticket})
            claims = scope_from_session(result['session'])
            token = secrets.token_urlsafe(32)
            self.leases[hashlib.sha256(token.encode()).hexdigest()] = (time.monotonic() + self.settings.lease_seconds, claims)
        return dict(ingest_token=token, expires_at=datetime.fromtimestamp(time.time()+self.settings.lease_seconds,timezone.utc).isoformat(), session=result['session'], next_sequence=result['next_sequence'])

    async def playback(self, body: dict[str, Any], remote: str = '') -> bytes:
        """Evidence playback: redeem a reviewer's single-use ticket and return only that window as WAV.

        recording_playback_ticket authorized and audited the request in SQL. Object keys
        from the boundary are re-derived here, so a boundary bug cannot read another recording.
        """
        now = time.monotonic()
        for key in [k for k, (expiry, _) in self.playback_attempts.items() if expiry <= now]:
            del self.playback_attempts[key]
        expiry, count = self.playback_attempts.get(remote, (now + 60, 0))
        if count >= PLAYBACK_PER_MINUTE or (remote not in self.playback_attempts and len(self.playback_attempts) >= 1024):
            raise Fault(429, 'playback_rate_limit')
        self.playback_attempts[remote] = (expiry, count + 1)
        ticket = body.get('ticket')
        if not isinstance(ticket, str) or not _HEX64.match(ticket):
            raise Fault(401, 'ticket_invalid')
        if self.inflight >= self.settings.max_inflight:
            raise Fault(429, 'backpressure')
        self.inflight += 1
        try:
            async with asyncio.timeout(self.settings.request_timeout):
                result = await self.boundary.call('playback_redeem', {'ticket': ticket})
                claims = scope_from_session(result.get('session') or {})
                first = integer(result.get('first_sequence'), 0, 7200)
                last = integer(result.get('last_sequence'), first, min(7200, first + PLAYBACK_MAX_CHUNKS - 1))
                chunks = result.get('chunks')
                if not isinstance(chunks, list) or not chunks or len(chunks) > PLAYBACK_MAX_CHUNKS:
                    raise Fault(503, 'invalid_boundary_playback')
                by_sequence: dict[int, dict[str, Any]] = {}
                for item in chunks:
                    if not isinstance(item, dict):
                        raise Fault(503, 'invalid_boundary_playback')
                    sequence = integer(item.get('sequence'), first, last)
                    digest, size = item.get('sha256'), item.get('byte_count')
                    if sequence in by_sequence or not isinstance(digest, str) or not _HEX64.match(digest) or type(size) is not int or not 2 <= size <= MAX_CHUNK or size % 2:
                        raise Fault(503, 'invalid_boundary_playback')
                    key = object_key(claims, sequence, digest)
                    if item.get('object_key') != key:
                        raise Fault(403, 'object_scope_mismatch')
                    by_sequence[sequence] = {'key': key, 'sha256': digest, 'size': size}
                pcm = bytearray()
                final = max(by_sequence)
                for sequence in range(first, final + 1):
                    item = by_sequence.get(sequence)
                    if item is None:
                        pcm.extend(bytes(MAX_CHUNK))  # Missing audio stays silent so the timeline stays true.
                        continue
                    data = await self.objects.get(item['key'], item['size'])
                    if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                        raise Fault(409, 'audio_integrity')
                    pcm.extend(data)
                    if sequence != final:
                        pcm.extend(bytes(MAX_CHUNK - len(data)))  # A paused partial chunk keeps later audio aligned.
                return wav(bytes(pcm))
        finally:
            self.inflight -= 1

    def authorize(self, token: str) -> dict[str, str]:
        self.expire()
        entry = self.leases.get(hashlib.sha256(token.encode()).hexdigest())
        if entry is None:
            raise Fault(401, 'lease_expired')
        return entry[1]

    async def operation(self, token: str, kind: str, body: dict[str, Any]) -> dict[str, Any]:
        claims = self.authorize(token)
        if self.inflight >= self.settings.max_inflight:
            raise Fault(429, 'backpressure')
        self.inflight += 1
        try:
            async with asyncio.timeout(self.settings.request_timeout):
                if kind == 'commit':
                    last = integer(body.get('last_sequence'), -1, 7199)
                    return await self.boundary.call('commit', {**claims, 'last_sequence': last})
                if kind != 'chunk':
                    raise Fault(422, 'unknown_message')
                if any(body.get(key) != value for key, value in claims.items()):
                    raise Fault(403, 'scope_mismatch')
                sequence = integer(body.get('sequence'), 0, 7199)
                digest, encoded = body.get('sha256'), body.get('data')
                if not isinstance(encoded, str) or len(encoded) > 85336:
                    raise Fault(413, 'chunk_too_large')
                try:
                    data = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error):
                    raise Fault(422, 'invalid_base64') from None
                if len(data) > MAX_CHUNK:
                    raise Fault(413, 'chunk_too_large')
                if not len(data) or len(data) % 2:
                    raise Fault(422, 'invalid_pcm_length')
                if not isinstance(digest, str) or hashlib.sha256(data).hexdigest() != digest:
                    raise Fault(422, 'checksum_mismatch')
                key = object_key(claims, sequence, digest)
                receipt = {**claims, 'sequence': sequence, 'sha256': digest, 'byte_count': len(data), 'object_key': key}
                await self.boundary.call('check_chunk', receipt)
                await self.objects.put(key, data, digest)
                # ACK only follows both durable object and canonical transaction (including job enqueue).
                return await self.boundary.call('chunk', receipt)
        finally:
            self.inflight -= 1


def create_app(settings: Settings, boundary: Boundary, objects: Objects) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    service = Ingestion(settings, boundary, objects)
    app.state.ingestion = service
    app.add_middleware(BodyLimit)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_methods=['POST','GET'], allow_headers=['Authorization','Content-Type'], allow_credentials=False)

    @app.exception_handler(Fault)
    async def fault_handler(_request, exc):
        return JSONResponse({'error': exc.code}, status_code=exc.status,headers={'Cache-Control':'no-store','Retry-After':'2'} if exc.status==429 else {'Cache-Control':'no-store'})

    def transport(scope) -> None:
        secure = scope['scheme'] in ('https','wss')
        if settings.allow_loopback_http:
            try:
                secure = secure or ipaddress.ip_address(scope.get('client', ('',))[0]).is_loopback
            except ValueError:
                pass
        if not secure:
            raise Fault(426, 'tls_required')
        headers = dict(scope.get('headers', []))
        origin = headers.get(b'origin')
        if origin and origin.decode() not in settings.origins:
            raise Fault(403,'origin_denied')
        if scope.get('query_string'):
            raise Fault(422,'query_not_supported')

    async def body(request: Request) -> dict[str, Any]:
        try:
            result = await request.json()
        except (ValueError, UnicodeError):
            raise Fault(422, 'invalid_json') from None
        if not isinstance(result, dict):
            raise Fault(422, 'invalid_json')
        return result

    @app.middleware('http')
    async def guard(request, call_next):
        try:
            if request.url.path not in ('/healthz','/readyz'):
                transport(request.scope)
            response = await call_next(request)
            response.headers['Cache-Control']='no-store'
            return response
        except Fault as exc:
            return await fault_handler(request, exc)
        except Exception:
            # No exception details: HTTP libraries/processor failures can contain credentials/audio/text.
            return JSONResponse({'error':'dependency_unavailable'},status_code=503)

    @app.get('/healthz')
    async def health():
        return {'status':'alive'}

    @app.get('/readyz')
    async def ready():
        try:
            service.expire()
            async with asyncio.timeout(5):
                health = await boundary.call('health', {})
                healthy = await objects.health()
            healthy = healthy and health.get('ready', True) and health.get('dead',0)==0 and health.get('pending',0)<health.get('capacity',10000) and len(service.leases)<settings.max_leases and service.inflight<settings.max_inflight
        except Exception:
            healthy = False
        return JSONResponse({'status':'ready' if healthy else 'unavailable'},status_code=200 if healthy else 503)

    @app.post('/v1/connect')
    async def connect(request: Request):
        async with asyncio.timeout(settings.request_timeout):
            return await service.connect(await body(request),request.client.host if request.client else '')

    def bearer(request: Request) -> str:
        authorization = request.headers.get('authorization','')
        if not authorization.startswith('Bearer ') or len(authorization)>512:
            raise Fault(401, 'authentication_required')
        return authorization[7:]

    @app.post('/v1/chunks')
    async def chunks(request: Request):
        return await service.operation(bearer(request), 'chunk', await body(request))

    @app.post('/v1/playback')
    async def playback(request: Request):
        audio = await service.playback(await body(request), request.client.host if request.client else '')
        return Response(content=audio, media_type='audio/wav', headers={'Cache-Control': 'no-store', 'Content-Disposition': 'inline'})

    @app.post('/v1/commit')
    async def commit(request: Request):
        return await service.operation(bearer(request), 'commit', await body(request))

    async def frame(ws: WebSocket) -> dict[str, Any]:
        raw = await asyncio.wait_for(ws.receive_text(),timeout=20)
        if len(raw.encode()) > MAX_FRAME:
            raise Fault(413,'payload_too_large')
        try:
            parsed = json.loads(raw)
        except ValueError:
            raise Fault(422,'invalid_json') from None
        if not isinstance(parsed,dict):
            raise Fault(422,'invalid_json')
        return parsed

    @app.websocket('/v1/stream')
    async def stream(ws: WebSocket):
        reserved = False
        try:
            transport(ws.scope)
            if service.connections >= settings.max_connections:
                raise Fault(429,'connection_capacity')
            service.connections += 1
            reserved = True
            await ws.accept()
            first = await asyncio.wait_for(frame(ws),timeout=5)
            if first.get('type') != 'auth':
                raise Fault(401,'authentication_required')
            result = await service.connect(first,ws.client.host if ws.client else '')
            token = result['ingest_token']
            await ws.send_json({'type':'authenticated', **result})
            while True:
                message = await frame(ws)
                kind = message.get('type')
                if kind not in ('chunk','commit'):
                    raise Fault(422,'unknown_message')
                await ws.send_json(await service.operation(token,kind,message))
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            error = exc.code if isinstance(exc,Fault) else 'connection_interrupted'
            try:
                if ws.application_state.name == 'CONNECTED':
                    await ws.send_json({'type':'error','error':error})
                await ws.close(code=1008)
            except (RuntimeError, WebSocketDisconnect):
                pass
        finally:
            if reserved:
                service.connections -= 1
    return app
