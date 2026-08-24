begin;
select plan(3);
set search_path = public, extensions;

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('93000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'section-admin@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('93000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'section-super@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into tenants(id, name, slug) values ('93100000-0000-4000-8000-000000000001', 'Section controls fixture', 'section-controls-fixture');
insert into branches(id, tenant_id, name, code) values ('93200000-0000-4000-8000-000000000001', '93100000-0000-4000-8000-000000000001', 'Section branch', 'SC-B');
insert into departments(id, tenant_id, branch_id, name, code) values ('93300000-0000-4000-8000-000000000001', '93100000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000001', 'Section department', 'SC-D');
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
values
  ('93400000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '93100000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000001', '93300000-0000-4000-8000-000000000001', 'Section Admin', '0000009301', 'section-admin@example.invalid', 'SC-A', 'admin', 'active', 'active', true, '{}'),
  ('93400000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', '93100000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000001', '93300000-0000-4000-8000-000000000001', 'Section Super Admin', '0000009302', 'section-super@example.invalid', 'SC-S', 'super_admin', 'active', 'active', true, '{}');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select save_section_availability_with_audit(true, jsonb_build_object('crm', false), 0, '93500000-0000-4000-8000-000000000001')$$,
  '42501', 'Section controls denied', 'Admin cannot change section maintenance controls'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select save_section_availability_with_audit(true, jsonb_build_object('crm', false), 0, '93500000-0000-4000-8000-000000000002')$$,
  'Super Admin can change section maintenance controls'
);
select ok(exists(
  select 1 from audit_logs
  where tenant_id = '93100000-0000-4000-8000-000000000001'
    and actor_user_id = '93400000-0000-4000-8000-000000000002'
    and action = 'section_availability_saved'
), 'Super Admin control save writes an audit row');
reset role;

select * from finish();
rollback;
