begin;
select plan(12);

-- The approved contract never auto-assigns a reporting manager. It routes an
-- absent original through primary then secondary buddy for the exact work date,
-- including dates beyond the former today/tomorrow window.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',email,crypt('local-test-only',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from (values
  ('86000000-0000-4000-8000-000000000001'::uuid,'coverage-86-manager@example.invalid'),
  ('86000000-0000-4000-8000-000000000002'::uuid,'coverage-86-original@example.invalid'),
  ('86000000-0000-4000-8000-000000000003'::uuid,'coverage-86-primary@example.invalid'),
  ('86000000-0000-4000-8000-000000000004'::uuid,'coverage-86-secondary@example.invalid')
) fixture(id,email);
insert into tenants(id,name,slug) values('86100000-0000-4000-8000-000000000001','Coverage 86 Fixture','coverage-86-fixture');
insert into branches(id,tenant_id,name,code) values('86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','Coverage 86 Branch','CV86');
insert into departments(id,tenant_id,branch_id,name,code) values('86300000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','Coverage 86 Department','CV86D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
values
 ('86400000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001','Coverage 86 Manager','0000008601','coverage-86-manager@example.invalid','CV86-1','manager','active','active',true,'{}'),
 ('86400000-0000-4000-8000-000000000002','86000000-0000-4000-8000-000000000002','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001','Coverage 86 Original','0000008602','coverage-86-original@example.invalid','CV86-2','doer','active','active',true,'{}'),
 ('86400000-0000-4000-8000-000000000003','86000000-0000-4000-8000-000000000003','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001','Coverage 86 Primary','0000008603','coverage-86-primary@example.invalid','CV86-3','doer','active','active',true,'{}'),
 ('86400000-0000-4000-8000-000000000004','86000000-0000-4000-8000-000000000004','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001','Coverage 86 Secondary','0000008604','coverage-86-secondary@example.invalid','CV86-4','doer','active','active',true,'{}');
update user_profiles set buddy_id='86400000-0000-4000-8000-000000000003',secondary_buddy_id='86400000-0000-4000-8000-000000000004',reports_to_user_id='86400000-0000-4000-8000-000000000001'
where id='86400000-0000-4000-8000-000000000002';

insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by)
values
 ('86100000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+2,'absent','fixture', '86400000-0000-4000-8000-000000000001'),
 ('86100000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000003',(now() at time zone 'Asia/Kolkata')::date+2,'absent','fixture', '86400000-0000-4000-8000-000000000001');

select is((select resolution from resolve_task_coverage('86400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+2)), 'secondary_buddy', 'future absence falls through from absent primary to secondary buddy');
select is((select effective_assignee_id from resolve_task_coverage('86400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+2)), '86400000-0000-4000-8000-000000000004'::uuid, 'secondary buddy is the effective future assignee');

insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
values('86500000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001','delegation','Future coverage task','pending',((((now() at time zone 'Asia/Kolkata')::date+2)::text)||' 18:00 Asia/Kolkata')::timestamptz,'86400000-0000-4000-8000-000000000001');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('86500000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000002','doer',true,true);
select ok(exists(select 1 from task_assignees where task_instance_id='86500000-0000-4000-8000-000000000001' and user_profile_id='86400000-0000-4000-8000-000000000004' and is_active), 'future ordinary task activates secondary buddy');

insert into clients(id,tenant_id,branch_id,phone,first_name,assigned_crm_id)
values('86600000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','0000008605','Coverage 86 Client','86400000-0000-4000-8000-000000000002');
insert into client_followups(id,client_id,tenant_id,branch_id,assigned_to,due_date,status,subject,created_by)
values('86700000-0000-4000-8000-000000000001','86600000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+2,'open','Future coverage follow-up','86400000-0000-4000-8000-000000000001');
select is((select assigned_to from client_followups where id='86700000-0000-4000-8000-000000000001'), '86400000-0000-4000-8000-000000000004'::uuid, 'future CRM follow-up activates secondary buddy');

insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by)
values('86100000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000004',(now() at time zone 'Asia/Kolkata')::date+2,'absent','fixture', '86400000-0000-4000-8000-000000000001');
select is((select effective_assignee_id from resolve_task_coverage('86400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+2)), null::uuid, 'unavailable primary and secondary leave coverage required instead of assigning manager');
select ok(position('reports_to_user_id' in pg_get_functiondef('public.resolve_task_coverage(uuid,date)'::regprocedure)) = 0, 'resolver does not automatically choose the reporting manager');
select ok(position('not between v_today and v_today+1' in pg_get_functiondef('public.resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure)) = 0, 'FMS assignment resolution is not limited to today or tomorrow');
select ok(position('not between v_today and v_today+1' in pg_get_functiondef('public.apply_task_assignment_coverage()'::regprocedure)) = 0, 'ordinary task assignment is not limited to today or tomorrow');

-- Existing work can be planned before its actual deadline. It must still move
-- to coverage when the original assignee becomes absent on that deadline date.
update user_availability set status='present'
where user_profile_id='86400000-0000-4000-8000-000000000004'
  and date=(now() at time zone 'Asia/Kolkata')::date+2;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,due_datetime,created_by)
values('86500000-0000-4000-8000-000000000002','86100000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001','delegation','Earlier planned coverage task','pending',((((now() at time zone 'Asia/Kolkata')::date+1)::text)||' 09:00 Asia/Kolkata')::timestamptz,((((now() at time zone 'Asia/Kolkata')::date+2)::text)||' 18:00 Asia/Kolkata')::timestamptz,'86400000-0000-4000-8000-000000000001');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('86500000-0000-4000-8000-000000000002','86400000-0000-4000-8000-000000000002','doer',true,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','86000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select record_availability_with_audit('86400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+2,'absent','mid-day absence');
select ok(exists(select 1 from task_assignees where task_instance_id='86500000-0000-4000-8000-000000000002' and user_profile_id='86400000-0000-4000-8000-000000000004' and is_active), 'existing task due today moves to the available buddy');
select ok(not exists(select 1 from task_assignees where task_instance_id='86500000-0000-4000-8000-000000000002' and user_profile_id='86400000-0000-4000-8000-000000000002' and is_active), 'existing absent assignee no longer has the due-today task');

-- Returning an employee to present must restore their unfinished work, even if
-- it was already moved to a buddy while they were absent.
select record_availability_with_audit('86400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+2,'present','returned to work');
select ok(exists(select 1 from task_assignees where task_instance_id='86500000-0000-4000-8000-000000000001' and user_profile_id='86400000-0000-4000-8000-000000000002' and is_active), 'present original assignee regains the task');
select ok(not exists(select 1 from task_assignees where task_instance_id='86500000-0000-4000-8000-000000000001' and user_profile_id='86400000-0000-4000-8000-000000000004' and is_active), 'buddy coverage ends when the original assignee returns');

select * from finish();
rollback;
