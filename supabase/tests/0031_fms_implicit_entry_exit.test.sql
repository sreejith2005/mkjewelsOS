begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(9);

select has_function('public','assert_fms_flow_publishable',array['uuid'],'publish validator exists');
select has_function('public','resolve_fms_stage_assignees',array['uuid','uuid','uuid'],'assignment resolver exists');
select has_function('public','activate_fms_stage_internal',array['uuid','uuid','uuid','uuid','integer'],'activation engine exists');
select function_owner_is('public','assert_fms_flow_publishable',array['uuid'],'postgres','publish validator remains owner-controlled');
select ok(not has_function_privilege('authenticated','assert_fms_flow_publishable(uuid)','EXECUTE'),'clients cannot bypass publish RPC');
select ok(has_function_privilege('authenticated','resolve_fms_stage_assignees(uuid,uuid,uuid)','EXECUTE'),'runtime keeps resolver access');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) like '%first workflow step must be a Form%'),'publish requires a Form first');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) like '%End nodes are no longer used%'),'publish rejects legacy End nodes');
select ok((select pg_get_functiondef('activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)'::regprocedure) like '%not v_activated_next%'),'automatic leaf steps complete their instance');

select * from finish();
rollback;
