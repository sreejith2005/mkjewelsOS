begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select set_config('test.fms.with_record_default','true',true);
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is(get_fms_assigned_work_context((select id from visit_assignment_fixture where name='instance'),
 (select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')))->>'recordName','ORD-1','original form default identifies the first assigned stage');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),
 jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c'),'client_name','Changed later client name'),
 'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),gen_random_uuid())$$,'existing form transition completes and hands off');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
select is(get_fms_assigned_work_context((select id from visit_assignment_fixture where name='instance'),
 (select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo')))->>'recordName','ORD-1','blank stage override falls back to the original record name, not a later arbitrary answer');
select is((get_fms_task_workspace('{"query":"ORD-1"}')->>'total')::integer,1,'next employee finds the same record name');
reset role;
select * from finish();
rollback;
