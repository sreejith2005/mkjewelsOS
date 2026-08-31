begin;
select plan(2);

select ok(public.is_valid_fms_timing_rule('{"deadlineEnabled":false,"conditional":{"decisionStageKey":"introduction_call","decisionOptionKey":"connected"}}'::jsonb),'a configured decision option is a valid condition');
select ok(not public.is_valid_fms_timing_rule('{"deadlineEnabled":false,"conditional":{"field":"status","operator":"equals","value":"busy"}}'::jsonb),'retired Status conditions are not accepted for new FMS saves');

select * from finish();
rollback;
