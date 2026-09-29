-- D2: crm.ensure_my_crm_user() provisions a CRM user once for an eligible JewelOS profile,
-- is idempotent, audited, never matches existing CRM users by name or email, and fails closed.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
--   profiles 01 crm (eligible), 02 super_admin (eligible, no branch needed), 03 staff (no crm.view),
--   04 crm (login disabled), 05 hr (crm.view granted, unmapped role), 06 crm (branch not linked),
--   07 crm (already linked), 08 crm (email used by an unlinked historical CRM user),
--   09 manager (other tenant, section disabled there), 10 crm (account inactive)
-- ---------------------------------------------------------------------------
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('01914000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
  'crm-0191-' || lpad(n::text, 2, '0') || '@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now()
from generate_series(1, 10) n;
insert into tenants(id, name, slug) values
('01911000-0000-4000-8000-000000000001', 'CRM 0191 tenant', 'crm-0191-one'),
('01911000-0000-4000-8000-000000000002', 'CRM 0191 other tenant', 'crm-0191-two');
insert into branches(id, tenant_id, name, code) values
('01912000-0000-4000-8000-000000000001', '01911000-0000-4000-8000-000000000001', 'JewelOS Branch 0191', 'C191A'),
('01912000-0000-4000-8000-000000000002', '01911000-0000-4000-8000-000000000001', 'JewelOS Head Office 0191', 'C191X'),
('01912000-0000-4000-8000-000000000003', '01911000-0000-4000-8000-000000000002', 'JewelOS Other 0191', 'C191T');
insert into departments(id, tenant_id, branch_id, name, code)
select ('01913000-0000-4000-8000-00000000000' || n)::uuid,
  case when n = 3 then '01911000-0000-4000-8000-000000000002' else '01911000-0000-4000-8000-000000000001' end::uuid,
  ('01912000-0000-4000-8000-00000000000' || n)::uuid, 'Dept 0191 ' || n, 'C191D' || n
from generate_series(1, 3) n;
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('01915000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('01914000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  case when n = 9 then '01911000-0000-4000-8000-000000000002' else '01911000-0000-4000-8000-000000000001' end::uuid,
  ('01912000-0000-4000-8000-00000000000' || case n when 6 then 2 when 9 then 3 else 1 end)::uuid,
  ('01913000-0000-4000-8000-00000000000' || case n when 6 then 2 when 9 then 3 else 1 end)::uuid,
  'CRM 0191 person ' || n, '0000019100', 'crm-0191-' || lpad(n::text, 2, '0') || '@example.invalid', 'C191-' || n,
  (array['crm','super_admin','staff','crm','hr','crm','crm','crm','manager','crm'])[n]::user_role,
  'active', (case when n = 10 then 'inactive' else 'active' end)::user_account_status, n <> 4, '{}'
from generate_series(1, 10) n;
insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect) values
('01915000-0000-4000-8000-000000000005', '01911000-0000-4000-8000-000000000001', 'crm.view', 'grant');
insert into tenant_section_controls(tenant_id, section_availability)
values ('01911000-0000-4000-8000-000000000002', '{"crm": false}')
on conflict (tenant_id) do update set section_availability = excluded.section_availability;

insert into crm.branches(id, name, jewelos_branch_id) values
('01916000-0000-4000-8000-000000000001', 'CRM Branch 0191', '01912000-0000-4000-8000-000000000001'),
('01916000-0000-4000-8000-000000000003', 'CRM Branch 0191 Other', '01912000-0000-4000-8000-000000000003');
insert into crm.users(id, name, email, role, branch_id, jewelos_profile_id) values
('01917000-0000-4000-8000-000000000007', 'CRM Already Linked', 'crm-0191-linked@example.invalid', 'salesperson', '01916000-0000-4000-8000-000000000001', '01915000-0000-4000-8000-000000000007'),
-- Historical user with profile 08's email (different case), not linked: never matched by email.
('01917000-0000-4000-8000-000000000008', 'CRM 0191 person 1', 'CRM-0191-08@Example.invalid', 'salesperson', '01916000-0000-4000-8000-000000000001', null);

-- ---------------------------------------------------------------------------
-- Privileges and unchanged identity functions
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'crm.ensure_my_crm_user()', 'EXECUTE'), 'staff may call ensure_my_crm_user');
select ok(not has_function_privilege('anon', 'crm.ensure_my_crm_user()', 'EXECUTE'), 'anon cannot call ensure_my_crm_user');
select ok(not has_function_privilege('service_role', 'crm.ensure_my_crm_user()', 'EXECUTE'), 'service_role cannot call ensure_my_crm_user');
select is((select p.prosecdef from pg_proc p where p.oid = 'crm.ensure_my_crm_user()'::regprocedure), true, 'ensure_my_crm_user is SECURITY DEFINER');
select is((select string_agg(p.provolatile::text, '' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (('crm', 'current_crm_user_id'), ('crm', 'current_user_role'), ('crm', 'current_user_branch_id'), ('crm', 'get_my_profile'), ('crm_private', 'current_crm_identity'))),
  'sssss', 'identity functions stay STABLE');

set local role anon;
select throws_ok($$select crm.ensure_my_crm_user()$$, '42501', null, 'anon is refused');
reset role;

-- ---------------------------------------------------------------------------
-- Eligible salesperson: created once, linked, audited
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from crm.get_my_profile()), 0, 'before provisioning the profile has no CRM access');
select is(crm.ensure_my_crm_user(), 'created', 'eligible profile: a CRM user is created');
select is((select row(name, role, branch_name)::text from crm.get_my_profile()), '("CRM 0191 person 1",salesperson,"CRM Branch 0191")',
  'the new CRM user resolves with the derived role and the mapped branch');
