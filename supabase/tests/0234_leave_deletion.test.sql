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


select ok(not has_function_privilege('anon','delete_leave_requests_with_audit(uuid[])','EXECUTE'),'anonymous deletion denied');
select ok(not has_function_privilege('service_role','delete_leave_requests_with_audit(uuid[])','EXECUTE'),'service-role deletion denied');
insert into storage.objects(bucket_id,name,owner_id)
select 'leave-approvals',tl_approval_path,'18900000-0000-4000-8000-000000000001' from leave_requests where id='18950000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('authenticated','leave_requests','DELETE'),'direct delete denied');
select ok(not has_function_privilege('authenticated','restore_deleted_leave_coverage(uuid,date)','EXECUTE'),'internal coverage helper denied');
update user_profiles set user_role='super_admin' where id='18940000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000001']::uuid[])$$,'42501','Leave deletion denied','missing authenticated profile denied');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000001',true);
select throws_ok($$select delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000001']::uuid[])$$,'42501','Leave deletion denied','ordinary applicant cannot delete own leave');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000004',true);
select throws_ok($$select delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000001']::uuid[])$$,'42501','Leave deletion denied','admin cannot delete office leave');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000006',true);
select throws_ok($$select delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000001']::uuid[])$$,'42501','Leave deletion denied','inactive user denied');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000003',true);
select throws_ok($$select delete_leave_requests_with_audit('{}'::uuid[])$$,'22023','Select between 1 and 500 leave requests','empty batch denied');
select throws_ok($$select delete_leave_requests_with_audit(array[null]::uuid[])$$,'22023','Select between 1 and 500 leave requests','null identifiers denied');
select throws_ok($$select delete_leave_requests_with_audit(array_fill('18950000-0000-4000-8000-000000000001'::uuid,array[501]))$$,'22023','Select between 1 and 500 leave requests','oversized batch denied');
select throws_ok($$select delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000001','18950000-0000-4000-8000-000000000099']::uuid[])$$,'42501','Leave request not found or not accessible','stale batch fails atomically');
select throws_ok($$select delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000001','18950000-0000-4000-8000-000000000003']::uuid[])$$,'42501','Leave request not found or not accessible','cross-tenant batch fails atomically');
select is((select count(*)::integer from leave_requests),2,'failed batch retains all own-tenant requests');
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000001','18950000-0000-4000-8000-000000000001']::uuid[]),1,'individual deletion deduplicates identifiers');
select is((select count(*)::integer from leave_requests),1,'individual deletion removes entry');
select ok(leave_file_readable('18910000-0000-4000-8000-000000000001/18940000-0000-4000-8000-000000000001/tl/18960000-0000-4000-8000-000000000001.png'),'Super Admin can read archived approval evidence');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000001',true);
-- Reproduce the Storage API deletion context while still enforcing its RLS.
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='leave-approvals' and name='18910000-0000-4000-8000-000000000001/18940000-0000-4000-8000-000000000001/tl/18960000-0000-4000-8000-000000000001.png';
select is((select count(*)::integer from storage.objects where bucket_id='leave-approvals' and name='18910000-0000-4000-8000-000000000001/18940000-0000-4000-8000-000000000001/tl/18960000-0000-4000-8000-000000000001.png'),1,'applicant cannot remove archived approval evidence');
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000003',true);

reset role;
select is((select count(*)::integer from audit_logs where action='leave_deleted' and record_id='18950000-0000-4000-8000-000000000001'),1,'one durable audit per deleted request');
select is((select old_value->>'reason' from audit_logs where action='leave_deleted' and record_id='18950000-0000-4000-8000-000000000001'),'Private reason','audit retains original request');
insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source)
values('18910000-0000-4000-8000-000000000001','18940000-0000-4000-8000-000000000004','2026-10-01','absent','Approved leave 18950000-0000-4000-8000-000000000002','18940000-0000-4000-8000-000000000003','manual');
set local role authenticated;
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000003',true);
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000002']::uuid[]),1,'Super Admin deletes approved cross-branch leave');
reset role;
select is((select status::text from user_availability where user_profile_id='18940000-0000-4000-8000-000000000004' and date='2026-10-01'),'present','deleting approved leave reconciles attributed absence');
select is((select count(*)::integer from leave_requests where tenant_id='18910000-0000-4000-8000-000000000002'),1,'cross-tenant leave preserved');

-- Overlap, manual overrides, and unfinished cross-surface work.
insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
select ('18950000-0000-4000-8000-00000000000'||n)::uuid,'18910000-0000-4000-8000-000000000001',
 '18940000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001','Casual Leave',
 case when n=4 then '2ND HALF' else 'FULL DAY' end,'Synthetic cleanup test','2026-10-06','2026-10-06','2026-10-07','1ST HALF','Inform Adv',1,
 'synthetic/leave-delete/'||n,'approved' from generate_series(4,8) n;
insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source)
values('18910000-0000-4000-8000-000000000001','18940000-0000-4000-8000-000000000001','2026-10-06','half_day','Approved leave 18950000-0000-4000-8000-000000000004','18940000-0000-4000-8000-000000000003','manual');
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by,coverage_status,coverage_original_assignee_id,coverage_resolved_for_date)
select ('18960000-0000-4000-8000-00000000000'||n)::uuid,'18910000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001',
 '18930000-0000-4000-8000-000000000001','delegation','Synthetic covered work',case when n=2 then 'completed' else 'pending' end::task_status,
 '2026-10-06 18:00 Asia/Kolkata','18940000-0000-4000-8000-000000000003','covered','18940000-0000-4000-8000-000000000001','2026-10-06' from generate_series(1,2) n;
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select ('18960000-0000-4000-8000-00000000000'||n)::uuid,'18940000-0000-4000-8000-000000000001','doer',true,false from generate_series(1,2) n;
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select ('18960000-0000-4000-8000-00000000000'||n)::uuid,'18940000-0000-4000-8000-000000000002','doer',false,true from generate_series(1,2) n;
insert into fms_flows(id,tenant_id,name,created_by)
values('18970000-0000-4000-8000-000000000009','18910000-0000-4000-8000-000000000001','Synthetic cleanup flow','18940000-0000-4000-8000-000000000003');
insert into fms_stages(id,fms_flow_id,name,sort_order)
values('189a0000-0000-4000-8000-000000000001','18970000-0000-4000-8000-000000000009','Synthetic cleanup stage',1);
insert into fms_instances(id,tenant_id,branch_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,started_by)
select '18980000-0000-4000-8000-000000000001',tenant_id,'18920000-0000-4000-8000-000000000001',id,family_id,version,'SYN-DELETE-1','Synthetic cleanup instance','18940000-0000-4000-8000-000000000003'
from fms_flows where id='18970000-0000-4000-8000-000000000009';
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,assigned_to,planned_datetime,status,coverage_status,coverage_original_assignee_id,coverage_resolved_for_date,leave_coverage_buddy_id,leave_coverage_buddy_preexisting)
values('18990000-0000-4000-8000-000000000001','18980000-0000-4000-8000-000000000001','189a0000-0000-4000-8000-000000000001',array['18940000-0000-4000-8000-000000000002','18940000-0000-4000-8000-000000000004']::uuid[],'2026-10-06 18:00 Asia/Kolkata','pending','covered','18940000-0000-4000-8000-000000000001','2026-10-06','18940000-0000-4000-8000-000000000002',true);
insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,is_active,status)
select '18910000-0000-4000-8000-000000000001','18990000-0000-4000-8000-000000000001',('18940000-0000-4000-8000-00000000000'||n)::uuid,n<>1,case when n=1 then 'reassigned' else 'assigned' end from generate_series(1,4) n where n<>3;
set local role authenticated;
select set_config('request.jwt.claim.sub','18900000-0000-4000-8000-000000000003',true);
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000004']::uuid[]),1,'half-day leave removed');
reset role;
select is((select status::text from user_availability where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-06'),'absent','remaining full-day approval still marks absence');
select ok(not exists(select 1 from task_assignees where task_instance_id='18960000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001' and is_active),'overlapping leave prevents premature work restoration');
set local role authenticated;
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000005','18950000-0000-4000-8000-000000000006','18950000-0000-4000-8000-000000000007','18950000-0000-4000-8000-000000000008']::uuid[]),4,'bulk removes remaining approved leaves');
reset role;
select ok(exists(select 1 from task_assignees where task_instance_id='18960000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001' and is_active),'unfinished task returns to original assignee');
select ok(exists(select 1 from task_assignees where task_instance_id='18960000-0000-4000-8000-000000000002' and user_profile_id='18940000-0000-4000-8000-000000000002' and is_active),'completed task assignment retained');
select ok((select array['18940000-0000-4000-8000-000000000001','18940000-0000-4000-8000-000000000002','18940000-0000-4000-8000-000000000004']::uuid[] <@ assigned_to from fms_instance_stages where id='18990000-0000-4000-8000-000000000001'),'FMS original and preexisting peers retained');
select ok(exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001' and is_active),'FMS assignment restored across work surfaces');

-- Sequential deletion must traverse older deleted approvals instead of
-- resurrecting their attributed absences. Manual prior state survives.
insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
select ('18950000-0000-4000-8000-0000000000'||n)::uuid,'18910000-0000-4000-8000-000000000001',
 '18940000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001','Casual Leave','FULL DAY','Synthetic prior-state test','2026-10-08','2026-10-08','2026-10-09','1ST HALF','Inform Adv',1,
 'synthetic/leave-delete/'||n,'pending' from generate_series(10,11) n;
set local role authenticated;
select lives_ok($$select record_availability_with_audit('18940000-0000-4000-8000-000000000001','2026-10-08','present','Manual present')$$,'seed audited prior availability');
select lives_ok($$select review_leave_request('18950000-0000-4000-8000-000000000010',true,'')$$,'approve first overlap');
select lives_ok($$select review_leave_request('18950000-0000-4000-8000-000000000011',true,'')$$,'approve second overlap');
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000010']::uuid[]),1,'remove older overlap first');
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000011']::uuid[]),1,'remove newer overlap separately');
reset role;
select is((select status::text from user_availability where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-08'),'present','old deleted approval does not resurrect absence');
select is((select reason from user_availability where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-08'),'Manual present','audited pre-leave manual reason restored');
-- A manual override made after approval is left alone.
insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
values('18950000-0000-4000-8000-000000000012','18910000-0000-4000-8000-000000000001','18940000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001','Casual Leave','FULL DAY','Synthetic manual test','2026-10-10','2026-10-10','2026-10-11','1ST HALF','Inform Adv',1,'synthetic/leave-delete/12','approved');
set local role authenticated;
select record_availability_with_audit('18940000-0000-4000-8000-000000000001','2026-10-10','absent','Manual override');
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000012']::uuid[]),1,'delete leave after manual override');
reset role;
select is((select reason from user_availability where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-10'),'Manual override','independent manual availability retained');

insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
values('18950000-0000-4000-8000-000000000013','18910000-0000-4000-8000-000000000001','18940000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001','Casual Leave','FULL DAY','Synthetic disabled test','2026-10-10','2026-10-10','2026-10-11','1ST HALF','Inform Adv',1,'synthetic/leave-delete/13','approved');
update user_availability set reason='Approved leave 18950000-0000-4000-8000-000000000013' where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-10';
update user_profiles set account_status='inactive',is_login_enabled=false where id='18940000-0000-4000-8000-000000000001';
update task_instances set coverage_status='covered',coverage_original_assignee_id='18940000-0000-4000-8000-000000000001',coverage_resolved_for_date='2026-10-10',planned_datetime='2026-10-10 12:00 Asia/Kolkata' where id='18960000-0000-4000-8000-000000000001';
update task_assignees set is_active=not is_original where task_instance_id='18960000-0000-4000-8000-000000000001';
set local role authenticated;
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000013']::uuid[]),1,'disabled employee leave removed');
reset role;
select ok(exists(select 1 from task_assignees where task_instance_id='18960000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000002' and is_active),'disabled employee does not take work away from buddy');
update user_profiles set account_status='active',is_login_enabled=true where id='18940000-0000-4000-8000-000000000001';
insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
select ('18950000-0000-4000-8000-0000000000'||n)::uuid,'18910000-0000-4000-8000-000000000001','18940000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001','Casual Leave',case when n=14 then 'FULL DAY' else '2ND HALF' end,'Synthetic remaining half','2026-10-06','2026-10-06','2026-10-07','1ST HALF','Inform Adv',1,'synthetic/leave-delete/'||n,'approved' from generate_series(14,15) n;
update user_availability set status='absent',reason='Approved leave 18950000-0000-4000-8000-000000000014' where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-06';
update task_instances set coverage_status='covered',coverage_original_assignee_id='18940000-0000-4000-8000-000000000001',coverage_resolved_for_date='2026-10-06',planned_datetime='2026-10-06 12:00 Asia/Kolkata' where id='18960000-0000-4000-8000-000000000001';
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by,coverage_status,coverage_original_assignee_id,coverage_resolved_for_date)
select '18960000-0000-4000-8000-000000000003',tenant_id,branch_id,department_id,task_type,'Synthetic afternoon coverage','pending','2026-10-06 18:00 Asia/Kolkata',created_by,'covered',coverage_original_assignee_id,coverage_resolved_for_date from task_instances where id='18960000-0000-4000-8000-000000000001';
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('18960000-0000-4000-8000-000000000003','18940000-0000-4000-8000-000000000001','doer',true,false),('18960000-0000-4000-8000-000000000003','18940000-0000-4000-8000-000000000002','doer',false,true);
update task_assignees set is_active=not is_original where task_instance_id='18960000-0000-4000-8000-000000000001';
set local role authenticated;
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000014']::uuid[]),1,'full-day overlap removed leaving second half');
reset role;
select ok(exists(select 1 from task_assignees where task_instance_id='18960000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001' and is_active),'morning unfinished work returns during available half');
select ok(exists(select 1 from task_assignees where task_instance_id='18960000-0000-4000-8000-000000000003' and user_profile_id='18940000-0000-4000-8000-000000000002' and is_active),'afternoon work retains coverage during remaining absent half');

-- Individual contributions may be completed while shared work stays pending.
update task_assignees set completed_at=case when is_original then now() else completed_at end,is_active=not is_original where task_instance_id='18960000-0000-4000-8000-000000000001';
update task_instances set coverage_status='covered',coverage_original_assignee_id='18940000-0000-4000-8000-000000000001',coverage_resolved_for_date='2026-10-06' where id='18960000-0000-4000-8000-000000000001';
update fms_instance_stages set assigned_to=array['18940000-0000-4000-8000-000000000002','18940000-0000-4000-8000-000000000004']::uuid[],coverage_status='covered',coverage_original_assignee_id='18940000-0000-4000-8000-000000000001',coverage_resolved_for_date='2026-10-06',leave_coverage_buddy_id='18940000-0000-4000-8000-000000000002',leave_coverage_buddy_preexisting=false where id='18990000-0000-4000-8000-000000000001';
update fms_instance_stage_assignees set status='reassigned',is_active=false where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001';
update fms_instance_stage_assignees set status='completed',is_active=true where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000002';
set local role authenticated;
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000015']::uuid[]),1,'last half-day approval removed');
reset role;
select ok(exists(select 1 from task_assignees where task_instance_id='18960000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000002' and is_active),'completed original contribution is not repeated on pending task');
select ok(exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000002' and is_active and status='completed'),'completed buddy contribution remains in shared stage completion');
select ok(not exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001' and is_active),'completed covered contribution does not gain a fresh doer');
insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
select ('18950000-0000-4000-8000-0000000000'||n)::uuid,'18910000-0000-4000-8000-000000000001','18940000-0000-4000-8000-000000000001','18920000-0000-4000-8000-000000000001','Casual Leave','FULL DAY','Synthetic manual overlap','2026-10-08','2026-10-08','2026-10-09','1ST HALF','Inform Adv',1,'synthetic/leave-delete/'||n,'pending' from generate_series(16,17) n;
set local role authenticated;
select record_availability_with_audit('18940000-0000-4000-8000-000000000001','2026-10-08','present','Manual before A');
select review_leave_request('18950000-0000-4000-8000-000000000016',true,'');
select record_availability_with_audit('18940000-0000-4000-8000-000000000001','2026-10-08','absent','Manual after A');
select review_leave_request('18950000-0000-4000-8000-000000000017',true,'');
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000017']::uuid[]),1,'remove newer approval around manual override');
select is(delete_leave_requests_with_audit(array['18950000-0000-4000-8000-000000000016']::uuid[]),1,'remove earlier remaining approval');
reset role;
select is((select status::text from user_availability where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-08'),'absent','intervening manual absence survives sequential deletion');
select is((select reason from user_availability where user_profile_id='18940000-0000-4000-8000-000000000001' and date='2026-10-08'),'Manual after A','latest manual baseline survives remaining approval attribution');

-- Older coverage can mark a completed assignment reassigned while preserving
-- its completed_at. That timestamp must remain authoritative during cleanup.
update fms_instance_stage_assignees set status='assigned',completed_at=null where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000002';
update fms_instance_stage_assignees set status='reassigned',is_active=false,completed_at=now() where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001';
select restore_deleted_leave_coverage('18940000-0000-4000-8000-000000000001','2026-10-06');
select ok(not exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001' and is_active),'legacy reassigned status does not reopen completed contribution');
select ok(exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id='18990000-0000-4000-8000-000000000001' and user_profile_id='18940000-0000-4000-8000-000000000001' and completed_at is not null),'original completion timestamp remains intact');
select * from finish();
rollback;
