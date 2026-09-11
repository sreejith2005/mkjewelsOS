begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

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

-- Catalog and privilege contract.
select has_table('public', 'permission_catalog', 'permission catalog exists');
select is((select count(*)::integer from permission_catalog), 29, 'catalog defines 29 permissions');
select ok(not has_function_privilege('authenticated', 'permission_effective_for(uuid,text)', 'EXECUTE'), 'resolving another profile''s permissions stays owner-only');
select throws_ok(
  $$insert into role_permissions(tenant_id, user_role, permission_key, is_allowed) values ('15610000-0000-4000-8000-000000000001', 'staff', 'permissions.manage', true)$$,
  '22023', 'Permission permissions.manage cannot be configured', 'protected permissions can never be stored as configuration');
select ok(exists (select 1 from pg_policies where tablename = 'clients' and policyname = 'clients_section_available' and permissive = 'RESTRICTIVE'), 'CRM tables carry a restrictive section policy');
select ok(position('current_profile()' in pg_get_functiondef('record_availability_with_audit(uuid,date,availability_status,text)'::regprocedure)) > 0, 'inline actor lookups now read current_profile()');
select ok(position('assert_module_access(''reports'')' in pg_get_functiondef('get_report_data(text,jsonb)'::regprocedure)) > 0, 'report data is section-gated');
select ok(position('has_permission(''crm.view'')' in pg_get_functiondef('assert_crm_actor()'::regprocedure)) > 0, 'CRM actor check uses the permission resolver');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Existing behaviour is preserved without any configuration.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000005', true);
select is(current_role_level(), 'staff'::user_role, 'Staff with no override acts as Staff');
select ok(has_permission('tasks.view'), 'Staff keep Tasks');
select ok(not has_permission('users.view'), 'Staff still cannot open Users');
select ok(not has_permission('permissions.manage'), 'Staff cannot manage permissions');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000004', true);
select ok(has_permission('crm.view'), 'Managers keep CRM');
select ok(not has_permission('users.manage'), 'Managers still cannot manage users');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000003', true);
select ok(has_permission('users.manage'), 'Admins keep user management');
select throws_ok($$select get_permission_admin_context()$$, '42501', 'Permission management denied', 'Admins cannot open permission management');
select throws_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005', '{}'::jsonb, 'manager')$$, '42501', 'Permission management denied', 'Admins cannot change access');

-- Dashboard authority: a Staff user acting as Manager.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005', '{}'::jsonb, 'manager')$$, 'Super Admin assigns Manager authority');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000005', true);
select is(current_role_level(), 'manager'::user_role, 'Staff + Manager authority acts as Manager');
select is((current_profile()).user_role, 'manager'::user_role, 'current_profile() carries the effective role');
select is(get_my_access_context() ->> 'base_role', 'staff', 'access context keeps the assigned role');
select ok(has_permission('crm.view'), 'Manager authority brings Manager section defaults');

-- Explicit user deny beats the authority default, including in the CRM contract.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005', '{"crm.view":"deny"}'::jsonb, 'manager')$$, 'Super Admin denies CRM to one user');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000005', true);
select ok(not has_permission('crm.view'), 'user deny wins');
select throws_ok($$select search_crm_clients('{}'::jsonb)$$, '42501', 'CRM access denied', 'denied user cannot call the CRM API directly');

-- Explicit user grant beyond the role, enforced by the availability contract.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000006', true);
select throws_ok($$select record_availability_with_audit('15640000-0000-4000-8000-000000000005', current_date + 30, 'present', 'fixture')$$, '42501', 'Availability cannot be recorded for this user', 'Staff cannot record availability for others');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000006', '{"availability.manage_others":"grant"}'::jsonb)$$, 'Super Admin grants one Staff user availability management');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000006', true);
select lives_ok($$select record_availability_with_audit('15640000-0000-4000-8000-000000000005', current_date + 30, 'present', 'fixture')$$, 'granted Staff user can record availability for others');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000008', '{"availability.manage_others":"deny"}'::jsonb)$$, 'Super Admin removes availability management from HR');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000008', true);
select throws_ok($$select record_availability_with_audit('15640000-0000-4000-8000-000000000005', current_date + 31, 'present', 'fixture')$$, '42501', 'Availability cannot be recorded for this user', 'denied HR user loses the capability on the server');

