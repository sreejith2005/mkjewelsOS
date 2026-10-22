begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not exists(select 1 from unnest(array[
 'public.fms_record_name_from_sources(jsonb,text,jsonb)',
 'public.fms_record_name_sources(uuid,jsonb)',
 'public.fms_work_record_name_authorized(uuid)',
 'public.fms_work_record_names_authorized(uuid[])']) helper
 where has_function_privilege(actor,helper,'EXECUTE')),
 actor||' cannot execute unchecked naming projections')
from unnest(array['anon','authenticated','service_role']) actor;
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select lives_ok($$select submit_fms_form_and_progress_with_audit(
 (select id from visit_assignment_fixture where name='form'),
 jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),
 'fms_stage',(select work.id from fms_instance_stages work where work.fms_instance_id=(select id from visit_assignment_fixture where name='instance')
  and work.fms_stage_id=(select id from visit_assignment_fixture where name='call')),gen_random_uuid())$$,
 'existing form handoff completes the first visit');
reset role;
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,visit_number,execution_path,execution_scope_id)
select work.fms_instance_id,work.fms_stage_id,'in_progress',work.assigned_to,now()+interval '1 day',n,work.execution_path,gen_random_uuid()
from fms_instance_stages work cross join generate_series(2,250) n
where work.fms_instance_id=(select id from visit_assignment_fixture where name='instance') and work.fms_stage_id=(select id from visit_assignment_fixture where name='call');
set local role authenticated;
set local statement_timeout='8s';
select is((get_fms_task_workspace('{"query":"Synthetic client"}')->>'total')::integer,249,
 'name search after a real handoff fits the authenticated budget for 249 visits');
select is((task_workspace_page('{"query":"Synthetic client","subsection":"fms","status":"pending"}')->>'total')::integer,249,
 'global task search shares the same names within the authenticated budget');
set local statement_timeout=0;
reset role;
select * from finish();
rollback;
