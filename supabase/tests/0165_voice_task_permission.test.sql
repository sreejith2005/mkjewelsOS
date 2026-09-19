begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(9);

select is((select kind from permission_catalog where key='tasks.voice_assign'),'action','voice assignment is a configurable action permission');
select is((select default_roles from permission_catalog where key='tasks.voice_assign'),'{super_admin,admin,manager,hr}'::user_role[],'voice assignment defaults to super admin, admin, manager and hr');
select is((select default_roles from permission_catalog where key='tasks.manage_team'),'{super_admin,admin,manager}'::user_role[],'tasks.manage_team authority is not widened to hr');

-- A tenant with one profile per role, resolved through the same function the
-- edge worker reaches via has_permission().
insert into auth.users(id,instance_id,aud,role,email) values
  ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','voice-sa@example.test'),
  ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','voice-mgr@example.test'),
  ('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','voice-hr@example.test'),
  ('00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','voice-staff@example.test'),
  ('00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','voice-crm@example.test');
insert into tenants(id,name,slug) values ('00000000-0000-0000-0000-00000000b001','Voice Tenant','voice-tenant');
insert into branches(id,tenant_id,name,code) values ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000b001','Main','VMAIN');
insert into departments(id,tenant_id,branch_id,name,code) values ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000b002','Customer Relations','VCRM');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,email,employee_code,employee_name,first_name,user_role,account_status,working_status) values
  ('00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000b003','voice-sa@example.test','V-1','Voice SA','Voice','super_admin','active','active'),
  ('00000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000b003','voice-mgr@example.test','V-2','Voice Manager','Voice','manager','active','active'),
  ('00000000-0000-0000-0000-00000000c003','00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000b003','voice-hr@example.test','V-3','Voice HR','Voice','hr','active','active'),
  ('00000000-0000-0000-0000-00000000c004','00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000b003','voice-staff@example.test','V-4','Voice Staff','Voice','staff','active','active'),
  ('00000000-0000-0000-0000-00000000c005','00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000b003','voice-crm@example.test','V-5','Voice CRM','Voice','crm','active','active');

select ok(permission_effective_for('00000000-0000-0000-0000-00000000c001','tasks.voice_assign'),'super admin may assign by voice');
select ok(permission_effective_for('00000000-0000-0000-0000-00000000c002','tasks.voice_assign'),'manager may assign by voice');
select ok(permission_effective_for('00000000-0000-0000-0000-00000000c003','tasks.voice_assign'),'hr may assign by voice');
select ok(not permission_effective_for('00000000-0000-0000-0000-00000000c004','tasks.voice_assign'),'staff may not assign by voice');
select ok(not permission_effective_for('00000000-0000-0000-0000-00000000c005','tasks.voice_assign'),'crm may not assign by voice');

-- The worker asks as the caller; has_permission is the resolver authenticated
-- users are granted, unlike permission_effective_for.
select ok(has_function_privilege('authenticated','public.has_permission(text)','EXECUTE'),'the worker can check the caller through has_permission');

select * from finish();
rollback;
