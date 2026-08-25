-- Narrow service-only roster correction for explicitly approved administrator
-- promotions. Identity fields and passwords are deliberately untouched.
set search_path = public, extensions;

create or replace function apply_authoritative_admin_roles(p_profile_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_profile user_profiles; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if coalesce(array_length(p_profile_ids, 1), 0) = 0 or cardinality(p_profile_ids) <> cardinality(array(select distinct unnest(p_profile_ids))) then
    raise exception 'A unique non-empty profile list is required' using errcode = '22023';
  end if;
  select * into v_actor from user_profiles where user_role = 'super_admin' and account_status = 'active' and is_login_enabled order by created_at limit 1;
  if v_actor.id is null then raise exception 'Active Super Admin is required' using errcode = '42501'; end if;
  if (select count(*) from user_profiles where id = any(p_profile_ids) and tenant_id = v_actor.tenant_id and account_status = 'active' and is_login_enabled) <> cardinality(p_profile_ids) then
    raise exception 'Each approved profile must be active and in the Super Admin tenant' using errcode = '23503';
  end if;
  for v_profile in select * from user_profiles where id = any(p_profile_ids) for update loop
    if v_profile.user_role <> 'admin' then
      update user_profiles set user_role = 'admin', updated_by = v_actor.id, updated_at = now() where id = v_profile.id;
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
      values(v_profile.tenant_id, v_actor.id, 'authoritative_admin_role_granted', 'user_management', v_profile.id, to_jsonb(v_profile), (select to_jsonb(p) from user_profiles p where p.id = v_profile.id));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function apply_authoritative_admin_roles(uuid[]) from public, anon, authenticated;
grant execute on function apply_authoritative_admin_roles(uuid[]) to service_role;
notify pgrst, 'reload schema';
