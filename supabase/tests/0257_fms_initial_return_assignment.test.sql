begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
insert into visit_assignment_fixture select 'return_flow',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='flow'));
reset role;
update fms_stages set default_next_stage_id=(select id from fms_stages where fms_flow_id=(select id from visit_assignment_fixture where name='return_flow') and stage_key='initial') where fms_flow_id=(select id from visit_assignment_fixture where name='return_flow') and stage_key='finish';
select throws_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='return_flow'))$$,'23514','Choose an assignment strategy for step Initial','an initial return route must configure its incoming owner');
update fms_stages set planned_time_rule=planned_time_rule||'{"assignment":{"mode":"manual_handoff","allowHandoff":true,"sources":[]}}'::jsonb where fms_flow_id=(select id from visit_assignment_fixture where name='return_flow') and stage_key='initial';
select lives_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='return_flow'))$$,'an explicit return owner contract is accepted');
select * from finish();
rollback;
