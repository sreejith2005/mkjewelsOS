"""Store Intelligence evaluation harness.

Scoring consistency (repeats, noisy variants), agreement with human rubric
labels, signal precision/recall and failure examples, for one analyzer and
prompt version. Fixtures are synthetic or owner-reviewed; never commit real
customer conversations. Marathi/Gujarati and real store-audio sets are
opt-in (--languages) and must be measured before they are called production quality.

  python -m evaluation.run_eval analysis --repeats 3 --out report.json   (uses RECORDER_ANALYZER_* env)
  python -m evaluation.run_eval wer --pairs stt_pairs.jsonl              (STT benchmark: WER/CER)

The report holds fixture IDs, numbers and error codes, never transcript text.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any
from uuid import uuid4

from analysis import Analyzer, analyze_job
from evaluation.metrics import cer, cohen_kappa, compute_total, precision_recall, spread, wer
from evaluation.variants import VARIANTS
from prompts import PROMPT_VERSION
from recorder import Fault

FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'reference_conversations.json'
SIGNALS = ('objection', 'price_concern', 'stock_gap', 'competitor_mention', 'customer_questions', 'conversion_signal', 'next_step', 'drop_off', 'upsell_opportunity')
DEFAULT_LANGUAGES = ('hi', 'en')


def quality(segments: list[dict[str, Any]]) -> dict[str, Any]:
    spoken = [s for s in segments if s['raw_text'].strip()]
    confidences = [s['stt_confidence'] for s in spoken if s.get('stt_confidence') is not None]
    duration = sum(s['end_ms'] - s['start_ms'] for s in spoken)
    unknown = sum(s['end_ms'] - s['start_ms'] for s in spoken if s['speaker'] == 'unknown')
    return {'words': sum(len(s['raw_text'].split()) for s in spoken), 'spoken_segments': len(spoken),
            'mean_stt_confidence': round(sum(confidences) / len(confidences), 3) if confidences else None,
            'unknown_speaker_share': round(unknown / duration, 3) if duration else None}


def status_of(result: dict[str, Any], q: dict[str, Any], rubric: list[dict[str, Any]], min_assessed: float) -> tuple[str, float | None]:
    """Mirrors the server status rules so offline results read like production ones."""
    if result['status_hint'] == 'insufficient_evidence' or q['words'] < 25 or q['spoken_segments'] < 2:
        return 'insufficient_evidence', None
    total = compute_total(result['dimensions'], rubric, min_assessed)
    if total is None:
        return 'insufficient_evidence', None
    output = result['output']
    review = ((q['mean_stt_confidence'] is not None and q['mean_stt_confidence'] < 0.6)
              or (q['unknown_speaker_share'] is not None and q['unknown_speaker_share'] > 0.5)
              or result['analyzer']['fallback_used'] or output['analyzer_confidence'] < 0.5
              or any(f['severity'] == 'high' for f in output['policy_findings']))
    return ('needs_review' if review else 'scored'), total


async def evaluate(fixtures: dict[str, Any], analyzer: Analyzer, repeats: int = 3, variants: tuple[str, ...] = tuple(VARIANTS),
                   languages: tuple[str, ...] = DEFAULT_LANGUAGES, fallback: Analyzer | None = None) -> dict[str, Any]:
    rubric, min_assessed = fixtures['rubric'], fixtures.get('min_assessed_weight', 50)
    runs: list[dict[str, Any]] = []
    for conv in fixtures['conversations']:
        if conv['language'] not in languages:
            continue
        for variant in variants:
            segments = VARIANTS[variant](conv['segments'])
            q = quality(segments)
            for repeat in range(repeats):
                job = {'id': str(uuid4()), 'job_version': 'eval', 'segments': segments, 'quality': q,
                       'rubric': {'id': 'eval', 'version': 0, 'dimensions': rubric, 'min_assessed_weight': min_assessed}, 'sop': fixtures.get('sop')}
                run = {'conversation': conv['id'], 'language': conv['language'], 'variant': variant, 'repeat': repeat}
                try:
                    result = await analyze_job(job, analyzer, fallback)
                    run['status'], run['total'] = status_of(result, q, rubric, min_assessed)
                    run['dimensions'] = {d['key']: {'status': d['status'], 'rating': d['rating']} for d in result['dimensions']}
                    run['signals'] = {k: result['output']['signals'][k]['detected'] for k in SIGNALS} if result['output'] else {}
                    run['outcome'] = result['output']['signals']['sales_outcome']['value'] if result['output'] else None
                    run['fallback_used'] = result['analyzer']['fallback_used']
                except Fault as exc:
                    run['error'] = exc.code
                runs.append(run)
    return report(fixtures, runs, repeats)


def report(fixtures: dict[str, Any], runs: list[dict[str, Any]], repeats: int) -> dict[str, Any]:
    human = {c['id']: c['human'] for c in fixtures['conversations']}
    rubric, min_assessed = fixtures['rubric'], fixtures.get('min_assessed_weight', 50)
    by_conv: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        by_conv[run['conversation']].append(run)
    conversations, failures = [], []
    dim_pred, dim_truth, rating_errors, status_pairs = [], [], defaultdict(list), []
    sig_pred: dict[str, list[bool]] = defaultdict(list)
    sig_truth: dict[str, list[bool]] = defaultdict(list)
    for conv_id, items in by_conv.items():
        h = human[conv_id]
        h_dims = [{'key': k, **v} for k, v in h['dimensions'].items()]
        h_total = compute_total(h_dims, rubric, min_assessed) if h['status'] != 'insufficient_evidence' else None
        originals = [r for r in items if r['variant'] == 'original' and 'error' not in r]
        per_variant = {v: spread([r.get('total') for r in items if r['variant'] == v and 'error' not in r]) for v in sorted({r['variant'] for r in items})}
        conversations.append({'id': conv_id, 'human_total': h_total, 'human_status': h['status'], 'repeat_spread': per_variant.get('original'),
                              'variant_spread': per_variant, 'all_runs_spread': spread([r.get('total') for r in items if 'error' not in r]),
                              'errors': sum('error' in r for r in items)})
        for r in originals:
            status_pairs.append((r['status'], h['status']))
            if r['status'] != h['status'] and not (r['status'] == 'needs_review' and h['status'] == 'scored'):
                failures.append({'conversation': conv_id, 'variant': r['variant'], 'repeat': r['repeat'], 'kind': 'status_mismatch', 'got': r['status'], 'want': h['status']})
            if h_total is not None and r.get('total') is not None and abs(r['total'] - h_total) > 10:
                failures.append({'conversation': conv_id, 'variant': r['variant'], 'repeat': r['repeat'], 'kind': 'total_off_by_more_than_10', 'got': r['total'], 'want': h_total})
            for key, truth in h['dimensions'].items():
                got = r['dimensions'].get(key)
                if got is None:
                    continue
                dim_pred.append(got['status'])
                dim_truth.append(truth['status'])
                if got['status'] == truth['status'] == 'assessed':
                    rating_errors[key].append(abs(got['rating'] - truth['rating']))
            for key in SIGNALS:
                if key in r['signals']:
                    sig_pred[key].append(r['signals'][key])
                    sig_truth[key].append(h['signals'].get(key, False))
                    if r['signals'][key] and not h['signals'].get(key, False):
                        failures.append({'conversation': conv_id, 'variant': 'original', 'repeat': r['repeat'], 'kind': f'false_positive:{key}'})
        for r in items:
            if r['variant'] == 'speakers_unknown' and r.get('status') == 'scored':
                failures.append({'conversation': conv_id, 'variant': r['variant'], 'repeat': r['repeat'], 'kind': 'scored_without_speakers'})
            if 'error' in r:
                failures.append({'conversation': conv_id, 'variant': r['variant'], 'repeat': r['repeat'], 'kind': 'error', 'code': r['error']})
    return {
        'prompt_version': PROMPT_VERSION, 'repeats': repeats, 'runs': len(runs),
        'invalid_or_failed_rate': round(sum('error' in r for r in runs) / len(runs), 3) if runs else None,
        'conversations': conversations,
        'agreement': {
            'status_accuracy': round(sum(a == b for a, b in status_pairs) / len(status_pairs), 3) if status_pairs else None,
            'dimension_status_kappa': cohen_kappa(dim_pred, dim_truth),
            'rating_mae': {k: round(sum(v) / len(v), 2) for k, v in rating_errors.items()},
        },
        'signals': {k: precision_recall(sig_pred[k], sig_truth[k]) for k in SIGNALS if sig_pred[k]},
        'failure_examples': failures[:50],
    }


def wer_report(pairs_path: Path) -> dict[str, Any]:
    groups: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for line in pairs_path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        w, c = wer(row['reference'], row['hypothesis']), cer(row['reference'], row['hypothesis'])
        if w is not None and c is not None:
            groups[f"{row.get('language', 'unknown')}/{row.get('noise', 'unknown')}"].append((w, c))
    return {k: {'n': len(v), 'wer': round(sum(x for x, _ in v) / len(v), 4), 'cer': round(sum(y for _, y in v) / len(v), 4)} for k, v in sorted(groups.items())}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    a = sub.add_parser('analysis')
    a.add_argument('--fixtures', type=Path, default=FIXTURES)
    a.add_argument('--repeats', type=int, default=3)
    a.add_argument('--variants', default=','.join(VARIANTS))
    a.add_argument('--languages', default=','.join(DEFAULT_LANGUAGES), help='hi,en by default; add mr,gu only with reviewed reference sets')
    a.add_argument('--out', type=Path)
    w = sub.add_parser('wer')
    w.add_argument('--pairs', type=Path, required=True, help='JSONL rows {id, language, noise, reference, hypothesis}')
    args = parser.parse_args(argv)
    if args.command == 'wer':
        result = wer_report(args.pairs)
    else:
        # Same configuration as the analysis worker (RECORDER_ANALYZER_KIND=bedrock or the private gateway).
        from production import _analyzer
        analyzer = _analyzer('RECORDER_ANALYZER')
        fixtures = json.loads(args.fixtures.read_text(encoding='utf-8'))
        result = asyncio.run(evaluate(fixtures, analyzer, args.repeats, tuple(args.variants.split(',')), tuple(args.languages.split(','))))
    text = json.dumps(result, indent=2)
    if getattr(args, 'out', None):
        args.out.write_text(text, encoding='utf-8')
    else:
        print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
