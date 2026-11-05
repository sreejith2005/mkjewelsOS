"""Benchmark the processor on real store audio before activation.

Owner-supplied, outside Git (customer voices):
  audio dir: *.wav, mono 16-bit 16 kHz (convert first: ffmpeg -i in.m4a -ac 1 -ar 16000 -sample_fmt s16 out.wav)
  refs.json (optional): {"file.wav": {"text": "human transcript", "language": "hi"}}

  python bench.py --audio C:\\private\\store-audio --refs C:\\private\\refs.json --out C:\\private\\bench.json

Reports per file and overall: word and character error rate against the human
transcript, real-time factor (processing time / audio time), provisional lag
(p50/p95 seconds to transcribe one live 2-second chunk with its context),
mean recognition confidence, unknown-speaker share and detected languages.
Report numbers, not anecdotes; Marathi/Gujarati sets are reported separately.
Only aggregate metrics and error examples are written; nothing is uploaded.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
import unicodedata
import wave
from pathlib import Path
from typing import Any, Sequence

from processor import CHUNK_BYTES, SAMPLE_RATE, assemble, assign_roles, label_stats


def _normalise(text: str) -> str:
    text = unicodedata.normalize('NFC', text).casefold()
    return ' '.join(''.join(ch if ch.isalnum() or ch.isspace() else ' ' for ch in text).split())


def _distance(a: Sequence[str], b: Sequence[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def error_rate(reference: str, hypothesis: str, unit: str = 'word') -> float | None:
    ref, hyp = _normalise(reference), _normalise(hypothesis)
    ref_units = ref.split() if unit == 'word' else list(ref.replace(' ', ''))
    hyp_units = hyp.split() if unit == 'word' else list(hyp.replace(' ', ''))
    if not ref_units:
        return None
    return round(_distance(ref_units, hyp_units) / len(ref_units), 4)


def percentile(values: Sequence[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return round(ordered[index], 3)


def read_pcm(path: Path) -> bytes:
    with wave.open(str(path), 'rb') as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != SAMPLE_RATE:
            raise ValueError(f'{path.name}: convert to mono 16-bit 16 kHz first')
        return source.readframes(source.getnframes())


def bench_file(pcm: bytes, engine, diarizer, reference: dict[str, Any] | None, live_samples: int = 20) -> dict[str, Any]:
    seconds = len(pcm) / (2 * SAMPLE_RATE)
    started = time.perf_counter()
    turns = diarizer.diarize(pcm) if diarizer else None
    pieces = engine.transcribe(pcm, turns)
    elapsed = time.perf_counter() - started
    utterances = assemble(pieces, turns, assign_roles(label_stats(pcm, turns)) if turns else {})
    hypothesis = ' '.join(u['text'] for u in utterances)
    confidences = [u['confidence'] for u in utterances if u['confidence'] is not None]
    words = [(len(u['text'].split()), u['speaker_role'] if (u['speaker_confidence'] or 0) >= 0.85 else None) for u in utterances]
    total_words = sum(count for count, _ in words)
    # Live lag: a 2-second chunk with the previous chunk as context, as the worker sends it.
    lags = []
    chunks = max(1, len(pcm) // CHUNK_BYTES)
    for index in range(1, chunks, max(1, chunks // live_samples)):
        clip = pcm[(index - 1) * CHUNK_BYTES:(index + 1) * CHUNK_BYTES]
        tick = time.perf_counter()
        engine.transcribe(clip, None)
        lags.append(time.perf_counter() - tick)
    result = {
        'audio_seconds': round(seconds, 1), 'processing_seconds': round(elapsed, 2),
        'real_time_factor': round(elapsed / seconds, 3) if seconds else None,
        'provisional_lag_p50_s': percentile(lags, 0.5), 'provisional_lag_p95_s': percentile(lags, 0.95),
        'mean_confidence': round(statistics.fmean(confidences), 3) if confidences else None,
        'unknown_speaker_share': round(sum(count for count, role in words if role is None) / total_words, 3) if total_words else None,
        'languages': sorted({u['language'] for u in utterances if u['language']}),
        'utterances': len(utterances),
    }
    if reference and reference.get('text'):
        result['wer'] = error_rate(reference['text'], hypothesis)
        result['cer'] = error_rate(reference['text'], hypothesis, 'char')
        result['reference_language'] = reference.get('language')
    return result


def summarise(files: dict[str, dict[str, Any]]) -> dict[str, Any]:
    def mean(key: str, rows) -> float | None:
        values = [row[key] for row in rows if row.get(key) is not None]
        return round(statistics.fmean(values), 4) if values else None
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in files.values():
        groups.setdefault(row.get('reference_language') or 'unlabelled', []).append(row)
    return {language: {'files': len(rows), 'wer': mean('wer', rows), 'cer': mean('cer', rows), 'real_time_factor': mean('real_time_factor', rows),
                       'provisional_lag_p95_s': max((row['provisional_lag_p95_s'] for row in rows if row['provisional_lag_p95_s'] is not None), default=None),
                       'unknown_speaker_share': mean('unknown_speaker_share', rows), 'mean_confidence': mean('mean_confidence', rows)}
            for language, rows in sorted(groups.items())}


def main() -> None:
    import os
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--audio', required=True, type=Path)
    parser.add_argument('--refs', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    from production import _list
    from engines import IndicConformerEngine, PyannoteDiarizer, WhisperEngine
    device = os.environ.get('PROCESSOR_DEVICE', 'cuda')
    if os.environ.get('PROCESSOR_ENGINE', 'whisper') == 'whisper':
        engine = WhisperEngine(os.environ['PROCESSOR_WHISPER_MODEL'], device=device, compute_type=os.environ.get('PROCESSOR_COMPUTE_TYPE', 'float16'), languages=_list('PROCESSOR_LANGUAGES', 'hi,en'))
    else:
        engine = IndicConformerEngine(os.environ.get('PROCESSOR_LANGUAGE', 'hi'), device=device, token=os.environ.get('PROCESSOR_HF_TOKEN') or None)
    diarizer = PyannoteDiarizer(os.environ['PROCESSOR_HF_TOKEN'], device=device) if os.environ.get('PROCESSOR_DIARIZATION') == 'true' else None
    references = json.loads(args.refs.read_text(encoding='utf-8')) if args.refs else {}
    files = {path.name: bench_file(read_pcm(path), engine, diarizer, references.get(path.name)) for path in sorted(args.audio.glob('*.wav'))}
    report = {'engine': {'provider': engine.provider, 'model': engine.model, 'diarization': diarizer.provider if diarizer else None},
              'summary': summarise(files), 'files': files}
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(report['summary'], indent=2))


if __name__ == '__main__':
    main()
