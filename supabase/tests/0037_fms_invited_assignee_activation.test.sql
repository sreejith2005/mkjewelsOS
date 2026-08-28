begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(4);

select function_owner_is('public','resolve_fms_stage_assignees',array['uuid','uuid','uuid'],'postgres','assignment resolver remains owner-controlled');
select ok(has_function_privilege('authenticated','resolve_fms_stage_assignees(uuid,uuid,uuid)','EXECUTE'),'authenticated runtime retains resolver access');
select ok((select pg_get_functiondef('resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure) like '%v_rule.assignee_type=''specific_user''%'),'named assignments have an explicit runtime eligibility path');
select ok((select pg_get_functiondef('resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure) like '%account_status=''active'' and u.working_status=''active'' and u.is_login_enabled%'),'runtime requires active login-enabled assignees before coverage resolution');

select * from finish();
rollback;
