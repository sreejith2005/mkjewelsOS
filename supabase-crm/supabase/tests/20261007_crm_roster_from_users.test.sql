-- CRM roster from JewelOS Users and Availability (20261007000900): roster rows follow the
-- JewelOS CRM role; absences follow JewelOS Availability; takeover of pre-sync rows; name
-- conflicts; reconciliation; staff can no longer write the roster. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.crm_allocation', 'insert'), 'staff cannot add roster rows');
select ok(not has_table_privilege('authenticated', 'public.crm_allocation', 'update'), 'staff cannot edit roster rows');
select ok(not has_table_privilege('authenticated', 'public.crm_allocation', 'delete'), 'staff cannot delete roster rows');
select ok(has_table_privilege('authenticated', 'public.crm_allocation', 'select'), 'staff still read the roster');
select ok(not has_table_privilege('authenticated', 'public.crm_daily_availability', 'insert'), 'staff cannot mark absences');
select ok(not has_table_privilege('authenticated', 'public.crm_daily_availability', 'delete'), 'staff cannot clear absences');
select ok(has_table_privilege('authenticated', 'public.crm_daily_availability', 'select'), 'staff still read availability');
select ok(not has_function_privilege('authenticated', 'public.manage_crm_roster(text,uuid,uuid,text,uuid,uuid)', 'execute'), 'the manual roster RPC is closed');
select ok(not has_function_privilege('authenticated', 'crm_private.apply_staff_roster(uuid,uuid,text,boolean,jsonb)', 'execute'), 'the roster step is internal');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'), 0,
  'anon still has no table privileges');

-- ---------------------------------------------------------------------------
-- Fixtures: CRM branches A and B mapped to JewelOS branches; a pre-sync roster row.
-- ---------------------------------------------------------------------------
insert into branches(id, name, jewelos_branch_id) values
('20261007-0000-4000-8000-00000000000a', 'Roster Branch A', '20261007-1111-4000-8000-00000000000a'),
('20261007-0000-4000-8000-00000000000b', 'Roster Branch B', '20261007-1111-4000-8000-00000000000b');
insert into crm_allocation(branch_id, crm_name, active) values
('20261007-0000-4000-8000-00000000000a', 'PRIYA OLD', true),
('20261007-0000-4000-8000-00000000000a', 'GONE PERSON', true);

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
-- p_days: offsets from today that JewelOS says are unavailable.
create function pg_temp.snap(p_person text, p_name text, p_role text, p_branch text, p_roster boolean,
  p_days int[], p_at text, p_eligible boolean default true) returns jsonb language sql as $$
  select jsonb_build_object('jewelos_user_id', '20261007-3333-4000-8000-0000000000' || p_person, 'present', true,
    'name', p_name, 'email', 'roster-' || p_person || '@example.invalid', 'crm_role', p_role,
    'jewelos_branch_id', case when p_branch is null then null else '20261007-1111-4000-8000-00000000000' || p_branch end,
    'eligible', p_eligible, 'crm_roster', p_roster,
    'availability_from', pg_temp.today(), 'availability_to', pg_temp.today() + 30,
    'unavailable_dates', coalesce((select jsonb_agg(pg_temp.today() + d) from unnest(p_days) d), '[]'::jsonb),
    'snapshot_at', p_at);
$$;
create function pg_temp.jid(p_person text) returns uuid language sql as $$
  select ('20261007-3333-4000-8000-0000000000' || p_person)::uuid;
$$;
create function pg_temp.uid(p_person text) returns uuid language sql security definer as $$
  select legacy_crm_user_id from crm_sso_access_grants where jewelos_user_id = pg_temp.jid(p_person);
$$;
create function pg_temp.apply(p_event text, p_snapshot jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  return public.crm_apply_staff_snapshot(p_event, p_snapshot);
end $$;
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user)::text, true),
         set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.today(), pg_temp.snap(text, text, text, text, boolean, int[], text, boolean), pg_temp.jid(text),
  pg_temp.uid(text), pg_temp.act_as(uuid), pg_temp.apply(text, jsonb) to authenticated, service_role;
-- Active roster rows of a person, as "NAME@branch-letter".
create function pg_temp.roster(p_person text) returns text language sql security definer as $$
  select coalesce(string_agg(a.crm_name || '@' || right(a.branch_id::text, 1), ',' order by a.crm_name), '')
  from crm_allocation a where a.crm_user_id = pg_temp.uid(p_person) and a.active;
$$;
-- Absence offsets from today for a branch-letter and name.
create function pg_temp.absent(p_branch text, p_name text) returns int[] language sql security definer as $$
  select coalesce(array_agg(d.date - pg_temp.today() order by d.date), '{}')
  from crm_daily_availability d
  where d.branch_id = ('20261007-0000-4000-8000-00000000000' || p_branch)::uuid and d.crm_name = p_name and not d.is_available;
$$;

