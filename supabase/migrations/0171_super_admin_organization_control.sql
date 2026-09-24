-- Super Admin authority and audited, tenant-scoped organization management.
set search_path = public, extensions;

-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('organization.manage', 'protected', null, '{super_admin}', 300);
-- permission-catalog:end

create or replace function permission_effective_for(p_profile_id uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_profile user_profiles;
  v_catalog permission_catalog;
  v_role user_role;
  v_effect text;
  v_allowed boolean;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  select * into v_catalog from permission_catalog where key = p_key;
  if v_profile.id is null or v_catalog.key is null then return false; end if;
  select coalesce((select a.dashboard_authority from user_access_profiles a where a.user_profile_id = v_profile.id), v_profile.user_role) into v_role;
  -- A Super Admin must not be locked out of a module by a configurable deny.
  if v_role = 'super_admin' then return true; end if;
  if v_catalog.kind = 'protected' then return false; end if;
  if v_catalog.kind = 'authority' then return v_role = any(v_catalog.default_roles); end if;
  select o.effect into v_effect from user_permission_overrides o where o.user_profile_id = v_profile.id and o.permission_key = p_key;
  if v_effect is not null then return v_effect = 'grant'; end if;
  if v_profile.designation_id is not null then
    select o.effect into v_effect from designation_permission_overrides o
      join dropdown_masters d on d.id = o.designation_id and d.is_active
      where o.tenant_id = v_profile.tenant_id and o.designation_id = v_profile.designation_id and o.permission_key = p_key;
    if v_effect is not null then return v_effect = 'grant'; end if;
  end if;
  select r.is_allowed into v_allowed from role_permissions r
    where r.tenant_id = v_profile.tenant_id and r.user_role = v_role and r.permission_key = p_key;
  return coalesce(v_allowed, v_role = any(v_catalog.default_roles));
end $$;

-- Organization authority does not imply access to other tenants' metadata.
alter policy tenants_select on tenants using (current_profile_is_active() and id = current_tenant_id());
alter policy branches_select on branches using (current_profile_is_active() and tenant_id = current_tenant_id());
alter policy departments_select on departments using (current_profile_is_active() and tenant_id = current_tenant_id());

create function save_branch_with_audit(p_branch_id uuid, p_payload jsonb)
returns branches language plpgsql security definer set search_path = public as $$
declare
  a user_profiles; old_row branches; new_row branches;
  v_name text; v_code text; v_manager uuid; v_active boolean;
begin
  a := current_profile();
  if a.id is null or not current_profile_is_active() or not has_permission('organization.manage') then
    raise exception 'Organization management denied' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array['name','code','address','city','state','pincode','manager_id','is_active'] <> '{}'::jsonb then
    raise exception 'Invalid branch changes' using errcode='22023';
  end if;
  if p_payload ? 'is_active' and jsonb_typeof(p_payload->'is_active') <> 'boolean' then
    raise exception 'Branch active flag must be boolean' using errcode='22023';
  end if;
  if p_branch_id is not null then
    select * into old_row from branches where id=p_branch_id for update;
    if old_row.id is null or old_row.tenant_id <> a.tenant_id then raise exception 'Branch not accessible' using errcode='42501'; end if;
  end if;
  v_name := btrim(coalesce(p_payload->>'name',old_row.name,''));
  v_code := upper(btrim(coalesce(p_payload->>'code',old_row.code,'')));
  v_active := coalesce((p_payload->>'is_active')::boolean,old_row.is_active,true);
  v_manager := case when p_payload ? 'manager_id' then nullif(p_payload->>'manager_id','')::uuid else old_row.manager_id end;
  if v_name = '' or char_length(v_name)>120 or v_code !~ '^[A-Z0-9_-]{2,32}$' then
    raise exception 'Branch name or code is invalid' using errcode='22023';
  end if;
  if exists(select 1 from branches b where b.tenant_id=a.tenant_id and lower(b.code)=lower(v_code) and b.id is distinct from p_branch_id) then
    raise exception 'Branch code already exists' using errcode='23505';
  end if;
  if v_manager is not null and not exists(select 1 from user_profiles u where u.id=v_manager and u.tenant_id=a.tenant_id and u.branch_id=p_branch_id and u.account_status='active' and u.is_login_enabled) then
    raise exception 'Branch manager must be an active employee in this branch' using errcode='23503';
  end if;
  if not v_active and old_row.id is not null and (
      exists(select 1 from user_profiles u where u.branch_id=old_row.id and u.account_status<>'left')
      or exists(select 1 from departments d where d.branch_id=old_row.id and d.is_active)) then
    raise exception 'Move employees and deactivate departments before deactivating this branch' using errcode='23514';
  end if;
  if p_branch_id is null then
    insert into branches(tenant_id,name,code,address,city,state,pincode,is_active,created_by,updated_by)
    values(a.tenant_id,v_name,v_code,nullif(btrim(p_payload->>'address'),''),nullif(btrim(p_payload->>'city'),''),nullif(btrim(p_payload->>'state'),''),nullif(btrim(p_payload->>'pincode'),''),v_active,a.id,a.id)
    returning * into new_row;
  else
    update branches set name=v_name,code=v_code,
      address=case when p_payload ? 'address' then nullif(btrim(p_payload->>'address'),'') else address end,
      city=case when p_payload ? 'city' then nullif(btrim(p_payload->>'city'),'') else city end,
      state=case when p_payload ? 'state' then nullif(btrim(p_payload->>'state'),'') else state end,
      pincode=case when p_payload ? 'pincode' then nullif(btrim(p_payload->>'pincode'),'') else pincode end,
      manager_id=v_manager,is_active=v_active,updated_by=a.id,updated_at=now()
    where id=p_branch_id returning * into new_row;
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'branch_saved','user_management',new_row.id,to_jsonb(old_row),to_jsonb(new_row));
  return new_row;
