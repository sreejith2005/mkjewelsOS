begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture: tenant A with two branches, an HR department and a sales department,
-- active staff, a resigned, a disabled, and an invited colleague, a staff user
-- with an individual deny of assistant.view; tenant B with one HR colleague.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('20600000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'kiara-dir-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 10) n;

insert into tenants(id, name, slug, timezone) values
  ('20610000-0000-4000-8000-000000000001', 'Kiara dir A', 'kiara-dir-a', 'Asia/Kolkata'),
  ('20610000-0000-4000-8000-000000000002', 'Kiara dir B', 'kiara-dir-b', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values
  ('20620000-0000-4000-8000-000000000001', '20610000-0000-4000-8000-000000000001', 'Dir Andheri', 'DIR-AND'),
  ('20620000-0000-4000-8000-000000000002', '20610000-0000-4000-8000-000000000001', 'Dir Borivali', 'DIR-BOR'),
  ('20620000-0000-4000-8000-000000000003', '20610000-0000-4000-8000-000000000002', 'Dir Other', 'DIR-OTH');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('20630000-0000-4000-8000-000000000001', '20610000-0000-4000-8000-000000000001', null, 'Dir HR', 'DIR-HR'),
  ('20630000-0000-4000-8000-000000000002', '20610000-0000-4000-8000-000000000001', null, 'Dir Sales', 'DIR-SALES'),
  ('20630000-0000-4000-8000-000000000003', '20610000-0000-4000-8000-000000000002', null, 'Dir HR', 'DIR-HR-B');
insert into dropdown_masters(id, tenant_id, master_type, label, value, sort_order, is_active) values
  ('20640000-0000-4000-8000-000000000001', '20610000-0000-4000-8000-000000000001', 'designation', 'HR Executive', 'dir_hr_executive', 1, true),
  ('20640000-0000-4000-8000-000000000002', '20610000-0000-4000-8000-000000000001', 'designation', 'Sales 100% Executive', 'dir_sales_executive', 2, true);

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, designation_id, employee_name, personal_mobile, official_mobile, email, official_email, personal_email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('20650000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('20600000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  f.tenant::uuid, f.branch::uuid, f.department::uuid, f.designation::uuid, f.name,
  '0000206' || lpad(f.n::text, 3, '0'), '0000306' || lpad(f.n::text, 3, '0'),
  'kiara-dir-' || f.n || '@example.invalid', 'kiara-dir-work-' || f.n || '@example.invalid', 'kiara-dir-home-' || f.n || '@example.invalid',
  'DIR-' || f.n, f.role::user_role, f.working::working_status, f.status::user_account_status, f.enabled, '{}'
from (values
  (1, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000001', '20630000-0000-4000-8000-000000000002', '20640000-0000-4000-8000-000000000002', 'Dir Staff Asha', 'staff', 'active', 'active', true),
  (2, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000001', '20630000-0000-4000-8000-000000000001', '20640000-0000-4000-8000-000000000001', 'Dir HR Bina', 'hr', 'active', 'active', true),
  (3, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000002', '20630000-0000-4000-8000-000000000001', '20640000-0000-4000-8000-000000000001', 'Dir HR Chitra', 'hr', 'on_leave', 'active', true),
  (4, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000001', '20630000-0000-4000-8000-000000000001', '20640000-0000-4000-8000-000000000001', 'Dir HR Resigned', 'hr', 'resigned', 'left', false),
  (5, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000001', '20630000-0000-4000-8000-000000000001', '20640000-0000-4000-8000-000000000001', 'Dir HR Disabled', 'hr', 'active', 'inactive', false),
  (6, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000001', '20630000-0000-4000-8000-000000000001', '20640000-0000-4000-8000-000000000001', 'Dir HR Invited', 'hr', 'active', 'invited', true),
  (7, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000001', '20630000-0000-4000-8000-000000000002', '20640000-0000-4000-8000-000000000002', 'Dir Denied Dev', 'staff', 'active', 'active', true),
  (8, '20610000-0000-4000-8000-000000000002', '20620000-0000-4000-8000-000000000003', '20630000-0000-4000-8000-000000000003', null, 'Dir HR Other Tenant', 'hr', 'active', 'active', true),
  (9, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000001', '20630000-0000-4000-8000-000000000002', null, 'Dir Super Admin', 'super_admin', 'active', 'active', true),
  (10, '20610000-0000-4000-8000-000000000001', '20620000-0000-4000-8000-000000000002', '20630000-0000-4000-8000-000000000002', null, 'Dir Staff_Percent', 'staff', 'active', 'active', true)
) as f(n, tenant, branch, department, designation, name, role, working, status, enabled);
insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect)
values ('20610000-0000-4000-8000-000000000001', '20650000-0000-4000-8000-000000000007', 'assistant.view', 'deny');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '20600000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
grant execute on function pg_temp.as_user(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'kiara_directory_lookup(text,text,text,text,integer)', 'EXECUTE'), 'signed-in users can call the lookup');
select ok(not has_function_privilege('anon', 'kiara_directory_lookup(text,text,text,text,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'kiara_directory_lookup(text,text,text,text,integer)', 'EXECUTE'), 'anon and the service role cannot call it');
set local role anon;
select throws_ok($$select kiara_directory_lookup('Bina')$$, '42501', null, 'anon execution is denied');
reset role;
set local role service_role;
select throws_ok($$select kiara_directory_lookup('Bina')$$, '42501', null, 'service role execution is denied');
reset role;

-- ---------------------------------------------------------------------------
-- Identity and section gates
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select kiara_directory_lookup('Bina')$$, '42501', 'Active profile required', 'unauthenticated callers are refused');
select pg_temp.as_user(5);
select throws_ok($$select kiara_directory_lookup('Bina')$$, '42501', 'Active profile required', 'a disabled account is refused');
select pg_temp.as_user(7);
select throws_ok($$select kiara_directory_lookup('Bina')$$, '42501', 'Section access denied', 'an individual deny of assistant.view is refused');

-- ---------------------------------------------------------------------------
-- Allowed fields only
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select is(kiara_directory_lookup('Bina') -> 'people', '[{"name":"Dir HR Bina","designation":"HR Executive","department":"Dir HR","branch":"Dir Andheri"}]'::jsonb, 'a name lookup returns name, designation, department, branch');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(kiara_directory_lookup(null, 'HR') -> 'people') p, jsonb_object_keys(p) k),
  array['branch','department','designation','name'], 'no other field is ever returned');
select ok(kiara_directory_lookup(null, 'HR')::text !~ '(example\.invalid|0000206|0000306|DIR-[0-9]|2065)', 'no email, mobile, employee code, or id appears anywhere in the result');

-- ---------------------------------------------------------------------------
-- Matching, tenant isolation, inactive users
-- ---------------------------------------------------------------------------
select is((select array_agg(p ->> 'name' order by p ->> 'name') from jsonb_array_elements(kiara_directory_lookup(null, 'HR') -> 'people') p),
  array['Dir HR Bina','Dir HR Chitra'], 'department lookup: active colleagues only (on leave is still active); resigned, disabled, invited and other-tenant people excluded');
select is((select array_agg(p ->> 'name' order by p ->> 'name') from jsonb_array_elements(kiara_directory_lookup(null, null, 'HR Executive', 'Andheri') -> 'people') p),
  array['Dir HR Bina'], 'designation and branch filters combine');
select is((select array_agg(p ->> 'name') from jsonb_array_elements(kiara_directory_lookup(null, null, null, 'dir-bor') -> 'people') p),
  array['Dir HR Chitra','Dir Staff_Percent'], 'a branch can be matched by its code');
select is(jsonb_array_length(kiara_directory_lookup('Other Tenant') -> 'people'), 0, 'another tenant''s people are never found');
select is(jsonb_array_length(kiara_directory_lookup('Resigned') -> 'people'), 0, 'a resigned colleague is not found');
select is(jsonb_array_length(kiara_directory_lookup('Disabled') -> 'people'), 0, 'a disabled colleague is not found');
select is(jsonb_array_length(kiara_directory_lookup('Invited') -> 'people'), 0, 'an invited (not yet active) colleague is not found');
select is((select array_agg(p ->> 'name') from jsonb_array_elements(kiara_directory_lookup('Staff_') -> 'people') p), array['Dir Staff_Percent'], 'an underscore is matched literally, not as a wildcard');
select is((select array_agg(p ->> 'name') from jsonb_array_elements(kiara_directory_lookup(null, null, '100%') -> 'people') p), array['Dir Denied Dev','Dir Staff Asha'], 'a percent sign is matched literally');

select pg_temp.as_user(8);
select is((select array_agg(p ->> 'name') from jsonb_array_elements(kiara_directory_lookup(null, 'HR') -> 'people') p), array['Dir HR Other Tenant'], 'tenant B sees only tenant B');

-- ---------------------------------------------------------------------------
-- Caps and validation
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select is(kiara_directory_lookup(null, null, null, 'Dir', 2) -> 'truncated', 'true'::jsonb, 'more matches than the limit set truncated');
select is(jsonb_array_length(kiara_directory_lookup(null, null, null, 'Dir', 2) -> 'people'), 2, 'rows are capped at the limit');
select is(kiara_directory_lookup('Bina') -> 'truncated', 'false'::jsonb, 'a complete result is not truncated');
select throws_ok($$select kiara_directory_lookup()$$, '22023', 'Give a name, department, designation, or branch to look up', 'an empty lookup is rejected (no full directory dump)');
select throws_ok($$select kiara_directory_lookup('   ', '')$$, '22023', null, 'blank terms count as empty');
select throws_ok(format('select kiara_directory_lookup(%L)', repeat('a', 61)), '22023', 'Lookup terms must be at most 60 characters', 'long terms are rejected');
select throws_ok($$select kiara_directory_lookup('Bina', null, null, null, 21)$$, '22023', 'Limit must be 1 to 20', 'the limit is capped at 20');
select throws_ok($$select kiara_directory_lookup('Bina', null, null, null, 0)$$, '22023', 'Limit must be 1 to 20', 'the limit must be positive');

-- ---------------------------------------------------------------------------
-- Section switched off (launch dark): staff denied, Super Admin allowed
-- ---------------------------------------------------------------------------
reset role;
insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version)
values ('20610000-0000-4000-8000-000000000001', false, default_section_availability() || '{"ask_kiara": false}', 1)
on conflict (tenant_id) do update set section_availability = excluded.section_availability;
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok($$select kiara_directory_lookup('Bina')$$, '42501', 'This section is currently unavailable', 'staff are refused while Ask Kiara is off');
select pg_temp.as_user(9);
select is(jsonb_array_length(kiara_directory_lookup('Bina') -> 'people'), 1, 'Super Admin keeps access while the section is off');

-- The lookup writes nothing.
reset role;
select is((select count(*)::integer from audit_logs where tenant_id = '20610000-0000-4000-8000-000000000001' and module = 'assistant'), 0, 'the read-only lookup writes no audit rows');

select * from finish();
rollback;
