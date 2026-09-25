-- Original CRM port (0179-0184): privileges, identity bridge, fail-closed access,
-- branch scoping, admin-only audited link RPCs, the service-role ingest path, and that
-- the old JewelOS CRM tables are untouched.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
--   profiles 01 super_admin, 02 admin, 03 manager, 04 crm, 05 staff, 06 crm (unlinked),
--   07 crm (login disabled), 08 hr, 09 crm (JewelOS branch not linked to a CRM branch),
--   10 admin (other tenant), 11 crm (link target)
-- ---------------------------------------------------------------------------
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('01804000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
  'crm-0180-' || lpad(n::text, 2, '0') || '@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now()
from generate_series(1, 11) n;
insert into tenants(id, name, slug) values
('01801000-0000-4000-8000-000000000001', 'CRM 0180 tenant', 'crm-0180-one'),
('01801000-0000-4000-8000-000000000002', 'CRM 0180 other tenant', 'crm-0180-two');
insert into branches(id, tenant_id, name, code) values
('01802000-0000-4000-8000-000000000001', '01801000-0000-4000-8000-000000000001', 'JewelOS Bandra 0180', 'C180A'),
('01802000-0000-4000-8000-000000000002', '01801000-0000-4000-8000-000000000001', 'JewelOS Andheri 0180', 'C180B'),
('01802000-0000-4000-8000-000000000003', '01801000-0000-4000-8000-000000000001', 'JewelOS Head Office 0180', 'C180X'),
('01802000-0000-4000-8000-000000000004', '01801000-0000-4000-8000-000000000002', 'JewelOS Other 0180', 'C180T');
insert into departments(id, tenant_id, branch_id, name, code)
select ('01803000-0000-4000-8000-00000000000' || n)::uuid,
  case when n = 4 then '01801000-0000-4000-8000-000000000002' else '01801000-0000-4000-8000-000000000001' end::uuid,
  ('01802000-0000-4000-8000-00000000000' || n)::uuid, 'Dept ' || n, 'C180D' || n
from generate_series(1, 4) n;
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('01805000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('01804000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  case when n = 10 then '01801000-0000-4000-8000-000000000002' else '01801000-0000-4000-8000-000000000001' end::uuid,
  ('01802000-0000-4000-8000-00000000000' || case n when 5 then 2 when 9 then 3 when 10 then 4 else 1 end)::uuid,
  ('01803000-0000-4000-8000-00000000000' || case n when 5 then 2 when 9 then 3 when 10 then 4 else 1 end)::uuid,
  'CRM 0180 person ' || n, '0000018000', 'crm-0180-' || lpad(n::text, 2, '0') || '@example.invalid', 'C180-' || n,
  (array['super_admin','admin','manager','crm','staff','crm','crm','hr','crm','admin','crm'])[n]::user_role,
  'active', 'active', n <> 7, '{}'
from generate_series(1, 11) n;

insert into crm.branches(id, name, jewelos_branch_id) values
('01806000-0000-4000-8000-000000000001', 'CRM Branch A', '01802000-0000-4000-8000-000000000001'),
('01806000-0000-4000-8000-000000000002', 'CRM Branch B', '01802000-0000-4000-8000-000000000002'),
('01806000-0000-4000-8000-000000000003', 'CRM Branch C', null);
insert into crm.users(id, name, email, role, branch_id, jewelos_profile_id) values
('01807000-0000-4000-8000-000000000001', 'CRM Admin One', 'crm-admin-one@example.invalid', 'super_admin', null, '01805000-0000-4000-8000-000000000001'),
('01807000-0000-4000-8000-000000000002', 'CRM Admin Two', 'crm-admin-two@example.invalid', 'super_admin', null, '01805000-0000-4000-8000-000000000002'),
('01807000-0000-4000-8000-000000000003', 'CRM Manager A', 'crm-manager-a@example.invalid', 'branch_manager', '01806000-0000-4000-8000-000000000001', '01805000-0000-4000-8000-000000000003'),
('01807000-0000-4000-8000-000000000004', 'CRM Sales A', 'crm-sales-a@example.invalid', 'salesperson', '01806000-0000-4000-8000-000000000001', '01805000-0000-4000-8000-000000000004'),
('01807000-0000-4000-8000-000000000005', 'CRM Sales B', 'crm-sales-b@example.invalid', 'salesperson', '01806000-0000-4000-8000-000000000002', '01805000-0000-4000-8000-000000000005'),
-- Same email as JewelOS profile 06, deliberately not linked: there is no auto-linking.
('01807000-0000-4000-8000-000000000006', 'CRM Unlinked', 'crm-0180-06@example.invalid', 'salesperson', '01806000-0000-4000-8000-000000000001', null),
('01807000-0000-4000-8000-000000000007', 'CRM Inactive Login', 'crm-inactive@example.invalid', 'salesperson', '01806000-0000-4000-8000-000000000001', '01805000-0000-4000-8000-000000000007'),
('01807000-0000-4000-8000-000000000008', 'CRM HR Linked', 'crm-hr@example.invalid', 'salesperson', '01806000-0000-4000-8000-000000000001', '01805000-0000-4000-8000-000000000008'),
('01807000-0000-4000-8000-000000000009', 'CRM Unmapped Branch', 'crm-unmapped@example.invalid', 'salesperson', '01806000-0000-4000-8000-000000000001', '01805000-0000-4000-8000-000000000009'),
('01807000-0000-4000-8000-000000000012', 'CRM Link Target', 'crm-link-target@example.invalid', 'salesperson', '01806000-0000-4000-8000-000000000001', null);
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id) values
('01808000-0000-4000-8000-000000000001', 'Client In A', '9018000001', '01806000-0000-4000-8000-000000000001'),
('01808000-0000-4000-8000-000000000002', 'Client In B', '9018000002', '01806000-0000-4000-8000-000000000002'),
('01808000-0000-4000-8000-000000000003', 'Disposable Client', '9018000003', '01806000-0000-4000-8000-000000000001');
insert into crm.crm_allocation(branch_id, crm_name) values
('01806000-0000-4000-8000-000000000001', 'ANU'), ('01806000-0000-4000-8000-000000000002', 'BINA');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(not has_schema_privilege('anon', 'crm', 'USAGE'), 'anon has no usage on schema crm');
select ok(has_schema_privilege('authenticated', 'crm', 'USAGE'), 'authenticated may use schema crm');
select ok(not has_schema_privilege('anon', 'crm_private', 'USAGE'), 'anon has no usage on crm_private');
select ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'crm' and grantee in ('anon', 'PUBLIC')), 'no crm table grant to anon or PUBLIC');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('crm', 'crm_private') and has_function_privilege('anon', p.oid, 'EXECUTE')
), 'anon cannot execute any crm function');
select ok(not has_function_privilege('authenticated', 'crm.submit_legacy_walkin_visit(jsonb)', 'EXECUTE'), 'legacy ingest RPC is not a browser contract');
select ok(not has_function_privilege('authenticated', 'crm.consume_legacy_walkin_ingest_rate_limit(text)', 'EXECUTE'), 'ingest rate limiter is not a browser contract');
select ok(not has_function_privilege('authenticated', 'crm_private.current_crm_identity()', 'EXECUTE'), 'identity resolver is owner-only');
select ok(not has_table_privilege('authenticated', 'crm.legacy_import_keys', 'SELECT'), 'import ledger is not readable by staff');
select ok(not has_table_privilege('authenticated', 'crm.crm_queue_round_robin', 'SELECT'), 'round-robin state is definer-only');
select ok(not has_column_privilege('authenticated', 'crm.users', 'jewelos_profile_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'crm.users', 'jewelos_profile_id', 'INSERT'), 'profile link column is not writable directly');
select ok(not has_column_privilege('authenticated', 'crm.branches', 'jewelos_branch_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'crm.branches', 'jewelos_branch_id', 'INSERT'), 'branch link column is not writable directly');
select ok(has_function_privilege('authenticated', 'crm.get_my_profile()', 'EXECUTE'), 'staff may call get_my_profile');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'crm' and c.relkind = 'r' and not c.relrowsecurity), 0, 'every crm table has RLS enabled');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'crm' and c.relkind = 'r' and not exists (
    select 1 from pg_policies p where p.schemaname = 'crm' and p.tablename = c.relname
      and p.policyname = c.relname || '_section_available' and p.permissive = 'RESTRICTIVE' and p.cmd = 'SELECT')), 0,
  'every crm table has a restrictive section policy');
