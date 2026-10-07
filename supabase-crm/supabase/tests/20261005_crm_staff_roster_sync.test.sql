-- CRM roster sync (20261005000100): JewelOS staff snapshots applied to users, grants and
-- the roster; idempotency and ordering; fail-closed cases; owner-approved link list;
-- roster rows follow the person (old-format snapshots); reconciliation; sync health. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.crm_apply_staff_snapshot(text,jsonb)', 'execute'), 'staff cannot apply snapshots');
select ok(not has_function_privilege('anon', 'public.crm_apply_staff_snapshot(text,jsonb)', 'execute'), 'anon cannot apply snapshots');
select ok(not has_function_privilege('authenticated', 'public.crm_reconcile_staff_roster(text,jsonb)', 'execute'), 'staff cannot reconcile');
select ok(has_function_privilege('service_role', 'public.crm_apply_staff_snapshot(text,jsonb)', 'execute'), 'the sync receiver can apply snapshots');
select ok(not has_table_privilege('authenticated', 'public.users', 'insert'), 'staff cannot create CRM users');
select ok(not has_table_privilege('authenticated', 'public.users', 'update'), 'staff cannot edit CRM users');
select ok(not has_table_privilege('authenticated', 'public.users', 'delete'), 'staff cannot delete CRM users');
select ok(not has_table_privilege('authenticated', 'crm_private.staff_links', 'select'), 'the link list is private');
select ok(not has_table_privilege('service_role', 'crm_private.sync_inbox', 'select'), 'the inbox is reached only through the RPCs');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'), 0,
  'anon still has no table privileges');

-- ---------------------------------------------------------------------------
-- Fixtures
--   CRM branches A (JewelOS JA) and B (JewelOS JB); JewelOS branch JC has no CRM branch.
--   A historical CRM user H (email legacy-h@example.invalid) with history.
-- ---------------------------------------------------------------------------
insert into branches(id, name, jewelos_branch_id) values
('20261005-0000-4000-8000-00000000000a', 'Sync Branch A', '20261005-1111-4000-8000-00000000000a'),
('20261005-0000-4000-8000-00000000000b', 'Sync Branch B', '20261005-1111-4000-8000-00000000000b');
insert into users(id, name, email, role, branch_id, active) values
('20261005-2222-4000-8000-0000000000a1', 'Historic Helen', 'legacy-h@example.invalid', 'salesperson', '20261005-0000-4000-8000-00000000000a', true),
('20261005-2222-4000-8000-0000000000a2', 'Historic Other', 'legacy-o@example.invalid', 'salesperson', '20261005-0000-4000-8000-00000000000a', true);
insert into crm_allocation(branch_id, crm_name, active) values ('20261005-0000-4000-8000-00000000000a', 'LEGACY NAME', true);

create function pg_temp.snap(p_person text, p_name text, p_email text, p_role text, p_branch text,
  p_eligible boolean, p_at text, p_present boolean default true) returns jsonb language sql as $$
  select jsonb_build_object('jewelos_user_id', '20261005-3333-4000-8000-0000000000' || p_person, 'present', p_present,
    'name', p_name, 'email', p_email, 'crm_role', p_role,
    'jewelos_branch_id', case when p_branch is null then null else '20261005-1111-4000-8000-00000000000' || p_branch end,
    'eligible', p_eligible, 'snapshot_at', p_at);
$$;
create function pg_temp.jid(p_person text) returns uuid language sql as $$
  select ('20261005-3333-4000-8000-0000000000' || p_person)::uuid;
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user)::text, true),
         set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.snap(text, text, text, text, text, boolean, text, boolean), pg_temp.jid(text),
  pg_temp.as_service(), pg_temp.act_as(uuid) to authenticated, service_role;
create function pg_temp.grant_of(p_person text) returns crm_sso_access_grants language sql security definer as $$
  select * from crm_sso_access_grants where jewelos_user_id = pg_temp.jid(p_person);
$$;
create function pg_temp.user_of(p_person text) returns users language sql security definer as $$
  select u.* from users u join crm_sso_access_grants g on g.legacy_crm_user_id = u.id where g.jewelos_user_id = pg_temp.jid(p_person);
$$;
grant execute on function pg_temp.grant_of(text), pg_temp.user_of(text) to authenticated, service_role;
-- The login bridge links a grant's session on first sign-in; tests do the same directly.
create function pg_temp.link_session(p_person text) returns void language sql as $$
  update crm_sso_access_grants set crm_auth_user_id = legacy_crm_user_id where jewelos_user_id = pg_temp.jid(p_person);
