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
select lives_ok($$select fms_remap_assignment_routes((select id from visit_assignment_fixture where name='revision'),jsonb_build_array(jsonb_build_object('key','call','branchRules',jsonb_build_array(jsonb_build_object('id',(select route.id from fms_branch_rules route join fms_stages source on source.id=route.fms_stage_id where source.fms_flow_id=(select id from visit_assignment_fixture where name='revision') and source.stage_key='call'),'order',0)))),null)$$,'logical route remapping preserves an exact assignment source during draft save');
select * from finish();
rollback;
