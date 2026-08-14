-- Passwords are managed by Supabase Auth, never stored in JewelOS. This
-- service-role-only RPC supplies the durable, tenant-scoped audit boundary
-- for a password reset performed by the authenticated Edge Function.
set search_path = public, extensions;

create or replace function authorize_super_admin_password_reset(
  p_actor_auth_user_id uuid,
  p_target_profile_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor user_profiles;
  v_target user_profiles;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into v_actor from user_profiles where auth_user_id = p_actor_auth_user_id;
  if v_actor.id is null or v_actor.user_role <> 'super_admin' or v_actor.account_status <> 'active'
    or v_actor.working_status = 'resigned' or v_actor.is_login_enabled is not true then
    raise exception 'Only an active super_admin can reset user passwords' using errcode = '42501';
  end if;
  select * into v_target from user_profiles where id = p_target_profile_id;
  if v_target.id is null or v_target.tenant_id <> v_actor.tenant_id or v_target.auth_user_id is null then
    raise exception 'Profile not found or not accessible' using errcode = '42501';
  end if;
  return v_target.auth_user_id;
end;
$$;

create or replace function audit_super_admin_password_reset(
  p_actor_auth_user_id uuid,
  p_target_profile_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor user_profiles;
  v_target user_profiles;
begin
  select * into v_actor from user_profiles where auth_user_id = p_actor_auth_user_id;
  select * into v_target from user_profiles where id = p_target_profile_id;
  if auth.role() <> 'service_role' or v_actor.id is null or v_actor.user_role <> 'super_admin'
    or v_actor.account_status <> 'active' or v_actor.working_status = 'resigned' or v_actor.is_login_enabled is not true
    or v_target.id is null or v_target.tenant_id <> v_actor.tenant_id then
    raise exception 'Only an active super_admin can reset user passwords' using errcode = '42501';
  end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'user_password_reset', 'user_management', v_target.id,
    jsonb_build_object('account_status', v_target.account_status),
    jsonb_build_object('password_stored', false, 'reset_by_super_admin', true));
end;
$$;

revoke all on function authorize_super_admin_password_reset(uuid, uuid) from public;
revoke all on function audit_super_admin_password_reset(uuid, uuid) from public;
grant execute on function authorize_super_admin_password_reset(uuid, uuid) to service_role;
grant execute on function audit_super_admin_password_reset(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