select ok(exists (select 1 from storage.buckets where id = 'crm-legacy-documents' and not public and file_size_limit = 10485760), 'original CRM files use a private distinct bucket');
select ok(exists (select 1 from storage.buckets where id = 'crm-documents'), 'JewelOS crm-documents bucket is left in place');

set local role anon;
select throws_ok($$select count(*) from crm.clients$$, '42501', null, 'anon cannot read crm clients');
select throws_ok($$select * from crm.get_my_profile()$$, '42501', null, 'anon cannot call crm RPCs');
reset role;

-- ---------------------------------------------------------------------------
-- Salesperson (JewelOS crm role) is branch-scoped for writes, global for reads
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000004', true);
select is((select row(name, role, branch_name)::text from crm.get_my_profile()), '("CRM Sales A",salesperson,"CRM Branch A")', 'crm role maps to salesperson in its linked branch');
select is(crm.current_crm_user_id(), '01807000-0000-4000-8000-000000000004'::uuid, 'actor resolves to the historical CRM user id, not the Auth id');
select is((select count(*)::integer from crm.clients where client_id in ('01808000-0000-4000-8000-000000000001', '01808000-0000-4000-8000-000000000002')), 2, 'salesperson reads clients of every branch');
select lives_ok($$insert into crm.client_timeline(client_id, event_date, buy_status, branch_id) values ('01808000-0000-4000-8000-000000000002', '2026-09-25T10:00:00Z', 'NO', '01806000-0000-4000-8000-000000000001')$$, 'salesperson writes a visit in its own branch');
select throws_ok($$insert into crm.client_timeline(client_id, event_date, buy_status, branch_id) values ('01808000-0000-4000-8000-000000000002', '2026-09-25T10:00:00Z', 'NO', '01806000-0000-4000-8000-000000000002')$$, '42501', null, 'salesperson cannot write a visit for another branch');
select throws_ok($$insert into crm.crm_allocation(branch_id, crm_name) values ('01806000-0000-4000-8000-000000000001', 'BLOCKED')$$, '42501', null, 'salesperson cannot change the roster');
select is((select count(*)::integer from crm.crm_allocation), 1, 'salesperson sees only its own branch roster');
select throws_like($$select * from crm.manage_crm_roster('ADD', null, '01806000-0000-4000-8000-000000000001', 'NEW CRM', null)$$, '%branch manager access is required%', 'salesperson cannot manage the roster');
select lives_ok($$delete from crm.clients where client_id = '01808000-0000-4000-8000-000000000003'$$, 'salesperson delete runs');
select lives_ok($$update crm.clients set primary_name = 'Client In A Renamed' where client_id = '01808000-0000-4000-8000-000000000001'$$, 'salesperson edits a client profile');
select set_config('test.new_client', crm.create_client_with_phone('Audited Client', '+91 90180 00009', null, null)::text, true);
select throws_like($$select crm.create_client_with_phone('Bad Phone', '123', null, null)$$, '%phone must contain at least 10 digits%', 'invalid RPC input is rejected');
reset role;
select ok(exists (select 1 from crm.clients where client_id = '01808000-0000-4000-8000-000000000003'), 'salesperson cannot delete clients (super_admin only)');
select is((select edited_by from crm.client_edit_log where client_id = '01808000-0000-4000-8000-000000000001' and field_name = 'primary_name'),
  '01807000-0000-4000-8000-000000000004'::uuid, 'field-level edit log records the CRM user id');
