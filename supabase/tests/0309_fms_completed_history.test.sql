begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select is((get_fms_task_workspace('{"status":"completed"}')->>'total')::integer,1,
 'one starting form submission produces one completed employee assignment');
select is((get_fms_task_stage_page((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),(select id from visit_assignment_fixture where name='initial'),false,
 '{"status":"completed"}')->'records'->0->>'id'),
 (select id::text from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance')
  and fms_stage_id=(select id from visit_assignment_fixture where name='initial') and visit_number=1),
 'completed starting form uses its exact persisted runtime history identity');
select is((task_workspace_page('{"subsection":"fms","status":"completed"}')->>'total')::integer,1,
 'global completed history counts the same one starting form action');
reset role;
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,actual_datetime,completed_by,
 form_submission_id,visit_number,execution_path,execution_scope_id)
select fms_instance_id,fms_stage_id,'completed',assigned_to,now(),completed_by,form_submission_id,2,execution_path,gen_random_uuid()
from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance')
 and fms_stage_id=(select id from visit_assignment_fixture where name='initial') and visit_number=1;
set local role authenticated;
select is((get_fms_task_workspace('{"status":"completed"}')->>'total')::integer,2,
 'a later completed visit remains distinct from the starting form action');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),
 jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c'),'client_name','Synthetic client'),
 'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance')
 and fms_stage_id=(select id from visit_assignment_fixture where name='call')),gen_random_uuid())$$,
 'existing form transaction completes the visit before later workflow cancellation');
reset role;
update fms_instances set status='cancelled' where id=(select id from visit_assignment_fixture where name='instance');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{"status":"completed"}')->>'total')::integer,1,
 'completed visit survives later workflow cancellation');
select is((task_workspace_page('{"subsection":"fms","status":"completed"}')->>'total')::integer,1,
 'global FMS history retains the same completed visit');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
select is((get_fms_task_workspace('{}')->>'total')::integer,0,
 'unfinished cancelled work is not actionable');
select is((get_fms_task_workspace('{"status":"waiting"}')->>'total')::integer,0,
 'unfinished cancelled work is not presented as waiting');
reset role;
select * from finish();
rollback;
