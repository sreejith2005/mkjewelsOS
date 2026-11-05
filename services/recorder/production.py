"""Production entry points. No local/test backend or plaintext mode can be selected here."""
import asyncio
import os
from adapters import EdgeBoundary,S3Objects,PrivateGPU,PrivateAnalyzer
from analysis import AnalysisWorker
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
    worker=Worker(*dependencies(),processor,coaching_enabled=os.environ.get('RECORDER_COACHING_ENABLED')=='true',
                  finalize_transcripts=os.environ.get('RECORDER_FINALIZE_TRANSCRIPTS')=='true')
    await worker.run()


def _analyzer(prefix: str) -> PrivateAnalyzer:
    return PrivateAnalyzer(os.environ[prefix+'_URL'],os.environ[prefix+'_TOKEN'],tuple(os.environ[prefix+'_HOSTS'].split(',')),
                           os.environ[prefix+'_PROVIDER'],os.environ[prefix+'_MODEL'])


async def analysis_main():
    # Separate process. Refuses startup without an explicit primary analyzer; fallback only if fully configured.
    edge=EdgeBoundary(os.environ['RECORDER_EDGE_URL'],os.environ['RECORDER_BACKEND_SECRET'])
    fallback=_analyzer('RECORDER_ANALYZER_FALLBACK') if os.environ.get('RECORDER_ANALYZER_FALLBACK_URL') else None
    versions=frozenset(v.strip() for v in os.environ.get('RECORDER_ANALYSIS_JOB_VERSIONS','mk-sales-v1').split(',') if v.strip())
    await AnalysisWorker(edge,_analyzer('RECORDER_ANALYZER'),fallback,supported_job_versions=versions).run()


if __name__=='__main__':
    import sys
    asyncio.run(analysis_main() if sys.argv[1:]==['analysis'] else worker_main())