-- ---------------------------------------------------------------------------
-- A JewelOS CRM-role person is on the roster with their absences
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('r-01', pg_temp.snap('01', 'Ravi  Kumar', 'salesperson', 'a', true, '{0,2}', '2026-10-07T10:00:00Z')) ->> 'roster',
  'on', 'a CRM-role person is put on the roster');
reset role;
select is(pg_temp.roster('01'), 'RAVI KUMAR@a', 'one active row, in their branch, under the normalized name');
select is(pg_temp.absent('a', 'RAVI KUMAR'), '{0,2}'::int[], 'today and the day after tomorrow are absences');

-- A past absence is history and stays when a new snapshot replaces the window.
insert into crm_daily_availability(branch_id, crm_name, date, is_available)
values ('20261007-0000-4000-8000-00000000000a', 'RAVI KUMAR', pg_temp.today() - 1, false);
select is(pg_temp.apply('r-01b', pg_temp.snap('01', 'Ravi Kumar', 'salesperson', 'a', true, '{5}', '2026-10-07T11:00:00Z')) ->> 'unavailable_days',
  '1', 'the new window is written');
reset role;
select is(pg_temp.absent('a', 'RAVI KUMAR'), '{-1,5}'::int[], 'JewelOS Availability replaces today onwards; the past stays');

-- ---------------------------------------------------------------------------
-- Other roles are not on the roster
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('r-02', pg_temp.snap('02', 'Sunil Staff', 'salesperson', 'a', false, '{}', '2026-10-07T10:00:00Z')) ->> 'roster',
  'off', 'a Staff-role person gets CRM access but no roster row');
select is(pg_temp.apply('r-03', pg_temp.snap('03', 'Meena Manager', 'branch_manager', 'a', false, '{}', '2026-10-07T10:00:00Z')) ->> 'outcome',
  'granted', 'a manager is granted');
reset role;
select is(pg_temp.roster('02') || pg_temp.roster('03'), '', 'neither has a roster row');

-- ---------------------------------------------------------------------------
-- A pre-sync row with the same name is taken over
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('r-04', pg_temp.snap('04', 'Priya Old', 'salesperson', 'a', true, '{}', '2026-10-07T10:00:00Z')) ->> 'roster',
  'on', 'a person whose name matches a pre-sync row is on the roster');
reset role;
select is((select count(*)::int from crm_allocation where branch_id = '20261007-0000-4000-8000-00000000000a' and crm_name = 'PRIYA OLD'), 1,
  'the pre-sync row is reused, not duplicated');
select is((select crm_user_id from crm_allocation where crm_name = 'PRIYA OLD'), pg_temp.uid('04'), 'and now belongs to the person');

-- ---------------------------------------------------------------------------
-- Same name, another synced person, same branch: conflict, not merged
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('r-05', pg_temp.snap('05', 'Ravi Kumar', 'salesperson', 'a', true, '{1}', '2026-10-07T10:00:00Z')) ->> 'roster',
  'conflict', 'a second person with the same name in the branch is a conflict');
reset role;
select is(pg_temp.roster('05'), '', 'the second person is not put on the roster');
select is(pg_temp.roster('01'), 'RAVI KUMAR@a', 'the first person keeps their row');
select is(pg_temp.absent('a', 'RAVI KUMAR'), '{-1,5}'::int[], 'and their absences');

-- ---------------------------------------------------------------------------
-- Rename and branch move; role change; loss of access
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('r-01c', pg_temp.snap('01', 'Ravi K', 'salesperson', 'b', true, '{3}', '2026-10-07T12:00:00Z')) ->> 'roster',
  'on', 'a renamed, moved person stays on the roster');
reset role;
select is(pg_temp.roster('01'), 'RAVI K@b', 'the row is renamed and moved');
select is(pg_temp.absent('b', 'RAVI K'), '{3}'::int[], 'absences are written under the new branch and name');
select is(pg_temp.absent('a', 'RAVI KUMAR'), '{-1}'::int[], 'future absences under the old name are cleared, the past stays');
select is((select count(*)::int from crm_allocation where crm_user_id = pg_temp.uid('01')), 1, 'the person still has one row');

select is(pg_temp.apply('r-05b', pg_temp.snap('05', 'Ravi Kumar', 'salesperson', 'a', true, '{1}', '2026-10-07T12:30:00Z')) ->> 'roster',
  'on', 'once the name is free, the second person joins the roster');
reset role;
select is(pg_temp.absent('a', 'RAVI KUMAR'), '{-1,1}'::int[], 'with their own absences');

select is(pg_temp.apply('r-01d', pg_temp.snap('01', 'Ravi K', 'salesperson', 'b', false, '{}', '2026-10-07T13:00:00Z')) ->> 'roster',
  'off', 'a role change away from CRM takes the person off the roster');
reset role;
select is(pg_temp.roster('01'), '', 'no active row remains');
select is(pg_temp.absent('b', 'RAVI K'), '{}'::int[], 'and their future absences are cleared');
select is((select count(*)::int from crm_allocation where crm_user_id = pg_temp.uid('01')), 1, 'the row is kept as history');

