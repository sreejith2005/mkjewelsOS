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


select has_table('public','department_permission_overrides','department rules exist');
select ok(not has_table_privilege('authenticated','department_permission_overrides','INSERT'), 'no direct client writes');
select ok(not has_function_privilege('service_role','save_department_permissions_with_audit(uuid,jsonb)','EXECUTE'),'service role cannot manage department rules');
select ok(not has_function_privilege('anon','save_user_section_access_with_audit(uuid,jsonb)','EXECUTE'),'anon cannot manage sections');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"grant"}')$$,'Super Admin grants CRM department');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select ok(has_permission('crm.view'),'Staff department receives CRM');
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"deny"}')$$,'42501','Permission management denied','Staff cannot change department access');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_user_access_with_audit('15640000-0000-4000-8000-000000000005','{"forms.manage":"grant"}','manager')$$,'assign authority and action');
select lives_ok($$select save_user_section_access_with_audit('15640000-0000-4000-8000-000000000005','{"crm.view":"deny"}')$$,'deny one user');
select is(get_user_access_breakdown('15640000-0000-4000-8000-000000000005')->>'dashboard_authority','manager','section save preserves authority');
select ok(exists(select 1 from jsonb_array_elements(get_user_access_breakdown('15640000-0000-4000-8000-000000000005')->'rows') r where r->>'key'='forms.manage' and r->>'user'='grant'),'section save preserves action override');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select ok(not has_permission('crm.view'),'individual deny beats department grant');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"deny"}')$$,'deny department');
select lives_ok($$select save_user_section_access_with_audit('15640000-0000-4000-8000-000000000005','{"crm.view":"grant"}')$$,'grant one user');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select ok(has_permission('crm.view'),'individual grant beats department deny');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000004',true);
select ok(not has_permission('crm.view'),'department deny beats manager default');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select ok(has_permission('crm.view'),'Super Admin retains access');
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"forms.manage":"grant"}')$$,'22023','Only section permissions can be configured','department cannot grant actions');
select throws_ok($$select save_user_section_access_with_audit('15640000-0000-4000-8000-000000000005','{"permissions.manage":"grant"}')$$,'22023','Only section permissions can be configured','individual section editor cannot grant protected permissions');
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":true}')$$,'22023','Override values must be grant, deny, or null','reject invalid payload');
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000099','{"crm.view":"grant"}')$$,'42501','Department not found or not accessible','reject inaccessible department');
select throws_ok($$select save_user_section_access_with_audit('15640000-0000-4000-8000-000000000001','{"crm.view":"deny"}')$$,'42501','You cannot change your own access; ask another Super Admin','retain self protection');
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":null}')$$,'inherit deletes department rule');
select lives_ok($$select save_user_section_access_with_audit('15640000-0000-4000-8000-000000000005','{"crm.view":null}')$$,'inherit deletes individual rule');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000004',true);
select ok(has_permission('crm.view'),'inherit restores role default');
reset role;
select ok(exists(select 1 from audit_logs where action='department_permissions_saved' and record_id='15630000-0000-4000-8000-000000000001'),'department changes audited');
select ok(exists(select 1 from audit_logs where action='user_access_saved' and new_value->'permissions'->>'crm.view'='deny'),'individual changes audited');

-- Same names in another branch/tenant must never broaden a department rule.
insert into tenants(id,name,slug) values('15610000-0000-4000-8000-000000000002','Other tenant','other-permission-tenant');
insert into branches(id,tenant_id,name,code) values('15620000-0000-4000-8000-000000000002','15610000-0000-4000-8000-000000000002','Other branch','OTHER');
insert into departments(id,tenant_id,branch_id,name,code) values('15630000-0000-4000-8000-000000000002','15610000-0000-4000-8000-000000000002','15620000-0000-4000-8000-000000000002','Permissions department','PERM-D');
select is(production_demo_data_retirement_manifest('15610000-0000-4000-8000-000000000001')->'retained_counts'->>'department_permission_overrides','0','permission config is retained by retirement manifest');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000002','{"crm.view":"grant"}')$$,'42501','Department not found or not accessible','Super Admin cannot write another tenant');
select ok(not exists(select 1 from jsonb_array_elements(get_permission_admin_context()->'departments') d where d->>'id'='15630000-0000-4000-8000-000000000002'),'department admin metadata stays tenant scoped');
select set_config('test.department_audit_before',(select count(*) from audit_logs where tenant_id='15610000-0000-4000-8000-000000000001' and action='department_permissions_saved')::text,true);
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"grant","forms.manage":"grant"}')$$,'22023','Only section permissions can be configured','mixed invalid save fails atomically');
select ok(not exists(select 1 from jsonb_array_elements(get_permission_admin_context()->'department_overrides') o where o->>'department_id'='15630000-0000-4000-8000-000000000001' and o->>'key'='crm.view'),'invalid save rolls back earlier valid row');
select is((select count(*) from audit_logs where tenant_id='15610000-0000-4000-8000-000000000001' and action='department_permissions_saved')::text,current_setting('test.department_audit_before'),'failed save leaves no audit event');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select throws_ok($$select save_user_section_access_with_audit('15640000-0000-4000-8000-000000000008','{"crm.view":"grant"}')$$,'42501','Permission management denied','ordinary direct RPC cannot manage another user');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"grant"}')$$,'enable department before designation test');
select lives_ok($$select save_designation_permissions_with_audit('15650000-0000-4000-8000-000000000001','{"crm.view":"deny"}')$$,'deny designation');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000007',true);
select ok(has_permission('crm.view'),'department beats designation');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select lives_ok($$select save_section_availability_with_audit(false,'{"crm":false}',0,'15660000-0000-4000-8000-000000000001')$$,'global CRM maintenance switch');
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000005',true);
select ok(not module_accessible('crm',false),'global disable beats department grant for direct access');
reset role;
select is((select count(*)::integer from department_permission_overrides where permission_key='forms.manage'),0,'invalid payload left no action row');
update departments set is_active=false where id='15630000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','15600000-0000-4000-8000-000000000001',true);
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"deny"}')$$,'42501','Department not found or not accessible','cannot save inactive department');
reset role;
update user_profiles set account_status='inactive' where id='15640000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"grant"}')$$,'42501',null,'inactive Super Admin cannot manage departments');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select save_department_permissions_with_audit('15630000-0000-4000-8000-000000000001','{"crm.view":"grant"}')$$,'42501',null,'no authenticated identity cannot manage departments');
reset role;

select * from finish();
rollback;
