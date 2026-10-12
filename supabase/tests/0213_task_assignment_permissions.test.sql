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

select ok(not has_function_privilege('anon','list_task_assignment_users()','EXECUTE'),'anonymous cannot list task assignees');
select ok(not has_function_privilege('service_role','list_task_assignment_users()','EXECUTE'),'service role has no assignment roster grant');
select ok(not has_function_privilege('authenticated','task_assignment_scope()','EXECUTE'),'scope helper is private');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000004',true);
select is((select count(*) from user_profiles),1::bigint,'manager directory stays restricted without reporting links');
select is((select count(*) from list_task_assignment_users()),7::bigint,'manager can pick all branch peers without reporting links');
select ok(exists(select 1 from list_task_assignment_users() where id='15640000-0000-4000-8000-000000000008'),'manager can pick another department in own branch');
select ok(not exists(select 1 from list_task_assignment_users() where id='15640000-0000-4000-8000-000000000006'),'manager cannot pick another branch');
select ok(not exists(select 1 from list_task_assignment_users() u where to_jsonb(u) ? 'email' or to_jsonb(u) ? 'personal_mobile'),'roster returns no contact data');
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000008')$$,'manager creates task for branch peer outside reporting tree');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000006')$$,'42501',null,'manager cannot bypass branch scope with direct RPC');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000009')$$,'42501',null,'cross tenant task creation blocked');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select is((select count(*) from list_task_assignment_users()),7::bigint,'staff retains department peers across branches');
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000006')$$,'staff can still assign across branches within department');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000008')$$,'42501',null,'staff cannot assign another department directly');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000007',true);
select is((select count(*) from list_task_assignment_users()),8::bigint,'Process Coordinator retains company roster');
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000008')$$,'Process Coordinator retains company assignment');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000003',true);
select is((select count(*) from list_task_assignment_users()),8::bigint,'Admin roster stays within tenant');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005','{}','manager')$$,'grant manager dashboard authority to staff');
select set_config('test.assignment.schedule',pg_temp.schedule_fixture('15640000-0000-4000-8000-000000000008')::text,true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"tasks.assign_others":"deny"}')$$,'Super Admin denies department assignment');
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"forms.manage":"grant"}')$$,'22023',null,'other department actions remain forbidden');
select ok(exists(select 1 from jsonb_array_elements(get_user_access_breakdown('15640000-0000-4000-8000-000000000005')->'rows') r where r->>'key'='tasks.assign_others' and r->>'department'='deny' and r->>'effective'='false'),'access breakdown includes assignment department decision');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select is((select count(*) from list_task_assignment_users()),1::bigint,'denied assignment returns self only even with elevated authority');
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000005')$$,'denial preserves self task creation');
select throws_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000008')$$,'42501','Assigning tasks to other users is denied','denial enforced in task RPC');
select throws_ok($$select pg_temp.schedule_fixture('15640000-0000-4000-8000-000000000008')$$,'42501','Assigning tasks to other users is denied','recurring creation cannot bypass denial');
select lives_ok($$select pg_temp.schedule_fixture('15640000-0000-4000-8000-000000000005')$$,'denial preserves self recurring schedule');
select lives_ok($$select pg_temp.schedule_fixture('15640000-0000-4000-8000-000000000008',current_setting('test.assignment.schedule')::uuid)$$,'denial does not remove metadata editing authority for existing schedules');
select throws_ok($$select pg_temp.schedule_fixture('15640000-0000-4000-8000-000000000004',current_setting('test.assignment.schedule')::uuid)$$,'42501','Assigning tasks to other users is denied','schedule reassignment cannot bypass denial');
select throws_ok($$select use_task_template_with_audit(current_setting('test.assignment.schedule')::uuid,now()+interval '3 days')$$,'42501','Assigning tasks to other users is denied','manual template use cannot bypass denial');
select throws_ok($$select run_recurring_todo_template_now_with_audit(current_setting('test.assignment.schedule')::uuid,current_date+3)$$,'42501','Assigning tasks to other users is denied','manual recurring run cannot bypass denial');
select throws_ok($$select assign_imported_task_with_audit('task','15670000-0000-4000-8000-000000000001','15640000-0000-4000-8000-000000000008')$$,'42501','Assigning tasks to other users is denied','import assignment cannot bypass denial');
select throws_ok($$select assign_imported_task_with_audit_v0104('task','15670000-0000-4000-8000-000000000001','15640000-0000-4000-8000-000000000008')$$,'42501',null,'legacy import assignment cannot bypass denial');
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"tasks.assign_others":"grant"}')$$,'42501',null,'ordinary/elevated manager cannot change assignment permission');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005','{"tasks.assign_others":"grant"}','manager')$$,'individual grant wins over department denial');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select is((select count(*) from list_task_assignment_users()),7::bigint,'elevated staff uses Manager branch roster including other departments');
select lives_ok($$select pg_temp.assign_fixture('15640000-0000-4000-8000-000000000008')$$,'elevated staff can persist task to branch peer');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"tasks.assign_others":null}')$$,'department inherit removes assignment override');
select lives_ok($$select save_role_permissions_with_audit('manager','{"tasks.assign_others":false}')$$,'role assignment default can be denied');
select lives_ok($$select save_designation_permissions_with_audit('15650000-0000-4000-8000-000000000001','{"tasks.assign_others":"deny"}')$$,'designation assignment can be denied');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000004',true);
select is((select count(*) from list_task_assignment_users()),1::bigint,'role denial affects Manager roster');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000007',true);
select is((select count(*) from list_task_assignment_users()),1::bigint,'designation denial affects Process Coordinator roster');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select is((select count(*) from list_task_assignment_users()),8::bigint,'Super Admin assignment retained');
select lives_ok($$select save_role_permissions_with_audit('manager','{"tasks.assign_others":null}')$$,'restore role inherit');
select set_config('test.assignment.task',pg_temp.assign_fixture('15640000-0000-4000-8000-000000000005')::text,true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005','{"tasks.assign_others":"deny"}','manager')$$,'deny individual after task assignment');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select throws_ok($$select delegate_task_with_audit(current_setting('test.assignment.task')::uuid,'15640000-0000-4000-8000-000000000005','15640000-0000-4000-8000-000000000004','Synthetic transfer')$$,'42501','Assigning tasks to other users is denied','delegation cannot bypass denial');
reset role;
select ok(exists(select 1 from audit_logs where action='delegation_task_created' and tenant_id='15610000-0000-4000-8000-000000000001'),'successful task creation remains audited');
select ok(exists(select 1 from notifications where source_record_id=current_setting('test.assignment.task')::uuid),'successful assignment still produces alert');
select ok(exists(select 1 from task_assignees where task_instance_id=current_setting('test.assignment.task')::uuid and user_profile_id='15640000-0000-4000-8000-000000000005' and is_active),'failed transfer preserves original assignment');
select ok(not exists(select 1 from audit_logs where record_id=current_setting('test.assignment.task')::uuid and action='task_doer_transferred'),'failed transfer leaves no audit mutation');
update user_profiles set account_status='inactive' where id='15640000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select throws_ok($$select list_task_assignment_users()$$,'42501',null,'inactive actor denied roster');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select list_task_assignment_users()$$,'42501',null,'missing identity denied roster');
reset role;
select * from finish();
rollback;
