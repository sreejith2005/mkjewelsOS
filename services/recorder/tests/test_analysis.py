import asyncio
import copy
import json
from uuid import uuid4

import pytest

from analysis import AnalysisWorker, analyze_job, validate_response, InvalidOutput
from contracts import AnalysisSubmission
from prompts import build_user_prompt
from recorder import Fault

S = [str(uuid4()) for _ in range(6)]
SEGMENTS = [
    dict(segment_id=S[0], ordinal=0, start_ms=0, end_ms=1800, speaker='employee', language='hi', raw_text='Namaste ji, MK Jewels mein aapka swagat hai. Aaj kis occasion ke liye dekh rahe hain?', display_text=None, translation_en=None, stt_confidence=.9),
    dict(segment_id=S[1], ordinal=1, start_ms=2000, end_ms=3900, speaker='customer', language='hi', raw_text='Beti ki shaadi hai, bridal necklace chahiye, budget around 3 lakh.', display_text=None, translation_en=None, stt_confidence=.9),
    dict(segment_id=S[2], ordinal=2, start_ms=4000, end_ms=4800, speaker='employee', language='hi', raw_text='Hamare paas 22 carat hallmark wale bridal sets hain, making charges 12 se 18 percent hain.', display_text=None, translation_en=None, stt_confidence=.9),
    dict(segment_id=S[3], ordinal=3, start_ms=4800, end_ms=5100, speaker='unknown', language='hi', raw_text='Making charges thoda zyada lag raha hai.', display_text=None, translation_en=None, stt_confidence=.9),
    dict(segment_id=S[4], ordinal=4, start_ms=5100, end_ms=5500, speaker='customer', language='hi', raw_text='Mera number 98765 43210 hai, kal papa ke saath aayenge.', display_text=None, translation_en=None, stt_confidence=.9),
    dict(segment_id=S[5], ordinal=5, start_ms=5500, end_ms=6000, speaker='employee', language='hi', raw_text='Bilkul, main aapke liye designs hold kar deti hoon aur kal call karti hoon.', display_text=None, translation_en=None, stt_confidence=.9),
]
RUBRIC = [dict(key=k, label=k, weight=w) for k, w in [('greeting_sop', 15), ('product_knowledge', 20), ('needs_discovery', 15), ('objection_handling', 15), ('pricing_value', 10), ('closing_follow_up', 15), ('personalization_empathy', 10)]]


def job(**over):
    base = dict(id=str(uuid4()), worker_id=str(uuid4()), lease_token=str(uuid4()), job_version='mk-sales-v1', segments=SEGMENTS,
                quality=dict(words=60, spoken_segments=6, mean_stt_confidence=.9, unknown_speaker_share=.1),
                rubric=dict(id=str(uuid4()), version=1, dimensions=RUBRIC, min_assessed_weight=50),
                sop=dict(id=str(uuid4()), version=1, title='Sales SOP', clauses=[dict(clause_id='MC-1', topic='making_charges', text='Making charges are 12 to 18 percent.')]))
    base.update(over)
    return base


def ev(i, q):
    return {'segment_id': S[i], 'quote': q}


NO = {'detected': False, 'confidence': .8, 'reason': 'Not observed.', 'evidence': []}


def response(**patch):
    out = {
        'summary': 'Bridal necklace enquiry; family returns tomorrow.',
        'key_points': [{'text': 'Bridal necklace', 'evidence': [ev(1, 'bridal necklace chahiye')]},
                       {'text': 'Making charges range given', 'evidence': [ev(2, '12 se 18 percent')]},
                       {'text': 'Return visit', 'evidence': [ev(4, 'kal papa ke saath aayenge')]}],
        'product_interests': [], 'customer_requirements': {'budget': {'text': 'About 3 lakh', 'evidence': [ev(1, 'budget around 3 lakh')]}, 'occasion': None, 'requirements': []},
        'customer_concerns': [], 'competitor_mentions': [], 'purchase_blockers': [], 'coaching_strengths': [], 'coaching_gaps': [],
        'coaching_interventions': [{'text': 'Tell the value story before the range', 'reason': 'Reaction to making charges', 'evidence': [ev(3, 'thoda zyada')]}],
        'next_best_actions': [{'action': 'Call tomorrow', 'reason': 'Visit agreed', 'evidence': [ev(4, 'mera number [PHONE] hai')]}],
        'signals': {k: copy.deepcopy(NO) for k in ['objection', 'price_concern', 'stock_gap', 'competitor_mention', 'customer_questions', 'conversion_signal', 'next_step', 'drop_off', 'upsell_opportunity']}
                   | {'sales_outcome': {'value': 'follow_up', 'confidence': .8, 'reason': 'Return visit.', 'evidence': [ev(4, 'kal papa ke saath')]}},
        'policy_findings': [], 'analyzer_confidence': .8,
    }
    dims = [{'key': d['key'], 'status': 'assessed', 'rating': 7, 'reason': 'Seen.', 'evidence': [ev(0, 'MK Jewels mein aapka swagat hai')]} for d in RUBRIC]
    dims[3] = {'key': 'objection_handling', 'status': 'not_applicable', 'rating': None, 'reason': 'No objection.', 'evidence': []}
    value = {'status_hint': 'scored', 'output': out, 'dimensions': dims}
    for path, v in patch.items():
        target = value
        keys = path.split('.')
        for k in keys[:-1]:
            target = target[int(k)] if k.isdigit() else target[k]
        target[int(keys[-1]) if keys[-1].isdigit() else keys[-1]] = v
    return json.dumps(value)


