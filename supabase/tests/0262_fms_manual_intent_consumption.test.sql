begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
insert into visit_assignment_fixture select 'loop_flow',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='flow'));
reset role;
insert into visit_assignment_fixture select 'loop_'||stage_key,id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='loop_flow');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{assignment,sources}',(planned_time_rule#>'{assignment,sources}')||jsonb_build_array(jsonb_build_object('sourceStageKey','demo','formTemplateId',form_template_id,'fieldKey','next_employee'))) where id=(select id from visit_assignment_fixture where name='loop_call');
update fms_stages set planned_time_rule=planned_time_rule||'{"decisionMode":"decision","decisionOptions":[{"key":"repeat","label":"Follow up again"},{"key":"exit","label":"Continue"}]}'::jsonb,default_next_stage_id=(select id from visit_assignment_fixture where name='loop_call') where id=(select id from visit_assignment_fixture where name='loop_demo');
insert into fms_branch_rules(fms_stage_id,source_type,condition_field,condition_operator,condition_value,next_stage_id,sort_order) values((select id from visit_assignment_fixture where name='loop_demo'),'outcome','outcome','equals','exit',(select id from visit_assignment_fixture where name='loop_negotiation'),0);
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from visit_assignment_fixture where name='loop_flow'))$$,'human follow-up loop with an exit publishes');
create function pg_temp.start_with_manual_owner() returns uuid language plpgsql as $$
declare request jsonb; choices jsonb; preview jsonb; result jsonb;
begin
 request:=jsonb_build_object('kind','starter_form','starterAssignmentId',(select id from fms_starter_assignments where fms_flow_id=(select id from visit_assignment_fixture where name='loop_flow') and user_profile_id=(select id from visit_assignment_fixture where name='a')),'formTemplateId',(select id from visit_assignment_fixture where name='form'),'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b')));
 choices:=jsonb_build_array(jsonb_build_object('targetStageId',(select id from visit_assignment_fixture where name='loop_call'),'userProfileId',(select id from visit_assignment_fixture where name='d')));
 preview:=preview_fms_work_transition(request,choices);
 result:=transition_fms_work_with_audit(request,gen_random_uuid(),choices,preview->>'fingerprint');
 return (result->>'instanceId')::uuid;
end $$;
insert into visit_assignment_fixture select 'loop_instance',pg_temp.start_with_manual_owner();
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='d_auth'),true);
select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='loop_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='loop_call')),gen_random_uuid());
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='e')),'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='loop_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='loop_demo')),gen_random_uuid(),p_outcome=>'repeat');
reset role;
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='loop_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='loop_call')),2,'return route creates a fresh visit');
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='loop_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='loop_call') and visit_number=2),array[(select id from visit_assignment_fixture where name='e')],'repeat visit takes its employee from the latest causal form');
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='loop_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='loop_call') and visit_number=1),array[(select id from visit_assignment_fixture where name='d')],'earlier visit assignment remains immutable');
select ok((select form_submission_id is not null and status='completed' from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='loop_instance') and fms_stage_id=(select id from visit_assignment_fixture where name='loop_call') and visit_number=1),'earlier completion form remains attached');
select is((select count(*)::integer from fms_stage_assignment_decisions decision join fms_instance_stages visit on visit.id=decision.target_instance_stage_id where visit.fms_instance_id=(select id from visit_assignment_fixture where name='loop_instance') and visit.fms_stage_id=(select id from visit_assignment_fixture where name='loop_call')),2,'each visit has its own provenance decision');
select * from finish();
rollback;
