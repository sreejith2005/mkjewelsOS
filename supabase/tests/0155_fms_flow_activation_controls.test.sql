begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(9);

select function_owner_is('public','set_fms_flow_active_with_audit',array['uuid','boolean','text'],'postgres','flow pause/resume owner remains postgres');
select function_owner_is('public','restore_fms_flow_with_audit',array['uuid','text'],'postgres','flow restore owner remains postgres');
select is((select proconfig from pg_proc where oid='set_fms_flow_active_with_audit(uuid,boolean,text)'::regprocedure),array['search_path=public']::text[],'flow pause/resume pins search path');
select is((select proconfig from pg_proc where oid='restore_fms_flow_with_audit(uuid,text)'::regprocedure),array['search_path=public']::text[],'flow restore pins search path');

select ok(has_function_privilege('authenticated','set_fms_flow_active_with_audit(uuid,boolean,text)','EXECUTE'),'authenticated callers can pause or resume a flow');
select ok(has_function_privilege('authenticated','restore_fms_flow_with_audit(uuid,text)','EXECUTE'),'authenticated callers can restore an archived flow');
select ok(not has_function_privilege('anon','set_fms_flow_active_with_audit(uuid,boolean,text)','EXECUTE'),'anonymous callers cannot pause or resume a flow');

select ok((select pg_get_functiondef('set_fms_flow_active_with_audit(uuid,boolean,text)'::regprocedure)
  like '%can_manage_fms_flow(p_flow_id)%'),'pause/resume reuses the FMS builder authorization check');
select ok((select pg_get_functiondef('restore_fms_flow_with_audit(uuid,text)'::regprocedure)
  like '%family_id=v_flow.family_id and status=''published''%'),'restoring a version archives the family''s current published version');

select * from finish();
rollback;
