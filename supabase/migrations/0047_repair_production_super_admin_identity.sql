-- One-time correction for the production bootstrap mix-up. Auth emails are
-- changed by the service-role Admin API first; this function atomically makes
-- the matching profile and audit updates.
set search_path = public, extensions;

create or replace function repair_production_super_admin_identity()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_legacy user_profiles;
  v_suganiya user_profiles;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into v_legacy
  from user_profiles
  where lower(email) = 'admin@mkjewels.local'
    and employee_name = 'Super Admin'
    and user_role = 'super_admin'
    and account_status = 'active'
    and is_login_enabled
  for update;

  select * into v_suganiya
  from user_profiles
  where lower(email) = 'mis@mkjewels.in'
    and employee_name = 'SUGANIYA ISAIVANAN'
    and user_role = 'super_admin'
    and account_status = 'active'
    and is_login_enabled
  for update;

  if v_legacy.id is null or v_suganiya.id is null or v_legacy.tenant_id <> v_suganiya.tenant_id then
    raise exception 'Expected production identity records are not eligible for repair' using errcode = '23514';
  end if;

  if exists (select 1 from user_profiles where lower(email) = 'suganiyamkjewels@gmail.com') then
    raise exception 'Suganiya work email is already assigned' using errcode = '23505';
  end if;

  update user_profiles
  set email = 'mis@mkjewels.in', official_email = 'mis@mkjewels.in', updated_by = v_legacy.id, updated_at = now()
  where id = v_legacy.id;

  update user_profiles
  set email = 'suganiyamkjewels@gmail.com', official_email = 'suganiyamkjewels@gmail.com',
      user_role = 'staff', updated_by = v_legacy.id, updated_at = now()
  where id = v_suganiya.id;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values
    (v_legacy.tenant_id, v_legacy.id, 'production_super_admin_identity_repaired', 'user_management', v_legacy.id,
      jsonb_build_object('email', v_legacy.email, 'user_role', v_legacy.user_role),
      jsonb_build_object('email', 'mis@mkjewels.in', 'user_role', 'super_admin')),
    (v_suganiya.tenant_id, v_legacy.id, 'production_employee_login_repaired', 'user_management', v_suganiya.id,
      jsonb_build_object('email', v_suganiya.email, 'user_role', v_suganiya.user_role),
      jsonb_build_object('email', 'suganiyamkjewels@gmail.com', 'user_role', 'staff'));
end;
$$;

revoke all on function repair_production_super_admin_identity() from public, anon, authenticated;
grant execute on function repair_production_super_admin_identity() to service_role;
notify pgrst, 'reload schema';
