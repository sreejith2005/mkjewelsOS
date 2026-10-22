begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','preview_fms_work_transition',array['jsonb'],'handoff preview is an authorized read operation');
select has_function('public','transition_fms_work_with_audit',array['jsonb','uuid','jsonb','text'],'final confirmation is one server transaction');
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
create temporary table transition_fixture(name text primary key,value jsonb);
grant all on transition_fixture to authenticated;
insert into transition_fixture values('request',jsonb_build_object('kind','stage_form','instanceStageId',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),
  'formTemplateId',(select id from visit_assignment_fixture where name='form'),'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),'outcome','','remark','','checklist','{}'::jsonb)),
  ('key',to_jsonb(gen_random_uuid())),('counts',jsonb_build_object('submissions',(select count(*) from form_submissions),'visits',(select count(*) from fms_instance_stages),'decisions',(select count(*) from fms_stage_assignment_decisions)));
set local role authenticated;
insert into transition_fixture values('preview',preview_fms_work_transition((select value from transition_fixture where name='request')));
select is((select value#>>'{destinations,0,selectedUserId}' from transition_fixture where name='preview'),(select id::text from visit_assignment_fixture where name='c'),'preview proposes the employee in the current unsubmitted form');
select is((select count(*)::integer from form_submissions),(select (value->>'submissions')::integer from transition_fixture where name='counts'),'preview does not save the form');
select is((select count(*)::integer from fms_instance_stages),(select (value->>'visits')::integer from transition_fixture where name='counts'),'preview does not advance work');
select throws_ok($$select transition_fms_work_with_audit((select value from transition_fixture where name='request'),gen_random_uuid(),jsonb_build_array(jsonb_build_object('targetStageId',(select id from visit_assignment_fixture where name='demo'),'userProfileId',gen_random_uuid())),(select value->>'fingerprint' from transition_fixture where name='preview'))$$,'23503','FMS user is not an active login-enabled tenant profile','forged nonexistent employee is rejected atomically');
select is((select count(*)::integer from form_submissions),(select (value->>'submissions')::integer from transition_fixture where name='counts'),'failed confirmation leaves the form unsaved');
insert into transition_fixture values('handoffs',jsonb_build_array(jsonb_build_object('targetStageId',(select id from visit_assignment_fixture where name='demo'),'userProfileId',(select id from visit_assignment_fixture where name='d'))));
update transition_fixture set value=preview_fms_work_transition((select value from transition_fixture where name='request'),(select value from transition_fixture where name='handoffs')) where name='preview';
insert into transition_fixture values('result',transition_fms_work_with_audit((select value from transition_fixture where name='request'),(select (value#>>'{}')::uuid from transition_fixture where name='key'),(select value from transition_fixture where name='handoffs'),(select value->>'fingerprint' from transition_fixture where name='preview')));
select is((select value->>'state' from transition_fixture where name='result'),'successors_activated','result reports actual successor work');
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo')),array[(select id from visit_assignment_fixture where name='d')],'authorized replacement D overrides the form-selected C');
select is(transition_fms_work_with_audit((select value from transition_fixture where name='request'),(select (value#>>'{}')::uuid from transition_fixture where name='key'),(select value from transition_fixture where name='handoffs'),(select value->>'fingerprint' from transition_fixture where name='preview')),(select value from transition_fixture where name='result'),'retry returns the exact original durable result');
select throws_ok($$select transition_fms_work_with_audit(jsonb_set((select value from transition_fixture where name='request'),'{remark}','"different payload"'),(select (value#>>'{}')::uuid from transition_fixture where name='key'),(select value from transition_fixture where name='handoffs'),(select value->>'fingerprint' from transition_fixture where name='preview'))$$,'23514','Workflow submission key cannot be reused for a different request','same key cannot silently replace answers or target');
reset role;
select is((select count(*)::integer from form_submissions where linked_module='fms_stage' and linked_record_id=(select (value->>'instanceStageId')::uuid from transition_fixture where name='request')),1,'one submitted form survives retries');
select is((select count(*)::integer from fms_stage_assignment_intents where source_instance_stage_id=((select value->>'instanceStageId' from transition_fixture where name='request'))::uuid),1,'handoff provenance is durable');
select ok(not has_function_privilege('anon','transition_fms_work_with_audit(jsonb,uuid,jsonb,text)','EXECUTE'),'anonymous callers cannot progress work');
select * from finish();
rollback;