select is((select profile_updated_by from crm.clients where client_id = '01808000-0000-4000-8000-000000000001'),
  '01807000-0000-4000-8000-000000000004'::uuid, 'profile editor is the CRM user id');
select is((select count(*)::integer from audit_logs where action = 'crm.create_client_with_phone'
    and record_id = current_setting('test.new_client')::uuid and module = 'crm'
    and actor_user_id = '01805000-0000-4000-8000-000000000004' and tenant_id = '01801000-0000-4000-8000-000000000001'
    and new_value ->> 'crm_user_id' = '01807000-0000-4000-8000-000000000004'), 1, 'mutating RPC writes a JewelOS audit row');
select is((select count(*)::integer from audit_logs where action = 'crm.create_client_with_phone'), 1, 'a rejected RPC leaves no audit row');

-- ---------------------------------------------------------------------------
-- Branch manager is limited to its branch; super_admin/admin are global
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000003', true);
select is((select row(name, role, branch_name)::text from crm.get_my_profile()), '("CRM Manager A",branch_manager,"CRM Branch A")', 'manager maps to branch_manager');
select lives_ok($$insert into crm.crm_allocation(branch_id, crm_name) values ('01806000-0000-4000-8000-000000000001', 'MANAGER ADDED')$$, 'manager writes its own roster');
select throws_ok($$insert into crm.crm_allocation(branch_id, crm_name) values ('01806000-0000-4000-8000-000000000002', 'WRONG BRANCH')$$, '42501', null, 'manager cannot write another branch roster');
select throws_like($$select * from crm.manage_crm_roster('ADD', null, '01806000-0000-4000-8000-000000000002', 'OTHER CRM', null)$$, '%branch manager access is required%', 'manager cannot manage another branch through the RPC');
select lives_ok($$select * from crm.manage_crm_roster('ADD', null, '01806000-0000-4000-8000-000000000001', 'rpc crm', null)$$, 'manager manages its own branch through the RPC');

