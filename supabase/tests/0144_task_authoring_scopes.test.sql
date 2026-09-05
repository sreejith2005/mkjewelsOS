begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(3);
select ok(position('process_coordinator' in pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)) > 0,'Process Coordinator is authorized by the task creation RPC');
select ok(position('participant.department_id = v_actor.department_id' in pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)) > 0,'normal task authors are constrained to their department server-side');
select function_privs_are('public','create_delegation_task_with_audit',array['jsonb','uuid[]','uuid[]','jsonb'],'authenticated',array['EXECUTE'],'authenticated can use the protected task creation RPC');
select * from finish();
rollback;
