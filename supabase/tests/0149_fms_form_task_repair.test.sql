begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(8);

select function_owner_is('public','submit_fms_form_and_progress_with_audit',array['uuid','jsonb','text','uuid','uuid','text','text','jsonb','uuid'],'postgres','the FMS submit contract remains postgres owned');
select is((select proconfig from pg_proc where oid='submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure),array['search_path=public']::text[],'the FMS submit contract pins search path');
select ok(has_function_privilege('authenticated','submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)','EXECUTE'),'authenticated callers retain the protected submit contract');
select ok(not has_function_privilege('anon','submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)','EXECUTE'),'anonymous callers cannot submit FMS forms');
select ok((select pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%submit_form_with_audit(p_form_template_id,p_answers,''fms_stage'',p_linked_record_id)%'),'the existing exact pinned-form authorization contract is reused');
select ok((select pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%perform complete_fms_stage_with_audit%'),'form-only stages reuse the established audited completion pipeline');
select ok((select pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%requires_upload%' and pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%requires_checklist%' and pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%requires_remark%' and pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%requires_next_doer_handoff%'),'upload, checklist, remark, and handoff requirements prevent auto-completion');
select ok((select pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%step_type<>''approval''%' and pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) like '%allow_multiple_doers%'),'approval and multi-doer stages do not auto-complete');
select * from finish();
rollback;
