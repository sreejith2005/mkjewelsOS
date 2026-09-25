begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('17800000-0000-4000-8000-000000000001','authenticated','authenticated','leave-178@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into tenants(id,name,slug) values('17810000-0000-4000-8000-000000000001','Leave 178','leave-178');
insert into branches(id,tenant_id,name,code) values('17820000-0000-4000-8000-000000000001','17810000-0000-4000-8000-000000000001','Leave 178 branch','L178');
insert into departments(id,tenant_id,branch_id,name,code) values('17830000-0000-4000-8000-000000000001','17810000-0000-4000-8000-000000000001','17820000-0000-4000-8000-000000000001','Dept','L178D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
values('17840000-0000-4000-8000-000000000001','17800000-0000-4000-8000-000000000001','17810000-0000-4000-8000-000000000001',
  '17820000-0000-4000-8000-000000000001','17830000-0000-4000-8000-000000000001','Richelle d''Souza','0000017801',
  'leave-178@example.invalid','L178-1','staff','active','active',true,'{}');

select ok(not has_function_privilege('authenticated','assign_leave_reference_code()','EXECUTE'),'employees cannot call the reference trigger');
select col_not_null('leave_requests','reference_code','every leave has a reference code');

insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,submitted_at)
select ('17850000-0000-4000-8000-00000000000'||n)::uuid,'17810000-0000-4000-8000-000000000001','17840000-0000-4000-8000-000000000001',
  '17820000-0000-4000-8000-000000000001','casual','FULL DAY','Test','2026-10-01','2026-10-01','2026-10-02','1ST HALF','Inform Adv',1,
  '178/tl/'||n,'2026-09-25 10:15:32+00'
from generate_series(1,2) n;

select is((select reference_code from leave_requests where id='17850000-0000-4000-8000-000000000001'),
  'RICHELLE D SOUZA-25-SEP-2026-154532','reference uses the source name, date, and IST time pattern');
select is((select reference_code from leave_requests where id='17850000-0000-4000-8000-000000000002'),
  'RICHELLE D SOUZA-25-SEP-2026-154532-2','same-second request gets a distinct reference');

update leave_requests set reference_code='CHANGED',status='approved' where id='17850000-0000-4000-8000-000000000001';
select is((select reference_code from leave_requests where id='17850000-0000-4000-8000-000000000001'),
  'RICHELLE D SOUZA-25-SEP-2026-154532','reference code cannot be changed after creation');

select * from finish();
rollback;
