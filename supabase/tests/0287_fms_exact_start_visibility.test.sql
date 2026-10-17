begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local test.fms.defer_start='true';
\ir helpers/fms_visit_assignment_fixture.psql
create temporary table exact_start(request jsonb,preview jsonb,key uuid,result jsonb);
grant all on exact_start to authenticated;
insert into exact_start(request,key) values(jsonb_build_object('kind','flow_form','flowId',(select id from visit_assignment_fixture where name='flow'),'formTemplateId',(select id from visit_assignment_fixture where name='form'),'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b'))),gen_random_uuid());
update exact_start set preview=preview_fms_work_transition(request);
select lives_ok($$update exact_start set result=transition_fms_work_with_audit(request,key,'[]',preview->>'fingerprint')$$,'Forms Library exact start reads the instance created by its own transaction');
select is((select result->>'state' from exact_start),'successors_activated','exact start activates the next work');
select is((select count(*)::integer from fms_instances where fms_flow_id=(select id from visit_assignment_fixture where name='flow')),1,'exact start creates one instance');
select is((select assigned_to from fms_instance_stages where fms_stage_id=(select id from visit_assignment_fixture where name='call')),array[(select id from visit_assignment_fixture where name='b')],'initial form assigns the selected employee');
select is((select transition_fms_work_with_audit(request,key,'[]',preview->>'fingerprint') from exact_start),(select result from exact_start),'retry returns the durable exact-start result');
select * from finish();
rollback;
