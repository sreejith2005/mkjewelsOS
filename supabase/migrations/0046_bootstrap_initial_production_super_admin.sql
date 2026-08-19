-- One-time bootstrap for an existing linked profile. It can run only while
-- there is no recovery-capable active Super Admin.
set search_path = public, extensions;

create or replace function bootstrap_initial_production_super_admin(p_target_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_target user_profiles; v_legacy user_profiles;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into v_legacy from user_profiles where user_role='super_admin' and account_status='active' and working_status<>'resigned' and is_login_enabled and lower(email) like '%@mkjewels.local' order by created_at limit 1 for update;
  if v_legacy.id is null or exists(select 1 from user_profiles where user_role='super_admin' and account_status='active' and working_status<>'resigned' and is_login_enabled and lower(email) not like '%@mkjewels.local') then raise exception 'Production Super Admin bootstrap is no longer eligible' using errcode='23514'; end if;
  select * into v_target from user_profiles where id=p_target_profile_id for update;
  if v_target.id is null or v_target.tenant_id<>v_legacy.tenant_id or v_target.auth_user_id is null or v_target.account_status<>'active' or v_target.working_status='resigned' or not v_target.is_login_enabled or lower(v_target.email) like '%@mkjewels.local' then raise exception 'Target must be an active linked non-local employee profile in the same tenant' using errcode='23514'; end if;
  update user_profiles set user_role='super_admin',updated_by=v_legacy.id,updated_at=now() where id=v_target.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_target.tenant_id,v_legacy.id,'production_super_admin_bootstrapped','user_management',v_target.id,jsonb_build_object('user_role',v_target.user_role),jsonb_build_object('user_role','super_admin','bootstrap',true));
end;
$$;

revoke all on function bootstrap_initial_production_super_admin(uuid) from public,anon,authenticated;
grant execute on function bootstrap_initial_production_super_admin(uuid) to service_role;
notify pgrst,'reload schema';
