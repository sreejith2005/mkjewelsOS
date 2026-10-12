begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture (synthetic only). Tenant A (section on): 1 Super Admin, 2 Admin,
-- 3 Manager, 4 HR, 5 staff, 6 staff individually granted assistant.voice,
-- 7 Manager individually denied assistant.voice, 8 inactive Manager.
-- Tenant B (section off): 9 Manager.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('22800000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'kvoice-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 9) n;

insert into tenants(id, name, slug, timezone) values
  ('22810000-0000-4000-8000-000000000001', 'KVOICE fixture A', 'kvoice-fixture-a', 'Asia/Kolkata'),
  ('22810000-0000-4000-8000-000000000002', 'KVOICE fixture B', 'kvoice-fixture-b', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values
  ('22820000-0000-4000-8000-000000000001', '22810000-0000-4000-8000-000000000001', 'KVOICE branch A', 'KVOICE-A'),
  ('22820000-0000-4000-8000-000000000002', '22810000-0000-4000-8000-000000000002', 'KVOICE branch B', 'KVOICE-B');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('22830000-0000-4000-8000-000000000001', '22810000-0000-4000-8000-000000000001', '22820000-0000-4000-8000-000000000001', 'Sales', 'KVOICE-SALES'),
  ('22830000-0000-4000-8000-000000000002', '22810000-0000-4000-8000-000000000002', '22820000-0000-4000-8000-000000000002', 'Sales', 'KVOICE-SALES-B');

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('22850000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('22800000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  case f.t when 'A' then '22810000-0000-4000-8000-000000000001'::uuid else '22810000-0000-4000-8000-000000000002'::uuid end,
  case f.t when 'A' then '22820000-0000-4000-8000-000000000001'::uuid else '22820000-0000-4000-8000-000000000002'::uuid end,
  case f.t when 'A' then '22830000-0000-4000-8000-000000000001'::uuid else '22830000-0000-4000-8000-000000000002'::uuid end,
  f.name, '0000228' || lpad(f.n::text, 3, '0'), 'kvoice-' || f.n || '@example.invalid', 'KVOICE-' || f.n,
  f.role::user_role, 'active', f.status::user_account_status, true, '{}'
from (values
  (1, 'KVOICE Super Admin', 'super_admin', 'A', 'active'),
  (2, 'KVOICE Admin', 'admin', 'A', 'active'),
  (3, 'KVOICE Manager', 'manager', 'A', 'active'),
  (4, 'KVOICE HR', 'hr', 'A', 'active'),
  (5, 'KVOICE Staff', 'staff', 'A', 'active'),
  (6, 'KVOICE Granted Staff', 'staff', 'A', 'active'),
  (7, 'KVOICE Denied Manager', 'manager', 'A', 'active'),
  (8, 'KVOICE Inactive Manager', 'manager', 'A', 'inactive'),
  (9, 'KVOICE Other Manager', 'manager', 'B', 'active')
) as f(n, name, role, t, status);
insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect) values
  ('22810000-0000-4000-8000-000000000001', '22850000-0000-4000-8000-000000000006', 'assistant.voice', 'grant'),
  ('22810000-0000-4000-8000-000000000001', '22850000-0000-4000-8000-000000000007', 'assistant.voice', 'deny');
insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version) values
  ('22810000-0000-4000-8000-000000000001', false, default_section_availability() || '{"ask_kiara": true}', 1),
  ('22810000-0000-4000-8000-000000000002', false, default_section_availability() || '{"ask_kiara": false}', 1);

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '22800000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true);
  select set_config('request.jwt.claim.role', 'service_role', true);
