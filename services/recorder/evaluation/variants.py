"""Deterministic transcript variants that imitate noisy store audio and weak diarization."""
from __future__ import annotations

import copy
import hashlib
from typing import Any, Callable

# Common ASR confusions in Hinglish jewellery conversations.
CONFUSIONS = {'making': 'mekin', 'charges': 'charjes', 'hallmark': 'hall mark', 'carat': 'karat', 'necklace': 'neckless',
              'shaadi': 'shadi', 'discount': 'discaunt', 'diamond': 'dimond', 'certificate': 'certifikate', 'exchange': 'ekschange'}


def _pick(word: str, salt: str, every: int) -> bool:
    return int(hashlib.sha256(f'{salt}:{word}'.encode()).hexdigest(), 16) % every == 0


def asr_noise(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = copy.deepcopy(segments)
    for s in out:
        s['raw_text'] = ' '.join(CONFUSIONS.get(w.lower().strip('.,?!'), w) if _pick(w, s['segment_id'], 2) else w for w in s['raw_text'].split())
        s['display_text'] = None
        s['stt_confidence'] = 0.55
    return out


def word_dropout(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = copy.deepcopy(segments)
    for s in out:
        s['raw_text'] = ' '.join(w for i, w in enumerate(s['raw_text'].split()) if (i + 1) % 6)
        s['display_text'] = None
    return out


def speakers_unknown(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = copy.deepcopy(segments)
    for s in out:
        s['speaker'] = 'unknown'
    return out


def truncated(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keep = max(1, round(len(segments) * 0.7))
    return copy.deepcopy(segments[:keep])


VARIANTS: dict[str, Callable[[list[dict[str, Any]]], list[dict[str, Any]]]] = {
    'original': copy.deepcopy, 'asr_noise': asr_noise, 'word_dropout': word_dropout,
    'speakers_unknown': speakers_unknown, 'truncated': truncated,
}
