"""Production entry points. No local/test backend or plaintext mode can be selected here."""
import asyncio
import os
from adapters import EdgeBoundary,S3Objects,PrivateGPU
from recorder import Settings,create_app
from worker import Worker


def dependencies():
    edge=EdgeBoundary(os.environ['RECORDER_EDGE_URL'],os.environ['RECORDER_BACKEND_SECRET'])
    objects=S3Objects(os.environ['RECORDER_BUCKET'],os.environ['RECORDER_KMS_KEY_ARN'])
    return edge,objects


def app():
    origins=tuple(v.strip() for v in os.environ['RECORDER_ORIGINS'].split(',') if v.strip())
    if not origins or any(not v.startswith('https://') for v in origins):
        raise ValueError('Exact HTTPS web origins required')
    return create_app(Settings(origins=origins),*dependencies())


async def worker_main():
    # Worker refuses startup until optional private processor is explicitly configured.
    processor=PrivateGPU(os.environ['RECORDER_GPU_URL'],os.environ['RECORDER_GPU_TOKEN'],tuple(os.environ['RECORDER_GPU_HOSTS'].split(',')))
    worker=Worker(*dependencies(),processor,coaching_enabled=os.environ.get('RECORDER_COACHING_ENABLED')=='true')
    await worker.run()


if __name__=='__main__':
    asyncio.run(worker_main())