select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000001', true);
select is((select row(name, role, branch_name)::text from crm.get_my_profile()), '("CRM Admin One",super_admin,)', 'super_admin maps to global super_admin');
select lives_ok($$insert into crm.crm_allocation(branch_id, crm_name) values ('01806000-0000-4000-8000-000000000002', 'ADMIN ADDED')$$, 'super_admin writes any branch roster');
select lives_ok($$delete from crm.clients where client_id = '01808000-0000-4000-8000-000000000003'$$, 'super_admin deletes a client');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000002', true);
select is((select role from crm.get_my_profile()), 'super_admin'::crm.user_role, 'JewelOS admin maps to CRM super_admin');
reset role;
select ok(not exists (select 1 from crm.clients where client_id = '01808000-0000-4000-8000-000000000003'), 'super_admin delete took effect');

-- ---------------------------------------------------------------------------
-- Fail closed
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'staff without crm.view has no CRM profile');
select is((select count(*)::integer from crm.clients), 0, 'staff without crm.view reads no clients');
select throws_like($$select crm.create_client_with_phone('Denied', '9018000099', null, null)$$, '%active CRM profile required%', 'staff without crm.view cannot write');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'unlinked profile is denied even when a CRM user shares its email');
select is((select count(*)::integer from crm.clients), 0, 'unlinked profile reads no clients');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'inactive JewelOS login is denied');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000008', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'hr (no CRM role) is denied');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000009', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'profile whose JewelOS branch has no CRM branch is denied');
select is((select count(*)::integer from crm.lookup_beverages), 0, 'denied profile cannot read lookups');
reset role;

insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect) values
('01805000-0000-4000-8000-000000000005', '01801000-0000-4000-8000-000000000001', 'crm.view', 'grant'),
('01805000-0000-4000-8000-000000000008', '01801000-0000-4000-8000-000000000001', 'crm.view', 'grant');
set local role authenticated;
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000005', true);
select is((select row(name, role, branch_name)::text from crm.get_my_profile()), '("CRM Sales B",salesperson,"CRM Branch B")', 'staff granted crm.view maps to salesperson in its JewelOS branch');
select throws_ok($$insert into crm.client_timeline(client_id, event_date, buy_status, branch_id) values ('01808000-0000-4000-8000-000000000001', '2026-09-25T11:00:00Z', 'NO', '01806000-0000-4000-8000-000000000001')$$, '42501', null, 'branch B salesperson cannot write branch A');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000008', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'crm.view alone does not give an unmapped JewelOS role CRM access');
reset role;

