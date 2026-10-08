-- CRM department on every branch roster (2026-10-08 owner decision).
--
-- The CRM department (code CRM) is one company-wide team: its members appear in the CRM
-- walk-in dropdown and round robin of every branch, not only their own JewelOS branch.
-- The roster fields (0201/0202) gain `crm_roster_all_branches`, true for CRM-department
-- members. A Role-CRM person outside the department stays on their own branch only.
-- CRM-project side: supabase-crm/supabase/migrations/20261008000100_crm_roster_all_branches.sql
-- (apply it first; this migration then re-sends everyone).

set search_path = public, extensions;

create or replace function crm_sync.staff_roster_fields(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile user_profiles;
  v_crm_department boolean;
  v_from date := (now() at time zone 'Asia/Kolkata')::date;
  v_to date := (now() at time zone 'Asia/Kolkata')::date + 30;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('crm_roster', false);
  end if;
  v_crm_department := exists (select 1 from departments d
    where d.id = v_profile.department_id and d.tenant_id = v_profile.tenant_id
      and upper(btrim(d.code)) = 'CRM');
  return jsonb_build_object(
    'crm_roster', v_profile.user_role = 'crm' or v_crm_department,
    'crm_roster_all_branches', v_crm_department,
    'availability_from', v_from,
    'availability_to', v_to,
    'unavailable_dates', coalesce((
      select jsonb_agg(day::date order by day)
      from generate_series(v_from, v_to, interval '1 day') as day
      where not is_user_available_for_task(v_profile.id, day::date)), '[]'::jsonb));
end
$$;

revoke all on function crm_sync.staff_roster_fields(uuid) from public, anon, authenticated, service_role;

-- Send everyone again so the CRM department joins every branch roster now.
insert into crm_sync.outbox (event_type, aggregate_id)
select 'staff.access_changed', profile.id from public.user_profiles profile
on conflict (event_type, aggregate_id) where delivered_at is null and dead_at is null
do update set changed_at = clock_timestamp();
