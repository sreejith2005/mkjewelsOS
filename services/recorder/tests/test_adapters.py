import asyncio
import base64
import hashlib
import json
from unittest.mock import Mock

import httpx
import pytest
from botocore.exceptions import ClientError

from adapters import ClaudeBedrockAnalyzer, EdgeBoundary, S3Objects, PrivateGPU
from recorder import Fault


def test_edge_secret_payload_and_safe_errors():
    def handle(request):
        assert request.headers['x-recorder-secret']=='test-only-secret'
        assert json.loads(request.content)=={'action':'health','payload':{}}
        return httpx.Response(200,json={'ready':True})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            edge=EdgeBoundary('https://project.supabase.co/functions/v1/recorder-ingest','test-only-secret',client)
            assert await edge.call('health',{})=={'ready':True}
    asyncio.run(run())
    with pytest.raises(ValueError): EdgeBoundary('http://unsafe','test')


def test_s3_encryption_conditional_put_and_scoped_read():
    client=Mock()
    objects=S3Objects('private-test','arn:aws:kms:region:account:key/test',client)
    data=b'\x00\x00';digest=hashlib.sha256(data).hexdigest()
    asyncio.run(objects.put('recordings/synthetic/0.pcm',data,digest))
    kwargs=client.put_object.call_args.kwargs
    assert kwargs['ServerSideEncryption']=='aws:kms'
    assert kwargs['IfNoneMatch']=='*'
    assert kwargs['ChecksumSHA256']==base64.b64encode(bytes.fromhex(digest)).decode()
    client.put_object.side_effect=ClientError({'Error':{'Code':'PreconditionFailed'}},'PutObject')
    client.head_object.return_value={'ContentLength':2,'Metadata':{'sha256':digest}}
    asyncio.run(objects.put('recordings/synthetic/0.pcm',data,digest))
    client.head_object.return_value={'ContentLength':2,'Metadata':{'sha256':'0'*64}}
    with pytest.raises(Fault): asyncio.run(objects.put('recordings/synthetic/0.pcm',data,digest))
    with pytest.raises(Fault): asyncio.run(objects.signed_read('../escape'))


def test_gpu_is_private_explicitly_configured_and_bounded():
    with pytest.raises(ValueError): PrivateGPU('https://public.example','secret',('gpu.internal',))
    with pytest.raises(ValueError): PrivateGPU('http://gpu.internal','secret',('gpu.internal',))
    async def run():
        def handle(request):
            assert request.headers['Authorization']=='Bearer synthetic'
            assert json.loads(request.content)['format']=={'encoding':'pcm_s16le','sample_rate':16000,'channels':1}
            return httpx.Response(200,json={'segments':[{'sequence':0,'text':'synthetic','started_ms':0,'ended_ms':10}],'provider':'faster-whisper','model':'large-v3','diarization_provider':None,'extra':'x'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            gpu=PrivateGPU('https://gpu.internal/v1/transcribe','synthetic',('gpu.internal',),client)
            result=await gpu.transcribe({'id':'job','kind':'final','session':{'id':'session'}},[{'sequence':0,'url':'https://private.invalid'}])
            assert result['segments'][0]['text']=='synthetic'
            assert {k:v for k,v in result.items() if k!='segments'}=={'provider':'faster-whisper','model':'large-v3'}
    asyncio.run(run())


class _Block:
    def __init__(self, kind, text=''): self.type, self.text = kind, text


class _Stream:
    def __init__(self, owner): self.owner = owner
    async def __aenter__(self): return self
    async def __aexit__(self, *exc): return False
    async def get_final_message(self):
        if isinstance(self.owner.result, Exception): raise self.owner.result
        return self.owner.result


class _Messages:
    def __init__(self, result): self.result, self.calls = result, []
    def stream(self, **kwargs):
        self.calls.append(kwargs)
        return _Stream(self)


class _Client:
    def __init__(self, result): self.messages = _Messages(result)


def _message(stop, *blocks):
    m = Mock(); m.stop_reason = stop; m.content = list(blocks); return m


def test_claude_bedrock_analyzer_request_and_failures():
    import anthropic
    with pytest.raises(ValueError): ClaudeBedrockAnalyzer('ap-south-1', 'claude-opus-5-5', client=object())        # needs Bedrock prefix
    with pytest.raises(ValueError): ClaudeBedrockAnalyzer('', client=object())
    client = _Client(_message('end_turn', _Block('thinking'), _Block('text', '{"status_hint":'), _Block('text', '"scored"}')))
    analyzer = ClaudeBedrockAnalyzer('ap-south-1', client=client)
    assert (analyzer.provider, analyzer.model) == ('anthropic-bedrock', 'anthropic.claude-opus-5-5')
    assert asyncio.run(analyzer.complete('system rules', 'transcript')) == '{"status_hint":"scored"}'
    call = client.messages.calls[0]
    assert call['model'] == 'anthropic.claude-opus-5-5' and call['system'] == 'system rules' and call['output_config'] == {'effort': 'high'}
    assert 'temperature' not in call and 'thinking' not in call
    for result, code in ((_message('refusal'), 'analyzer_refused'), (_message('max_tokens', _Block('text', '{')), 'analyzer_truncated'),
                         (_message('end_turn', _Block('text', '  ')), 'analyzer_unavailable'),
                         (anthropic.APIConnectionError(request=Mock()), 'analyzer_unavailable')):
        with pytest.raises(Fault) as caught:
            asyncio.run(ClaudeBedrockAnalyzer('ap-south-1', client=_Client(result)).complete('s', 'u'))
        assert caught.value.code == code and 'transcript' not in str(caught.value)
