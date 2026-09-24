begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('17600000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','leave-eligibility-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,6) n;
insert into tenants(id,name,slug) values('17610000-0000-4000-8000-000000000001','Leave eligibility','leave-eligibility');
insert into branches(id,tenant_id,name,code) values
('17620000-0000-4000-8000-000000000001','17610000-0000-4000-8000-000000000001','Leave branch','LE');
insert into departments(id,tenant_id,branch_id,name,code) values
('17630000-0000-4000-8000-000000000001','17610000-0000-4000-8000-000000000001','17620000-0000-4000-8000-000000000001','Leave department','LE-D');
insert into dropdown_masters(id,tenant_id,master_type,label,value,is_active) values
('17660000-0000-4000-8000-000000000001','17610000-0000-4000-8000-000000000001','designation','Director','director',true),
('17660000-0000-4000-8000-000000000002','17610000-0000-4000-8000-000000000001','designation','Managing Director','managing_director',true),
('17660000-0000-4000-8000-000000000003','17610000-0000-4000-8000-000000000001','designation','Owner','owner',true);
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,designation_id,working_status,account_status,is_login_enabled,week_off)
select ('17640000-0000-4000-8000-00000000000'||n)::uuid,('17600000-0000-4000-8000-00000000000'||n)::uuid,
  '17610000-0000-4000-8000-000000000001','17620000-0000-4000-8000-000000000001','17630000-0000-4000-8000-000000000001',
  'Eligibility person '||n,'000001760'||n,'leave-eligibility-'||n||'@example.invalid','ELIG-'||n,
  case when n=2 then 'hr' when n=3 then 'super_admin' else 'staff' end::user_role,
  case when n between 4 and 6 then ('17660000-0000-4000-8000-00000000000'||(n-3))::uuid else null end,
  'active','active',true,'{}' from generate_series(1,6) n;

select ok(not has_function_privilege('anon','leave_applicant_eligible()','EXECUTE'),'anonymous users cannot call leave eligibility');
select ok(not has_function_privilege('service_role','leave_applicant_eligible()','EXECUTE'),'service role has no leave eligibility RPC grant');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17600000-0000-4000-8000-000000000001',true);
select ok(leave_applicant_eligible(),'staff can apply');
select set_config('request.jwt.claim.sub','17600000-0000-4000-8000-000000000002',true);
select ok(leave_applicant_eligible(),'HR can apply');
select set_config('request.jwt.claim.sub','17600000-0000-4000-8000-000000000003',true);
select ok(not leave_applicant_eligible(),'Super Admin cannot apply');
select throws_ok($$select submit_leave_request('casual','FULL DAY','Reason','2026-09-25','2026-09-25','2026-09-26','1ST HALF','bad')$$,
  '42501','Leave application is unavailable for this account','Super Admin direct RPC submit is denied');
select set_config('request.jwt.claim.sub','17600000-0000-4000-8000-000000000004',true);
select ok(not leave_applicant_eligible(),'Director cannot apply');
select throws_ok($$select submit_leave_request('casual','FULL DAY','Reason','2026-09-25','2026-09-25','2026-09-26','1ST HALF','bad')$$,
  '42501','Leave application is unavailable for this account','Director direct RPC submit is denied');
select set_config('request.jwt.claim.sub','17600000-0000-4000-8000-000000000005',true);
select ok(not leave_applicant_eligible(),'Managing Director cannot apply');
select set_config('request.jwt.claim.sub','17600000-0000-4000-8000-000000000006',true);
select ok(not leave_applicant_eligible(),'Owner cannot apply');
select * from finish();
rollback;
