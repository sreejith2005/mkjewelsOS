begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
insert into visit_assignment_fixture select 'parallel_flow',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='flow'));
reset role;
insert into visit_assignment_fixture select 'parallel_'||stage_key,id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='parallel_flow');
insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,completion_rule,parallel_target_stage_ids)
 values((select id from visit_assignment_fixture where name='parallel_flow'),'split','Sales and production','parallel_start',10,true,'{}','any_doer',array[(select id from visit_assignment_fixture where name='parallel_call'),(select id from visit_assignment_fixture where name='parallel_demo')]);
insert into visit_assignment_fixture select 'parallel_split',id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='parallel_flow') and stage_key='split';
insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,completion_rule,join_rule,default_next_stage_id)
 values((select id from visit_assignment_fixture where name='parallel_flow'),'join','Both pipelines ready','parallel_join',11,true,'{}','any_doer','all',(select id from visit_assignment_fixture where name='parallel_negotiation'));
insert into visit_assignment_fixture select 'parallel_join',id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='parallel_flow') and stage_key='join';
update fms_stages set default_next_stage_id=(select id from visit_assignment_fixture where name='parallel_split') where id=(select id from visit_assignment_fixture where name='parallel_initial');
update fms_stages set default_next_stage_id=(select id from visit_assignment_fixture where name='parallel_join') where id in((select id from visit_assignment_fixture where name='parallel_call'),(select id from visit_assignment_fixture where name='parallel_demo'));
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{assignment,sources}',jsonb_build_array(jsonb_build_object('sourceStageKey',case when stage_key='demo' then 'initial' else 'call' end,'formTemplateId',form_template_id,'fieldKey','next_employee'))) where id in((select id from visit_assignment_fixture where name='parallel_demo'),(select id from visit_assignment_fixture where name='parallel_negotiation'));
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from visit_assignment_fixture where name='parallel_flow'))$$,'one workflow publishes two parallel pipelines');
insert into visit_assignment_fixture select 'parallel_instance',(submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b')),'fms_entry',(select id from fms_starter_assignments where fms_flow_id=(select id from visit_assignment_fixture where name='parallel_flow') and user_profile_id=(select id from visit_assignment_fixture where name='a')),gen_random_uuid())->>'instance_id')::uuid;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='parallel_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='parallel_call')),gen_random_uuid());
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='parallel_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='parallel_negotiation')),0,'join does not create next work while a mandatory branch is open');
create temporary table parallel_preview(request jsonb,preview jsonb);
grant all on parallel_preview to authenticated;
insert into parallel_preview(request) select jsonb_build_object('kind','stage_form','instanceStageId',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='parallel_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='parallel_demo')),'formTemplateId',(select id from visit_assignment_fixture where name='form'),'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='d')),'outcome','','remark','','checklist','{}'::jsonb);
update parallel_preview set preview=preview_fms_work_transition(request);
select is((select preview#>>'{destinations,0,selectedUserId}' from parallel_preview),(select id::text from visit_assignment_fixture where name='c'),'last-branch preview resolves the explicitly mapped completed branch form');
select lives_ok($$select transition_fms_work_with_audit(request,gen_random_uuid(),'[]',preview->>'fingerprint') from parallel_preview$$,'confirmed last branch atomically releases the join');
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='parallel_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='parallel_negotiation')),array[(select id from visit_assignment_fixture where name='c')],'actual joined owner matches preview and never leaks from the other branch');
reset role;
select * from finish();
rollback;
