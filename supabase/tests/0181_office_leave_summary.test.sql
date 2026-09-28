begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('18900000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','office-leave-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,8) n;
insert into tenants(id,name,slug) values
('18910000-0000-4000-8000-000000000001','Office leave one','office-leave-one'),
('18910000-0000-4000-8000-000000000002','Office leave two','office-leave-two');
insert into branches(id,tenant_id,name,code) values
('18920000-0000-4000-8000-000000000001','18910000-0000-4000-8000-000000000001','Office one','OL1'),
('18920000-0000-4000-8000-000000000002','18910000-0000-4000-8000-000000000002','Office two','OL2'),
('18920000-0000-4000-8000-000000000003','18910000-0000-4000-8000-000000000001','Office one second branch','OL3');
insert into departments(id,tenant_id,branch_id,name,code) values
('18930000-0000-4000-8000-000000000001','18910000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001','Office one','OL1-D'),
('18930000-0000-4000-8000-000000000002','18910000-0000-4000-8000-000000000002','18920000-0000-4000-8000-000000000002','Office two','OL2-D'),
('18930000-0000-4000-8000-000000000003','18910000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000003','Office one second branch','OL3-D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
select ('18940000-0000-4000-8000-00000000000'||n)::uuid,('18900000-0000-4000-8000-00000000000'||n)::uuid,
  ('18910000-0000-4000-8000-00000000000'||case when n=5 then 2 else 1 end)::uuid,
  ('18920000-0000-4000-8000-00000000000'||case when n=5 then 2 when n=4 then 3 else 1 end)::uuid,
  ('18930000-0000-4000-8000-00000000000'||case when n=5 then 2 when n=4 then 3 else 1 end)::uuid,
  'Office leave person '||n,'000001890'||n,'office-leave-'||n||'@example.invalid','OL-'||n,
  case when n=2 then 'manager' when n=3 then 'super_admin' when n=4 then 'admin' else 'staff' end::user_role,
  'active',(case when n=6 then 'inactive' else 'active' end)::user_account_status,n<>6,'{}'
from generate_series(1,8) n;
insert into dropdown_masters(id,tenant_id,master_type,label,value,is_active) values
('18970000-0000-4000-8000-000000000001','18910000-0000-4000-8000-000000000001','designation','Director','director',true),
('18970000-0000-4000-8000-000000000002','18910000-0000-4000-8000-000000000001','designation','Owner','owner',true);
update user_profiles set designation_id='18970000-0000-4000-8000-000000000001' where id='18940000-0000-4000-8000-000000000007';
update user_profiles set designation_id='18970000-0000-4000-8000-000000000002' where id='18940000-0000-4000-8000-000000000008';
insert into designation_permission_overrides(tenant_id,designation_id,permission_key,effect) values
('18910000-0000-4000-8000-000000000001','18970000-0000-4000-8000-000000000001','availability.view_leave_summary','grant'),
('18910000-0000-4000-8000-000000000001','18970000-0000-4000-8000-000000000002','availability.view_leave_summary','grant');
insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
select ('18950000-0000-4000-8000-00000000000'||n)::uuid,
  ('18910000-0000-4000-8000-00000000000'||case when n=3 then 2 else 1 end)::uuid,
  ('18940000-0000-4000-8000-00000000000'||case when n=2 then 4 when n=3 then 5 else 1 end)::uuid,
  ('18920000-0000-4000-8000-00000000000'||case when n=3 then 2 when n=2 then 3 else 1 end)::uuid,
  'casual','FULL DAY','Private reason','2026-10-01','2026-10-01','2026-10-02','1ST HALF','Inform Adv',1,
  '18910000-0000-4000-8000-00000000000'||case when n=3 then '2' else '1' end||'/18940000-0000-4000-8000-00000000000'||case when n=2 then '4' when n=3 then '5' else '1' end||'/tl/18960000-0000-4000-8000-00000000000'||n||'.png',
  case when n=2 then 'approved' else 'pending' end
from generate_series(1,3) n;

select ok(not has_table_privilege('anon','leave_requests','SELECT'),'anonymous read denied');
select ok(not has_table_privilege('anon','leave_summary_applicants','SELECT'),'anonymous applicant names denied');
select ok(not has_table_privilege('service_role','leave_requests','SELECT'),'service role has no leave table grant');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from leave_requests),1,'staff sees only own leave');
select is((select count(*)::integer from leave_summary_applicants),0,'staff cannot enumerate office applicants');
select ok(not leave_file_readable('18910000-0000-4000-8000-000000000001/18940000-0000-4000-8000-000000000004/tl/18960000-0000-4000-8000-000000000002.png'),'staff cannot read peer proof');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from leave_requests),2,'manager sees all tenant leave statuses across branches');
select is((select count(*)::integer from leave_summary_applicants),2,'manager resolves applicant names across branches');
select ok(leave_file_readable((select tl_approval_path from leave_requests where id='18950000-0000-4000-8000-000000000001')),'manager can read staff proof');
select throws_ok($$select review_leave_request('18950000-0000-4000-8000-000000000001',true,'')$$,'42501','Leave review denied','manager summary access does not permit approval');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from leave_requests),2,'admin sees the office summary');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000007',true);
select is((select count(*)::integer from leave_requests),2,'Director designation sees the office summary');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000008',true);
select is((select count(*)::integer from leave_requests),2,'Owner designation sees the office summary');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from leave_requests),2,'Super Admin sees office leave');
select ok(not has_permission('availability.apply_leave_exception'),'Super Admin has no implicit leave application exception');
select ok(not leave_applicant_eligible(),'ordinary Super Admin remains exempt from application');
reset role;
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect)
values('18940000-0000-4000-8000-000000000003','18910000-0000-4000-8000-000000000001','availability.apply_leave_exception','grant');
set local role authenticated;
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000003',true);
select ok(has_permission('availability.apply_leave_exception'),'explicit user grant resolves for Super Admin');
select ok(leave_applicant_eligible(),'named Super Admin exception can apply and retain office access');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000005',true);
select is((select count(*)::integer from leave_requests),1,'cross-tenant staff sees only own tenant');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000006',true);
select is((select count(*)::integer from leave_requests),0,'inactive user cannot read office leave');
select * from finish();
rollback;
