begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

-- Owner report 2026-10-30: assigning one task to two people failed with
-- 'duplicate key value violates unique constraint "idx_task_assignees_one_active_doer"'
-- when one chosen person was absent and the other chosen person is their buddy.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',email,crypt('local-test-only',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from (values
  ('35700000-0000-4000-8000-000000000001'::uuid,'cover-357-admin@example.invalid'),
  ('35700000-0000-4000-8000-000000000002'::uuid,'cover-357-absent@example.invalid'),
  ('35700000-0000-4000-8000-000000000003'::uuid,'cover-357-buddy@example.invalid'),
  ('35700000-0000-4000-8000-000000000004'::uuid,'cover-357-other@example.invalid')
) fixture(id,email);
insert into tenants(id,name,slug) values('35710000-0000-4000-8000-000000000001','Cover 357 Fixture','cover-357-fixture');
insert into branches(id,tenant_id,name,code) values('35720000-0000-4000-8000-000000000001','35710000-0000-4000-8000-000000000001','Cover 357 Branch','CV357');
insert into departments(id,tenant_id,branch_id,name,code) values('35730000-0000-4000-8000-000000000001','35710000-0000-4000-8000-000000000001','35720000-0000-4000-8000-000000000001','Cover 357 Department','CV357D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
select ('35740000-0000-4000-8000-00000000000'||n)::uuid,('35700000-0000-4000-8000-00000000000'||n)::uuid,
  '35710000-0000-4000-8000-000000000001','35720000-0000-4000-8000-000000000001','35730000-0000-4000-8000-000000000001',
  name,'000035700'||n,email,'CV357-'||n,role::user_role,'active','active',true,'{}'
from (values
  (1,'Cover 357 Admin','cover-357-admin@example.invalid','super_admin'),
  (2,'Cover 357 Absent','cover-357-absent@example.invalid','staff'),
  (3,'Cover 357 Buddy','cover-357-buddy@example.invalid','staff'),
  (4,'Cover 357 Other','cover-357-other@example.invalid','staff')
) f(n,name,email,role);
-- Absent (2) is covered by Buddy (3).
update user_profiles set buddy_id='35740000-0000-4000-8000-000000000003' where id='35740000-0000-4000-8000-000000000002';
insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by)
values('35710000-0000-4000-8000-000000000001','35740000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+3,'absent','fixture','35740000-0000-4000-8000-000000000001');

-- Same request the Tasks screen sends.
create function pg_temp.create_for(p_doers uuid[]) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  return create_manual_task_with_mode_with_audit(jsonb_build_object('title','Two-person assignment',
    'planned_datetime',(((now() at time zone 'Asia/Kolkata')::date+3)::text||' 18:00 Asia/Kolkata')::timestamptz,
    'priority','medium','branch_id','35720000-0000-4000-8000-000000000001','department_id','35730000-0000-4000-8000-000000000001',
    'task_type','delegation','requires_form',false,'form_template_id',null),p_doers,'{}'::uuid[],'[]'::jsonb);
end $$;
grant execute on function pg_temp.create_for(uuid[]) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','35700000-0000-4000-8000-000000000001',true);

-- 1. Absent person first, their buddy second: the reported failure.
select lives_ok($$select set_config('test.cover.a',pg_temp.create_for(array['35740000-0000-4000-8000-000000000002','35740000-0000-4000-8000-000000000003']::uuid[])::text,true)$$,
  'assigning an absent person and their buddy together succeeds');
reset role;
select is((select count(*) from task_assignees where task_instance_id=current_setting('test.cover.a')::uuid and user_profile_id='35740000-0000-4000-8000-000000000003' and is_active),1::bigint,
  'buddy is an active doer exactly once');
select ok(exists(select 1 from task_assignees where task_instance_id=current_setting('test.cover.a')::uuid and user_profile_id='35740000-0000-4000-8000-000000000003' and is_active and is_original),
  'buddy holds the task as their own original assignment');
select ok(not exists(select 1 from task_assignees where task_instance_id=current_setting('test.cover.a')::uuid and user_profile_id='35740000-0000-4000-8000-000000000002' and is_active),
  'absent person is not an active doer on their leave day');
select is((select coverage_original_assignee_id from task_instances where id=current_setting('test.cover.a')::uuid),'35740000-0000-4000-8000-000000000002'::uuid,
  'task still records whose work is being covered');
select ok(exists(select 1 from audit_logs where record_id=current_setting('test.cover.a')::uuid and action='delegation_task_created'),
  'creation is audited');
select is((select count(*) from notifications where user_profile_id='35740000-0000-4000-8000-000000000003' and source_record_id=current_setting('test.cover.a')::uuid and event_type='task_assigned'),1::bigint,
  'buddy receives one assignment alert, not a duplicate');

-- 2. Buddy first, absent person second.
set local role authenticated;
select lives_ok($$select set_config('test.cover.b',pg_temp.create_for(array['35740000-0000-4000-8000-000000000003','35740000-0000-4000-8000-000000000002']::uuid[])::text,true)$$,
  'reverse order succeeds');
reset role;
select is((select count(*) from task_assignees where task_instance_id=current_setting('test.cover.b')::uuid and user_profile_id='35740000-0000-4000-8000-000000000003' and is_active),1::bigint,
  'reverse order also leaves the buddy active once');

-- 3. Ordinary two-person assignment is unchanged.
set local role authenticated;
select lives_ok($$select set_config('test.cover.c',pg_temp.create_for(array['35740000-0000-4000-8000-000000000003','35740000-0000-4000-8000-000000000004']::uuid[])::text,true)$$,
  'two available people can share a task');
reset role;
select is((select count(*) from task_assignees where task_instance_id=current_setting('test.cover.c')::uuid and is_active and is_original),2::bigint,
  'both available people are active original doers');

-- 4. Adding the buddy afterwards (task edit, import, any other path) also works.
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
values('35750000-0000-4000-8000-000000000001','35710000-0000-4000-8000-000000000001','35720000-0000-4000-8000-000000000001','35730000-0000-4000-8000-000000000001','delegation','Later edit','pending',
  (((now() at time zone 'Asia/Kolkata')::date+3)::text||' 18:00 Asia/Kolkata')::timestamptz,'35740000-0000-4000-8000-000000000001');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('35750000-0000-4000-8000-000000000001','35740000-0000-4000-8000-000000000002','doer',true,true);
select ok(exists(select 1 from task_assignees where task_instance_id='35750000-0000-4000-8000-000000000001' and user_profile_id='35740000-0000-4000-8000-000000000003' and is_active and not is_original),
  'buddy first joins as cover');
update task_assignees set completed_at=now()
where task_instance_id='35750000-0000-4000-8000-000000000001' and user_profile_id='35740000-0000-4000-8000-000000000003' and is_active;
select lives_ok($$insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
  values('35750000-0000-4000-8000-000000000001','35740000-0000-4000-8000-000000000003','doer',true,true)$$,
  'adding the covering buddy as a doer later succeeds');
select ok(exists(select 1 from task_assignees where task_instance_id='35750000-0000-4000-8000-000000000001' and user_profile_id='35740000-0000-4000-8000-000000000003' and is_active and is_original and completed_at is not null),
  'work finished as cover stays finished');

-- 5. When the absent person returns, the buddy keeps their own assignment.
set local role authenticated;
select lives_ok($$select record_availability_with_audit('35740000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date+3,'present','returned')$$,
  'absent person can be marked present again');
reset role;
select ok(exists(select 1 from task_assignees where task_instance_id=current_setting('test.cover.a')::uuid and user_profile_id='35740000-0000-4000-8000-000000000003' and is_active),
  'buddy keeps their own assignment after the absent person returns');

select * from finish();
rollback;
