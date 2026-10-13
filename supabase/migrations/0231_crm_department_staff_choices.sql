-- Department membership controls intake choices, independently of CRM login access.
create or replace function crm_sync.staff_roster_fields(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_profile user_profiles;
  v_department text;
  v_department_code text;
  v_choice text := 'other';
  v_from date := (now() at time zone 'Asia/Kolkata')::date;
  v_to date := (now() at time zone 'Asia/Kolkata')::date + 30;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('crm_roster', false, 'crm_roster_all_branches', false, 'selection_department', 'other');
  end if;
  select regexp_replace(lower(btrim(d.name)), '[^a-z0-9]', '', 'g'), upper(btrim(d.code)) into v_department,v_department_code
  from departments d where d.id = v_profile.department_id and d.tenant_id = v_profile.tenant_id and d.is_active;
  if v_department_code='CRM' or v_department in ('crm', 'customerrelationshipmanagement', 'customerrelations') then v_choice := 'crm';
  elsif v_department in ('sales', 'salespeople', 'salesperson', 'salesdepartment') then v_choice := 'sales'; end if;
  return jsonb_build_object(
    'crm_roster', v_choice = 'crm', 'crm_roster_all_branches', v_choice = 'crm', 'selection_department', v_choice,
    'availability_from', v_from, 'availability_to', v_to,
    'unavailable_dates', coalesce((select jsonb_agg(day::date order by day)
      from generate_series(v_from, v_to, interval '1 day') as day
      where not is_user_available_for_task(v_profile.id, day::date)), '[]'::jsonb));
end $$;
revoke all on function crm_sync.staff_roster_fields(uuid) from public, anon, authenticated, service_role;

-- Refresh metadata through the existing audited outbox; identity/access remain unchanged.
insert into crm_sync.outbox(event_type, aggregate_id)
select 'staff.access_changed', id from public.user_profiles
on conflict (event_type, aggregate_id) where delivered_at is null and dead_at is null
do update set changed_at = clock_timestamp();
