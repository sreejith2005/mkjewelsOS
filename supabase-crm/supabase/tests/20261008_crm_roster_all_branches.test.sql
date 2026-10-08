-- CRM department on every branch roster (20261008000100): one row per active branch, each
-- with the person's absences; per-branch name conflicts; back to one branch; round robin.
-- Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Only fixture branches are active for this test (rolled back).
update branches set active = false;
insert into branches(id, name, jewelos_branch_id) values
('20261008-0000-4000-8000-00000000000a', 'All Branch A', '20261008-1111-4000-8000-00000000000a'),
('20261008-0000-4000-8000-00000000000b', 'All Branch B', '20261008-1111-4000-8000-00000000000b'),
('20261008-0000-4000-8000-00000000000c', 'All Branch C', null);

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function pg_temp.snap(p_person text, p_name text, p_role text, p_branch text, p_all boolean,
  p_days int[], p_at text) returns jsonb language sql as $$
  select jsonb_build_object('jewelos_user_id', '20261008-3333-4000-8000-0000000000' || p_person, 'present', true,
    'name', p_name, 'email', 'all-' || p_person || '@example.invalid', 'crm_role', p_role,
    'jewelos_branch_id', case when p_branch is null then null else '20261008-1111-4000-8000-00000000000' || p_branch end,
    'eligible', true, 'crm_roster', true, 'crm_roster_all_branches', p_all,
    'availability_from', pg_temp.today(), 'availability_to', pg_temp.today() + 30,
    'unavailable_dates', coalesce((select jsonb_agg(pg_temp.today() + d) from unnest(p_days) d), '[]'::jsonb),
    'snapshot_at', p_at);
$$;
create function pg_temp.jid(p_person text) returns uuid language sql as $$
  select ('20261008-3333-4000-8000-0000000000' || p_person)::uuid $$;
create function pg_temp.uid(p_person text) returns uuid language sql security definer as $$
  select legacy_crm_user_id from crm_sso_access_grants where jewelos_user_id = pg_temp.jid(p_person) $$;
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
-- Active roster branches of a person, as letters.
create function pg_temp.branches_of(p_person text) returns text language sql security definer as $$
  select coalesce(string_agg(right(a.branch_id::text, 1), '' order by a.branch_id), '')
  from crm_allocation a where a.crm_user_id = pg_temp.uid(p_person) and a.active $$;
create function pg_temp.absent_in(p_name text) returns text language sql security definer as $$
  select coalesce(string_agg(right(d.branch_id::text, 1), '' order by d.branch_id), '')
  from crm_daily_availability d where d.crm_name = p_name and d.date = pg_temp.today() and not d.is_available $$;
grant execute on function pg_temp.today(), pg_temp.snap(text, text, text, text, boolean, int[], text), pg_temp.jid(text),
  pg_temp.uid(text), pg_temp.apply(text, jsonb), pg_temp.act_as(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A CRM-department member is on every active branch
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('a-01', pg_temp.snap('01', 'Kiran Crm', 'salesperson', 'b', true, '{0}', '2026-10-08T10:00:00Z')) ->> 'roster_branches',
  '3', 'one roster row for each active branch');
reset role;
select is(pg_temp.branches_of('01'), 'abc', 'in every active branch, mapped or not');
select is(pg_temp.absent_in('KIRAN CRM'), 'abc', 'today''s JewelOS absence applies in every branch');
select is((pg_temp.uid('01') is not null and (select branch_id from users where id = pg_temp.uid('01')) = '20261008-0000-4000-8000-00000000000b'::uuid),
  true, 'the CRM user keeps their own home branch');

select is(pg_temp.apply('a-01b', pg_temp.snap('01', 'Kiran Crm', 'salesperson', 'b', true, '{}', '2026-10-08T11:00:00Z')) ->> 'roster',
  'on', 'a later snapshot');
reset role;
select is(pg_temp.absent_in('KIRAN CRM'), '', 'clears the absence in every branch');
select is((select count(*)::int from crm_allocation where crm_user_id = pg_temp.uid('01')), 3, 'without adding rows');

-- ---------------------------------------------------------------------------
-- A name taken in one branch by another synced person: conflict there only
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('a-02', pg_temp.snap('02', 'Same Name', 'salesperson', 'a', false, '{}', '2026-10-08T10:00:00Z')) ->> 'roster',
  'on', 'a one-branch person in branch A');
select is(pg_temp.apply('a-03', pg_temp.snap('03', 'Same Name', 'salesperson', 'b', true, '{}', '2026-10-08T10:00:00Z')) ->> 'roster_conflicts',
  '1', 'an all-branch person with the same name conflicts in that branch');
reset role;
select is(pg_temp.branches_of('03'), 'bc', 'and is on the other branches');
select is(pg_temp.branches_of('02'), 'a', 'the first person keeps their row');

-- ---------------------------------------------------------------------------
-- Leaving the CRM department: back to the own branch only
-- ---------------------------------------------------------------------------
insert into crm_daily_availability(branch_id, crm_name, date, is_available)
values ('20261008-0000-4000-8000-00000000000c', 'KIRAN CRM', pg_temp.today() + 2, false);
select is(pg_temp.apply('a-01c', pg_temp.snap('01', 'Kiran Crm', 'salesperson', 'b', false, '{}', '2026-10-08T12:00:00Z')) ->> 'roster_branches',
  '1', 'without the all-branches flag the person is on one branch');
reset role;
select is(pg_temp.branches_of('01'), 'b', 'their own branch');
select is((select count(*)::int from crm_daily_availability where crm_name = 'KIRAN CRM' and date >= pg_temp.today()), 0,
  'future absences of the rows they left are cleared');
select is((select count(*)::int from crm_allocation where crm_user_id = pg_temp.uid('01')), 3, 'the rows are kept as history');

-- ---------------------------------------------------------------------------
-- The round robin of any branch assigns an all-branch person
-- ---------------------------------------------------------------------------
select is(pg_temp.apply('a-04', pg_temp.snap('04', 'Branch Boss', 'branch_manager', 'a', false, '{}', '2026-10-08T10:00:00Z')) ->> 'outcome',
  'granted', 'a branch manager of A');
reset role;
update crm_allocation set active = false where crm_user_id = pg_temp.uid('04');
update crm_sso_access_grants set crm_auth_user_id = legacy_crm_user_id where jewelos_user_id = pg_temp.jid('04');
set local role authenticated;
select pg_temp.act_as(pg_temp.uid('04'));
create temporary table picks on commit drop as
select assign_next_available_crm('20261008-0000-4000-8000-00000000000a') as name from generate_series(1, 6);
select ok(exists (select 1 from picks where name = 'SAME NAME'), 'branch A assigns among its roster');
reset role;

select * from finish();
rollback;