-- Designation layer, overridden by the user layer.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_designation_permissions_with_audit('15650000-0000-4000-8000-000000000001', '{"task_control.view":"grant"}'::jsonb)$$, 'Super Admin grants Task Control to Process Coordinators');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000007', true);
select ok(has_permission('task_control.view'), 'designation grant applies to a Staff Process Coordinator');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000007', '{"task_control.view":"deny"}'::jsonb)$$, 'Super Admin denies it to one coordinator');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000007', true);
select ok(not has_permission('task_control.view'), 'user deny beats designation grant');

-- Role matrix configuration and reset.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_role_permissions_with_audit('staff', '{"reports.export": false}'::jsonb)$$, 'Super Admin removes exports from the Staff role');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000006', true);
select ok(not has_permission('reports.export'), 'role configuration applies to Staff');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_role_permissions_with_audit('staff', '{"reports.export": null}'::jsonb)$$, 'Super Admin restores the default');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000006', true);
select ok(has_permission('reports.export'), 'default restored');

-- Super Admin protection.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select throws_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005', '{"permissions.manage":"grant"}'::jsonb, 'manager')$$, '22023', 'Permission permissions.manage cannot be configured', 'protected permissions cannot be granted');
select throws_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000001', '{}'::jsonb, 'admin')$$, '42501', 'You cannot change your own access; ask another Super Admin', 'a Super Admin cannot lock themselves out');
select throws_ok($$select save_role_permissions_with_audit('super_admin', '{"developer_mode.manage": false}'::jsonb)$$, '22023', 'Permission developer_mode.manage cannot be configured', 'Developer Mode management cannot be removed from Super Admins');
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000002', '{}'::jsonb, 'admin')$$, 'another Super Admin can be given Admin authority');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000002', true);
select throws_ok($$select get_permission_admin_context()$$, '42501', 'Permission management denied', 'lowered authority removes protected permissions');

-- Feature availability is enforced on the server, independently of the
-- Developer Mode strip, with the Super Admin bypass retained.
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_section_availability_with_audit(false, '{"reports": false}'::jsonb, 0, '15660000-0000-4000-8000-000000000001')$$, 'Super Admin disables Reports with the strip hidden');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000006', true);
select ok(not module_accessible('reports', false), 'Reports are unavailable to Staff');
select throws_ok($$select get_report_data('task_operations', '{}'::jsonb)$$, '42501', 'This section is currently unavailable', 'Staff cannot read report data through the API');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000003', true);
select throws_ok($$select get_report_data('task_operations', '{}'::jsonb)$$, '42501', 'This section is currently unavailable', 'Admins cannot read a disabled section either');
select set_config('request.jwt.claim.sub', '15600000-0000-4000-8000-000000000001', true);
select lives_ok($$select get_report_data('task_operations', '{}'::jsonb)$$, 'Super Admin keeps access to a disabled section');
select ok(module_accessible('crm', false), 'other sections stay available');

reset role;

-- Every permission change is audited.
select ok(exists (select 1 from audit_logs where tenant_id = '15610000-0000-4000-8000-000000000001' and action = 'user_access_saved'
  and record_id = '15640000-0000-4000-8000-000000000005' and new_value -> 'permissions' ->> 'crm.view' = 'deny'), 'user access changes are audited with old and new values');
select ok(exists (select 1 from audit_logs where tenant_id = '15610000-0000-4000-8000-000000000001' and action = 'role_permissions_saved'), 'role changes are audited');
select ok(exists (select 1 from audit_logs where tenant_id = '15610000-0000-4000-8000-000000000001' and action = 'designation_permissions_saved'), 'designation changes are audited');

select * from finish();
rollback;