select is(pg_temp.apply('r-01e', pg_temp.snap('01', 'Ravi K', 'salesperson', 'b', true, '{}', '2026-10-07T14:00:00Z')) ->> 'roster',
  'on', 'back to the CRM role: back on the roster');
select is(pg_temp.apply('r-01f', pg_temp.snap('01', 'Ravi K', 'salesperson', 'b', true, '{}', '2026-10-07T15:00:00Z', false)) ->> 'outcome',
  'deactivated', 'losing CRM access in JewelOS');
reset role;
select is(pg_temp.roster('01'), '', 'takes the person off the roster');

-- A snapshot from JewelOS before 0201 (no crm_roster) does not create roster rows.
select is(pg_temp.apply('r-06', pg_temp.snap('06', 'Old Format', 'salesperson', 'a', null, '{}', '2026-10-07T10:00:00Z') - 'crm_roster') ->> 'outcome',
  'granted', 'an old-format snapshot is still applied');
reset role;
select is(pg_temp.roster('06'), '', 'without creating a roster row');

-- ---------------------------------------------------------------------------
-- The walk-in round robin uses the JewelOS roster and skips today's absences
-- ---------------------------------------------------------------------------
update crm_sso_access_grants set crm_auth_user_id = legacy_crm_user_id where jewelos_user_id = pg_temp.jid('03');
select is(pg_temp.apply('r-07', pg_temp.snap('07', 'Asha Present', 'salesperson', 'a', true, '{}', '2026-10-07T10:00:00Z')) ->> 'roster',
  'on', 'a present CRM person is on the roster');
select is(pg_temp.apply('r-08', pg_temp.snap('08', 'Bala Absent', 'salesperson', 'a', true, '{0}', '2026-10-07T10:00:00Z')) ->> 'roster',
  'on', 'an absent CRM person is on the roster');
reset role;
set local role authenticated;
select pg_temp.act_as(pg_temp.uid('03'));
create temporary table picks on commit drop as
select assign_next_available_crm('20261007-0000-4000-8000-00000000000a') as name from generate_series(1, 8);
select ok(exists (select 1 from picks where name = 'ASHA PRESENT'), 'the round robin assigns a present CRM person');
select ok(not exists (select 1 from picks where name = 'BALA ABSENT'), 'and never one absent today in JewelOS');
select ok(not exists (select 1 from picks where name = 'SUNIL STAFF'), 'nor a Staff-role person');
select throws_ok($$insert into crm_daily_availability(branch_id, crm_name, date, is_available)
  values ('20261007-0000-4000-8000-00000000000a', 'ASHA PRESENT', (now() at time zone 'Asia/Kolkata')::date, false)$$,
  '42501', null, 'a manager can no longer mark someone absent in the CRM');
select throws_ok($$select * from manage_crm_roster('ADD', null, '20261007-0000-4000-8000-00000000000a', null, null, null)$$,
  '42501', null, 'a manager can no longer add roster rows');
reset role;

-- ---------------------------------------------------------------------------
-- Reconciliation retires roster rows no synced person holds
-- ---------------------------------------------------------------------------
update crm_sso_access_grants set active = false where jewelos_user_id::text not like '20261007-3333-%';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temporary table reconcile_result on commit drop as
select public.crm_reconcile_staff_roster('roster-run-1', jsonb_build_array(
  pg_temp.snap('04', 'Priya Old', 'salesperson', 'a', true, '{}', '2026-10-08T00:00:00Z'),
  pg_temp.snap('05', 'Ravi Kumar', 'salesperson', 'a', true, '{}', '2026-10-08T00:00:00Z'),
  pg_temp.snap('07', 'Asha Present', 'salesperson', 'a', true, '{}', '2026-10-08T00:00:00Z'),
  pg_temp.snap('08', 'Bala Absent', 'salesperson', 'a', true, '{}', '2026-10-08T00:00:00Z')
)) as counts;
reset role;
select ok((select (counts ->> 'roster_unheld_deactivated')::int from reconcile_result) >= 1, 'an unheld pre-sync row is retired');
select is((select (counts ->> 'roster_rows_without_user')::int from reconcile_result), 0, 'no active row is left without a person');
select ok(not (select active from crm_allocation where crm_name = 'GONE PERSON'), 'the unheld row is inactive');
select is((select count(*)::int from crm_allocation where crm_name = 'GONE PERSON'), 1, 'and kept as history');
select is(pg_temp.absent('a', 'BALA ABSENT'), '{}'::int[], 'reconciliation refreshes absences (back at work)');
select ok(not exists (select 1 from crm_private.audit_logs where action like 'crm.staff_sync_%'
  and (details::text ilike '%@example.invalid%' or details::text ilike '%Ravi%')), 'sync audit rows carry no names or emails');

select * from finish();
rollback;