$$;

-- ---------------------------------------------------------------------------
-- A new eligible salesperson is provisioned
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-01', pg_temp.snap('01', 'Asha Sales', 'asha@example.invalid', 'salesperson', 'a', true, '2026-10-05T10:00:00Z')) ->> 'outcome',
  'granted', 'an eligible person is granted');
reset role;
select is((pg_temp.user_of('01')).name::text, 'Asha Sales', 'a CRM user is created with the JewelOS name');
select is((pg_temp.user_of('01')).role::text, 'salesperson', 'with the mapped role');
select is((pg_temp.user_of('01')).branch_id, '20261005-0000-4000-8000-00000000000a'::uuid, 'in the mapped CRM branch');
select ok((pg_temp.grant_of('01')).active, 'the grant is active');
select is((pg_temp.grant_of('01')).crm_auth_user_id, null, 'the session is linked later by the bridge');

set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-01', pg_temp.snap('01', 'Changed', 'asha@example.invalid', 'salesperson', 'a', true, '2026-10-05T11:00:00Z')) ->> 'duplicate',
  'true', 'a redelivered event is applied once');
select is(public.crm_apply_staff_snapshot('e-01-old', pg_temp.snap('01', 'Old name', 'asha@example.invalid', 'salesperson', 'a', true, '2026-10-05T09:00:00Z')) ->> 'outcome',
  'stale', 'an older snapshot is ignored');
reset role;
select is((pg_temp.user_of('01')).name::text, 'Asha Sales', 'duplicate and stale events change nothing');

-- ---------------------------------------------------------------------------
-- A branch manager, a super admin, roster picking
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-02', pg_temp.snap('02', 'Mira Manager', 'mira@example.invalid', 'branch_manager', 'a', true, '2026-10-05T10:00:00Z')) ->> 'outcome',
  'granted', 'a branch manager is granted');
select is(public.crm_apply_staff_snapshot('e-03', pg_temp.snap('03', 'Sam Super', 'sam@example.invalid', 'super_admin', null, true, '2026-10-05T10:00:00Z')) ->> 'outcome',
  'granted', 'a super admin needs no branch');
select is(public.crm_apply_staff_snapshot('e-04', pg_temp.snap('04', 'Bina B', 'bina@example.invalid', 'salesperson', 'b', true, '2026-10-05T10:00:00Z')) ->> 'outcome',
  'granted', 'a salesperson of branch B is granted');
reset role;
select is((pg_temp.user_of('03')).branch_id, null, 'the super admin has no branch');
select pg_temp.link_session('01'); select pg_temp.link_session('02'); select pg_temp.link_session('04');

set local role authenticated;
select pg_temp.act_as((pg_temp.user_of('02')).id);
select is(current_user_role()::text, 'branch_manager', 'the synced manager signs in through the gate');
-- Since 20261007000100 the roster follows JewelOS: staff can no longer edit it.
select throws_ok(format($$select * from manage_crm_roster('ADD', null, '20261005-0000-4000-8000-00000000000a', null, null, %L)$$, (pg_temp.user_of('01')).id),
  '42501', null, 'the manual roster RPC is closed');
select throws_ok($$insert into crm_allocation(branch_id, crm_name) values ('20261005-0000-4000-8000-00000000000a', 'DIRECT NAME')$$,
  '42501', null, 'a direct roster insert is refused');
select throws_ok($$insert into users(id, name, email, role, branch_id) values (gen_random_uuid(), 'X', 'x@example.invalid', 'salesperson', '20261005-0000-4000-8000-00000000000a')$$,
  '42501', null, 'staff cannot create a CRM user directly');
reset role;
insert into crm_allocation(branch_id, crm_name, active, crm_user_id)
values ('20261005-0000-4000-8000-00000000000a', 'ASHA SALES', true, (pg_temp.user_of('01')).id);

-- availability exceptions for today and yesterday, under the old name
insert into crm_daily_availability(branch_id, crm_name, date, is_available) values
('20261005-0000-4000-8000-00000000000a', 'ASHA SALES', (now() at time zone 'Asia/Kolkata')::date, false),
('20261005-0000-4000-8000-00000000000a', 'ASHA SALES', (now() at time zone 'Asia/Kolkata')::date - 1, false);

