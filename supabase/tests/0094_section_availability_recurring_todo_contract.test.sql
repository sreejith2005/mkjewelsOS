begin;
select plan(1);
set search_path = public, extensions;

insert into auth.users(id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('94000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'section-availability-reader@example.invalid', crypt('local-test-only', gen_salt('bf')), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into tenants(id, name, slug) values ('94100000-0000-4000-8000-000000000001', 'Section availability reader fixture', 'section-availability-reader-fixture');
insert into branches(id, tenant_id, name, code) values ('94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'Section availability branch', 'SA-B');
insert into departments(id, tenant_id, branch_id, name, code) values ('94300000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', 'Section availability department', 'SA-D');
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
values ('94400000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', 'Section availability reader', '0000009401', 'section-availability-reader@example.invalid', 'SA-R', 'staff', 'active', 'active', true, '{}');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select is(
  (get_section_availability() -> 'section_availability' ->> 'recurring_todo')::boolean,
  true,
  'Authenticated section-availability reads include the Recurring / To-Do page'
);
reset role;

select * from finish();
rollback;
