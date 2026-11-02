-- Every signed-in employee can change their own login password from Settings.
-- The change-own-password Edge Function checks the current password, sets the
-- new one in Supabase Auth, and records the change here. Passwords are never
-- stored or logged in this database.
set search_path = public, extensions;

create or replace function authorize_own_password_change(p_actor_auth_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select * into v_actor from user_profiles where auth_user_id = p_actor_auth_user_id;
  if v_actor.id is null or v_actor.account_status <> 'active' or v_actor.is_login_enabled is not true
    or v_actor.working_status = 'resigned' then
    raise exception 'This account cannot change its password' using errcode = '42501';
  end if;
end $$;

create or replace function audit_own_password_change(p_actor_auth_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select * into v_actor from user_profiles where auth_user_id = p_actor_auth_user_id;
  if v_actor.id is null then raise exception 'This account cannot change its password' using errcode = '42501'; end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'user_password_changed', 'user_management', v_actor.id,
    jsonb_build_object('password_stored', false, 'changed_by_self', true));
end $$;

revoke all on function authorize_own_password_change(uuid) from public, anon, authenticated;
revoke all on function audit_own_password_change(uuid) from public, anon, authenticated;
grant execute on function authorize_own_password_change(uuid) to service_role;
grant execute on function audit_own_password_change(uuid) to service_role;
notify pgrst, 'reload schema';
