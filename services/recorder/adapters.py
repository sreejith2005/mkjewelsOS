"""Production adapters: narrow Edge secret, instance-role private S3, optional verified GPU."""
from __future__ import annotations
import asyncio
import base64
import json
from typing import Any
from urllib.parse import urlsplit

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import httpx

from recorder import Fault


def https_endpoint(url: str) -> str:
    parsed=urlsplit(url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('HTTPS endpoint without credentials/query required')
    return url


async def read_json(response: httpx.Response, maximum: int) -> dict[str, Any]:
    data=bytearray()
    async for part in response.aiter_bytes():
        data.extend(part)
        if len(data)>maximum:
            raise Fault(503,'dependency_response_too_large')
    try:
        value=json.loads(data)
    except (ValueError,UnicodeError):
        raise Fault(503,'invalid_dependency_response') from None
    if not isinstance(value,dict):
        raise Fault(503,'invalid_dependency_response')
    return value


class EdgeBoundary:
    def __init__(self, url: str, secret: str, client: httpx.AsyncClient | None = None):
        self.url=https_endpoint(url)
        if not secret:
            raise ValueError('recorder backend secret required')
        self.secret=secret
        self.client=client or httpx.AsyncClient(timeout=15,follow_redirects=False,limits=httpx.Limits(max_connections=32,max_keepalive_connections=8))

    async def call(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            # The action is repeated in the query so the Edge function can size the body limit before reading it.
            async with self.client.stream('POST',self.url,params={'action':action},headers={'x-recorder-secret':self.secret},json={'action':action,'payload':payload}) as response:
                if response.status_code != 200:
                    # Never reflect upstream body (may contain credentials, SQL, transcript).
                    status=response.status_code if response.status_code in (401,403,409,422,429) else 503
                    raise Fault(status,'boundary_rejected' if status!=503 else 'boundary_unavailable')
                return await read_json(response,8*1024*1024)
        except httpx.HTTPError:
            raise Fault(503,'boundary_unavailable') from None


class S3Objects:
    def __init__(self, bucket: str, kms_key: str, client=None):
        if not bucket or not kms_key:
            raise ValueError('private bucket and KMS key required')
        self.bucket,self.kms_key=bucket,kms_key
        self.client=client or boto3.client('s3',config=Config(connect_timeout=3,read_timeout=10,retries={'max_attempts':2,'mode':'standard'},signature_version='s3v4'))

    def key(self, key: str) -> str:
        if not key.startswith('recordings/') or '..' in key or '\\' in key or len(key)>512:
            raise Fault(403,'object_scope_mismatch')
        return key

    async def put(self, key: str, data: bytes, sha256: str) -> None:
        key=self.key(key)
        try:
            await asyncio.to_thread(self.client.put_object,Bucket=self.bucket,Key=key,Body=data,ContentType='application/octet-stream',ServerSideEncryption='aws:kms',SSEKMSKeyId=self.kms_key,IfNoneMatch='*',ChecksumSHA256=base64.b64encode(bytes.fromhex(sha256)).decode(),Metadata={'sha256':sha256,'encoding':'pcm_s16le','sample-rate':'16000','channels':'1'})
        except ClientError as exc:
            if exc.response.get('Error',{}).get('Code') not in ('PreconditionFailed','412'):
                raise Fault(503,'object_unavailable') from None
            try:
                head=await asyncio.to_thread(self.client.head_object,Bucket=self.bucket,Key=key)
            except Exception:
                raise Fault(503,'object_unavailable') from None
            if head.get('ContentLength') != len(data) or head.get('Metadata',{}).get('sha256') != sha256:
                raise Fault(409,'hash_conflict')
        except Exception:
            raise Fault(503,'object_unavailable') from None

    async def signed_read(self, key: str) -> str:
        # Worker-only access. Browser playback never receives a signed URL (see Ingestion.playback).
        return await asyncio.to_thread(self.client.generate_presigned_url,'get_object',Params={'Bucket':self.bucket,'Key':self.key(key)},ExpiresIn=120)

    async def get(self, key: str, maximum: int) -> bytes:
        # Evidence playback only: Ingestion.playback re-derives the exact canonical key; the read is bounded.
        key=self.key(key)
        def read() -> bytes:
            body=self.client.get_object(Bucket=self.bucket,Key=key)['Body']
            try:
                return body.read(maximum+1)
            finally:
                body.close()
        try:
            data=await asyncio.to_thread(read)
        except Exception:
            raise Fault(503,'object_unavailable') from None
        if len(data)>maximum:
            raise Fault(409,'audio_integrity')
        return data

    async def health(self) -> bool:
        try:
            await asyncio.to_thread(self.client.head_bucket,Bucket=self.bucket)
            return True
        except Exception:
            return False


class PrivateGPU:
    def __init__(self, url: str, token: str, allowed_hosts: tuple[str,...], client: httpx.AsyncClient | None = None):
        self.url=https_endpoint(url)
        if urlsplit(url).hostname not in allowed_hosts or not token:
            raise ValueError('Explicit private GPU hostname and credential required')
        self.token=token
        self.client=client or httpx.AsyncClient(timeout=85,follow_redirects=False,limits=httpx.Limits(max_connections=2))

    async def transcribe(self, job: dict[str,Any], manifest: list[dict[str,Any]]) -> list[dict[str,Any]]:
        # Verified private adapter fetches signed objects, resamples/context-trims, and returns per-chunk text.
        # No legacy public endpoint, manager password, identity-by-name, or legacy database access.
        try:
            async with self.client.stream('POST',self.url,headers={'Authorization':'Bearer '+self.token},json={'job_id':job['id'],'session_id':job['session']['id'],'kind':job['kind'],'format':{'encoding':'pcm_s16le','sample_rate':16000,'channels':1},'chunks':manifest}) as response:
                if response.status_code!=200:
                    raise Fault(503,'processor_unavailable')
                result=await read_json(response,4*1024*1024)
                segments=result.get('segments')
                if not isinstance(segments,list):
                    raise Fault(422,'invalid_processor_response')
                return segments
        except httpx.HTTPError:
            raise Fault(503,'processor_unavailable') from None


class PrivateAnalyzer:
    """Verified private analysis endpoint (self-hosted or a vendor behind our own gateway).

    Request {system, user, response_format:'json'}; response {content: '<JSON text>'}.
    The model label is configuration, recorded on every analysis.
    """
    def __init__(self, url: str, token: str, allowed_hosts: tuple[str,...], provider: str, model: str, client: httpx.AsyncClient | None = None):
        self.url=https_endpoint(url)
        if urlsplit(url).hostname not in allowed_hosts or not token or not provider or not model:
            raise ValueError('Explicit analyzer hostname, credential, provider and model required')
        self.token,self.provider,self.model=token,provider[:80],model[:120]
        self.client=client or httpx.AsyncClient(timeout=120,follow_redirects=False,limits=httpx.Limits(max_connections=2))

    async def complete(self, system: str, user: str) -> str:
        try:
            async with self.client.stream('POST',self.url,headers={'Authorization':'Bearer '+self.token},json={'system':system,'user':user,'response_format':'json','temperature':0}) as response:
                if response.status_code!=200:
                    raise Fault(503,'analyzer_unavailable')
                content=(await read_json(response,2*1024*1024)).get('content')
                if not isinstance(content,str):
                    raise Fault(503,'analyzer_unavailable')
                return content
        except httpx.HTTPError:
            raise Fault(503,'analyzer_unavailable') from None
