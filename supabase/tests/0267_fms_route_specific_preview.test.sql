begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
insert into visit_assignment_fixture select 'revision',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='flow'));
reset role;
insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,sort_order)
 select call.id,'form_answer','next_employee','next_employee','equals',(select id::text from visit_assignment_fixture where name='c'),demo.id,0
 from fms_stages call join fms_stages demo on demo.fms_flow_id=call.fms_flow_id and demo.stage_key='demo'
 where call.fms_flow_id=(select id from visit_assignment_fixture where name='revision') and call.stage_key='call';
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{assignment,sources,0,routeRuleId}',to_jsonb((select route.id from fms_branch_rules route join fms_stages source on source.id=route.fms_stage_id where source.fms_flow_id=(select id from visit_assignment_fixture where name='revision') and source.stage_key='call')))
 where fms_flow_id=(select id from visit_assignment_fixture where name='revision') and stage_key='demo';

set local role authenticated;
select publish_fms_flow_with_audit((select id from visit_assignment_fixture where name='revision'));
insert into visit_assignment_fixture select 'route_instance',(submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b')),'fms_entry',(select id from fms_starter_assignments where fms_flow_id=(select id from visit_assignment_fixture where name='revision') and user_profile_id=(select id from visit_assignment_fixture where name='a')),gen_random_uuid())->>'instance_id')::uuid;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
create temporary table route_preview(request jsonb,preview jsonb);
grant all on route_preview to authenticated;
insert into route_preview(request) values(jsonb_build_object('kind','stage_form','instanceStageId',(select work.id from fms_instance_stages work join fms_stages stage on stage.id=work.fms_stage_id where work.fms_instance_id=(select id from visit_assignment_fixture where name='route_instance') and stage.stage_key='call'),'formTemplateId',(select id from visit_assignment_fixture where name='form'),'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),'outcome','','remark','','checklist','{}'::jsonb));
update route_preview set preview=preview_fms_work_transition(request);
select is((select preview#>>'{destinations,0,effectiveUserId}' from route_preview),(select id::text from visit_assignment_fixture where name='c'),'route-specific source resolves from the unsaved candidate answers');
select lives_ok($$select transition_fms_work_with_audit(request,gen_random_uuid(),'[]',preview->>'fingerprint') from route_preview$$,'route-specific form confirms without a manual workaround');
reset role;
select is((select work.assigned_to from fms_instance_stages work join fms_stages stage on stage.id=work.fms_stage_id where work.fms_instance_id=(select id from visit_assignment_fixture where name='route_instance') and stage.stage_key='demo'),array[(select id from visit_assignment_fixture where name='c')],'actual route-scoped assignment matches its preview');
select * from finish();
rollback;
