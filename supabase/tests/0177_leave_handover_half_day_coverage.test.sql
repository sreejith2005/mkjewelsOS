begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('17700000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','leave-177-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,4) n;
insert into tenants(id,name,slug) values
('17710000-0000-4000-8000-000000000001','Leave 177 one','leave-177-one'),
('17710000-0000-4000-8000-000000000002','Leave 177 two','leave-177-two');
insert into branches(id,tenant_id,name,code) values
('17720000-0000-4000-8000-000000000001','17710000-0000-4000-8000-000000000001','Leave 177 branch','L177'),
('17720000-0000-4000-8000-000000000002','17710000-0000-4000-8000-000000000002','Leave 177 other','L177B');
insert into departments(id,tenant_id,branch_id,name,code) values
('17730000-0000-4000-8000-000000000001','17710000-0000-4000-8000-000000000001','17720000-0000-4000-8000-000000000001','Dept','L177D'),
('17730000-0000-4000-8000-000000000002','17710000-0000-4000-8000-000000000002','17720000-0000-4000-8000-000000000002','Other','L177O');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
select ('17740000-0000-4000-8000-00000000000'||n)::uuid,('17700000-0000-4000-8000-00000000000'||n)::uuid,
  ('17710000-0000-4000-8000-00000000000'||case when n=4 then 2 else 1 end)::uuid,
  ('17720000-0000-4000-8000-00000000000'||case when n=4 then 2 else 1 end)::uuid,
  ('17730000-0000-4000-8000-00000000000'||case when n=4 then 2 else 1 end)::uuid,
  'Leave 177 person '||n,'000001770'||n,'leave-177-'||n||'@example.invalid','L177-'||n,
  case when n=3 then 'hr' else 'staff' end::user_role,'active','active',true,'{}'
from generate_series(1,4) n;
update user_profiles set buddy_id='17740000-0000-4000-8000-000000000002'
where id='17740000-0000-4000-8000-000000000001';

select ok(not has_table_privilege('anon','leave_handover_candidates','SELECT'),'anonymous handover lookup denied');
select ok(not has_table_privilege('service_role','leave_handover_candidates','SELECT'),'service role has no handover view grant');
select ok(not has_function_privilege('authenticated','sync_leave_half_day_tasks(timestamptz)','EXECUTE'),'employees cannot invoke scheduler');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17700000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from leave_handover_candidates),2,'staff sees eligible same-tenant coworkers');
select ok(not exists(select 1 from leave_handover_candidates where id='17740000-0000-4000-8000-000000000004'),'cross-tenant coworker hidden');
select ok(not exists(select 1 from leave_handover_candidates where id='17740000-0000-4000-8000-000000000001'),'self excluded from handover');
select set_config('request.jwt.claim.sub','17700000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from leave_handover_candidates),0,'other tenant sees no first-tenant employees');
reset role;
update user_profiles set is_login_enabled=false where id='17740000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','17700000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from leave_handover_candidates),0,'inactive login cannot enumerate coworkers');
reset role;
update user_profiles set is_login_enabled=true where id='17740000-0000-4000-8000-000000000001';

insert into user_availability(tenant_id,user_profile_id,date,status)
values('17710000-0000-4000-8000-000000000001','17740000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kolkata')::date,'half_day');
insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status)
values('17750000-0000-4000-8000-000000000001','17710000-0000-4000-8000-000000000001','17740000-0000-4000-8000-000000000001','17720000-0000-4000-8000-000000000001','casual','FULL DAY','Test',
  (now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date,'2ND HALF','Inform Adv',0.5,'177/tl/one','approved');
select ok(leave_half_day_absent_at('17740000-0000-4000-8000-000000000001',
  (((now() at time zone 'Asia/Kolkata')::date::text||' 12:59 Asia/Kolkata')::timestamptz)),'first half absent before cutoff');
select ok(not leave_half_day_absent_at('17740000-0000-4000-8000-000000000001',
  (((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz)),'first half returns at 13:00');

insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
values('17760000-0000-4000-8000-000000000001','17710000-0000-4000-8000-000000000001','17720000-0000-4000-8000-000000000001','17730000-0000-4000-8000-000000000001','delegation','Half-day work','pending',
  (((now() at time zone 'Asia/Kolkata')::date::text||' 18:00 Asia/Kolkata')::timestamptz),'17740000-0000-4000-8000-000000000003');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('17760000-0000-4000-8000-000000000001','17740000-0000-4000-8000-000000000001','doer',true,true);
update task_assignees set is_active=false where task_instance_id='17760000-0000-4000-8000-000000000001';
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('17760000-0000-4000-8000-000000000001','17740000-0000-4000-8000-000000000002','doer',false,true);
update task_instances set coverage_status='covered',coverage_original_assignee_id='17740000-0000-4000-8000-000000000001',
  coverage_resolution='primary_buddy',coverage_resolved_for_date=(now() at time zone 'Asia/Kolkata')::date
where id='17760000-0000-4000-8000-000000000001';
reset role;
select sync_leave_half_day_tasks((((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz));
select ok(exists(select 1 from task_assignees where task_instance_id='17760000-0000-4000-8000-000000000001' and user_profile_id='17740000-0000-4000-8000-000000000001' and is_active),'open task returns to employee at cutoff');
select ok(not exists(select 1 from task_assignees where task_instance_id='17760000-0000-4000-8000-000000000001' and user_profile_id='17740000-0000-4000-8000-000000000002' and is_active),'buddy loses returned task');

update leave_requests set duration='2ND HALF',work_start_date=work_start_date+1,work_start_in='1ST HALF'
where id='17750000-0000-4000-8000-000000000001';
select ok(not leave_half_day_absent_at('17740000-0000-4000-8000-000000000001',
  (((now() at time zone 'Asia/Kolkata')::date::text||' 12:59 Asia/Kolkata')::timestamptz)),'second half leave keeps employee available before cutoff');
select ok(leave_half_day_absent_at('17740000-0000-4000-8000-000000000001',
  (((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz)),'second half leave starts at 13:00');
insert into clients(id,tenant_id,branch_id,phone,first_name,assigned_crm_id)
values('17770000-0000-4000-8000-000000000001','17710000-0000-4000-8000-000000000001','17720000-0000-4000-8000-000000000001','0000017705','Leave client','17740000-0000-4000-8000-000000000001');
insert into client_followups(id,client_id,tenant_id,branch_id,assigned_to,due_date,status,subject,created_by)
values('17780000-0000-4000-8000-000000000001','17770000-0000-4000-8000-000000000001','17710000-0000-4000-8000-000000000001','17720000-0000-4000-8000-000000000001','17740000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kolkata')::date,'open','Leave follow-up','17740000-0000-4000-8000-000000000003');
insert into fms_flows(id,tenant_id,name,created_by)
values('17790000-0000-4000-8000-000000000001','17710000-0000-4000-8000-000000000001','Leave flow','17740000-0000-4000-8000-000000000003');
insert into fms_stages(id,fms_flow_id,name,sort_order)
values
('177a0000-0000-4000-8000-000000000001','17790000-0000-4000-8000-000000000001','Leave stage',1),
('177a0000-0000-4000-8000-000000000002','17790000-0000-4000-8000-000000000001','Shared stage',2);
insert into fms_instances(id,tenant_id,branch_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,started_by)
select '177b0000-0000-4000-8000-000000000001',tenant_id,'17720000-0000-4000-8000-000000000001',id,family_id,version,'L177-1','Leave FMS work','17740000-0000-4000-8000-000000000003'
from fms_flows where id='17790000-0000-4000-8000-000000000001';
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,assigned_to,planned_datetime)
values
('177c0000-0000-4000-8000-000000000001','177b0000-0000-4000-8000-000000000001','177a0000-0000-4000-8000-000000000001',
  array['17740000-0000-4000-8000-000000000001'::uuid],(((now() at time zone 'Asia/Kolkata')::date::text||' 18:00 Asia/Kolkata')::timestamptz)),
('177c0000-0000-4000-8000-000000000002','177b0000-0000-4000-8000-000000000001','177a0000-0000-4000-8000-000000000002',
  array['17740000-0000-4000-8000-000000000001'::uuid,'17740000-0000-4000-8000-000000000003'::uuid],
  (((now() at time zone 'Asia/Kolkata')::date::text||' 18:00 Asia/Kolkata')::timestamptz));
insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id)
values
('17710000-0000-4000-8000-000000000001','177c0000-0000-4000-8000-000000000001','17740000-0000-4000-8000-000000000001'),
('17710000-0000-4000-8000-000000000001','177c0000-0000-4000-8000-000000000002','17740000-0000-4000-8000-000000000001'),
('17710000-0000-4000-8000-000000000001','177c0000-0000-4000-8000-000000000002','17740000-0000-4000-8000-000000000003');
select sync_leave_half_day_tasks((((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz));
select ok(exists(select 1 from task_assignees where task_instance_id='17760000-0000-4000-8000-000000000001' and user_profile_id='17740000-0000-4000-8000-000000000002' and is_active),'primary buddy owns task during absent half');
select ok(not exists(select 1 from task_assignees where task_instance_id='17760000-0000-4000-8000-000000000001' and user_profile_id='17740000-0000-4000-8000-000000000001' and is_active),'absent employee loses task during absent half');
select is((select coverage_original_assignee_id from task_instances where id='17760000-0000-4000-8000-000000000001'),
  '17740000-0000-4000-8000-000000000001'::uuid,'task retains original assignee tag');
select is((select effective_assignee_id from resolve_task_coverage_at(
  '17740000-0000-4000-8000-000000000001',
  (now() at time zone 'Asia/Kolkata')::date,
  (((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz))),
  '17740000-0000-4000-8000-000000000002'::uuid,'new assignment resolver targets buddy during absent half');
select sync_leave_half_day_tasks((((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz));
select is((select count(*)::integer from audit_logs where record_id='17760000-0000-4000-8000-000000000001' and action='absence_coverage_assigned'),1,'repeat scheduler run does not duplicate transfer');
select is((select assigned_to from client_followups where id='17780000-0000-4000-8000-000000000001'),
  '17740000-0000-4000-8000-000000000002'::uuid,'CRM follow-up moves to primary buddy');
select is((select assigned_to[1] from fms_instance_stages where id='177c0000-0000-4000-8000-000000000001'),
  '17740000-0000-4000-8000-000000000002'::uuid,'single-doer FMS work moves to primary buddy');
select ok((select assigned_to @> array['17740000-0000-4000-8000-000000000002'::uuid,'17740000-0000-4000-8000-000000000003'::uuid]
  and not assigned_to @> array['17740000-0000-4000-8000-000000000001'::uuid]
  from fms_instance_stages where id='177c0000-0000-4000-8000-000000000002'),'shared FMS stage keeps coworker and transfers absent doer');
update leave_requests set duration='FULL DAY',work_start_date=leave_start,work_start_in='2ND HALF'
where id='17750000-0000-4000-8000-000000000001';
select sync_leave_half_day_tasks((((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz));
select is((select assigned_to from client_followups where id='17780000-0000-4000-8000-000000000001'),
  '17740000-0000-4000-8000-000000000001'::uuid,'open CRM follow-up returns at cutoff');
select is((select assigned_to[1] from fms_instance_stages where id='177c0000-0000-4000-8000-000000000001'),
  '17740000-0000-4000-8000-000000000001'::uuid,'open FMS work returns at cutoff');
select ok((select assigned_to @> array['17740000-0000-4000-8000-000000000001'::uuid,'17740000-0000-4000-8000-000000000003'::uuid]
  and not assigned_to @> array['17740000-0000-4000-8000-000000000002'::uuid]
  from fms_instance_stages where id='177c0000-0000-4000-8000-000000000002'),'shared FMS stage restores doer without removing coworker');

select * from finish();
rollback;
