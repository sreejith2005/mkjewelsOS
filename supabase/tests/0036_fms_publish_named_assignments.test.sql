begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);

select function_owner_is('public','assert_fms_flow_publishable',array['uuid'],'postgres','publish validator remains owner-controlled');
select ok(has_function_privilege('authenticated','assert_fms_flow_publishable(uuid)','EXECUTE'),'authenticated builders can preflight publish validation without a write');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) not like '%active named primary or fallback%'),'publish no longer contradicts the visible Users picker');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) like '%named primary assignee from Users%'),'every human step still requires durable named ownership');
select ok((select pg_get_functiondef('resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure) like '%is_login_enabled%'),'runtime still enforces operational eligibility and fallback');

select * from finish();
rollback;