select is(crm.ensure_my_crm_user(), 'already_linked', 'second call is a no-op');
reset role;
select is((select count(*)::integer from crm.users where jewelos_profile_id = '01915000-0000-4000-8000-000000000001'), 1, 'exactly one CRM user for the profile');
select is((select row(u.name, u.email, u.role, u.branch_id, u.active)::text from crm.users u where u.jewelos_profile_id = '01915000-0000-4000-8000-000000000001'),
  '("CRM 0191 person 1",crm-0191-01@example.invalid,salesperson,01916000-0000-4000-8000-000000000001,t)', 'name and email come from the profile');
select is((select count(*)::integer from crm.users where name = 'CRM 0191 person 1'), 2, 'a CRM user with the same name was not matched or reused');
select is((select count(*)::integer from audit_logs where action = 'crm.ensure_my_crm_user' and actor_user_id = '01915000-0000-4000-8000-000000000001'), 1, 'exactly one audit row');
select is((select row(a.tenant_id, a.module, a.record_id = u.id, a.new_value ->> 'role', (a.new_value ->> 'crm_branch_id')::uuid)::text
  from audit_logs a join crm.users u on u.jewelos_profile_id = '01915000-0000-4000-8000-000000000001'
  where a.action = 'crm.ensure_my_crm_user' and a.actor_user_id = '01915000-0000-4000-8000-000000000001'),
  '(01911000-0000-4000-8000-000000000001,crm,t,salesperson,01916000-0000-4000-8000-000000000001)', 'audit row names tenant, module, record, role and branch');

-- ---------------------------------------------------------------------------
-- Eligible super_admin: no branch needed, none stored
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000002', true);
select is(crm.ensure_my_crm_user(), 'created', 'super_admin: a CRM user is created');
select is((select role from crm.get_my_profile()), 'super_admin'::crm.user_role, 'super_admin resolves');
reset role;
select is((select branch_id from crm.users where jewelos_profile_id = '01915000-0000-4000-8000-000000000002'), null, 'super_admin CRM user has no branch');

-- ---------------------------------------------------------------------------
-- Not eligible: nothing created, access denied
-- ---------------------------------------------------------------------------
select set_config('test.users_before', (select count(*)::text from crm.users), true);
select set_config('test.audit_before', (select count(*)::text from audit_logs where action = 'crm.ensure_my_crm_user'), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000003', true);
select is(crm.ensure_my_crm_user(), 'not_eligible', 'no crm.view: nothing created');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'no crm.view: access denied');
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000004', true);
select is(crm.ensure_my_crm_user(), 'not_eligible', 'login disabled: nothing created');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'login disabled: access denied');
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000005', true);
select is(crm.ensure_my_crm_user(), 'not_eligible', 'unmapped role: nothing created');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'unmapped role: access denied');
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000006', true);
select is(crm.ensure_my_crm_user(), 'not_eligible', 'unmapped branch: nothing created');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'unmapped branch: access denied');
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000008', true);
select is(crm.ensure_my_crm_user(), 'email_in_use', 'email of an unlinked historical CRM user: nothing created');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'email match: access denied (no auto-link)');
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000009', true);
select is(crm.ensure_my_crm_user(), 'not_eligible', 'disabled crm section: nothing created');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'disabled crm section: access denied');
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000010', true);
select is(crm.ensure_my_crm_user(), 'not_eligible', 'inactive account: nothing created');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'inactive account: access denied');
reset role;

select is((select count(*)::text from crm.users), current_setting('test.users_before'), 'no CRM user was created for any ineligible profile');
select is((select jewelos_profile_id from crm.users where id = '01917000-0000-4000-8000-000000000008'), null, 'the historical user with the same email stays unlinked');
select is((select count(*)::text from audit_logs where action = 'crm.ensure_my_crm_user'), current_setting('test.audit_before'), 'no audit row for a refused call');

-- ---------------------------------------------------------------------------
-- Already linked: no-op (also when that CRM user is inactive; it is not re-activated)
-- ---------------------------------------------------------------------------
update crm.users set active = false where id = '01917000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claim.sub', '01914000-0000-4000-8000-000000000007', true);
select is(crm.ensure_my_crm_user(), 'already_linked', 'already linked: no-op');
select is((select count(*)::integer from crm.get_my_profile()), 0, 'an inactive linked CRM user stays denied');
reset role;
select is((select count(*)::integer from crm.users where jewelos_profile_id = '01915000-0000-4000-8000-000000000007'), 1, 'no second CRM user for a linked profile');
select is((select active from crm.users where id = '01917000-0000-4000-8000-000000000007'), false, 'the linked CRM user is not re-activated');
select is((select count(*)::text from audit_logs where action = 'crm.ensure_my_crm_user'), current_setting('test.audit_before'), 'no audit row for a no-op');

-- Server-side callers are not provisioned (service_role has no execute; a forged claim does nothing).
select set_config('request.jwt.claim.role', 'service_role', true);
select is(crm.ensure_my_crm_user(), 'not_eligible', 'a non-authenticated JWT role creates nothing');

select * from finish();
rollback;
