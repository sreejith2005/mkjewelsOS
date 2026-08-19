-- A week off is one fixed weekday, or no weekly exception. It is deliberately
-- restricted to Super Admins because it changes recurring-task availability.
set search_path = public, extensions;

create or replace function update_user_profile_with_audit(p_profile_id uuid, p_changes jsonb)
returns user_profiles language plpgsql security definer set search_path = public as $$
declare
  v_actor user_profiles; v_old user_profiles; v_new user_profiles;
  v_role user_role; v_status working_status; v_account user_account_status;
  v_branch uuid; v_department uuid; v_designation uuid; v_buddy uuid; v_manager uuid;
  v_week_off text[];
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or v_actor.user_role not in ('super_admin','admin') or not current_profile_is_active() then
    raise exception 'Only active super_admin or admin can edit user profiles' using errcode = '42501';
  end if;
  if p_changes - array['employee_name','branch_id','department_id','designation_id','personal_mobile','official_mobile','week_off','user_role','employee_code','buddy_id','working_status','account_status','reports_to_user_id'] <> '{}'::jsonb then
    raise exception 'Profile update contains unsupported fields' using errcode = '22023';
  end if;
  if p_changes ? 'week_off' then
    if v_actor.user_role <> 'super_admin' then raise exception 'Only super_admin can change week off' using errcode = '42501'; end if;
    if jsonb_typeof(p_changes->'week_off') <> 'array' or jsonb_array_length(p_changes->'week_off') > 1
      or exists (select 1 from jsonb_array_elements(p_changes->'week_off') as day(value) where jsonb_typeof(day.value) <> 'string' or lower(btrim(day.value #>> '{}')) not in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')) then
      raise exception 'Week off must be one weekday or no week off' using errcode = '22023';
    end if;
    select coalesce(array_agg(lower(btrim(day.value #>> '{}'))), '{}'::text[]) into v_week_off
    from jsonb_array_elements(p_changes->'week_off') as day(value);
  end if;
  select * into v_old from user_profiles where id = p_profile_id for update;
  if v_old.id is null or v_old.tenant_id <> v_actor.tenant_id then raise exception 'Profile not found or not accessible' using errcode = '42501'; end if;
  if v_actor.user_role = 'admin' and v_old.user_role = 'super_admin' then raise exception 'Admin cannot edit a super_admin' using errcode = '42501'; end if;
  v_role := case when p_changes ? 'user_role' then (p_changes->>'user_role')::user_role else v_old.user_role end;
  v_status := case when p_changes ? 'working_status' then (p_changes->>'working_status')::working_status else v_old.working_status end;
  v_account := case when p_changes ? 'account_status' then (p_changes->>'account_status')::user_account_status else v_old.account_status end;
  v_branch := case when p_changes ? 'branch_id' then nullif(p_changes->>'branch_id','')::uuid else v_old.branch_id end;
  v_department := case when p_changes ? 'department_id' then nullif(p_changes->>'department_id','')::uuid else v_old.department_id end;
  v_designation := case when p_changes ? 'designation_id' then nullif(p_changes->>'designation_id','')::uuid else v_old.designation_id end;
  v_buddy := case when p_changes ? 'buddy_id' then nullif(p_changes->>'buddy_id','')::uuid else v_old.buddy_id end;
  v_manager := case when p_changes ? 'reports_to_user_id' then nullif(p_changes->>'reports_to_user_id','')::uuid else v_old.reports_to_user_id end;
  if v_actor.user_role <> 'super_admin' and v_role <> v_old.user_role then raise exception 'Only super_admin can change user role' using errcode = '42501'; end if;
  if v_actor.user_role = 'admin' and v_role = 'super_admin' then raise exception 'Admin cannot create or promote super_admin' using errcode = '42501'; end if;
  if v_status = 'resigned' and v_old.working_status <> 'resigned' then raise exception 'Use the resignation workflow to set resigned status' using errcode = '22023'; end if;
  if v_account = 'left' and v_status <> 'resigned' then raise exception 'Only the resignation workflow can mark a user as left' using errcode = '22023'; end if;
  if not exists(select 1 from branches where id=v_branch and tenant_id=v_old.tenant_id and is_active is true) then raise exception 'Branch is invalid or inactive' using errcode='23503'; end if;
  if not exists(select 1 from departments where id=v_department and tenant_id=v_old.tenant_id and is_active is true and (branch_id is null or branch_id=v_branch)) then raise exception 'Department is invalid or inactive for this branch' using errcode='23503'; end if;
  if v_designation is not null and not exists(select 1 from dropdown_masters where id=v_designation and master_type='designation' and is_active is true and (tenant_id=v_old.tenant_id or tenant_id is null)) then raise exception 'Designation is invalid or inactive' using errcode='23503'; end if;
  if v_buddy is not null and not exists(select 1 from user_profiles where id=v_buddy and tenant_id=v_old.tenant_id and id<>v_old.id and account_status='active') then raise exception 'Buddy is invalid' using errcode='23503'; end if;
  if v_manager = v_old.id or (v_manager is not null and (select is_reporting_descendant(v_old.id,v_manager))) then raise exception 'Reporting hierarchy cannot contain a cycle' using errcode='23514'; end if;
  if v_manager is not null and not exists(select 1 from user_profiles where id=v_manager and tenant_id=v_old.tenant_id and account_status='active') then raise exception 'Reports-to user is invalid or inactive' using errcode='23503'; end if;
  if v_old.user_role='super_admin' and (v_role <> 'super_admin' or v_account <> 'active') and not exists(select 1 from user_profiles where tenant_id=v_old.tenant_id and user_role='super_admin' and account_status='active' and id<>v_old.id) then raise exception 'At least one active super_admin is required' using errcode='23514'; end if;
  if p_changes ? 'personal_mobile' and nullif(btrim(p_changes->>'personal_mobile'),'') is not null and btrim(p_changes->>'personal_mobile') !~ E'^\\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Personal mobile format is invalid' using errcode='22023'; end if;
  update user_profiles set
    employee_name=case when p_changes?'employee_name' then btrim(p_changes->>'employee_name') else employee_name end,
    branch_id=v_branch, department_id=v_department, designation_id=v_designation,
    personal_mobile=case when p_changes?'personal_mobile' then nullif(btrim(p_changes->>'personal_mobile'),'') else personal_mobile end,
    official_mobile=case when p_changes?'official_mobile' then nullif(btrim(p_changes->>'official_mobile'),'') else official_mobile end,
    week_off=case when p_changes?'week_off' then v_week_off else week_off end,
    user_role=v_role, employee_code=case when p_changes?'employee_code' then btrim(p_changes->>'employee_code') else employee_code end,
    buddy_id=v_buddy, working_status=v_status, account_status=v_account, reports_to_user_id=v_manager,
    is_login_enabled=(v_account='active' and v_status<>'resigned'), updated_by=v_actor.id, updated_at=now()
  where id=p_profile_id returning * into v_new;
  if (v_old.branch_id,v_old.department_id,v_old.designation_id,v_old.reports_to_user_id) is distinct from (v_new.branch_id,v_new.department_id,v_new.designation_id,v_new.reports_to_user_id) then
    insert into user_organization_history(tenant_id,user_profile_id,old_branch_id,new_branch_id,old_department_id,new_department_id,old_designation_id,new_designation_id,old_reports_to_user_id,new_reports_to_user_id,changed_by)
    values(v_new.tenant_id,v_new.id,v_old.branch_id,v_new.branch_id,v_old.department_id,v_new.department_id,v_old.designation_id,v_new.designation_id,v_old.reports_to_user_id,v_new.reports_to_user_id,v_actor.id);
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_new.tenant_id,v_actor.id,'user_updated','user_management',v_new.id,to_jsonb(v_old),to_jsonb(v_new));
  return v_new;
end;
$$;

revoke all on function update_user_profile_with_audit(uuid,jsonb) from public;
grant execute on function update_user_profile_with_audit(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
