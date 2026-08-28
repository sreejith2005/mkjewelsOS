begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);

select function_owner_is('public','can_start_fms_flow',array['uuid','uuid','uuid'],'postgres','start authorization owner is postgres');
select function_owner_is('public','resolve_fms_stage_assignees',array['uuid','uuid','uuid'],'postgres','assignee resolver owner is postgres');
select function_owner_is('public','start_fms_instance_with_audit',array['uuid','text','task_priority','jsonb','uuid','uuid','uuid'],'postgres','start RPC owner is postgres');
select ok(has_function_privilege('authenticated','start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)','EXECUTE'),'authenticated users execute the audited start RPC');
select ok(not has_function_privilege('anon','start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)','EXECUTE'),'anonymous users cannot execute start');
select ok((select pg_get_functiondef('resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure) like '%assert_direct_assignment_user(p_selected_user,v_instance.tenant_id,''FMS'')%'),'explicit owner selection is validated by the shared direct-assignment scope guard');

select * from finish();
rollback;
