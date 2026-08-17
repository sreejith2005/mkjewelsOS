begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);

select function_owner_is('public','complete_fms_stage_with_audit',array['uuid','text','text','jsonb','uuid'],'postgres','complete owner remains postgres');
select is((select proconfig from pg_proc where oid='complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure),array['search_path=public']::text[],'complete pins search path');
select ok(has_function_privilege('authenticated','complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)','EXECUTE'),'authenticated can complete');
select ok(not has_function_privilege('service_role','complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)','EXECUTE'),'service role cannot complete');
select ok((select pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure) like '%first_stage%order by first_stage.sort_order%'),'only the first workflow stage gates completion on its linked Form');

select * from finish();
rollback;
