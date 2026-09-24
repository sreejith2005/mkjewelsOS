begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('17400000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','leave-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,5) n;
insert into tenants(id,name,slug) values
('17410000-0000-4000-8000-000000000001','Leave one','leave-one'),
('17410000-0000-4000-8000-000000000002','Leave two','leave-two');
insert into branches(id,tenant_id,name,code) values
('17420000-0000-4000-8000-000000000001','17410000-0000-4000-8000-000000000001','Branch one','L1'),
('17420000-0000-4000-8000-000000000002','17410000-0000-4000-8000-000000000002','Branch two','L2');
insert into departments(id,tenant_id,branch_id,name,code) values
('17430000-0000-4000-8000-000000000001','17410000-0000-4000-8000-000000000001','17420000-0000-4000-8000-000000000001','Dept one','L1-D'),
('17430000-0000-4000-8000-000000000002','17410000-0000-4000-8000-000000000002','17420000-0000-4000-8000-000000000002','Dept two','L2-D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
select ('17440000-0000-4000-8000-00000000000'||n)::uuid,('17400000-0000-4000-8000-00000000000'||n)::uuid,
  ('17410000-0000-4000-8000-00000000000'||case when n=4 then 2 else 1 end)::uuid,
  ('17420000-0000-4000-8000-00000000000'||case when n=4 then 2 else 1 end)::uuid,
  ('17430000-0000-4000-8000-00000000000'||case when n=4 then 2 else 1 end)::uuid,
  'Leave person '||n,'000001740'||n,'leave-'||n||'@example.invalid','LEAVE-'||n,
  case when n=2 then 'hr' when n=3 then 'manager' else 'staff' end::user_role,
  'active','active',n<>5,'{}'
from generate_series(1,5) n;
insert into dropdown_masters(tenant_id,master_type,label,value,is_active)
values('17410000-0000-4000-8000-000000000001','leave_type','Test annual leave','annual',true);
insert into storage.objects(id,bucket_id,name,owner_id,metadata)
values
('17450000-0000-4000-8000-000000000001','leave-approvals','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000001.png','17400000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}'),
('17450000-0000-4000-8000-000000000002','leave-approvals','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/handover/17460000-0000-4000-8000-000000000002.png','17400000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}'),
('17450000-0000-4000-8000-000000000003','leave-approvals','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000003.png','17400000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}'),
('17450000-0000-4000-8000-000000000004','leave-approvals','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000004.png','17400000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}');

select is(leave_day_count('2ND HALF','2026-09-24','2026-09-28','2026-09-29','2ND HALF'),4.5::numeric,'SQL matches the Apps Script long half-day case');
select is(leave_inform_status('2026-09-01','2026-09-24','2026-09-24'),'Inform Adv','advance notice uses source threshold');
select ok(not has_function_privilege('anon','submit_leave_request(text,text,text,date,date,date,text,text)','EXECUTE'),'anonymous request is blocked');
select ok(not has_table_privilege('authenticated','leave_requests','INSERT'),'request insert is RPC only');
select ok(not has_table_privilege('authenticated','leave_requests','UPDATE'),'request update is RPC only');
select ok(not has_function_privilege('service_role','review_leave_request(uuid,boolean,text)','EXECUTE'),'service role cannot directly review leave');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000001',true);
select ok(leave_file_writable('17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000003.png'),'applicant can upload within own path');
select ok(leave_file_readable('17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000004.png'),'applicant can access an unlinked own upload for cleanup');
select ok(not leave_file_writable('17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000002/tl/17460000-0000-4000-8000-000000000003.png'),'applicant cannot upload to another profile path');
select throws_ok($$select submit_leave_request('annual','FULL DAY','Reason','2026-09-25','2026-09-24','2026-09-28','1ST HALF','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000001.png')$$,'22023','Leave application fields are invalid','invalid date order rejected');
select lives_ok($$select submit_leave_request('annual','FULL DAY','Family matter','2026-09-24','2026-09-26','2026-09-28','1ST HALF','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000001.png')$$,'applicant can submit with own proof');
select is((select count(*)::integer from leave_requests),1,'applicant sees own request');
select is((select status from leave_requests limit 1),'pending','new leave is pending');
select ok(leave_file_readable('17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000001.png'),'applicant can read linked image');
select is((select count(*)::integer from user_availability where user_profile_id='17440000-0000-4000-8000-000000000001'),0,'pending leave does not mark absence');
select lives_ok($$select edit_pending_leave((select id from leave_requests limit 1),'2026-09-24','2026-09-26','2026-09-28','2ND HALF')$$,'applicant edits pending dates');
select lives_ok($$select submit_leave_handover((select id from leave_requests limit 1),'17440000-0000-4000-8000-000000000003','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/handover/17460000-0000-4000-8000-000000000002.png')$$,'applicant records handover');
select throws_ok($$select review_leave_request((select id from leave_requests limit 1),true,'')$$,'42501','Leave review denied','ordinary employee cannot review');

select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000003',true);
select ok(not leave_file_readable('17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000001.png'),'manager cannot read private leave image');
select throws_ok($$select review_leave_request((select id from leave_requests limit 1),true,'')$$,'42501','Leave review denied','manager cannot use HR decision');
select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000005',true);
select throws_ok($$select submit_leave_request('annual','FULL DAY','Reason','2026-09-24','2026-09-26','2026-09-28','1ST HALF','bad')$$,'42501','Active employee required','inactive employee cannot submit');
select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from leave_requests),0,'cross-tenant user cannot read leave');
select throws_ok($$select review_leave_request('17450000-0000-4000-8000-000000000001',true,'')$$,'42501','Leave review denied','cross-tenant review is denied');

select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000002',true);
select ok(leave_file_readable('17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000001.png'),'HR can read linked image');
select lives_ok($$select review_leave_request((select id from leave_requests limit 1),true,'Approved')$$,'HR approves and records absence');
select is((select status from leave_requests limit 1),'approved','request is approved');
select is((select count(*)::integer from user_availability where user_profile_id='17440000-0000-4000-8000-000000000001' and status='absent'),3,'approved leave marks non-Sunday dates absent');
select is((select count(*)::integer from user_availability where user_profile_id='17440000-0000-4000-8000-000000000001' and status='half_day'),1,'second-half return is a half day in Availability');
select throws_ok($$select review_leave_request((select id from leave_requests where status='approved' limit 1),false,'Changed mind')$$,'42501','Leave review denied','review cannot run twice');
select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000001',true);
select throws_ok($$select edit_pending_leave((select id from leave_requests where status='approved' limit 1),'2026-09-24','2026-09-26','2026-09-28','1ST HALF')$$,'42501','Only your pending leave may be edited','approved leave is immutable');
select lives_ok($$select submit_leave_request('annual','FULL DAY','Family matter','2026-10-01','2026-10-01','2026-10-02','1ST HALF','17410000-0000-4000-8000-000000000001/17440000-0000-4000-8000-000000000001/tl/17460000-0000-4000-8000-000000000003.png')$$,'applicant can make another request');
select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000002',true);
select lives_ok($$select review_leave_request((select id from leave_requests where status='pending' limit 1),false,'Roster cannot cover')$$,'HR can reject with a reason');
select is((select count(*)::integer from leave_requests where status='rejected'),1,'rejected request is retained');
select is((select count(*)::integer from user_availability where user_profile_id='17440000-0000-4000-8000-000000000001'),4,'rejection does not record attendance');

select * from finish();
rollback;
