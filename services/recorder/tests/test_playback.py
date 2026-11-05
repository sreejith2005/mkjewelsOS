"""Evidence playback route: single-use ticket, exact canonical keys, integrity, timeline alignment."""
import asyncio
import hashlib
import secrets
import struct

import pytest

from recorder import Fault, MAX_CHUNK, Settings, create_app, object_key, scope_from_session
from support import Canonical, PrivateFiles
from test_integration import serving

import httpx


class PlaybackCanonical(Canonical):
    """Synthetic redemption mirroring recording_playback_ingest (single use, window only)."""
    def __init__(self, path):
        super().__init__(path)
        self.grants = {}
        self.stored = {}

    def grant(self, first, last):
        ticket = secrets.token_hex(32)
        self.grants[ticket] = (first, last)
        return ticket

    async def call(self, action, payload):
        if action != 'playback_redeem':
            return await super().call(action, payload)
        window = self.grants.pop(payload['ticket'], None)
        if window is None:
            raise Fault(403, 'boundary_rejected')
        first, last = window
        return {'session': self.session, 'first_sequence': first, 'last_sequence': last,
                'chunks': [c for s, c in sorted(self.stored.items()) if first <= s <= last]}


def store(canonical, objects, sequence, data):
    claims = scope_from_session(canonical.session)
    digest = hashlib.sha256(data).hexdigest()
    key = object_key(claims, sequence, digest)
    asyncio.run(objects.put(key, data, digest))
    canonical.stored[sequence] = {'sequence': sequence, 'sha256': digest, 'byte_count': len(data), 'object_key': key}


@pytest.fixture
def playback(tmp_path):
    canonical = PlaybackCanonical(tmp_path / 'canonical.sqlite')
    objects = PrivateFiles(tmp_path / 'objects')
    app = create_app(Settings(allow_loopback_http=True, origins=('https://jewelos.example',)), canonical, objects)
    with serving(app) as url:
        with httpx.Client(base_url=url) as client:
            yield canonical, objects, client


def pcm(value, size=MAX_CHUNK):
    return bytes([value, 0]) * (size // 2)


def parse_wav(body):
    assert body[:4] == b'RIFF' and body[8:16] == b'WAVEfmt '
    _, fmt, channels, rate, _, _, bits = struct.unpack('<IHHIIHH', body[16:36])
    assert (fmt, channels, rate, bits) == (1, 1, 16000, 16)
    assert body[36:40] == b'data'
    return body[44:44 + struct.unpack('<I', body[40:44])[0]]


def test_window_is_aligned_single_use_and_private(playback):
    canonical, objects, client = playback
    store(canonical, objects, 1, pcm(1, 1000))   # paused partial chunk
    store(canonical, objects, 2, pcm(2))
    store(canonical, objects, 4, pcm(4, 4000))   # sequence 3 missing
    ticket = canonical.grant(1, 4)
    response = client.post('/v1/playback', json={'ticket': ticket}, headers={'Origin': 'https://jewelos.example'})
    assert response.status_code == 200 and response.headers['content-type'] == 'audio/wav'
    assert response.headers['cache-control'] == 'no-store'
    audio = parse_wav(response.content)
    # Chunk 2 starts exactly 2 s after chunk 1 even though chunk 1 was partial; gap is silent.
    assert len(audio) == 3 * MAX_CHUNK + 4000
    assert audio[:1000] == pcm(1, 1000) and audio[1000:MAX_CHUNK] == bytes(MAX_CHUNK - 1000)
    assert audio[MAX_CHUNK:2 * MAX_CHUNK] == pcm(2)
    assert audio[2 * MAX_CHUNK:3 * MAX_CHUNK] == bytes(MAX_CHUNK)
    assert audio[3 * MAX_CHUNK:] == pcm(4, 4000)
    assert client.post('/v1/playback', json={'ticket': ticket}).status_code == 403


def test_rejects_bad_tickets_foreign_keys_and_tampered_audio(playback):
    canonical, objects, client = playback
    assert client.post('/v1/playback', json={'ticket': 'not-a-ticket'}).status_code == 401
    assert client.post('/v1/playback', json={'ticket': 'a' * 64}, headers={'Origin': 'https://evil.example'}).status_code == 403
    store(canonical, objects, 0, pcm(9))
    # Boundary returning a key outside this recording's canonical path is refused.
    canonical.stored[0] = {**canonical.stored[0], 'object_key': 'recordings/other/session/00000000-x.pcm'}
    assert client.post('/v1/playback', json={'ticket': canonical.grant(0, 0)}).status_code == 403
    # Object bytes changed after upload: integrity failure, no audio returned.
    store(canonical, objects, 0, pcm(9))
    (objects.root / canonical.stored[0]['object_key']).write_bytes(pcm(8))
    response = client.post('/v1/playback', json={'ticket': canonical.grant(0, 0)})
    assert response.status_code == 409 and b'RIFF' not in response.content


def test_window_larger_than_a_minute_is_refused(playback):
    canonical, objects, client = playback
    store(canonical, objects, 0, pcm(1))
    assert client.post('/v1/playback', json={'ticket': canonical.grant(0, 40)}).status_code == 422
