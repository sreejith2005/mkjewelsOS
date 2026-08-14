begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);

select function_owner_is('public','can_start_fms_flow',array['uuid','uuid','uuid'],'postgres','start authorization owner is postgres');
select function_owner_is('public','resolve_fms_stage_assignees',array['uuid','uuid','uuid'],'postgres','assignee resolver owner is postgres');
select function_owner_is('public','start_fms_instance_with_audit',array['uuid','text','task_priority','jsonb','uuid','uuid','uuid'],'postgres','start RPC owner is postgres');
select ok(has_function_privilege('authenticated','start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)','EXECUTE'),'authenticated users execute the audited start RPC');
select ok(not has_function_privilege('anon','start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)','EXECUTE'),'anonymous users cannot execute start');
select ok((select pg_get_functiondef('resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure) like '%u.branch_id=v_instance.branch_id%u.department_id=v_instance.department_id%'),'explicit owner selection is validated against both instance scope fields');

select * from finish();
rollback;
