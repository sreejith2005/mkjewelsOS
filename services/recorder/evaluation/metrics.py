"""Evaluation metrics. compute_total mirrors recording_compute_score for offline
evaluation only; the database stays the scoring authority (parity tested)."""
from __future__ import annotations

import math
from collections import Counter
from statistics import pstdev
from typing import Any, Iterable, Sequence


def compute_total(dimensions: Sequence[dict[str, Any]], rubric: Sequence[dict[str, Any]], min_assessed: float = 50) -> float | None:
    ratings = {d['key']: d for d in dimensions}
    assessed = weighted = 0
    for item in rubric:
        d = ratings.get(item['key'])
        if d is None:
            raise ValueError('dimension_missing')
        if d['status'] == 'assessed':
            assessed += item['weight']
            weighted += d['rating'] * item['weight']
    if assessed <= 0 or assessed < min_assessed:
        return None
    # Half-up rounding of an exact rational, like SQL numeric round().
    return math.floor(weighted * 1000 / assessed + 0.5) / 100


def spread(values: Iterable[float | None]) -> dict[str, float | int | None]:
    items = list(values)
    present = [v for v in items if v is not None]
    return {'n': len(present), 'missing': len(items) - len(present),
            'stdev': round(pstdev(present), 3) if present else None,
            'range': round(max(present) - min(present), 2) if present else None}


def cohen_kappa(a: Sequence[str], b: Sequence[str]) -> float | None:
    if len(a) != len(b) or not a:
        return None
    n = len(a)
    observed = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    expected = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    return 1.0 if expected == 1 else round((observed - expected) / (1 - expected), 3)


def precision_recall(predicted: Sequence[bool], truth: Sequence[bool]) -> dict[str, float | int | None]:
    tp = sum(p and t for p, t in zip(predicted, truth))
    fp = sum(p and not t for p, t in zip(predicted, truth))
    fn = sum(t and not p for p, t in zip(predicted, truth))
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
    r = lambda v: round(v, 3) if v is not None else None  # noqa: E731
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': r(precision), 'recall': r(recall), 'f1': r(f1)}


def _edits(ref: Sequence[str], hyp: Sequence[str]) -> int:
    previous = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        current = [i]
        for j, h in enumerate(hyp, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (r != h)))
        previous = current
    return previous[-1]


def wer(reference: str, hypothesis: str) -> float | None:
    ref = reference.lower().split()
    return round(_edits(ref, hypothesis.lower().split()) / len(ref), 4) if ref else None


def cer(reference: str, hypothesis: str) -> float | None:
    ref = ''.join(reference.lower().split())
    return round(_edits(list(ref), list(''.join(hypothesis.lower().split()))) / len(ref), 4) if ref else None
