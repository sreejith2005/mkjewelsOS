-- CRM roster: the CRM people are the CRM department (2026-10-08 owner correction to 0201).
--
-- In JewelOS Users the CRM staff are identified by Department = CRM (code `CRM`); their
-- Role is Staff. 0201 put only Role = CRM on the roster, which matched nobody, so every
-- CRM branch roster became empty. A person is now on their CRM branch roster when their
-- department's code is CRM (case-insensitive) or their role is CRM, and they have CRM
-- access (the snapshot's `eligible`, unchanged).
--
-- Moving a person into or out of a department already enqueues them (0200 compares
-- department_id); a change of a department's code now enqueues its members too.

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
  v_from date := (now() at time zone 'Asia/Kolkata')::date;
  v_to date := (now() at time zone 'Asia/Kolkata')::date + 30;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('crm_roster', false);
  end if;
  return jsonb_build_object(
    'crm_roster', v_profile.user_role = 'crm'
      or exists (select 1 from departments d
                 where d.id = v_profile.department_id and d.tenant_id = v_profile.tenant_id
                   and upper(btrim(d.code)) = 'CRM'),
    'availability_from', v_from,
    'availability_to', v_to,
    'unavailable_dates', coalesce((
      select jsonb_agg(day::date order by day)
      from generate_series(v_from, v_to, interval '1 day') as day
      where not is_user_available_for_task(v_profile.id, day::date)), '[]'::jsonb));
end
$$;

create function crm_sync.department_code_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if upper(btrim(new.code)) is distinct from upper(btrim(old.code)) then
    perform crm_sync.enqueue_staff(p.id) from public.user_profiles p where p.department_id = new.id;
  end if;
  return null;
end
$$;

create trigger crm_sync_department_code_changed
after update of code on public.departments
for each row execute function crm_sync.department_code_changed();

revoke all on function crm_sync.staff_roster_fields(uuid), crm_sync.department_code_changed()
  from public, anon, authenticated, service_role;

-- Send everyone again so the CRM department joins the branch rosters now.
insert into crm_sync.outbox (event_type, aggregate_id)
select 'staff.access_changed', profile.id from public.user_profiles profile
on conflict (event_type, aggregate_id) where delivered_at is null and dead_at is null
do update set changed_at = clock_timestamp();
