begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(9);

select has_table('public','fms_workflow_mutation_keys','workflow submission keys are persisted server-side');
select table_owner_is('public','fms_workflow_mutation_keys','postgres','workflow submission keys are owned by postgres');
select ok((select relrowsecurity from pg_class where oid='fms_workflow_mutation_keys'::regclass),'workflow submission keys have RLS enabled');
select col_is_null('public','form_fields','rule_definition','legacy form fields do not require a destructive backfill');
select col_is_null('public','form_fields','option_source','legacy form fields retain their existing option behaviour');
select function_owner_is('public','submit_fms_form_and_progress_with_audit',array['uuid','jsonb','text','uuid','uuid','text','text','jsonb','uuid'],'postgres','transactional workflow submit RPC is owned by postgres');
select is((select proconfig from pg_proc where oid='submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure),array['search_path=public']::text[],'transactional workflow submit RPC pins search path');
select ok(has_function_privilege('authenticated','submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)','EXECUTE'),'authenticated users may submit authorized workflow work');
select ok(not has_function_privilege('anon','submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)','EXECUTE'),'anonymous users cannot submit workflow work');

select * from finish();
rollback;
