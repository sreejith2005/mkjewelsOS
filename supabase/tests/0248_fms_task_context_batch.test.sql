begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
insert into visit_assignment_fixture select 'work_visit',id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
select is((select count(*)::integer from jsonb_object_keys(get_fms_task_contexts(array[(select id from visit_assignment_fixture where name='work_visit')]))),1,'one authorized work context is hydrated');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select is(get_fms_task_contexts(array[(select id from visit_assignment_fixture where name='work_visit')]),'{}'::jsonb,'forged IDs do not expose another work context');
select throws_ok($$select get_fms_task_contexts(array_fill(gen_random_uuid(),array[101]))$$,'22023','Request at most 100 workflow work contexts','batch reads are bounded');
reset role;
select ok(not has_function_privilege('anon','get_fms_task_contexts(uuid[])','execute'),'anonymous task context hydration is denied');
select * from finish();
rollback;
