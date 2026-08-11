-- Correct the escaped phone expression in the 0017 provisioning RPC.
set search_path = public, extensions;

create or replace function invite_profile_with_audit_v2(
  p_auth_user_id uuid, p_creator_profile_id uuid, p_email text, p_employee_name text,
  p_branch_id uuid, p_department_id uuid, p_designation_id uuid, p_personal_mobile text,
  p_official_mobile text, p_week_off text[], p_user_role user_role, p_buddy_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_creator user_profiles; v_profile user_profiles; v_code text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into v_creator from user_profiles where id=p_creator_profile_id;
  if v_creator.id is null or v_creator.user_role not in ('super_admin','admin') or v_creator.is_login_enabled is not true then raise exception 'Inviter is not authorized' using errcode='42501'; end if;
  if v_creator.user_role='admin' and p_user_role='super_admin' then raise exception 'Admin cannot create super_admin users' using errcode='42501'; end if;
  if not exists(select 1 from branches where id=p_branch_id and tenant_id=v_creator.tenant_id and is_active) then raise exception 'Branch is invalid' using errcode='23503'; end if;
  if not exists(select 1 from departments where id=p_department_id and tenant_id=v_creator.tenant_id and is_active and (branch_id is null or branch_id=p_branch_id)) then raise exception 'Department is invalid' using errcode='23503'; end if;
  if p_designation_id is not null and not exists(select 1 from dropdown_masters where id=p_designation_id and master_type='designation' and is_active and (tenant_id=v_creator.tenant_id or tenant_id is null)) then raise exception 'Designation is invalid' using errcode='23503'; end if;
  if p_buddy_id is not null and not exists(select 1 from user_profiles where id=p_buddy_id and tenant_id=v_creator.tenant_id and account_status='active') then raise exception 'Buddy is invalid' using errcode='23503'; end if;
  if nullif(btrim(coalesce(p_personal_mobile,'')),'') is not null and btrim(p_personal_mobile) !~ E'^\\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Personal mobile format is invalid' using errcode='22023'; end if;
  v_code := next_employee_code();
  insert into user_profiles(auth_user_id,tenant_id,branch_id,department_id,employee_name,designation_id,personal_mobile,official_mobile,email,week_off,user_role,employee_code,buddy_id,working_status,account_status,is_login_enabled,created_by,updated_by)
  values(p_auth_user_id,v_creator.tenant_id,p_branch_id,p_department_id,btrim(p_employee_name),p_designation_id,nullif(btrim(coalesce(p_personal_mobile,'')),''),nullif(btrim(coalesce(p_official_mobile,'')),''),lower(btrim(p_email)),coalesce(p_week_off,'{}'),p_user_role,v_code,p_buddy_id,'active','invited',false,v_creator.id,v_creator.id) returning * into v_profile;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_creator.tenant_id,v_creator.id,'user_invited','user_management',v_profile.id,to_jsonb(v_profile));
  return v_profile.id;
end;
$$;
revoke all on function invite_profile_with_audit_v2(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid) from public;
grant execute on function invite_profile_with_audit_v2(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid) to service_role;
notify pgrst, 'reload schema';
