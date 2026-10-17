begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local test.fms.demo_mode='configured_fallback';
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
create temporary table previous_employee(request jsonb,preview jsonb,result jsonb);
grant all on previous_employee to authenticated;
insert into previous_employee(request) values(jsonb_build_object('kind','stage_form','instanceStageId',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),'formTemplateId',(select id from visit_assignment_fixture where name='form'),'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),'outcome','','remark','','checklist','{}'::jsonb));
update previous_employee set preview=preview_fms_work_transition(request);
select is((select preview#>>'{destinations,0,effectiveUserId}' from previous_employee),(select id::text from visit_assignment_fixture where name='b'),'previous employee preview uses the current completing employee');
update previous_employee set result=transition_fms_work_with_audit(request,gen_random_uuid(),'[]',preview->>'fingerprint');
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo')),array[(select id from visit_assignment_fixture where name='b')],'actual previous employee matches the reviewed preview');
select * from finish();
rollback;
