-- Store the requested contact fields explicitly while keeping email as the
-- personal/login address used by Supabase Auth.
set search_path = public, extensions;

alter table user_profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists official_email text;

update user_profiles
set first_name = coalesce(first_name, nullif(split_part(btrim(employee_name), ' ', 1), '')),
    last_name = coalesce(last_name, nullif(btrim(regexp_replace(btrim(employee_name), '^\\S+\\s*', '')), ''))
where first_name is null or last_name is null;

alter table user_profiles
  add constraint user_profiles_first_name_length check (first_name is null or length(btrim(first_name)) between 1 and 100),
  add constraint user_profiles_last_name_length check (last_name is null or length(btrim(last_name)) <= 100),
  add constraint user_profiles_official_email_format check (official_email is null or official_email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$');

create index if not exists idx_user_profiles_buddy_candidates
  on user_profiles (tenant_id, branch_id, department_id, designation_id, account_status, user_role);

create or replace function user_role_hierarchy_rank(p_role user_role)
returns integer language sql immutable set search_path = public as $$
  select case p_role
    when 'super_admin' then 100
    when 'admin' then 90
    when 'manager' then 80
    when 'hr' then 70
    when 'crm' then 60
    when 'staff' then 50
    when 'doer' then 40
    when 'housekeeping' then 30
  end;
$$;

create or replace function enforce_user_profile_buddy_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_buddy user_profiles;
begin
  if new.buddy_id is null then return new; end if;
  if new.buddy_id = new.id then raise exception 'A user cannot be their own buddy' using errcode='23514'; end if;
  select * into v_buddy from user_profiles where id = new.buddy_id;
  if v_buddy.id is null
    or v_buddy.tenant_id <> new.tenant_id
    or v_buddy.account_status <> 'active'
    or v_buddy.is_login_enabled is not true then
    raise exception 'Buddy must be an active user in the same tenant' using errcode='23503';
  end if;
  if v_buddy.branch_id <> new.branch_id
    or v_buddy.department_id <> new.department_id
    or v_buddy.designation_id is distinct from new.designation_id then
    raise exception 'Buddy must be in the same branch, department, and designation' using errcode='23503';
  end if;
  if user_role_hierarchy_rank(v_buddy.user_role) < user_role_hierarchy_rank(new.user_role) then
    raise exception 'Buddy assignment cannot point to a higher hierarchy' using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_enforce_buddy_scope on user_profiles;
create trigger user_profiles_enforce_buddy_scope
before insert or update of buddy_id, branch_id, department_id, designation_id, user_role, account_status, is_login_enabled
on user_profiles for each row execute function enforce_user_profile_buddy_scope();

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
  if btrim(p_personal_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then raise exception 'Personal email is invalid' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_official_email,'')),'') is not null and btrim(p_official_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then raise exception 'Official email is invalid' using errcode='22023'; end if;
  if not exists(select 1 from branches where id=p_branch_id and tenant_id=v_creator.tenant_id and is_active) then raise exception 'Branch is invalid' using errcode='23503'; end if;
  if not exists(select 1 from departments where id=p_department_id and tenant_id=v_creator.tenant_id and is_active and (branch_id is null or branch_id=p_branch_id)) then raise exception 'Department is invalid' using errcode='23503'; end if;
  if p_designation_id is not null and not exists(select 1 from dropdown_masters where id=p_designation_id and master_type='designation' and is_active and (tenant_id=v_creator.tenant_id or tenant_id is null)) then raise exception 'Designation is invalid' using errcode='23503'; end if;
  if nullif(btrim(coalesce(p_personal_mobile,'')),'') is not null and btrim(p_personal_mobile) !~ E'^\\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Personal phone format is invalid' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_official_mobile,'')),'') is not null and btrim(p_official_mobile) !~ E'^\\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Official phone format is invalid' using errcode='22023'; end if;
  v_name := concat_ws(' ', btrim(p_first_name), nullif(btrim(coalesce(p_last_name,'')),''));
  v_code := next_employee_code();
  insert into user_profiles(auth_user_id,tenant_id,branch_id,department_id,employee_name,first_name,last_name,designation_id,personal_mobile,official_mobile,email,official_email,week_off,user_role,employee_code,buddy_id,working_status,account_status,is_login_enabled,created_by,updated_by)
  values(p_auth_user_id,v_creator.tenant_id,p_branch_id,p_department_id,v_name,btrim(p_first_name),nullif(btrim(coalesce(p_last_name,'')),''),p_designation_id,nullif(btrim(coalesce(p_personal_mobile,'')),''),nullif(btrim(coalesce(p_official_mobile,'')),''),lower(btrim(p_personal_email)),nullif(lower(btrim(coalesce(p_official_email,''))),''),coalesce(p_week_off,'{}'),p_user_role,v_code,p_buddy_id,'active','invited',false,v_creator.id,v_creator.id) returning * into v_profile;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_creator.tenant_id,v_creator.id,'user_invited','user_management',v_profile.id,to_jsonb(v_profile));
  return v_profile.id;
end;
$$;

revoke all on function user_role_hierarchy_rank(user_role) from public;
revoke all on function enforce_user_profile_buddy_scope() from public;
revoke all on function invite_profile_with_audit_v3(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid) from public;
grant execute on function invite_profile_with_audit_v3(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid) to service_role;
notify pgrst, 'reload schema';
