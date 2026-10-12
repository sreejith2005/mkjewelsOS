begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Another project/schema may define an enum with the same unqualified name.
create schema permission_metadata_fixture;
create type permission_metadata_fixture.user_role as enum ('staff', 'super_admin', 'crm_only');

-- Fixture: one tenant, one designation, and an account per authorization shape.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('15600000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'perm-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 8) n;

insert into tenants(id, name, slug) values ('15610000-0000-4000-8000-000000000001', 'Permissions fixture', 'permissions-fixture');
insert into branches(id, tenant_id, name, code) values ('15620000-0000-4000-8000-000000000001', '15610000-0000-4000-8000-000000000001', 'Permissions branch', 'PERM-B');
insert into departments(id, tenant_id, branch_id, name, code) values ('15630000-0000-4000-8000-000000000001', '15610000-0000-4000-8000-000000000001', '15620000-0000-4000-8000-000000000001', 'Permissions department', 'PERM-D');
insert into dropdown_masters(id, tenant_id, master_type, label, value, is_active)
values ('15650000-0000-4000-8000-000000000001', '15610000-0000-4000-8000-000000000001', 'designation', 'Process Coordinator', 'process_coordinator', true);

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, designation_id, working_status, account_status, is_login_enabled, week_off)
select ('15640000-0000-4000-8000-00000000000' || f.n)::uuid, ('15600000-0000-4000-8000-00000000000' || f.n)::uuid,
  '15610000-0000-4000-8000-000000000001', '15620000-0000-4000-8000-000000000001', '15630000-0000-4000-8000-000000000001',
  f.name, '00000156' || lpad(f.n::text, 2, '0'), 'perm-' || f.n || '@example.invalid', 'PERM-' || f.n, f.role::user_role,
  case when f.n = 7 then '15650000-0000-4000-8000-000000000001'::uuid end, 'active', 'active', true, '{}'
from (values
  (1, 'Perm Super Admin', 'super_admin'),
  (2, 'Perm Second Super Admin', 'super_admin'),
  (3, 'Perm Admin', 'admin'),
  (4, 'Perm Manager', 'manager'),
  (5, 'Perm Staff', 'staff'),
  (6, 'Perm Staff Two', 'staff'),
  (7, 'Perm Process Coordinator', 'staff'),
  (8, 'Perm HR', 'hr')
) as f(n, name, role);


-- assignment-behavior:begin
insert into branches(id,tenant_id,name,code) values ('15620000-0000-4000-8000-000000000002','15610000-0000-4000-8000-000000000001','Second branch','PERM-B2');
update departments set branch_id=null where id='15630000-0000-4000-8000-000000000001';
insert into departments(id,tenant_id,branch_id,name,code) values ('15630000-0000-4000-8000-000000000002','15610000-0000-4000-8000-000000000001','15620000-0000-4000-8000-000000000001','Second department','PERM-D2');
update user_profiles set branch_id='15620000-0000-4000-8000-000000000002' where id='15640000-0000-4000-8000-000000000006';
update user_profiles set department_id='15630000-0000-4000-8000-000000000002' where id='15640000-0000-4000-8000-000000000008';
insert into tenants(id,name,slug) values('15610000-0000-4000-8000-000000000002','Assignment other tenant','assignment-other-tenant');
insert into branches(id,tenant_id,name,code) values('15620000-0000-4000-8000-000000000003','15610000-0000-4000-8000-000000000002','Other tenant branch','OTHER');
insert into departments(id,tenant_id,branch_id,name,code) values('15630000-0000-4000-8000-000000000003','15610000-0000-4000-8000-000000000002','15620000-0000-4000-8000-000000000003','Other tenant department','OTHER');
insert into auth.users(id,aud,role,email,created_at,updated_at) values('15600000-0000-4000-8000-000000000009','authenticated','authenticated','assignment-9@example.invalid',now(),now());
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
values('15640000-0000-4000-8000-000000000009','15600000-0000-4000-8000-000000000009','15610000-0000-4000-8000-000000000002','15620000-0000-4000-8000-000000000003','15630000-0000-4000-8000-000000000003','Synthetic outsider','0000015609','assignment-9@example.invalid','ASSIGN-9','staff','active','active',true,'{}');

-- A test-only builder mirrors the real client request: scope from selected user.
create function pg_temp.assign_fixture(p_user uuid,p_watchers uuid[] default '{}') returns uuid
language plpgsql security definer set search_path=public as $$
declare u user_profiles;
begin
  select * into u from user_profiles where id=p_user;
  return create_manual_task_with_mode_with_audit(jsonb_build_object('title','Synthetic assignment regression',
    'planned_datetime',now()+interval '3 days','priority','medium','branch_id',u.branch_id,'department_id',u.department_id,
    'task_type','delegation','requires_form',false,'form_template_id',null),array[p_user],p_watchers,'[]');
