-- CRM department roster per franchise (20261107000100): with
-- crm_roster_jewelos_branch_ids the person joins only their franchise's stores;
-- without it, every active branch as before. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update branches set active = false;
-- a, b: Mumbai stores; c: Ahmedabad store; d: unmapped CRM branch.
insert into branches(id, name, jewelos_branch_id) values
('20261107-0000-4000-8000-00000000000a', 'Franchise Bandra', '20261107-1111-4000-8000-00000000000a'),
('20261107-0000-4000-8000-00000000000b', 'Franchise Andheri', '20261107-1111-4000-8000-00000000000b'),
('20261107-0000-4000-8000-00000000000c', 'Franchise Ahmedabad', '20261107-1111-4000-8000-00000000000c'),
('20261107-0000-4000-8000-00000000000d', 'Franchise Unmapped', null);

create function pg_temp.snap(p_person text, p_name text, p_scope jsonb, p_at text) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('jewelos_user_id', '20261107-3333-4000-8000-0000000000' || p_person, 'present', true,
    'name', p_name, 'email', 'fr-' || p_person || '@example.invalid', 'crm_role', 'salesperson',
    'jewelos_branch_id', '20261107-1111-4000-8000-00000000000a',
    'eligible', true, 'crm_roster', true, 'crm_roster_all_branches', true, 'crm_roster_jewelos_branch_ids', p_scope,
    'availability_from', (now() at time zone 'Asia/Kolkata')::date, 'availability_to', (now() at time zone 'Asia/Kolkata')::date + 30,
    'unavailable_dates', '[]'::jsonb, 'snapshot_at', p_at));
$$;
create function pg_temp.uid(p_person text) returns uuid language sql security definer as $$
  select legacy_crm_user_id from crm_sso_access_grants where jewelos_user_id = ('20261107-3333-4000-8000-0000000000' || p_person)::uuid $$;
create function pg_temp.apply(p_event text, p_snapshot jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  return public.crm_apply_staff_snapshot(p_event, p_snapshot);
end $$;
create function pg_temp.branches_of(p_person text) returns text language sql security definer as $$
  select coalesce(string_agg(right(a.branch_id::text, 1), '' order by a.branch_id), '')
  from crm_allocation a where a.crm_user_id = pg_temp.uid(p_person) and a.active $$;
grant execute on function pg_temp.snap(text, text, jsonb, text), pg_temp.uid(text), pg_temp.apply(text, jsonb) to authenticated, service_role;

select is(pg_temp.apply('f-01', pg_temp.snap('01', 'Mumbai Crm', null, '2026-11-07T10:00:00Z')) ->> 'roster_branches', '4',
  'isolation off: the CRM department is on every active branch, as before');
reset role;
select is(pg_temp.branches_of('01'), 'abcd', 'every branch, mapped or not');

select pg_temp.apply('f-02', pg_temp.snap('01', 'Mumbai Crm',
  '["20261107-1111-4000-8000-00000000000a","20261107-1111-4000-8000-00000000000b"]'::jsonb, '2026-11-07T11:00:00Z'));
reset role;
select is(pg_temp.branches_of('01'), 'ab', 'isolation on: only the stores of the person''s own franchise');
select is((select count(*)::int from crm_allocation where crm_user_id = pg_temp.uid('01') and not active), 2,
  'the other franchise''s rows become inactive, nothing is deleted');

select pg_temp.apply('f-03', pg_temp.snap('02', 'Ahmedabad Crm', '["20261107-1111-4000-8000-00000000000c"]'::jsonb, '2026-11-07T11:00:00Z'));
reset role;
select is(pg_temp.branches_of('02'), 'c', 'an Ahmedabad CRM member joins only the Ahmedabad store');

select pg_temp.apply('f-04', pg_temp.snap('01', 'Mumbai Crm', null, '2026-11-07T12:00:00Z'));
reset role;
select is(pg_temp.branches_of('01'), 'abcd', 'switching isolation off restores the company-wide roster');

select * from finish();
rollback;
