begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);

select function_owner_is('public','submit_form_with_audit',array['uuid','jsonb','text','uuid'],'postgres','form submission owner remains postgres');
select is((select proconfig from pg_proc where oid='submit_form_with_audit(uuid,jsonb,text,uuid)'::regprocedure),array['search_path=public']::text[],'form submission pins search path');
select ok(has_function_privilege('authenticated','submit_form_with_audit(uuid,jsonb,text,uuid)','EXECUTE'),'authenticated can submit FMS stage forms');
select ok(not has_function_privilege('service_role','submit_form_with_audit(uuid,jsonb,text,uuid)','EXECUTE'),'service role cannot submit FMS stage forms');
select ok((select pg_get_functiondef('submit_form_with_audit(uuid,jsonb,text,uuid)'::regprocedure) like '%p_linked_module=''fms_stage''%' and pg_get_functiondef('submit_form_with_audit(uuid,jsonb,text,uuid)'::regprocedure) like '%form_submission_id=v_submission.id%'),'FMS stage forms are authorized and persist the exact stage output');

select * from finish();
rollback;
