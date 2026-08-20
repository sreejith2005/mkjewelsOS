begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(7);

select function_owner_is('public','start_fms_from_form_submission_with_audit',array['uuid'],'postgres','form-triggered FMS start owner is postgres');
select is((select proconfig from pg_proc where oid='start_fms_from_form_submission_with_audit(uuid)'::regprocedure),array['search_path=public']::text[],'form-triggered FMS start pins search path');
select ok(has_function_privilege('authenticated','start_fms_from_form_submission_with_audit(uuid)','EXECUTE'),'authenticated users can start a linked FMS by submitting its form');
select ok(not has_function_privilege('anon','start_fms_from_form_submission_with_audit(uuid)','EXECUTE'),'anonymous users cannot start a linked FMS');
select ok((select pg_get_functiondef('start_fms_from_form_submission_with_audit(uuid)'::regprocedure) like '%activate_fms_stage_internal%'),'form-triggered FMS start activates the next actionable stage');
select ok((select pg_get_functiondef('get_home_summary(jsonb)'::regprocedure) like '%ta.user_profile_id=v_actor.id and ta.is_active%' and pg_get_functiondef('get_home_summary(jsonb)'::regprocedure) like '%a.user_profile_id=v_actor.id and a.is_active%'),'home work lists are scoped to the signed-in assignee');
select ok((select pg_get_functiondef('get_home_summary(jsonb)'::regprocedure) like '%f.assigned_to=v_actor.id%'),'assigned CRM follow-ups are visible to every assigned user');

select * from finish();
rollback;
