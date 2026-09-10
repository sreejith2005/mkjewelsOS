begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(11);

select function_owner_is('public','record_availability_with_audit',array['uuid','date','availability_status','text'],'postgres','availability recording owner remains postgres');
select function_owner_is('public','record_availability_days_with_audit',array['uuid','date[]','availability_status','text'],'postgres','multi-day availability recording owner remains postgres');
select is((select proconfig from pg_proc where oid='record_availability_days_with_audit(uuid,date[],availability_status,text)'::regprocedure),array['search_path=public']::text[],'multi-day availability recording pins search path');
select ok(has_function_privilege('authenticated','record_availability_days_with_audit(uuid,date[],availability_status,text)','EXECUTE'),'authenticated can record a whole week of availability');
select ok(not has_function_privilege('service_role','record_availability_days_with_audit(uuid,date[],availability_status,text)','EXECUTE'),'service role cannot record availability');
select ok(not has_function_privilege('anon','record_availability_days_with_audit(uuid,date[],availability_status,text)','EXECUTE'),'anonymous callers cannot record availability');

select is(current_availability_week_start(),date_trunc('week',(now() at time zone 'Asia/Kolkata'))::date,'the self-service week starts on the Kolkata Monday');

select ok((select pg_get_functiondef('record_availability_with_audit(uuid,date,availability_status,text)'::regprocedure)
  like '%p_user_profile_id=v_actor.id or v_privileged%'),'any active user can record their own availability');
select ok((select pg_get_functiondef('record_availability_with_audit(uuid,date,availability_status,text)'::regprocedure)
  like '%p_date<v_week_start or p_date>v_week_start+6%'),'self-service availability is confined to the current week');

-- The self-service path must not weaken the absence handover restored in 0145.
select ok((select pg_get_functiondef('record_availability_with_audit(uuid,date,availability_status,text)'::regprocedure)
  like '%reconcile_all_assignment_coverage_with_audit(p_user_profile_id,p_date,p_reason)%'),'marking yourself absent still reassigns your work');
select ok((select pg_get_functiondef('record_availability_with_audit(uuid,date,availability_status,text)'::regprocedure)
  like '%absence_coverage_restored%'),'coming back present still restores your own work');

select * from finish();
rollback;