-- ---------------------------------------------------------------------------
-- Rename and branch move follow the person
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-01-move', pg_temp.snap('01', 'Asha  Rao', 'asha@example.invalid', 'salesperson', 'b', true, '2026-10-05T12:00:00Z')) ->> 'renamed',
  'true', 'a rename is reported');
reset role;
select is((pg_temp.user_of('01')).name::text, 'Asha  Rao', 'the CRM user is renamed');
select is((pg_temp.user_of('01')).branch_id, '20261005-0000-4000-8000-00000000000b'::uuid, 'the CRM user moves branch');
select is((select crm_name::text || '@' || branch_id::text from crm_allocation where crm_user_id = (pg_temp.user_of('01')).id),
  'ASHA RAO@20261005-0000-4000-8000-00000000000b', 'the roster row is renamed and moved');
select is((select count(*)::int from crm_daily_availability where crm_name = 'ASHA RAO' and branch_id = '20261005-0000-4000-8000-00000000000b'), 1,
  'today''s availability exception moves with the person');
select is((select count(*)::int from crm_daily_availability where crm_name = 'ASHA SALES'), 1, 'past availability is history and stays');

-- ---------------------------------------------------------------------------
-- Deactivation fails closed; reactivation restores
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-01-off', pg_temp.snap('01', 'Asha  Rao', 'asha@example.invalid', 'salesperson', 'b', false, '2026-10-05T13:00:00Z')) ->> 'outcome',
  'deactivated', 'an ineligible person is deactivated');
reset role;
select ok(not (pg_temp.grant_of('01')).active, 'the grant is inactive');
select ok(not (pg_temp.user_of('01')).active, 'the CRM user is inactive (kept, not deleted)');
select ok(not (select active from crm_allocation where crm_user_id = (pg_temp.user_of('01')).id), 'the roster row is inactive');
set local role authenticated;
select pg_temp.act_as((pg_temp.user_of('01')).id);
select is(current_crm_user_id(), null, 'a deactivated person no longer passes the gate');
reset role;

set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-01-on', pg_temp.snap('01', 'Asha  Rao', 'asha@example.invalid', 'salesperson', 'b', true, '2026-10-05T14:00:00Z')) ->> 'created',
  'false', 'reactivation reuses the same CRM user');
reset role;
select ok((pg_temp.user_of('01')).active and (pg_temp.grant_of('01')).active, 'reactivation restores user and grant');
select ok((select active from crm_allocation where crm_user_id = (pg_temp.user_of('01')).id), 'and the roster row');

set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-04-del', pg_temp.snap('04', null, null, null, null, false, '2026-10-05T14:00:00Z', false)) ->> 'reason',
  'deleted', 'a deleted JewelOS profile is deactivated');
reset role;
select ok(not (pg_temp.grant_of('04')).active, 'the deleted person''s grant is inactive');
select is((select count(*)::int from users where id = (select legacy_crm_user_id from crm_sso_access_grants where jewelos_user_id = pg_temp.jid('04'))), 1,
  'the deleted person''s CRM user is kept');

-- ---------------------------------------------------------------------------
-- Blocked cases
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-02-c', pg_temp.snap('02', 'Mira Manager', 'mira@example.invalid', 'branch_manager', 'c', true, '2026-10-05T15:00:00Z')) ->> 'reason',
  'unmapped_branch', 'a JewelOS branch without a CRM branch is blocked');
reset role;
select ok(not (pg_temp.grant_of('02')).active, 'the blocked person''s existing grant is closed');

set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-05', pg_temp.snap('05', 'Helen New', 'Legacy-H@Example.invalid', 'salesperson', 'a', true, '2026-10-05T10:00:00Z')) ->> 'reason',
  'needs_link', 'an email held by a historical CRM user needs an owner-approved link');
select is(public.crm_apply_staff_snapshot('e-06', pg_temp.snap('06', 'Bad', 'not-an-email', 'salesperson', 'a', true, '2026-10-05T10:00:00Z')) ->> 'reason',
  'invalid_snapshot', 'an unusable snapshot is blocked');
select is(public.crm_apply_staff_snapshot('e-07', pg_temp.snap('07', 'No Role', 'norole@example.invalid', null, 'a', true, '2026-10-05T10:00:00Z')) ->> 'reason',
  'invalid_snapshot', 'a snapshot without a CRM role is blocked');
reset role;
select is((select count(*)::int from users where lower(email) = 'legacy-h@example.invalid'), 1, 'no second user is created for a historical email');
select is((pg_temp.grant_of('05')).id, null, 'no grant is created while a link is needed');