end $$;
grant execute on function pg_temp.assign_fixture(uuid,uuid[]) to authenticated;

insert into dropdown_masters(id,tenant_id,master_type,label,value,is_active)
values('15650000-0000-4000-8000-000000000002','15610000-0000-4000-8000-000000000001','task_category','Assignment tests','assignment-tests',true);
create function pg_temp.schedule_fixture(p_user uuid,p_template uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare u user_profiles;
begin
  select * into u from user_profiles where id=p_user;
  return save_task_template_with_audit(p_template,jsonb_build_object('title','Synthetic schedule regression',
    'description','Synthetic metadata edit','recurrence_rule','RRULE:FREQ=DAILY;INTERVAL=1','planned_time','18:00','priority','medium',
    'branch_id',u.branch_id,'department_id',u.department_id,'category_id','15650000-0000-4000-8000-000000000002',
    'default_assignee_type','specific_user','default_assignee_user_id',p_user,'default_assignee_role',null,
    'requires_form',false,'form_template_id',null,'checklist_items','[]'::jsonb,'is_active',true));
end $$;
grant execute on function pg_temp.schedule_fixture(uuid,uuid) to authenticated;

-- Reproduce a plain employee explicitly granted assignment access.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005','{"tasks.assign_others":"grant"}',null)$$,'grant employee assignment without elevating authority');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select ok(not exists(select 1 from list_task_assignment_users() where user_role in ('super_admin','admin','manager')),'employee roster excludes protected management');
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000006')$$,'employee still assigns a colleague');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000001')$$,'42501',null,'direct API cannot assign Super Admin');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000003')$$,'42501',null,'direct API cannot assign Admin');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000004')$$,'42501',null,'direct API cannot assign Manager');
select set_config('test.protected.task',pg_temp.assign_fixture('15640000-0000-4000-8000-000000000005')::text,true);
select throws_ok($$select delegate_task_with_audit(current_setting('test.protected.task')::uuid,'15640000-0000-4000-8000-000000000005','15640000-0000-4000-8000-000000000004','Synthetic transfer')$$,'42501',null,'delegation cannot assign protected Manager');
reset role;
insert into dropdown_masters(id,tenant_id,master_type,label,value,is_active) values('15650000-0000-4000-8000-000000000003','15610000-0000-4000-8000-000000000001','designation','Company Owner','company_owner',true);
update user_profiles set designation_id='15650000-0000-4000-8000-000000000003' where id='15640000-0000-4000-8000-000000000007';
set local role authenticated;
select ok(not exists(select 1 from list_task_assignment_users() where id='15640000-0000-4000-8000-000000000007'),'owner designation hidden even with Staff role');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000007')$$,'42501',null,'direct API cannot assign Owner designation');
reset role;
update dropdown_masters set label='Director' where id='15650000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000007')$$,'42501',null,'Director designation protected');
reset role;
update user_profiles set designation_id=null where id='15640000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000007','{}','manager')$$,'target has elevated Manager authority');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select ok(not exists(select 1 from list_task_assignment_users() where id='15640000-0000-4000-8000-000000000007'),'elevated Manager target hidden');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000007')$$,'42501',null,'elevated Manager target blocked directly');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000004')$$,'Super Admin existing assignment authority retained');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000004',true);
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000004')$$,'Manager retains self assignment');
select throws_ok($$select pg_temp.schedule_fixture('15640000-0000-4000-8000-000000000007')$$,'42501',null,'specific schedule cannot assign elevated Manager');
select throws_ok($$select save_task_template_with_audit(null,jsonb_build_object(
  'title','Synthetic protected role schedule','recurrence_rule','RRULE:FREQ=DAILY;INTERVAL=1',
  'planned_time','18:00','priority','medium','branch_id','15620000-0000-4000-8000-000000000001',
  'department_id','15630000-0000-4000-8000-000000000001','category_id','15650000-0000-4000-8000-000000000002',
  'default_assignee_type','role','default_assignee_user_id',null,'default_assignee_role','manager',
  'requires_form',false,'checklist_items','[]'::jsonb,'is_active',true))$$,'42501',null,'Manager cannot create role schedule that could later assign other Managers');
select ok(not has_function_privilege('authenticated','task_assignment_recipient_allowed(uuid)','EXECUTE'),'recipient helper remains private');
select * from finish();
rollback;