update crm.users set active = false where id = '01807000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'inactive CRM user is denied');
reset role;
update crm.users set active = true where id = '01807000-0000-4000-8000-000000000004';

insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority)
values ('01805000-0000-4000-8000-000000000004', '01801000-0000-4000-8000-000000000001', 'manager');
set local role authenticated;
select is((select role from crm.get_my_profile()), 'branch_manager'::crm.user_role, 'CRM role follows JewelOS dashboard authority');
reset role;
delete from user_access_profiles where user_profile_id = '01805000-0000-4000-8000-000000000004';

insert into tenant_section_controls(tenant_id, section_availability)
values ('01801000-0000-4000-8000-000000000001', '{"crm": false}')
on conflict (tenant_id) do update set section_availability = excluded.section_availability;
set local role authenticated;
select is((select count(*)::integer from crm.get_my_profile()), 0, 'disabled crm section denies staff');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'disabled crm section denies an admin');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000001', true);
select is((select role from crm.get_my_profile()), 'super_admin'::crm.user_role, 'Developer Mode super_admin keeps access to a disabled section');
reset role;
update tenant_section_controls set section_availability = '{}' where tenant_id = '01801000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Link administration: super_admin/admin only, same tenant, audited
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000004', true);
select throws_ok($$select crm.link_jewelos_profile('01807000-0000-4000-8000-000000000012', '01805000-0000-4000-8000-000000000011')$$, '42501', null, 'salesperson cannot link identities');
select throws_ok($$select crm.list_identity_links()$$, '42501', null, 'salesperson cannot list identity links');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000003', true);
select throws_ok($$select crm.link_jewelos_profile('01807000-0000-4000-8000-000000000012', '01805000-0000-4000-8000-000000000011')$$, '42501', null, 'manager cannot link identities');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000010', true);
select throws_ok($$select crm.link_jewelos_profile('01807000-0000-4000-8000-000000000012', '01805000-0000-4000-8000-000000000011')$$, '42501', null, 'another tenant admin cannot link this tenant profile');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000011', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'profile has no access before it is linked');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000002', true);
select lives_ok($$select crm.link_jewelos_profile('01807000-0000-4000-8000-000000000012', '01805000-0000-4000-8000-000000000011')$$, 'admin links a CRM user');
select throws_ok($$select crm.link_jewelos_profile('01807000-0000-4000-8000-000000000006', '01805000-0000-4000-8000-000000000011')$$, '23505', null, 'a profile cannot act as two CRM users');
select throws_ok($$update crm.users set jewelos_profile_id = null where id = '01807000-0000-4000-8000-000000000012'$$, '42501', null, 'link column cannot be changed outside the RPC');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000011', true);
select is((select row(name, role, branch_name)::text from crm.get_my_profile()), '("CRM Link Target",salesperson,"CRM Branch A")', 'linked profile gains access');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(crm.list_identity_links() -> 'users'), (select count(*)::integer from crm.users), 'super_admin lists every CRM user for linking');
select lives_ok($$select crm.link_jewelos_profile('01807000-0000-4000-8000-000000000012', null)$$, 'super_admin unlinks a CRM user');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000011', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'unlinked profile loses access immediately');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000002', true);
select lives_ok($$select crm.link_jewelos_branch('01806000-0000-4000-8000-000000000003', '01802000-0000-4000-8000-000000000003')$$, 'admin links a CRM branch to a JewelOS branch');
select throws_ok($$select crm.link_jewelos_branch('01806000-0000-4000-8000-000000000002', '01802000-0000-4000-8000-000000000001')$$, '23505', null, 'a JewelOS branch maps to one CRM branch');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000009', true);
select is((select row(name, role, branch_name)::text from crm.get_my_profile()), '("CRM Unmapped Branch",salesperson,"CRM Branch C")', 'CRM branch is derived from the JewelOS branch');
select set_config('request.jwt.claim.sub', '01804000-0000-4000-8000-000000000010', true);
select throws_ok($$select crm.link_jewelos_branch('01806000-0000-4000-8000-000000000003', '01802000-0000-4000-8000-000000000004')$$, '42501', null, 'another tenant admin cannot relink this tenant branch');
reset role;
select is((select count(*)::integer from audit_logs where module = 'crm' and record_id = '01807000-0000-4000-8000-000000000012'
  and actor_user_id = '01805000-0000-4000-8000-000000000002' and action = 'crm.link_jewelos_profile'
  and old_value ->> 'jewelos_profile_id' is null and new_value ->> 'jewelos_profile_id' = '01805000-0000-4000-8000-000000000011'), 1, 'profile link is audited');
