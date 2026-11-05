"""Production entry point. Refuses to start without an explicit token, audio host allowlist and model."""
import os

from processor import Processor, Settings, create_app


def _list(name: str, default: str = '') -> tuple[str, ...]:
    return tuple(value.strip() for value in os.environ.get(name, default).split(',') if value.strip())


def app():
    from engines import IndicConformerEngine, PyannoteDiarizer, WhisperEngine
    device = os.environ.get('PROCESSOR_DEVICE', 'cuda')
    engine_name = os.environ.get('PROCESSOR_ENGINE', 'whisper')
    if engine_name == 'whisper':
        engine = WhisperEngine(os.environ['PROCESSOR_WHISPER_MODEL'], device=device, compute_type=os.environ.get('PROCESSOR_COMPUTE_TYPE', 'float16'),
                               languages=_list('PROCESSOR_LANGUAGES', 'hi,en'), translate=os.environ.get('PROCESSOR_TRANSLATE') == 'true')
    elif engine_name == 'indic_conformer':
        engine = IndicConformerEngine(os.environ.get('PROCESSOR_LANGUAGE', 'hi'), device=device, token=os.environ.get('PROCESSOR_HF_TOKEN') or None)
    else:
        raise ValueError('PROCESSOR_ENGINE must be whisper or indic_conformer')
    diarizer = PyannoteDiarizer(os.environ['PROCESSOR_HF_TOKEN'], device=device) if os.environ.get('PROCESSOR_DIARIZATION') == 'true' else None
    settings = Settings(token=os.environ['PROCESSOR_TOKEN'], audio_hosts=_list('PROCESSOR_AUDIO_HOSTS'))
    return create_app(Processor(settings, engine, diarizer))
