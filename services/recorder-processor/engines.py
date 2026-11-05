"""Model engines for the private processor. Heavy libraries load only here, at startup.

- WhisperEngine: faster-whisper (CTranslate2). Segment and word timestamps,
  per-word probabilities (confidence), language detection limited to an
  allowlist (default hi,en; Marathi/Gujarati are opt-in), optional English
  translation per stretch.
- IndicConformerEngine: the legacy ai4bharat/indic-conformer-600m-multilingual
  CTC model, one fixed language, no confidence. Kept as an alternative.
- PyannoteDiarizer: pyannote/speaker-diarization-3.1 (legacy choice).
"""
from __future__ import annotations

import math
from typing import Sequence

from processor import SAMPLE_RATE, Piece, Turn, Word

MIN_TURN_S = 0.3        # Legacy MIN_SPEAKER_SEGMENT_SECONDS.
WINDOW_S = 20.0


def _float_audio(pcm: bytes):
    import numpy as np
    return (np.frombuffer(pcm[: len(pcm) - len(pcm) % 2], dtype='<i2').astype(np.float32) / 32768.0).clip(-1.0, 1.0)


class WhisperEngine:
    provider = 'faster-whisper'

    def __init__(self, model: str, device: str = 'cuda', compute_type: str = 'float16', languages: Sequence[str] = ('hi', 'en'), translate: bool = False):
        from faster_whisper import WhisperModel
        self.model = model
        self.languages = tuple(languages)
        self.translate = translate
        self._whisper = WhisperModel(model, device=device, compute_type=compute_type)

    def _language(self, info) -> str | None:
        if not self.languages or info.language in self.languages:
            return info.language
        probabilities = dict(getattr(info, 'all_language_probs', None) or [])
        allowed = [(probabilities.get(code, 0.0), code) for code in self.languages]
        return max(allowed)[1] if allowed else None

    def transcribe(self, pcm: bytes, turns: Sequence[Turn] | None) -> list[Piece]:
        audio = _float_audio(pcm)
        if not audio.size or not audio.any():
            return []
        options = dict(beam_size=5, vad_filter=True, word_timestamps=True, temperature=0.0,
                       # Legacy saw repeated-word loops; not conditioning on earlier text reduces them.
                       condition_on_previous_text=False)
        segments, info = self._whisper.transcribe(audio, language=None, **options)
        language = self._language(info)
        if language != info.language:
            segments, info = self._whisper.transcribe(audio, language=language, **options)
        pieces: list[Piece] = []
        for segment in segments:
            # Drop likely hallucinations over silence.
            if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1.0:
                continue
            words = tuple(Word(float(w.start), float(w.end), w.word, round(float(w.probability), 3)) for w in (segment.words or []))
            translation = None
            if self.translate and language not in (None, 'en'):
                clip = audio[int(segment.start * SAMPLE_RATE): int(segment.end * SAMPLE_RATE)]
                translated, _ = self._whisper.transcribe(clip, language=language, task='translate', beam_size=5, temperature=0.0, condition_on_previous_text=False)
                translation = ' '.join(part.text.strip() for part in translated) or None
            pieces.append(Piece(float(segment.start), float(segment.end), segment.text,
                                round(min(1.0, math.exp(segment.avg_logprob)), 3), language, words, translation))
        return pieces


class IndicConformerEngine:
    provider = 'ai4bharat'
    model = 'indic-conformer-600m-multilingual'

    def __init__(self, language: str = 'hi', device: str = 'cuda', token: str | None = None):
        import torch
        from transformers import AutoModel
        self.language = language
        self._torch = torch
        self._model = AutoModel.from_pretrained('ai4bharat/indic-conformer-600m-multilingual', trust_remote_code=True, **({'token': token} if token else {}))
        self._model.eval()
        if device == 'cuda' and torch.cuda.is_available():
            self._model.to('cuda')

    def _windows(self, total_s: float, turns: Sequence[Turn] | None) -> list[tuple[float, float]]:
        if turns:
            spans = []
            for turn in turns:
                start = turn.start_s
                while start < turn.end_s:
                    spans.append((start, min(turn.end_s, start + WINDOW_S)))
                    start += WINDOW_S
            return spans
        spans, start = [], 0.0
        while start < total_s:
            spans.append((start, min(total_s, start + WINDOW_S)))
            start += WINDOW_S
        return spans

    def transcribe(self, pcm: bytes, turns: Sequence[Turn] | None) -> list[Piece]:
        audio = _float_audio(pcm)
        pieces: list[Piece] = []
        for start, end in self._windows(audio.size / SAMPLE_RATE, turns):
            clip = audio[int(start * SAMPLE_RATE): int(end * SAMPLE_RATE)]
            if not clip.size or not clip.any():
                continue
            with self._torch.no_grad():
                text = self._model(self._torch.from_numpy(clip).float().unsqueeze(0), self.language, 'ctc')
            if isinstance(text, (list, tuple)):
                text = ' '.join(str(item) for item in text)
            if str(text).strip():
                pieces.append(Piece(start, end, str(text), None, self.language))
        return pieces


class PyannoteDiarizer:
    provider = 'pyannote/speaker-diarization-3.1'

    def __init__(self, token: str, device: str = 'cuda', max_speakers: int = 4):
        import torch
        from pyannote.audio import Pipeline
        if not token:
            raise ValueError('Hugging Face token required for pyannote')
        self._torch = torch
        self.max_speakers = max_speakers
        self._pipeline = Pipeline.from_pretrained('pyannote/speaker-diarization-3.1', use_auth_token=token)
        if device == 'cuda' and torch.cuda.is_available():
            self._pipeline.to(torch.device('cuda'))

    def diarize(self, pcm: bytes) -> list[Turn]:
        audio = _float_audio(pcm)
        if not audio.size or not audio.any():
            return []
        result = self._pipeline({'waveform': self._torch.from_numpy(audio).unsqueeze(0), 'sample_rate': SAMPLE_RATE}, min_speakers=1, max_speakers=self.max_speakers)
        turns = [Turn(float(turn.start), float(turn.end), str(label)) for turn, _, label in result.itertracks(yield_label=True) if turn.end - turn.start >= MIN_TURN_S]
        return sorted(turns, key=lambda item: item.start_s)