end $$;

create function save_department_with_audit(p_department_id uuid, p_payload jsonb)
returns departments language plpgsql security definer set search_path = public as $$
declare
  a user_profiles; old_row departments; new_row departments;
  v_name text; v_code text; v_branch uuid; v_head uuid; v_active boolean;
begin
  a := current_profile();
  if a.id is null or not current_profile_is_active() or not has_permission('organization.manage') then
    raise exception 'Organization management denied' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array['name','code','branch_id','head_id','is_active'] <> '{}'::jsonb then
    raise exception 'Invalid department changes' using errcode='22023';
  end if;
  if p_payload ? 'is_active' and jsonb_typeof(p_payload->'is_active') <> 'boolean' then
    raise exception 'Department active flag must be boolean' using errcode='22023';
  end if;
  if p_department_id is not null then
    select * into old_row from departments where id=p_department_id for update;
    if old_row.id is null or old_row.tenant_id <> a.tenant_id then raise exception 'Department not accessible' using errcode='42501'; end if;
    if p_payload ? 'branch_id' and nullif(p_payload->>'branch_id','')::uuid is distinct from old_row.branch_id then
      raise exception 'Create a new department and move people to change branch scope' using errcode='23514';
    end if;
  end if;
  v_name := btrim(coalesce(p_payload->>'name',old_row.name,''));
  v_code := upper(btrim(coalesce(p_payload->>'code',old_row.code,'')));
  v_branch := case when p_department_id is null then nullif(p_payload->>'branch_id','')::uuid else old_row.branch_id end;
  v_head := case when p_payload ? 'head_id' then nullif(p_payload->>'head_id','')::uuid else old_row.head_id end;
  v_active := coalesce((p_payload->>'is_active')::boolean,old_row.is_active,true);
  if v_name = '' or char_length(v_name)>120 or v_code !~ '^[A-Z0-9_-]{2,32}$' then
    raise exception 'Department name or code is invalid' using errcode='22023';
  end if;
  if v_branch is not null and not exists(select 1 from branches b where b.id=v_branch and b.tenant_id=a.tenant_id and b.is_active) then
    raise exception 'Branch not accessible or inactive' using errcode='42501';
  end if;
  if exists(select 1 from departments d where d.tenant_id=a.tenant_id and lower(d.code)=lower(v_code) and d.id is distinct from p_department_id) then
    raise exception 'Department code already exists' using errcode='23505';
  end if;
  if v_head is not null and not exists(select 1 from user_profiles u where u.id=v_head and u.tenant_id=a.tenant_id and u.department_id=p_department_id and (v_branch is null or u.branch_id=v_branch) and u.account_status='active' and u.is_login_enabled) then
    raise exception 'Department head must be an active employee in this department' using errcode='23503';
  end if;
  if not v_active and old_row.id is not null and exists(select 1 from user_profiles u where u.department_id=old_row.id and u.account_status<>'left') then
    raise exception 'Move employees before deactivating this department' using errcode='23514';
  end if;
  if p_department_id is null then
    insert into departments(tenant_id,branch_id,name,code,is_active,created_by,updated_by)
    values(a.tenant_id,v_branch,v_name,v_code,v_active,a.id,a.id) returning * into new_row;
  else
    update departments set name=v_name,code=v_code,head_id=v_head,is_active=v_active,updated_by=a.id,updated_at=now()
    where id=p_department_id returning * into new_row;
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'department_saved','user_management',new_row.id,to_jsonb(old_row),to_jsonb(new_row));
  return new_row;
end $$;

revoke all on function save_branch_with_audit(uuid,jsonb),save_department_with_audit(uuid,jsonb) from public,anon,authenticated;
grant execute on function save_branch_with_audit(uuid,jsonb),save_department_with_audit(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
