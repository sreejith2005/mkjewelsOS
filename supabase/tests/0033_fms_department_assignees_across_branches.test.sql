begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(4);

select function_owner_is('public','resolve_fms_stage_assignees',array['uuid','uuid','uuid'],'postgres','assignment resolver remains owner-controlled');
select ok(has_function_privilege('authenticated','resolve_fms_stage_assignees(uuid,uuid,uuid)','EXECUTE'),'authenticated runtime retains resolver access');
select ok(pg_get_functiondef('resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure) not like '%u.branch_id=v_instance.branch_id%','named primary and fallback are not hidden by workflow branch');
select ok(pg_get_functiondef('resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure) not like '%u.department_id=v_instance.department_id%','named assignments may advance a workflow across stage departments');

select * from finish();
rollback;
