-- Accounts created by Super Admin are ready to sign in immediately. Passwords
-- remain in Supabase Auth; this migration only manages the employee-profile
-- lifecycle and its audited activation.
set search_path = public, extensions;

create or replace function invite_profile_with_audit_v3(
  p_auth_user_id uuid, p_creator_profile_id uuid, p_personal_email text,
  p_first_name text, p_last_name text, p_official_email text,
  p_branch_id uuid, p_department_id uuid, p_designation_id uuid,
  p_personal_mobile text, p_official_mobile text, p_week_off text[],
  p_user_role user_role, p_buddy_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_creator user_profiles; v_profile user_profiles; v_code text; v_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into v_creator from user_profiles where id=p_creator_profile_id;
  if v_creator.id is null or v_creator.user_role not in ('super_admin','admin') or v_creator.is_login_enabled is not true then raise exception 'Inviter is not authorized' using errcode='42501'; end if;
  if v_creator.user_role='admin' and p_user_role='super_admin' then raise exception 'Admin cannot create super_admin users' using errcode='42501'; end if;
  if nullif(btrim(p_first_name),'') is null then raise exception 'First name is required' using errcode='22023'; end if;
  if btrim(p_personal_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Personal email is invalid' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_official_email,'')),'') is not null and btrim(p_official_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Official email is invalid' using errcode='22023'; end if;
  if not exists(select 1 from branches where id=p_branch_id and tenant_id=v_creator.tenant_id and is_active) then raise exception 'Branch is invalid' using errcode='23503'; end if;
  if not exists(select 1 from departments where id=p_department_id and tenant_id=v_creator.tenant_id and is_active and (branch_id is null or branch_id=p_branch_id)) then raise exception 'Department is invalid' using errcode='23503'; end if;
  if p_designation_id is not null and not exists(select 1 from dropdown_masters where id=p_designation_id and master_type='designation' and is_active and (tenant_id=v_creator.tenant_id or tenant_id is null)) then raise exception 'Designation is invalid' using errcode='23503'; end if;
  if nullif(btrim(coalesce(p_personal_mobile,'')),'') is not null and btrim(p_personal_mobile) !~ E'^\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Personal phone format is invalid' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_official_mobile,'')),'') is not null and btrim(p_official_mobile) !~ E'^\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Official phone format is invalid' using errcode='22023'; end if;
  v_name := concat_ws(' ', btrim(p_first_name), nullif(btrim(coalesce(p_last_name,'')),''));
  v_code := next_employee_code();
  insert into user_profiles(auth_user_id,tenant_id,branch_id,department_id,employee_name,first_name,last_name,designation_id,personal_mobile,official_mobile,email,official_email,week_off,user_role,employee_code,buddy_id,working_status,account_status,is_login_enabled,created_by,updated_by)
  values(p_auth_user_id,v_creator.tenant_id,p_branch_id,p_department_id,v_name,btrim(p_first_name),nullif(btrim(coalesce(p_last_name,'')),''),p_designation_id,nullif(btrim(coalesce(p_personal_mobile,'')),''),nullif(btrim(coalesce(p_official_mobile,'')),''),lower(btrim(p_personal_email)),nullif(lower(btrim(coalesce(p_official_email,''))),''),coalesce(p_week_off,'{}'),p_user_role,v_code,p_buddy_id,'active','active',true,v_creator.id,v_creator.id) returning * into v_profile;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_creator.tenant_id,v_creator.id,'user_created','user_management',v_profile.id,to_jsonb(v_profile));
  return v_profile.id;
end;
$$;

create or replace function audit_super_admin_password_reset(
  p_actor_auth_user_id uuid,
  p_target_profile_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_target user_profiles; v_activated boolean;
begin
  select * into v_actor from user_profiles where auth_user_id = p_actor_auth_user_id;
  select * into v_target from user_profiles where id = p_target_profile_id for update;
  if auth.role() <> 'service_role' or v_actor.id is null or v_actor.user_role <> 'super_admin'
    or v_actor.account_status <> 'active' or v_actor.working_status = 'resigned' or v_actor.is_login_enabled is not true
    or v_target.id is null or v_target.tenant_id <> v_actor.tenant_id then
    raise exception 'Only an active super_admin can reset user passwords' using errcode = '42501';
  end if;
  v_activated := v_target.account_status = 'invited' or v_target.is_login_enabled is false;
  if v_activated then
    update user_profiles set account_status='active', is_login_enabled=true, updated_by=v_actor.id, updated_at=now() where id=v_target.id;
  end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'user_password_reset', 'user_management', v_target.id,
    jsonb_build_object('account_status', v_target.account_status, 'is_login_enabled', v_target.is_login_enabled),
    jsonb_build_object('password_stored', false, 'reset_by_super_admin', true, 'account_activated', v_activated));
end;
$$;

revoke all on function invite_profile_with_audit_v3(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid) from public;
revoke all on function audit_super_admin_password_reset(uuid,uuid) from public;
grant execute on function invite_profile_with_audit_v3(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid) to service_role;
grant execute on function audit_super_admin_password_reset(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
