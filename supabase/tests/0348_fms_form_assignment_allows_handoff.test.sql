begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local test.fms.defer_start='true';
set local test.fms.assigned_to_label='true';
\ir helpers/fms_visit_assignment_fixture.psql
insert into visit_assignment_fixture select 'revision',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='flow'));
reset role;
-- Form assignment saved with allowHandoff=false, exactly as the builder saved it from 2026-10-17.
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{assignment}','{"mode":"previous_form","sources":[],"allowHandoff":false,"followFormAssignee":true,"fallbackRule":{"type":"previous_step_doer"}}')
where fms_flow_id=(select id from visit_assignment_fixture where name='revision') and stage_key in ('call','demo','negotiation');
-- "Call" has no form, so it has no employee question to choose the next owner.
update fms_stages set form_template_id=null,planned_time_rule=jsonb_set(planned_time_rule,'{completionFormRequired}','false') where fms_flow_id=(select id from visit_assignment_fixture where name='revision') and stage_key='call';
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from visit_assignment_fixture where name='revision'))$$,'form-assignment workflow publishes');
create temporary table handoff_run(request jsonb,preview jsonb,result jsonb);
grant all on handoff_run to authenticated;
insert into handoff_run(request) values(jsonb_build_object('kind','flow_form','flowId',(select id from visit_assignment_fixture where name='revision'),'formTemplateId',(select id from visit_assignment_fixture where name='form'),'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b'))));
update handoff_run set preview=preview_fms_work_transition(request);
select is((select (preview#>>'{destinations,0,allowHandoff}')::boolean from handoff_run),true,'the first step after the start form can be handed to someone else');
update handoff_run set result=transition_fms_work_with_audit(request,gen_random_uuid(),'[]',preview->>'fingerprint');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
update handoff_run set request=jsonb_build_object('kind','complete','instanceStageId',(select work.id from fms_instance_stages work join fms_stages stage on stage.id=work.fms_stage_id where work.fms_instance_id=(handoff_run.result->>'instanceId')::uuid and stage.stage_key='call'),'outcome','','remark','','checklist','{}'::jsonb);
update handoff_run set preview=preview_fms_work_transition(request);
select is((select preview#>>'{destinations,0,selectedUserId}' from handoff_run),(select id::text from visit_assignment_fixture where name='b'),'without an employee question the same employee is suggested');
select is((select (preview#>>'{destinations,0,allowHandoff}')::boolean from handoff_run),true,'and the completing employee may choose someone else');
select ok((select count(*) from list_fms_handoff_recipients((select request from handoff_run),(select id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='revision') and stage_key='demo'),'',null,50))>0,'eligible replacements are listed');
update handoff_run set preview=preview_fms_work_transition(request,jsonb_build_array(jsonb_build_object('targetStageId',(select id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='revision') and stage_key='demo'),'userProfileId',(select id from visit_assignment_fixture where name='c'))));
select is((select preview#>>'{destinations,0,selectedUserId}' from handoff_run),(select id::text from visit_assignment_fixture where name='c'),'the chosen employee is previewed');
update handoff_run set result=transition_fms_work_with_audit(request,gen_random_uuid(),jsonb_build_array(jsonb_build_object('targetStageId',(select id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='revision') and stage_key='demo'),'userProfileId',(select id from visit_assignment_fixture where name='c'))),preview->>'fingerprint');
select is((select assigned_to from fms_instance_stages work join fms_stages stage on stage.id=work.fms_stage_id where work.fms_instance_id=(select (result->>'instanceId')::uuid from handoff_run) and stage.stage_key='demo'),array[(select id from visit_assignment_fixture where name='c')],'the next step goes to the chosen employee');
reset role;
select is(fms_assignment_allows_handoff('{"mode":"fixed_employee","allowHandoff":true,"followFormAssignee":true}'),false,'a fixed employee stays locked');
select is(fms_assignment_allows_handoff('{"mode":"previous_form","allowHandoff":false}'),false,'a pinned source question without handoff stays as configured');
select is(fms_assignment_allows_handoff('{"mode":"manual_handoff","allowHandoff":true}'),true,'manual handoff is unchanged');
select is(has_function_privilege('authenticated','fms_assignment_allows_handoff(jsonb)','EXECUTE'),false,'the predicate has no direct client grant');
select * from finish();
rollback;