-- The owner-approved link list connects the historical user.
insert into crm_private.staff_links(jewelos_user_id, legacy_crm_user_id, approved_by)
values (pg_temp.jid('05'), '20261005-2222-4000-8000-0000000000a1', 'Owner (test)');
set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-05-linked', pg_temp.snap('05', 'Helen New', 'legacy-h@example.invalid', 'salesperson', 'a', true, '2026-10-05T11:00:00Z')) ->> 'linked',
  'true', 'a linked person takes over the historical CRM user');
reset role;
select is((pg_temp.grant_of('05')).legacy_crm_user_id, '20261005-2222-4000-8000-0000000000a1'::uuid, 'the grant points at the historical user');
select is((select name::text from users where id = '20261005-2222-4000-8000-0000000000a1'), 'Helen New', 'JewelOS is the source of the name');

set local role service_role;
select pg_temp.as_service();
select is(public.crm_apply_staff_snapshot('e-08', pg_temp.snap('08', 'Clash', 'legacy-h@example.invalid', 'salesperson', 'a', true, '2026-10-05T10:00:00Z')) ->> 'reason',
  'needs_link', 'another person with the same email is not given that user');
reset role;
select throws_ok($$insert into crm_private.staff_links(jewelos_user_id, legacy_crm_user_id, approved_by)
  values (pg_temp.jid('09'), '20261005-2222-4000-8000-0000000000a1', 'Owner (test)')$$, '23505', null,
  'a historical user can be linked to one JewelOS person only');

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------
-- Only fixture grants take part (a local database may hold other rows; rolled back).
update crm_sso_access_grants set active = false where jewelos_user_id::text not like '20261005-3333-%';
set local role service_role;
select pg_temp.as_service();
create temporary table reconcile_result on commit drop as
select public.crm_reconcile_staff_roster('run-1', jsonb_build_array(
  pg_temp.snap('01', 'Asha  Rao', 'asha@example.invalid', 'salesperson', 'b', true, '2026-10-06T00:00:00Z'),
  pg_temp.snap('03', 'Sam Super', 'sam@example.invalid', 'super_admin', null, false, '2026-10-06T00:00:00Z')
)) as counts;
select is((select (counts ->> 'absent_deactivated')::int from reconcile_result), 1, 'an active grant JewelOS no longer lists is deactivated');
select is((select (counts ->> 'active_for_ineligible')::int from reconcile_result), 0, 'no active grant remains for an ineligible person');
select is((select (counts ->> 'granted')::int from reconcile_result), 1, 'the run counts granted people');
select is((select coalesce((counts ->> 'not_eligible')::int, 0) + coalesce((counts ->> 'deactivated')::int, 0) from reconcile_result), 1, 'and deactivated people');
select is(public.crm_reconcile_staff_roster('run-1', '[]'::jsonb) ->> 'duplicate', 'true', 'a run id is applied once');
reset role;
select ok(not (pg_temp.grant_of('05')).active, 'the person absent from the run lost access');

-- ---------------------------------------------------------------------------
-- Audit and health
-- ---------------------------------------------------------------------------
select ok((select count(*) from crm_private.audit_logs where action = 'crm.staff_sync_apply') >= 10, 'each applied snapshot is audited');
select ok(not exists (select 1 from crm_private.audit_logs where action like 'crm.staff_sync_%'
  and (details::text ilike '%@example.invalid%' or details::text ilike '%Asha%')), 'sync audit rows carry no names or emails');
select is((select count(*)::int from crm_private.audit_logs where action = 'crm.staff_sync_reconcile' and details ->> 'run_id' = 'run-1'), 1, 'the reconciliation is audited');

set local role authenticated;
select pg_temp.act_as((pg_temp.user_of('01')).id);
select throws_ok($$select crm_sync_health()$$, '42501', null, 'a salesperson cannot read sync health');
reset role;
update crm_sso_access_grants set active = true where jewelos_user_id = pg_temp.jid('03');
update users set active = true where id = (select legacy_crm_user_id from crm_sso_access_grants where jewelos_user_id = pg_temp.jid('03'));
select pg_temp.link_session('03');
set local role authenticated;
select pg_temp.act_as((pg_temp.grant_of('03')).legacy_crm_user_id);
select ok((crm_sync_health() -> 'last_reconciliation' ->> 'run_id') = 'run-1', 'a super admin reads sync health');
select ok((crm_sync_health() -> 'blocked_staff') ? 'needs_link', 'sync health lists blocked reasons');
reset role;

select * from finish();
rollback;
