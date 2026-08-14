begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(3);

select function_owner_is('public','save_fms_flow_draft_with_audit',array['uuid','jsonb','jsonb'],'postgres','FMS draft save remains owner-controlled');
select ok(has_function_privilege('authenticated','save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)','EXECUTE'),'authenticated builder retains audited draft-save access');
select ok(pg_get_functiondef('save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)'::regprocedure) like '%d.branch_id is null or d.branch_id=v_flow.branch_id%','tenant-wide departments are valid inside a selected branch');

select * from finish();
rollback;
