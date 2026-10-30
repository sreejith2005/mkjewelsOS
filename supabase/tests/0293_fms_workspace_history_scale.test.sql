begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
-- Distinct durable visits, not 250 duplicated cards from client grouping.
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,visit_number,execution_path,execution_scope_id)
select work.fms_instance_id,work.fms_stage_id,'in_progress',work.assigned_to,now()+interval '1 day',n,work.execution_path,gen_random_uuid()
from fms_instance_stages work cross join generate_series(2,250) n
where work.fms_instance_id=(select id from visit_assignment_fixture where name='instance') and work.fms_stage_id=(select id from visit_assignment_fixture where name='call');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{}')->>'total')::integer,250,'summary counts all 250 actual visits');
select is((task_feed_page('fms','pending')->'counts'->>'open')::integer,250,'tab reconciles beyond first 50');
-- Refresh planner statistics after bulk synthetic visits; retain the 8-second query budget.
reset role;
do $stats$declare t record;begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') loop
 execute format('analyze %I.%I',t.nspname,t.relname);
 end loop;
end $stats$;
set local role authenticated;
set local statement_timeout='8s';
select is((get_fms_task_workspace('{"query":"Synthetic client"}')->>'total')::integer,250,'form-answer search covers all visits within the authenticated request budget');
set local statement_timeout=0;
select is(jsonb_array_length(get_fms_task_stage_page((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),(select id from visit_assignment_fixture where name='call'))->'records'),50,'expanded stage is bounded');
select is((select sum((entry->>'count')::integer)::integer from jsonb_array_elements(get_fms_task_stages((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')))) entry),250,'stage counts reconcile');
reset role;
insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,status,is_active,completed_at)
select (select id from visit_assignment_fixture where name='tenant'),id,(select id from visit_assignment_fixture where name='b'),'completed',true,now()
from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call') and visit_number=2;
insert into form_submissions(tenant_id,form_template_id,submitted_by,data,status,linked_module,linked_record_id)
select (select id from visit_assignment_fixture where name='tenant'),(select id from visit_assignment_fixture where name='form'),(select id from visit_assignment_fixture where name='b'),
 jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c'),'client_name','Synthetic client'),'submitted','fms_stage',id
from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call') and visit_number=3;
update fms_instance_stages work set status='completed',actual_datetime=now(),completed_by=(select id from visit_assignment_fixture where name='b'),
 form_submission_id=(select id from form_submissions where linked_module='fms_stage' and linked_record_id=work.id limit 1)
where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call') and visit_number=3;
set local role authenticated;
select is((get_fms_task_workspace('{}')->>'total')::integer,248,'completed contribution and completed stage leave active count');
select is((get_fms_task_workspace('{"status":"waiting"}')->>'total')::integer,1,'own completed contribution waits for other doers');
select is((get_fms_task_workspace('{"status":"completed"}')->>'total')::integer,1,'completed work is available through explicit history');
select is((task_feed_page('fms','completed')->>'total')::integer,1,'legacy page can select completed FMS history');
select is((task_workspace_page('{"subsection":"fms","status":"completed"}')->>'total')::integer,1,'global search retains completed FMS history');
reset role;
update user_profiles set is_login_enabled=false where id=(select id from visit_assignment_fixture where name='b');
set local role authenticated;
select throws_ok($$select get_fms_task_workspace('{}')$$,'42501',null,'inactive actor denied');
reset role;
select * from finish();
rollback;