$$;
create function pg_temp.profile(p_n integer) returns uuid language sql immutable as $$
  select ('22850000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid
$$;
create function pg_temp.spent(p_n integer) returns integer language sql as $$
  select coalesce((select interpretations from voice_interpretation_quotas where user_profile_id = pg_temp.profile(p_n)), 0)
$$;
grant execute on function pg_temp.as_user(integer), pg_temp.as_service(), pg_temp.profile(integer) to authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Contract: authenticated only, definer, owned by postgres
-- ---------------------------------------------------------------------------
select function_privs_are('public', 'consume_my_voice_quota', array[]::text[], 'authenticated', array['EXECUTE'], 'signed-in callers may spend their own voice allowance');
select function_privs_are('public', 'consume_my_voice_quota', array[]::text[], 'anon', array[]::text[], 'anon cannot spend voice allowance');
select function_privs_are('public', 'consume_my_voice_quota', array[]::text[], 'service_role', array[]::text[], 'the service role uses its own Tasks quota function, not this one');
select ok((select prosecdef from pg_proc where oid = 'public.consume_my_voice_quota()'::regprocedure), 'consume_my_voice_quota is security definer');
select is((select r.rolname::text from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'public.consume_my_voice_quota()'::regprocedure), 'postgres', 'consume_my_voice_quota is owned by postgres');
-- Tasks voice keeps its own service-role function, untouched.
select function_privs_are('public', 'consume_voice_interpretation_quota', array['uuid'], 'authenticated', array[]::text[], 'the Tasks quota function stays service-role only');
select function_privs_are('public', 'consume_voice_interpretation_quota', array['uuid'], 'service_role', array['EXECUTE'], 'the Tasks worker still spends quota as the service role');
select is((select default_roles from permission_catalog where key = 'assistant.voice'), '{super_admin,admin,manager}'::user_role[], 'assistant.voice defaults to super admin, admin and manager (no hr)');
select is((select default_roles from permission_catalog where key = 'tasks.voice_assign'), '{super_admin,admin,manager,hr}'::user_role[], 'tasks.voice_assign defaults are unchanged');

-- ---------------------------------------------------------------------------
-- Allowed and denied
-- ---------------------------------------------------------------------------
set local role authenticated;

select pg_temp.as_user(1);
select ok(consume_my_voice_quota(), 'super admin (role default) may transcribe');
select pg_temp.as_user(2);
select ok(consume_my_voice_quota(), 'admin (role default) may transcribe');
select pg_temp.as_user(3);
select ok(consume_my_voice_quota(), 'manager (role default) may transcribe');
select pg_temp.as_user(4);
select throws_ok($$select consume_my_voice_quota()$$, '42501', 'Voice questions are not enabled for your account', 'hr is denied by default');
select pg_temp.as_user(5);
select throws_ok($$select consume_my_voice_quota()$$, '42501', 'Voice questions are not enabled for your account', 'staff is denied by default');
select pg_temp.as_user(6);
select ok(consume_my_voice_quota(), 'staff with an individual grant may transcribe');
select pg_temp.as_user(7);
select throws_ok($$select consume_my_voice_quota()$$, '42501', 'Voice questions are not enabled for your account', 'a manager with an individual deny is refused');
select pg_temp.as_user(8);
select throws_ok($$select consume_my_voice_quota()$$, '42501', 'Active profile required', 'an inactive profile is refused');
select pg_temp.as_user(9);
select throws_ok($$select consume_my_voice_quota()$$, '42501', 'This section is currently unavailable', 'the Ask Kiara section switched off refuses a manager');

reset role;
select is(pg_temp.spent(4) + pg_temp.spent(5) + pg_temp.spent(7) + pg_temp.spent(8) + pg_temp.spent(9), 0, 'a refused caller spends nothing');
select is(pg_temp.spent(3), 1, 'an allowed call spends one unit');

-- HR can be granted per role in Settings -> Permissions.
insert into role_permissions(tenant_id, user_role, permission_key, is_allowed)
values ('22810000-0000-4000-8000-000000000001', 'hr', 'assistant.voice', true);
set local role authenticated;
select pg_temp.as_user(4);
select ok(consume_my_voice_quota(), 'hr may transcribe once the role is granted assistant.voice');
reset role;

-- Anonymous callers have no execute privilege at all.
set local role anon;
select throws_ok($$select consume_my_voice_quota()$$, '42501', null, 'anon cannot call consume_my_voice_quota');
reset role;

-- ---------------------------------------------------------------------------
-- One allowance shared with Tasks voice (same row, same window, same 40)
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
set local role service_role;
select ok(consume_voice_interpretation_quota(pg_temp.profile(3)), 'a Tasks voice note spends from the same row');
reset role;
select is(pg_temp.spent(3), 2, 'Kiara and Tasks voice count on one row');

update voice_interpretation_quotas set interpretations = 38 where user_profile_id = pg_temp.profile(3);
set local role authenticated;
select pg_temp.as_user(3);
select ok(consume_my_voice_quota(), 'the 39th use of the hour is allowed');
reset role;
select pg_temp.as_service();
set local role service_role;
select ok(consume_voice_interpretation_quota(pg_temp.profile(3)), 'the 40th use of the hour (a Tasks note) is allowed');
select ok(not consume_voice_interpretation_quota(pg_temp.profile(3)), 'Tasks voice is refused once Kiara and Tasks together reach 40');
reset role;
set local role authenticated;
select pg_temp.as_user(3);
select ok(not consume_my_voice_quota(), 'Kiara voice is refused once the shared allowance is spent');
reset role;
select is(pg_temp.spent(3), 40, 'a refused call spends nothing more');

update voice_interpretation_quotas set window_started_at = now() - interval '61 minutes' where user_profile_id = pg_temp.profile(3);
set local role authenticated;
select pg_temp.as_user(3);
select ok(consume_my_voice_quota(), 'a new hour starts a new window');
reset role;
select is(pg_temp.spent(3), 1, 'the new window counts from one');

-- ---------------------------------------------------------------------------
-- Transcription is not a Kiara question
-- ---------------------------------------------------------------------------
select is((select count(*)::integer from kiara_messages m join kiara_conversations c on c.id = m.conversation_id where c.user_profile_id = pg_temp.profile(3)), 0, 'transcription stores no Kiara message');
set local role authenticated;
select pg_temp.as_user(3);
select is((get_my_kiara_quota() ->> 'used')::integer, 0, 'transcription does not use a daily Kiara question');
reset role;
select is((select count(*)::integer from audit_logs where tenant_id = '22810000-0000-4000-8000-000000000001'), 0, 'transcription writes no audit row (it is logged by shape in the function)');

select * from finish();
rollback;
