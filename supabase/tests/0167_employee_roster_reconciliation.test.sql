begin;
select plan(15);

select has_function('public','reconcile_employee_roster_with_audit',array['jsonb','jsonb'],'roster reconciliation is one database contract');
select ok(has_function_privilege('service_role','reconcile_employee_roster_with_audit(jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','reconcile_employee_roster_with_audit(jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','reconcile_employee_roster_with_audit(jsonb,jsonb)','EXECUTE'),'only the service role reconciles the roster');
select ok(not has_function_privilege('authenticated','user_profile_has_linked_records(uuid)','EXECUTE'),'browser clients cannot probe profile links');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('16700000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','user'||n||'-167@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()
from generate_series(1,7) n;
insert into public.tenants(id,name,slug) values('16710000-0000-4000-8000-000000000001','Roster 167','roster-167');
insert into public.branches(id,tenant_id,name,code) values('16720000-0000-4000-8000-000000000001','16710000-0000-4000-8000-000000000001','ROSTER BRANCH 167','R167');
insert into public.departments(id,tenant_id,branch_id,name,code) values('16730000-0000-4000-8000-000000000001','16710000-0000-4000-8000-000000000001',null,'ROSTER DEPT 167','D167');
-- 1 super admin (earliest, the system actor), 2 kept, 3 duplicate of 2,
-- 4 leaver, 5 reports to duplicate, 6 reports to and buddies with leaver,
-- 7 leaver without links.
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,first_name,last_name,username,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,created_at)
select ('16740000-0000-4000-8000-00000000000'||n)::uuid,('16700000-0000-4000-8000-00000000000'||n)::uuid,'16710000-0000-4000-8000-000000000001','16720000-0000-4000-8000-000000000001','16730000-0000-4000-8000-000000000001',
  v.name,split_part(v.name,' ',1),split_part(v.name,' ',2),v.username,null,'user'||n||'-167@example.invalid','R167-'||n,v.role::user_role,'active','active',true,
  case when n = 1 then '2000-01-01'::timestamptz else now() end
from (values (1,'SYSTEM ADMIN','systemadmin167','super_admin'),(2,'KEEP PERSON','keepperson167old','staff'),(3,'KEEP PERSON','keepperson167','staff'),
  (4,'LEAVING PERSON','leavingperson167','staff'),(5,'REPORT ONE','reportone167','staff'),(6,'REPORT TWO','reporttwo167','staff'),(7,'CLEAN LEAVER','cleanleaver167','staff')) v(n,name,username,role);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('16710000-0000-4000-8000-000000000001','designation','ROSTER ROLE 167','roster_role_167',1,'16740000-0000-4000-8000-000000000001');
update public.user_profiles set reports_to_user_id='16740000-0000-4000-8000-000000000003' where id='16740000-0000-4000-8000-000000000005';
update public.user_profiles set reports_to_user_id='16740000-0000-4000-8000-000000000004',buddy_id='16740000-0000-4000-8000-000000000004' where id='16740000-0000-4000-8000-000000000006';

create function pg_temp.roster() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000002','employee_name','KEEP PERSON','first_name','KEEP','last_name','PERSON',
    'username','keepperson167','work_email','keep-167@example.invalid','personal_email','','personal_mobile','9876543210','official_mobile','',
    'branch','roster branch 167','department','ROSTER DEPT 167','designation','roster role 167','week_off',jsonb_build_array('friday'),'access_level','USER','employee_code','167'))
$$;
create function pg_temp.retire() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000003','merge_into_profile_id','16740000-0000-4000-8000-000000000002'),
    jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000004','merge_into_profile_id',null),
    jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000007','merge_into_profile_id',null))
$$;
grant execute on function pg_temp.roster() to authenticated, service_role;
grant execute on function pg_temp.retire() to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claim.sub','16700000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.reconcile_employee_roster_with_audit(pg_temp.roster(),pg_temp.retire())$$,'42501',null,'a signed-in Super Admin cannot call the service contract directly');

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.reconcile_employee_roster_with_audit(pg_temp.roster(),jsonb_build_array(jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000001')))$$,'22023',null,'the system Super Admin cannot be retired');
create temp table result_167 as select public.reconcile_employee_roster_with_audit(pg_temp.roster(),pg_temp.retire()) as r;
reset role;

select is((select (r->>'updated')::int from result_167),1,'one roster profile is written');
select is((select (r->>'retired')::int from result_167),3,'duplicate and leavers are retired');
select results_eq($$select username,email,official_email,employee_code,personal_mobile,week_off,account_status::text,is_login_enabled from public.user_profiles where id='16740000-0000-4000-8000-000000000002'$$,
  $$values ('keepperson167'::text,'keep-167@example.invalid'::text,'keep-167@example.invalid'::text,'167'::text,'9876543210'::text,array['friday']::text[],'active'::text,true)$$,
  'the kept profile takes the approved identity, including the username the duplicate released');
select is((select reports_to_user_id from public.user_profiles where id='16740000-0000-4000-8000-000000000005'),'16740000-0000-4000-8000-000000000002'::uuid,'reports of a duplicate move to the kept profile');
select results_eq($$select reports_to_user_id,buddy_id from public.user_profiles where id='16740000-0000-4000-8000-000000000006'$$,$$values (null::uuid,null::uuid)$$,'links to a leaver are cleared');
select is((select count(*)::int from public.user_profiles where id in ('16740000-0000-4000-8000-000000000003','16740000-0000-4000-8000-000000000004','16740000-0000-4000-8000-000000000007') and account_status='left' and working_status='resigned' and not is_login_enabled),3,'retired profiles cannot sign in');
select is((select user_role::text from public.user_profiles where id='16740000-0000-4000-8000-000000000001'),'super_admin','the Super Admin is untouched');
select ok((select r->'deletable' @> jsonb_build_array(jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000003')) and r->'deletable' @> jsonb_build_array(jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000007')) from result_167),'unlinked duplicate and leaver are reported as deletable');
select ok((select not (r->'deletable' @> jsonb_build_array(jsonb_build_object('profile_id','16740000-0000-4000-8000-000000000004'))) from result_167),'a leaver with organisation history is kept');
select is((select count(*)::int from public.audit_logs where tenant_id='16710000-0000-4000-8000-000000000001' and action in ('employee_roster_reconciled','roster_duplicate_retired','roster_employee_retired','roster_duplicate_links_merged','roster_leaver_links_cleared')),6,'every change is audited');

select * from finish();
rollback;
