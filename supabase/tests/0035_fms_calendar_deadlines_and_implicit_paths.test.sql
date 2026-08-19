begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(8);

select function_owner_is('public','assert_fms_flow_publishable',array['uuid'],'postgres','publish validator remains owner-controlled');
select ok(not has_function_privilege('authenticated','assert_fms_flow_publishable(uuid)','EXECUTE'),'clients cannot bypass the publish RPC');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) not like '%Flow requires a start and end path%'),'legacy start and end requirement is removed');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) like '%first workflow step must be a Form%'),'the first ordered Form is the implicit start');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) like '%completion step with no outgoing connection%'),'a reachable leaf is an implicit completion path');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) like '%valid completion due date%'),'publish validates calendar deadlines');
select is(fms_stage_deadline('{"dueDate":"2099-12-31"}'::jsonb,(select id from tenants order by created_at limit 1)),('2099-12-31 23:59:59.999999'::timestamp at time zone coalesce((select timezone from tenants order by created_at limit 1),'Asia/Kolkata')),'calendar date resolves to tenant-local end of day');
select ok((select pg_get_functiondef('activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)'::regprocedure) like '%fms_stage_deadline(v_stage.planned_time_rule,v_instance.tenant_id)%'),'runtime uses the calendar deadline');

select * from finish();
rollback;
