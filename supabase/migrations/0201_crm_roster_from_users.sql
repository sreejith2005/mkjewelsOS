-- CRM roster from JewelOS Users and Availability (2026-10-07 owner decision).
--
-- The CRM branch roster (who appears in the walk-in/queue CRM dropdowns and the round
-- robin) and "present today" are no longer kept by hand on the CRM ROSTER / ALLOCATION
-- page. They follow JewelOS:
-- - a person is on their branch roster exactly when their JewelOS role (Users > Role,
--   `user_profiles.user_role`) is `crm` and they have CRM access (the snapshot's
--   `eligible`). Dashboard authority cannot be `crm`, so it does not take a CRM person off
--   the roster;
-- - a person is absent in the CRM on a date exactly when JewelOS Availability says they
--   are not available for work that day (`is_user_available_for_task`: an absent entry,
--   including approved leave, a weekly off, or a non-active working status).
--
-- Every delivered staff snapshot (0195) gains four fields from crm_sync.staff_roster_fields():
-- crm_roster, availability_from, availability_to, unavailable_dates. They are merged in
-- the two delivery functions, so crm_sync.staff_snapshot() itself (access and identity) is
-- left to the migrations that own it. Availability and weekly-off changes enqueue the same
-- `staff.access_changed` event; the daily reconciliation sends every snapshot again, which
-- also moves the availability window forward each day. CRM-project side:
-- supabase-crm/supabase/migrations/20261007000100_crm_roster_from_users.sql.

set search_path = public, extensions;

-- Roster flag and the availability window: today (Asia/Kolkata) and the next 30 days.
create function crm_sync.staff_roster_fields(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile user_profiles;
  v_from date := (now() at time zone 'Asia/Kolkata')::date;
  v_to date := (now() at time zone 'Asia/Kolkata')::date + 30;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('crm_roster', false);
  end if;
  return jsonb_build_object(
    'crm_roster', v_profile.user_role = 'crm',
    'availability_from', v_from,
    'availability_to', v_to,
    'unavailable_dates', coalesce((
      select jsonb_agg(day::date order by day)
      from generate_series(v_from, v_to, interval '1 day') as day
      where not is_user_available_for_task(v_profile.id, day::date)), '[]'::jsonb));
end
$$;

-- Delivery worker contract (0195), with the roster fields merged into each snapshot.
create or replace function public.crm_sync_claim_staff_events(p_limit integer default 50)
returns table (event_id bigint, event_type text, aggregate_id uuid, snapshot jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  with due as (
    select o.id from crm_sync.outbox o
    where o.delivered_at is null and o.dead_at is null and o.next_attempt_at <= now()
    order by o.next_attempt_at, o.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), claimed as (
    -- The lease: an event a crashed worker never finishes becomes due again in 5 minutes.
    update crm_sync.outbox o
    set claimed_at = clock_timestamp(), attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
    from due where o.id = due.id
    returning o.id, o.event_type, o.aggregate_id
  )
  select claimed.id, claimed.event_type, claimed.aggregate_id,
    crm_sync.staff_snapshot(claimed.aggregate_id) || crm_sync.staff_roster_fields(claimed.aggregate_id)
  from claimed order by claimed.id;
end
$$;

-- Full roster for the daily reconciliation: one snapshot per JewelOS profile.
create or replace function public.crm_sync_staff_roster()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(crm_sync.staff_snapshot(profile.id) || crm_sync.staff_roster_fields(profile.id)
    order by profile.id) from user_profiles profile), '[]'::jsonb);
end
$$;

-- Every Availability write (manual entry, range entry, approved leave, weekly off) enqueues
-- the person, in the same transaction as the write.
create function crm_sync.user_availability_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then perform crm_sync.enqueue_staff(old.user_profile_id); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.user_profile_id is distinct from old.user_profile_id) then
    perform crm_sync.enqueue_staff(new.user_profile_id);
  end if;
  return null;
end
$$;

create trigger crm_sync_staff_availability_changed
after insert or update or delete on public.user_availability
for each row execute function crm_sync.user_availability_changed();

-- A weekly-off change alters availability (the 0195 profile trigger does not compare it).
create function crm_sync.user_week_off_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.week_off is distinct from old.week_off then
    perform crm_sync.enqueue_staff(new.id);
  end if;
  return null;
end
$$;

create trigger crm_sync_staff_week_off_changed
after update of week_off on public.user_profiles
for each row execute function crm_sync.user_week_off_changed();

revoke all on function crm_sync.staff_roster_fields(uuid), crm_sync.user_availability_changed(),
  crm_sync.user_week_off_changed()
  from public, anon, authenticated, service_role;
revoke all on function public.crm_sync_claim_staff_events(integer), public.crm_sync_staff_roster()
  from public, anon, authenticated, service_role;
grant execute on function public.crm_sync_claim_staff_events(integer), public.crm_sync_staff_roster() to service_role;

-- Send everyone once so the CRM builds the roster and today's availability right away.
insert into crm_sync.outbox (event_type, aggregate_id)
select 'staff.access_changed', profile.id from public.user_profiles profile
on conflict (event_type, aggregate_id) where delivered_at is null and dead_at is null
do update set changed_at = clock_timestamp();
