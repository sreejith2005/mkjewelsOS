begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local test.fms.with_options='true';
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
select is((select field#>>'{field,options,0,label}' from jsonb_array_elements(get_fms_assigned_work_context((select id from visit_assignment_fixture where name='instance'),(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')))->'receivedFields') field where field#>>'{field,key}'='historical_choice'),'Original label','received choice retains its historical option label');
select * from finish();
rollback;
