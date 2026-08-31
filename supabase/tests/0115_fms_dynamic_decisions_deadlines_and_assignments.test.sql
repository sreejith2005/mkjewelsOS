begin;
select plan(10);

select has_table('public','fms_context_assignee_defaults','context defaults are durable configuration');
select policies_are('public','fms_context_assignee_defaults',array['fms_context_assignee_defaults_select'],'context defaults have tenant-scoped read policy');
select has_function('public','save_fms_context_assignee_default_with_audit',array['text','uuid'],'default mapping is saved through an audited RPC');
select ok((select public.fms_stage_deadline_for_instance('{"deadlineEnabled":false}'::jsonb,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid) is null),'disabled deadlines create no timestamp');
select ok(public.is_valid_fms_timing_rule('{"deadlineEnabled":false,"dueDate":""}'::jsonb),'disabled deadline rule is valid');
select ok(public.is_valid_fms_timing_rule('{"timingMethod":"tat_hours","tatMinutes":30,"dueDate":""}'::jsonb),'minute TAT is valid');
select ok(not public.is_valid_fms_timing_rule('{"decisionMode":"decision","decisionOptions":[{"key":"yes","label":"Yes"}],"dueDate":"2099-01-01"}'::jsonb),'decision rule requires at least two options');
select ok(public.is_valid_fms_timing_rule('{"deadlineEnabled":false,"decisionMode":"decision","decisionOptions":[{"key":"connected","label":"Call Connected"},{"key":"callback","label":"Call Back Required"}],"conditional":{"decisionStageKey":"introduction_call","decisionOptionKey":"connected"}}'::jsonb),'disabled deadline preserves and validates dynamic decision mapping');
select ok(public.is_valid_fms_timing_rule('{"deadlineEnabled":false,"conditional":{"field":"status","operator":"equals","value":"interested"}}'::jsonb),'disabled deadline preserves existing status conditions');
select ok(not public.is_valid_fms_timing_rule('{"deadlineEnabled":false,"decisionMode":"decision","decisionOptions":[{"key":"connected","label":"Call Connected"}],"conditional":{"decisionStageKey":"introduction_call","decisionOptionKey":"removed"}}'::jsonb),'disabled deadline does not bypass malformed dynamic rules');

select * from finish();
rollback;