select is((select count(*)::integer from audit_logs where module = 'crm' and record_id = '01807000-0000-4000-8000-000000000012'
  and actor_user_id = '01805000-0000-4000-8000-000000000001' and action = 'crm.unlink_jewelos_profile'), 1, 'profile unlink is audited');
select is((select count(*)::integer from audit_logs where module = 'crm' and record_id = '01806000-0000-4000-8000-000000000003'
  and action = 'crm.link_jewelos_branch' and new_value ->> 'jewelos_branch_id' = '01802000-0000-4000-8000-000000000003'), 1, 'branch link is audited');

-- ---------------------------------------------------------------------------
-- Server-side legacy ingest: only a service_role JWT may act as the ingest user
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select is(crm.current_user_role(), null::crm.user_role, 'service role without a CRM subject has no CRM role');
select ok((select client_id is not null from crm.submit_legacy_walkin_visit(
  '{"branch_id":"01806000-0000-4000-8000-000000000001","primary_name":"Legacy Asha","primary_phone":"+91 90180 90000","did_buy":true,"seen_categories":["Ring"]}'::jsonb)),
  'legacy payload is ingested through the canonical walk-in path');
select ok(exists (select 1 from crm.users where email = 'legacy-ingest+01806000-0000-4000-8000-000000000001@internal.invalid'), 'ingest actor is the original synthetic CRM user');
select is((select count(*)::integer from audit_logs where action = 'crm.submit_walkin_visit' and actor_user_id is null
  and tenant_id = '01801000-0000-4000-8000-000000000001'), 1, 'ingested visit is audited against the linked branch tenant');
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select id::text from crm.users where email = 'legacy-ingest+01806000-0000-4000-8000-000000000001@internal.invalid'), true);
select is(crm.current_user_role(), null::crm.user_role, 'a browser JWT cannot impersonate a CRM user id');

-- ---------------------------------------------------------------------------
-- The old JewelOS CRM tables are untouched
-- ---------------------------------------------------------------------------
select columns_are('public', 'clients', array['id','tenant_id','branch_id','phone','billing_phone','first_name','last_name','gender','address','city','state','pincode','source_id','client_type_id','potential_category','total_visits','last_visit_date','next_visit_date','assigned_crm_id','created_at','updated_at','normalized_phone','normalized_billing_phone','email','date_of_birth','anniversary_date','tags','status','communication_preference','communication_consent','record_version','merged_into_client_id','created_by','updated_by'], 'public.clients columns unchanged');
select columns_are('public', 'client_timeline', array['id','client_id','event_type','ref_id','summary','created_by','created_at','tenant_id','branch_id','subject','outcome','occurred_at','correction_of_id','metadata'], 'public.client_timeline columns unchanged');
select is((select count(*)::integer from pg_policy where polrelid in ('public.clients'::regclass, 'public.client_timeline'::regclass)), 4, 'public CRM table policies unchanged');
select is((select count(*)::integer from pg_trigger where tgrelid in ('public.clients'::regclass, 'public.client_timeline'::regclass) and not tgisinternal), 3, 'public CRM table triggers unchanged');
select ok(not exists (
  select 1 from pg_policies where schemaname = 'public' and tablename in ('clients', 'client_timeline')
    and (coalesce(qual, '') ~ '\mcrm(_private)?\.' or coalesce(with_check, '') ~ '\mcrm(_private)?\.')
), 'no public CRM policy references the ported schema');
select ok(not exists (
  select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
  where t.tgrelid in ('public.clients'::regclass, 'public.client_timeline'::regclass) and n.nspname in ('crm', 'crm_private')
), 'no ported trigger is attached to the public CRM tables');

select * from finish();
rollback;
