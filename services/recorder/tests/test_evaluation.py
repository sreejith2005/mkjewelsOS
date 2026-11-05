import asyncio
import json
import re

import pytest

from evaluation.metrics import cer, cohen_kappa, compute_total, precision_recall, wer
from evaluation.run_eval import FIXTURES, evaluate, wer_report

FIX = json.loads(FIXTURES.read_text(encoding='utf-8'))
RUBRIC = FIX['rubric']
KEYS = [d['key'] for d in RUBRIC]
SIGNALS = ['objection', 'price_concern', 'stock_gap', 'competitor_mention', 'customer_questions', 'conversion_signal', 'next_step', 'drop_off', 'upsell_opportunity']
LINE = re.compile(r'^\[([0-9a-f-]{36})\] \S+ \S+: (.+)$', re.M)


def dims(ratings, statuses):
    return [{'key': k, 'status': s, 'rating': r if s == 'assessed' else None} for k, r, s in zip(KEYS, ratings, statuses)]


A, NA, IE = 'assessed', 'not_applicable', 'insufficient_evidence'


@pytest.mark.parametrize('ratings,statuses,expected', [
    ([8, 7, 6, 5, 9, 7, 8], [A] * 7, 70.0),
    ([8, 7, 6, 0, 0, 7, 8], [A, A, A, NA, IE, A, A], 71.33),
    ([8, 0, 6, 0, 0, 0, 8], [A, IE, A, NA, IE, IE, A], None),
    ([0] * 7, [A] * 7, 0.0),
    ([10, 10, 0, 0, 0, 10, 0], [A, A, IE, NA, NA, A, IE], 100.0),
    ([8, 7, 8, 0, 7, 8, 9], [A, A, A, NA, A, A, A], 77.65),
])
def test_offline_score_mirror_matches_database_vectors(ratings, statuses, expected):
    assert compute_total(dims(ratings, statuses), RUBRIC, 50) == expected


class HumanLabelAnalyzer:
    """Deterministic: answers with the fixture's human labels, quoting words it actually sees in the prompt."""
    provider, model = 'eval-fake', 'human-labels'

    def __init__(self, extra_signals=()):
        self.extra_signals = set(extra_signals)

    async def complete(self, system, user):
        lines = LINE.findall(user)
        conv = next(c for c in FIX['conversations'] if lines and any(s['segment_id'] == lines[0][0] for s in c['segments']))
        quote = lambda i: {'segment_id': lines[i % len(lines)][0], 'quote': ' '.join(lines[i % len(lines)][1].split()[:3])}  # noqa: E731
        h = conv['human']
        signals = {k: {'detected': bool(h['signals'].get(k)) or k in self.extra_signals, 'confidence': .8, 'reason': 'Labelled.',
                       'evidence': [quote(1)] if (h['signals'].get(k) or k in self.extra_signals) else []} for k in SIGNALS}
        signals['sales_outcome'] = {'value': h['sales_outcome'], 'confidence': .8, 'reason': 'Labelled.', 'evidence': [quote(1)] if h['sales_outcome'] != 'unknown' else []}
        claim = lambda i: {'text': 'Point', 'evidence': [quote(i)]}  # noqa: E731
        return json.dumps({'status_hint': 'scored', 'dimensions': [
            {'key': k, 'status': v['status'], 'rating': v['rating'], 'reason': 'Labelled.', 'evidence': [quote(0)] if v['status'] == 'assessed' else []}
            for k, v in h['dimensions'].items()], 'output': {
            'summary': 'Synthetic.', 'key_points': [claim(0), claim(1), claim(2)], 'product_interests': [], 'customer_requirements': {'budget': None, 'occasion': None, 'requirements': []},
            'customer_concerns': [], 'competitor_mentions': [], 'purchase_blockers': [], 'coaching_strengths': [], 'coaching_gaps': [],
            'coaching_interventions': [{'text': 'Practise', 'reason': 'Labelled', 'evidence': [quote(0)]}], 'next_best_actions': [],
            'signals': signals, 'policy_findings': [], 'analyzer_confidence': .8}})


def test_report_measures_consistency_agreement_and_review_routing():
    report = asyncio.run(evaluate(FIX, HumanLabelAnalyzer(), repeats=2))
    assert report['invalid_or_failed_rate'] == 0
    convs = {c['id']: c for c in report['conversations']}
    assert convs['hi_bridal_follow_up']['repeat_spread']['stdev'] == 0
    assert convs['hi_bridal_follow_up']['human_total'] == compute_total([{'key': k, **v} for k, v in FIX['conversations'][0]['human']['dimensions'].items()], RUBRIC)
    assert convs['hi_short_fragment']['all_runs_spread']['n'] == 0, 'too little speech is never scored'
    assert report['agreement']['status_accuracy'] == 1.0 and report['agreement']['dimension_status_kappa'] == 1.0
    assert not [f for f in report['failure_examples'] if f['kind'] == 'scored_without_speakers'], 'unknown speakers route to review'
    assert 'raw_text' not in json.dumps(report) and 'shaadi' not in json.dumps(report), 'no transcript text in reports'


def test_price_question_flagged_as_concern_is_a_failure_example():
    report = asyncio.run(evaluate(FIX, HumanLabelAnalyzer(extra_signals={'price_concern'}), repeats=1, variants=('original',)))
    assert report['signals']['price_concern']['fp'] >= 1
    assert {'conversation': 'en_price_question_not_objection', 'variant': 'original', 'repeat': 0, 'kind': 'false_positive:price_concern'} in report['failure_examples']


def test_marathi_and_gujarati_are_opt_in():
    report = asyncio.run(evaluate(FIX, HumanLabelAnalyzer(), repeats=1, variants=('original',), languages=('mr', 'gu')))
    assert report['runs'] == 0


def test_metric_helpers(tmp_path):
    assert wer('making charges kitna hai', 'mekin charges kitna hai') == 0.25
    assert cer('abc', 'abd') == round(1 / 3, 4)
    assert cohen_kappa(['a', 'b', 'a', 'b'], ['a', 'b', 'a', 'b']) == 1.0
    assert precision_recall([True, True, False], [True, False, True]) == {'tp': 1, 'fp': 1, 'fn': 1, 'precision': .5, 'recall': .5, 'f1': .5}
    pairs = tmp_path / 'pairs.jsonl'
    pairs.write_text('\n'.join(json.dumps(r) for r in [
        {'id': '1', 'language': 'hi', 'noise': 'store', 'reference': 'a b c d', 'hypothesis': 'a b c x'},
        {'id': '2', 'language': 'hi', 'noise': 'store', 'reference': 'a b', 'hypothesis': 'a b'}]), encoding='utf-8')
    assert wer_report(pairs) == {'hi/store': {'n': 2, 'wer': 0.125, 'cer': 0.125}}
