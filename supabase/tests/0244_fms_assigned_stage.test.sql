begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
select is(get_fms_assigned_stage((select id from visit_assignment_fixture where name='instance'),(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')))->'instance'->>'context','{}','assigned loader excludes global form context');
select is(jsonb_array_length(get_fms_assigned_stage((select id from visit_assignment_fixture where name='instance'),null)->'instanceStages'),2,'bounded loader includes latest visits for backward selection');
select is(jsonb_array_length(get_fms_assigned_stage((select id from visit_assignment_fixture where name='instance'),null)->'checklist'),0,'only current visit checklist is loaded');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select throws_ok($$select get_fms_assigned_stage((select id from visit_assignment_fixture where name='instance'),(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')))$$,'42501','FMS work is not available to your account','other employees cannot open forged work IDs');
reset role;
select ok(not has_function_privilege('anon','get_fms_assigned_stage(uuid,uuid)','execute'),'anonymous assigned loader is denied');
select * from finish();
rollback;