class Scripted:
    def __init__(self, replies, provider='private-llm', model='m1'):
        self.replies, self.provider, self.model, self.prompts = list(replies), provider, model, []

    async def complete(self, system, user):
        self.prompts.append(user)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def test_valid_response_becomes_a_schema_valid_submission():
    result = asyncio.run(analyze_job(job(), Scripted([response()])))
    AnalysisSubmission.model_validate_json(json.dumps(result))
    assert result['analyzer'] == {'provider': 'private-llm', 'model': 'm1', 'prompt_version': 'mk-sales-prompt-v1', 'fallback_used': False, 'fallback_reason': None}
    assert 'total' not in json.dumps(result), 'the worker never computes the score'


def test_too_little_speech_never_calls_a_model():
    analyzer = Scripted([])
    result = asyncio.run(analyze_job(job(quality=dict(words=10, spoken_segments=1)), analyzer))
    assert result['status_hint'] == 'insufficient_evidence' and result['output'] == {} and analyzer.prompts == []


@pytest.mark.parametrize('patch,error', [
    ({'output.key_points.0.evidence.0.quote': 'words nobody said'}, 'quote_not_in_segment:key_points'),
    ({'output.policy_findings': [{'severity': 'high', 'clause_id': 'MC-1', 'statement': 'x', 'evidence': [ev(3, 'thoda zyada')]}]}, 'high_finding_without_employee_evidence'),
    ({'output.policy_findings': [{'severity': 'low', 'clause_id': 'NOPE-1', 'statement': 'x', 'evidence': [ev(2, '22 carat')]}]}, 'unknown_sop_clause'),
    ({'dimensions.6.rating': 5, 'dimensions.6.status': 'insufficient_evidence'}, 'schema:dimensions.6'),
    ({'output.signals.drop_off.detected': True}, 'schema:output.signals.drop_off'),
])
def test_ungrounded_or_overconfident_output_rejected(patch, error):
    with pytest.raises(InvalidOutput) as exc:
        validate_response(response(**patch), job())
    assert error in exc.value.errors
    assert all('98765' not in e and 'zyada' not in e for e in exc.value.errors), 'error codes carry no transcript text'


def test_sensitive_attribute_fields_rejected():
    value = json.loads(response())
    value['output']['customer_gender'] = 'female'
    with pytest.raises(InvalidOutput):
        validate_response(json.dumps(value), job())


def test_repair_attempt_fixes_invalid_output():
    analyzer = Scripted([response(**{'output.key_points.0.evidence.0.quote': 'invented'}), response()])
    result = asyncio.run(analyze_job(job(), analyzer))
    assert result['status_hint'] == 'scored' and len(analyzer.prompts) == 2
    assert 'quote_not_in_segment' in analyzer.prompts[1]


def test_fallback_is_explicit_and_recorded():
    primary = Scripted([Fault(503, 'analyzer_unavailable')])
    result = asyncio.run(analyze_job(job(), primary, Scripted([response()], provider='backup', model='m2')))
    assert result['analyzer']['fallback_used'] is True and result['analyzer']['fallback_reason'] == 'primary_unavailable' and result['analyzer']['model'] == 'm2'


def test_no_fallback_configured_means_failure_not_silence():
    with pytest.raises(Fault):
        asyncio.run(analyze_job(job(), Scripted(['not json'] * 3)))


def test_prompt_masks_contact_numbers_but_keeps_segment_ids():
    prompt = build_user_prompt(job())
    assert '98765' not in prompt and '[PHONE]' in prompt and S[4] in prompt and 'MC-1' in prompt


class Boundary:
    def __init__(self, claimed):
        self.claimed, self.calls = claimed, []

    async def call(self, action, payload):
        self.calls.append((action, copy.deepcopy(payload)))
        if action == 'analysis_claim':
            return {'job': self.claimed}
        return {'accepted': True}


def test_worker_submits_with_lease():
    claimed = job()
    boundary = Boundary(claimed)
    asyncio.run(AnalysisWorker(boundary, Scripted([response()])).once())
    action, payload = boundary.calls[-1]
    assert action == 'analysis_submit' and payload['lease_token'] == claimed['lease_token'] and payload['job_id'] == claimed['id']


def test_unknown_job_version_dead_letters_without_running():
    boundary = Boundary(job(job_version='mk-sales-v9'))
    analyzer = Scripted([])
    asyncio.run(AnalysisWorker(boundary, analyzer).once())
    assert boundary.calls[-1] == ('analysis_fail', {'job_id': boundary.claimed['id'], 'worker_id': boundary.claimed['worker_id'], 'lease_token': boundary.claimed['lease_token'], 'error_code': 'unsupported_job_version', 'retryable': False})
    assert analyzer.prompts == []


def test_failures_report_fixed_codes_only():
    boundary = Boundary(job())
    asyncio.run(AnalysisWorker(boundary, Scripted(['{"status_hint": "Mera number 98765 43210"}'] * 3)).once())
    action, payload = boundary.calls[-1]
    assert action == 'analysis_fail' and payload['error_code'] == 'invalid_model_output' and payload['retryable'] is True
    assert '98765' not in json.dumps(boundary.calls)


def test_timeout_is_bounded():
    class Slow:
        provider, model = 'p', 'm'
        async def complete(self, system, user):
            await asyncio.sleep(5)
    boundary = Boundary(job())
    asyncio.run(AnalysisWorker(boundary, Slow(), timeout_seconds=.05).once())
    assert boundary.calls[-1][1]['error_code'] == 'analysis_timeout'
