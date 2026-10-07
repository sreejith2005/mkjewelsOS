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



set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"grant"}')$$,'enable department CRM');
reset role;
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000008')->>'crm_role','salesperson','HR ordinary employee maps to salesperson');
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000008')->>'eligible','true','HR with department grant is eligible');
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000004')->>'crm_role','branch_manager','manager mapping unchanged');
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000001')->>'crm_role','super_admin','Super Admin mapping unchanged');
select is((select count(*)::integer from crm_sync.outbox where aggregate_id in (select id from user_profiles where tenant_id='15610000-0000-4000-8000-000000000001') and delivered_at is null),8,'department grant queues affected employees');
update user_profiles set user_role='doer' where id='15640000-0000-4000-8000-000000000008';
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000008')->>'eligible','true','doer with department grant is eligible');
update user_profiles set user_role='housekeeping' where id='15640000-0000-4000-8000-000000000008';
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000008')->>'eligible','true','housekeeping with explicit department grant is eligible');
update departments set is_active=false where id='15630000-0000-4000-8000-000000000001';
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000008')->>'eligible','false','inactive department stops grant eligibility');
update departments set is_active=true where id='15630000-0000-4000-8000-000000000001';
insert into departments(id,tenant_id,branch_id,name,code) values('15630000-0000-4000-8000-000000000002','15610000-0000-4000-8000-000000000001','15620000-0000-4000-8000-000000000001','Other department','OTHER');
update user_profiles set department_id='15630000-0000-4000-8000-000000000002' where id='15640000-0000-4000-8000-000000000008';
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000008')->>'eligible','false','moving out removes department eligibility');

-- A changed department must create fresh delivery events, including revocations.
update crm_sync.outbox set delivered_at=now() where aggregate_id in(select id from user_profiles where tenant_id='15610000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"deny"}')$$,'revoke department CRM');
reset role;
select is((select count(*)::integer from crm_sync.outbox where aggregate_id in(select id from user_profiles where department_id='15630000-0000-4000-8000-000000000001') and delivered_at is null),7,'revocation queues all remaining department members');
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000005')->>'eligible','false','staff revocation is reflected at claim time');
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000004')->>'eligible','false','manager department revocation is respected');
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000001')->>'eligible','true','Super Admin remains eligible');
update crm_sync.outbox set delivered_at=now() where aggregate_id in(select id from user_profiles where tenant_id='15610000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":null}')$$,'restore department inherit');
reset role;
select is((select count(*)::integer from crm_sync.outbox where aggregate_id in(select id from user_profiles where department_id='15630000-0000-4000-8000-000000000001') and delivered_at is null),7,'inherit queues all remaining department members');
select is(crm_sync.staff_snapshot('15640000-0000-4000-8000-000000000004')->>'eligible','true','manager default restored after department reset');
select * from finish();
rollback;
