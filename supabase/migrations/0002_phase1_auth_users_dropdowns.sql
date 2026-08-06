-- Phase 1: close user-role escalation, add Phase 1 RLS, and expose narrow,
-- transactional RPCs for every audited mutation.

set search_path = public, extensions;

create or replace function current_profile()
returns user_profiles
language sql stable security definer
set search_path = public
as $$
  select * from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_role_level()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select user_role from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_tenant_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select tenant_id from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_branch_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select branch_id from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function is_super_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(current_role_level() = 'super_admin', false);
$$;

alter table tenants enable row level security;
alter table branches enable row level security;
alter table departments enable row level security;
alter table resignations enable row level security;
alter table audit_logs enable row level security;

drop policy if exists up_select on user_profiles;
create policy up_select on user_profiles for select
  using (
    auth_user_id = auth.uid()
    or is_super_admin()
    or (
      tenant_id = current_tenant_id()
      and current_role_level() in ('admin', 'manager', 'hr')
    )
  );

drop policy if exists up_write on user_profiles;
-- No direct INSERT/UPDATE/DELETE policy is intentionally provided. Authenticated
-- users must use the audited RPCs below; service_role remains available to the
-- invite Edge Function.

drop policy if exists dm_write on dropdown_masters;
-- Dropdown writes likewise go only through change_dropdown_with_audit().

create policy tenants_select on tenants for select
  using (id = current_tenant_id() or is_super_admin());
create policy branches_select on branches for select
  using (tenant_id = current_tenant_id() or is_super_admin());
create policy departments_select on departments for select
  using (tenant_id = current_tenant_id() or is_super_admin());

create policy resignations_select on resignations for select
  using (
    is_super_admin()
    or (tenant_id = current_tenant_id()
      and current_role_level() in ('admin', 'manager', 'hr'))
  );

create policy audit_logs_select on audit_logs for select
  using (
    tenant_id = current_tenant_id()
    and current_role_level() in ('super_admin', 'admin')
  );

alter table user_profiles
  add constraint user_profiles_designation_id_fkey
  foreign key (designation_id) references dropdown_masters(id) not valid;

create index if not exists idx_user_profiles_filters
  on user_profiles (tenant_id, user_role, branch_id, department_id, working_status);
create index if not exists idx_dropdown_masters_category
  on dropdown_masters (tenant_id, master_type, is_active, sort_order);
create index if not exists idx_resignations_profile
  on resignations (tenant_id, user_profile_id, created_at desc);

create or replace function update_user_profile_with_audit(
  p_profile_id uuid,
  p_changes jsonb
)
returns user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old user_profiles;
  v_new user_profiles;
  v_role user_role;
  v_status working_status;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or v_actor.user_role not in ('super_admin', 'admin')
     or v_actor.working_status = 'resigned' or v_actor.is_login_enabled is false then
    raise exception 'Only super_admin or admin can edit user profiles' using errcode = '42501';
  end if;

  if p_changes - array[
    'employee_name','branch_id','department_id','designation_id',
    'personal_mobile','official_mobile','week_off','user_role',
    'employee_code','buddy_id','working_status'
  ] <> '{}'::jsonb then
    raise exception 'Profile update contains unsupported fields' using errcode = '22023';
  end if;

  select * into v_old from user_profiles where id = p_profile_id for update;
  if v_old.id is null or (v_actor.user_role <> 'super_admin' and v_old.tenant_id <> v_actor.tenant_id) then
    raise exception 'Profile not found or not accessible' using errcode = '42501';
  end if;

  v_role := case when p_changes ? 'user_role'
    then (p_changes->>'user_role')::user_role else v_old.user_role end;
  v_status := case when p_changes ? 'working_status'
    then (p_changes->>'working_status')::working_status else v_old.working_status end;

  if v_actor.user_role <> 'super_admin' and v_role <> v_old.user_role then
    raise exception 'Only super_admin can change user_role' using errcode = '42501';
  end if;
  if not exists (
    select 1 from branches where id = (case when p_changes ? 'branch_id'
      then (p_changes->>'branch_id')::uuid else v_old.branch_id end)
      and tenant_id = v_old.tenant_id
  ) then
    raise exception 'Branch is outside the profile tenant' using errcode = '23503';
  end if;
  if not exists (
    select 1 from departments where id = (case when p_changes ? 'department_id'
      then (p_changes->>'department_id')::uuid else v_old.department_id end)
      and tenant_id = v_old.tenant_id
      and (branch_id is null or branch_id = (case when p_changes ? 'branch_id'
        then (p_changes->>'branch_id')::uuid else v_old.branch_id end))
  ) then
    raise exception 'Department is outside the selected branch' using errcode = '23503';
  end if;
  if (case when p_changes ? 'designation_id' then nullif(p_changes->>'designation_id', '')::uuid
      else v_old.designation_id end) is not null and not exists (
    select 1 from dropdown_masters where id = (case when p_changes ? 'designation_id'
      then nullif(p_changes->>'designation_id', '')::uuid else v_old.designation_id end)
      and master_type = 'designation' and is_active is not false
      and (tenant_id = v_old.tenant_id or tenant_id is null)
  ) then
    raise exception 'Designation is invalid' using errcode = '23503';
  end if;
  if (case when p_changes ? 'buddy_id' then nullif(p_changes->>'buddy_id', '')::uuid
      else v_old.buddy_id end) is not null and not exists (
    select 1 from user_profiles where id = (case when p_changes ? 'buddy_id'
      then nullif(p_changes->>'buddy_id', '')::uuid else v_old.buddy_id end)
      and tenant_id = v_old.tenant_id and id <> v_old.id and working_status = 'active'
  ) then
    raise exception 'Buddy is invalid' using errcode = '23503';
  end if;
  if p_changes ? 'personal_mobile'
     and btrim(p_changes->>'personal_mobile') !~ '^\+?[0-9][0-9 ()-]{7,19}$' then
    raise exception 'Personal mobile format is invalid' using errcode = '22023';
  end if;
  if p_changes ? 'official_mobile' and nullif(btrim(p_changes->>'official_mobile'), '') is not null
     and btrim(p_changes->>'official_mobile') !~ '^\+?[0-9][0-9 ()-]{7,19}$' then
    raise exception 'Official mobile format is invalid' using errcode = '22023';
  end if;
  if p_changes ? 'week_off' and exists (
    select 1 from jsonb_array_elements_text(p_changes->'week_off') requested(value)
    where not exists (
      select 1 from dropdown_masters dm where dm.master_type = 'week_off'
        and dm.value = requested.value and dm.is_active is not false
        and (dm.tenant_id = v_old.tenant_id or dm.tenant_id is null)
    )
  ) then
    raise exception 'Week off contains an invalid value' using errcode = '23503';
  end if;
  if v_status = 'resigned' and v_old.working_status <> 'resigned' then
    raise exception 'Use the resignation workflow to set resigned status' using errcode = '22023';
  end if;
  if v_status = 'active' and (case when p_changes ? 'buddy_id'
    then nullif(p_changes->>'buddy_id', '')::uuid else v_old.buddy_id end) is null then
    raise exception 'Buddy is required for active users' using errcode = '23514';
  end if;

  update user_profiles set
    employee_name = case when p_changes ? 'employee_name' then btrim(p_changes->>'employee_name') else employee_name end,
    branch_id = case when p_changes ? 'branch_id' then (p_changes->>'branch_id')::uuid else branch_id end,
    department_id = case when p_changes ? 'department_id' then (p_changes->>'department_id')::uuid else department_id end,
    designation_id = case when p_changes ? 'designation_id' then nullif(p_changes->>'designation_id', '')::uuid else designation_id end,
    personal_mobile = case when p_changes ? 'personal_mobile' then btrim(p_changes->>'personal_mobile') else personal_mobile end,
    official_mobile = case when p_changes ? 'official_mobile' then nullif(btrim(p_changes->>'official_mobile'), '') else official_mobile end,
    week_off = case when p_changes ? 'week_off' then array(select jsonb_array_elements_text(p_changes->'week_off')) else week_off end,
    user_role = v_role,
    employee_code = case when p_changes ? 'employee_code' then btrim(p_changes->>'employee_code') else employee_code end,
    buddy_id = case when p_changes ? 'buddy_id' then nullif(p_changes->>'buddy_id', '')::uuid else buddy_id end,
    working_status = v_status,
    updated_by = v_actor.id,
    updated_at = now()
  where id = p_profile_id
  returning * into v_new;

  if v_old.working_status <> v_new.working_status then
    insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (v_new.tenant_id, v_actor.id, 'working_status_changed', 'user_management', v_new.id,
      jsonb_build_object('working_status', v_old.working_status),
      jsonb_build_object('working_status', v_new.working_status));
  end if;

  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_new.tenant_id, v_actor.id, 'profile_updated', 'user_management', v_new.id, to_jsonb(v_old), to_jsonb(v_new));

  return v_new;
end;
$$;

create or replace function submit_resignation_with_audit(
  p_profile_id uuid,
  p_profile_changes jsonb,
  p_resignation jsonb
)
returns resignations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old user_profiles;
  v_new user_profiles;
  v_resignation resignations;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or v_actor.user_role not in ('super_admin', 'admin')
     or v_actor.working_status = 'resigned' or v_actor.is_login_enabled is false then
    raise exception 'Only super_admin or admin can submit resignations' using errcode = '42501';
  end if;

  select * into v_old from user_profiles where id = p_profile_id for update;
  if v_old.id is null or (v_actor.user_role <> 'super_admin' and v_old.tenant_id <> v_actor.tenant_id) then
    raise exception 'Profile not found or not accessible' using errcode = '42501';
  end if;
  if exists (
    select 1 from resignations where user_profile_id = p_profile_id
      and (manager_approval_status = 'pending' or super_admin_approval_status = 'pending')
  ) then
    raise exception 'A pending resignation already exists for this user' using errcode = '23505';
  end if;
  if v_actor.user_role <> 'super_admin'
     and p_profile_changes ? 'user_role'
     and (p_profile_changes->>'user_role')::user_role <> v_old.user_role then
    raise exception 'Only super_admin can change user_role' using errcode = '42501';
  end if;
  if not exists (select 1 from branches where id = (p_profile_changes->>'branch_id')::uuid and tenant_id = v_old.tenant_id)
     or not exists (
       select 1 from departments where id = (p_profile_changes->>'department_id')::uuid
         and tenant_id = v_old.tenant_id
         and (branch_id is null or branch_id = (p_profile_changes->>'branch_id')::uuid)
     ) then
    raise exception 'Branch or department is outside the profile tenant' using errcode = '23503';
  end if;
  if nullif(p_profile_changes->>'designation_id', '') is not null and not exists (
    select 1 from dropdown_masters where id = (p_profile_changes->>'designation_id')::uuid
      and master_type = 'designation' and is_active is not false
      and (tenant_id = v_old.tenant_id or tenant_id is null)
  ) then
    raise exception 'Designation is invalid' using errcode = '23503';
  end if;
  if nullif(p_profile_changes->>'buddy_id', '') is not null and not exists (
    select 1 from user_profiles where id = (p_profile_changes->>'buddy_id')::uuid
      and tenant_id = v_old.tenant_id and id <> v_old.id and working_status = 'active'
  ) then
    raise exception 'Buddy is invalid' using errcode = '23503';
  end if;
  if btrim(p_profile_changes->>'personal_mobile') !~ '^\+?[0-9][0-9 ()-]{7,19}$'
     or (nullif(btrim(p_profile_changes->>'official_mobile'), '') is not null
       and btrim(p_profile_changes->>'official_mobile') !~ '^\+?[0-9][0-9 ()-]{7,19}$') then
    raise exception 'Mobile format is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_profile_changes->'week_off') requested(value)
    where not exists (
      select 1 from dropdown_masters dm where dm.master_type = 'week_off'
        and dm.value = requested.value and dm.is_active is not false
        and (dm.tenant_id = v_old.tenant_id or dm.tenant_id is null)
    )
  ) then
    raise exception 'Week off contains an invalid value' using errcode = '23503';
  end if;
  if not exists (
    select 1 from dropdown_masters where id = (p_resignation->>'resignation_reason_id')::uuid
      and master_type = 'resignation_reason' and is_active is not false
      and (tenant_id = v_old.tenant_id or tenant_id is null)
  ) then
    raise exception 'Resignation reason is invalid' using errcode = '23503';
  end if;
  if (p_resignation->>'last_working_date')::date < (p_resignation->>'resignation_date')::date then
    raise exception 'Last working date cannot precede resignation date' using errcode = '22023';
  end if;
  if exists (
    select requested.id from (values
      (nullif(p_resignation->>'handover_given_to', '')::uuid),
      (nullif(p_resignation->>'replacement_buddy_id', '')::uuid)
    ) requested(id)
    where requested.id is not null and not exists (
      select 1 from user_profiles candidate where candidate.id = requested.id
        and candidate.tenant_id = v_old.tenant_id and candidate.id <> v_old.id
        and candidate.working_status = 'active'
    )
  ) then
    raise exception 'Handover or replacement user is invalid' using errcode = '23503';
  end if;

  update user_profiles set
    employee_name = btrim(p_profile_changes->>'employee_name'),
    branch_id = (p_profile_changes->>'branch_id')::uuid,
    department_id = (p_profile_changes->>'department_id')::uuid,
    designation_id = nullif(p_profile_changes->>'designation_id', '')::uuid,
    personal_mobile = btrim(p_profile_changes->>'personal_mobile'),
    official_mobile = nullif(btrim(p_profile_changes->>'official_mobile'), ''),
    week_off = array(select jsonb_array_elements_text(p_profile_changes->'week_off')),
    user_role = (p_profile_changes->>'user_role')::user_role,
    employee_code = btrim(p_profile_changes->>'employee_code'),
    buddy_id = nullif(p_profile_changes->>'buddy_id', '')::uuid,
    working_status = 'resigned',
    updated_by = v_actor.id,
    updated_at = now()
  where id = p_profile_id
  returning * into v_new;

  insert into resignations (
    tenant_id, user_profile_id, resignation_date, last_working_date,
    resignation_reason_id, notice_period_served, handover_completed,
    handover_given_to, pending_tasks_reassigned, replacement_buddy_id,
    company_assets_returned, official_mobile_returned,
    email_access_remove_date, final_settlement_status, hr_remark,
    created_by, updated_by
  ) values (
    v_old.tenant_id, p_profile_id,
    (p_resignation->>'resignation_date')::date,
    (p_resignation->>'last_working_date')::date,
    nullif(p_resignation->>'resignation_reason_id', '')::uuid,
    (p_resignation->>'notice_period_served')::boolean,
    (p_resignation->>'handover_completed')::boolean,
    nullif(p_resignation->>'handover_given_to', '')::uuid,
    (p_resignation->>'pending_tasks_reassigned')::boolean,
    nullif(p_resignation->>'replacement_buddy_id', '')::uuid,
    (p_resignation->>'company_assets_returned')::boolean,
    nullif(p_resignation->>'official_mobile_returned', '')::boolean,
    (p_resignation->>'email_access_remove_date')::date,
    nullif(btrim(p_resignation->>'final_settlement_status'), ''),
    nullif(btrim(p_resignation->>'hr_remark'), ''),
    v_actor.id, v_actor.id
  ) returning * into v_resignation;

  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values
    (v_old.tenant_id, v_actor.id, 'profile_updated', 'user_management', v_new.id, to_jsonb(v_old), to_jsonb(v_new)),
    (v_old.tenant_id, v_actor.id, 'working_status_changed', 'user_management', v_new.id,
      jsonb_build_object('working_status', v_old.working_status), jsonb_build_object('working_status', 'resigned')),
    (v_old.tenant_id, v_actor.id, 'resignation_submitted', 'user_management', v_resignation.id, null, to_jsonb(v_resignation));

  return v_resignation;
end;
$$;

create or replace function review_resignation_with_audit(
  p_resignation_id uuid,
  p_decision text
)
returns resignations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old resignations;
  v_new resignations;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_old from resignations where id = p_resignation_id for update;
  if v_actor.id is null or v_old.id is null or v_old.tenant_id <> v_actor.tenant_id
     or v_actor.working_status = 'resigned' or v_actor.is_login_enabled is false then
    raise exception 'Resignation not found or not accessible' using errcode = '42501';
  end if;

  if v_actor.user_role = 'manager' then
    if v_old.manager_approval_status <> 'pending' then
      raise exception 'Manager decision has already been recorded' using errcode = '22023';
    end if;
    update resignations set manager_approval_status = p_decision,
      updated_by = v_actor.id, updated_at = now()
    where id = p_resignation_id returning * into v_new;
  elsif v_actor.user_role = 'super_admin' then
    if v_old.super_admin_approval_status <> 'pending' then
      raise exception 'Super admin decision has already been recorded' using errcode = '22023';
    end if;
    update resignations set super_admin_approval_status = p_decision,
      updated_by = v_actor.id, updated_at = now()
    where id = p_resignation_id returning * into v_new;
  else
    raise exception 'Only manager or super_admin can review resignations' using errcode = '42501';
  end if;

  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_new.tenant_id, v_actor.id, 'resignation_reviewed', 'user_management', v_new.id, to_jsonb(v_old), to_jsonb(v_new));

  if v_new.manager_approval_status = 'approved'
     and v_new.super_admin_approval_status = 'approved' then
    update user_profiles set is_login_enabled = false, working_status = 'resigned',
      updated_by = v_actor.id, updated_at = now()
    where id = v_new.user_profile_id;
    insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (v_new.tenant_id, v_actor.id, 'resignation_finalized', 'user_management', v_new.user_profile_id,
      null, jsonb_build_object('is_login_enabled', false, 'working_status', 'resigned'));
  end if;

  return v_new;
end;
$$;

create or replace function change_dropdown_with_audit(
  p_operation text,
  p_record_id uuid default null,
  p_master_type text default null,
  p_label text default null,
  p_value text default null,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns dropdown_masters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old dropdown_masters;
  v_new dropdown_masters;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or v_actor.user_role <> 'super_admin'
     or v_actor.working_status = 'resigned' or v_actor.is_login_enabled is false then
    raise exception 'Only super_admin can change dropdown masters' using errcode = '42501';
  end if;

  if p_operation = 'create' then
    if nullif(btrim(p_master_type), '') is null or nullif(btrim(p_label), '') is null
       or nullif(btrim(p_value), '') is null then
      raise exception 'master_type, label, and value are required' using errcode = '23502';
    end if;
    insert into dropdown_masters (
      tenant_id, master_type, label, value, sort_order, is_active, created_by, updated_by
    ) values (
      v_actor.tenant_id, btrim(p_master_type), btrim(p_label), btrim(p_value),
      p_sort_order, p_is_active, v_actor.id, v_actor.id
    ) returning * into v_new;
  elsif p_operation = 'update' then
    select * into v_old from dropdown_masters where id = p_record_id for update;
    if v_old.id is null or (v_old.tenant_id is not null and v_old.tenant_id <> v_actor.tenant_id) then
      raise exception 'Dropdown item not found or not accessible' using errcode = '42501';
    end if;
    update dropdown_masters set
      master_type = btrim(p_master_type), label = btrim(p_label), value = btrim(p_value),
      sort_order = p_sort_order, is_active = p_is_active,
      updated_by = v_actor.id, updated_at = now()
    where id = p_record_id returning * into v_new;
  elsif p_operation = 'delete' then
    select * into v_old from dropdown_masters where id = p_record_id for update;
    if v_old.id is null or (v_old.tenant_id is not null and v_old.tenant_id <> v_actor.tenant_id) then
      raise exception 'Dropdown item not found or not accessible' using errcode = '42501';
    end if;
    delete from dropdown_masters where id = p_record_id;
    v_new := v_old;
  else
    raise exception 'Unsupported dropdown operation' using errcode = '22023';
  end if;

  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (
    v_actor.tenant_id, v_actor.id, 'dropdown_changed', 'dropdown_master', v_new.id,
    case when p_operation = 'create' then null else to_jsonb(v_old) end,
    case when p_operation = 'delete' then null else to_jsonb(v_new) end
  );
  return v_new;
end;
$$;

create or replace function invite_profile_with_audit(
  p_auth_user_id uuid,
  p_creator_profile_id uuid,
  p_email text,
  p_employee_name text,
  p_branch_id uuid,
  p_department_id uuid,
  p_designation_id uuid,
  p_personal_mobile text,
  p_official_mobile text,
  p_week_off text[],
  p_user_role user_role,
  p_employee_code text,
  p_buddy_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator user_profiles;
  v_profile user_profiles;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into v_creator from user_profiles where id = p_creator_profile_id;
  if v_creator.id is null or v_creator.user_role not in ('super_admin', 'admin')
     or v_creator.working_status = 'resigned' or v_creator.is_login_enabled is false then
    raise exception 'Inviter is not authorized' using errcode = '42501';
  end if;
  if v_creator.user_role = 'admin' and p_user_role = 'super_admin' then
    raise exception 'Admin cannot create super_admin users' using errcode = '42501';
  end if;
  if not exists (select 1 from branches where id = p_branch_id and tenant_id = v_creator.tenant_id)
     or not exists (
       select 1 from departments where id = p_department_id and tenant_id = v_creator.tenant_id
         and (branch_id is null or branch_id = p_branch_id)
     ) then
    raise exception 'Branch or department is outside the inviter tenant' using errcode = '23503';
  end if;
  if p_buddy_id is null or not exists (
    select 1 from user_profiles where id = p_buddy_id and tenant_id = v_creator.tenant_id
  ) then
    raise exception 'A buddy from the same tenant is required' using errcode = '23514';
  end if;
  if p_designation_id is not null and not exists (
    select 1 from dropdown_masters where id = p_designation_id
      and master_type = 'designation' and is_active is not false
      and (tenant_id = v_creator.tenant_id or tenant_id is null)
  ) then
    raise exception 'Designation is invalid' using errcode = '23503';
  end if;
  if btrim(p_personal_mobile) !~ '^\+?[0-9][0-9 ()-]{7,19}$'
     or (nullif(btrim(p_official_mobile), '') is not null
       and btrim(p_official_mobile) !~ '^\+?[0-9][0-9 ()-]{7,19}$') then
    raise exception 'Mobile format is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_week_off) requested(value)
    where not exists (
      select 1 from dropdown_masters dm where dm.master_type = 'week_off'
        and dm.value = requested.value and dm.is_active is not false
        and (dm.tenant_id = v_creator.tenant_id or dm.tenant_id is null)
    )
  ) then
    raise exception 'Week off contains an invalid value' using errcode = '23503';
  end if;

  insert into user_profiles (
    auth_user_id, tenant_id, branch_id, department_id, employee_name,
    designation_id, personal_mobile, official_mobile, email, week_off,
    user_role, employee_code, buddy_id, working_status, is_login_enabled,
    created_by, updated_by
  ) values (
    p_auth_user_id, v_creator.tenant_id, p_branch_id, p_department_id,
    btrim(p_employee_name), p_designation_id, btrim(p_personal_mobile),
    nullif(btrim(p_official_mobile), ''), lower(btrim(p_email)), p_week_off,
    p_user_role, btrim(p_employee_code), p_buddy_id, 'active', true,
    v_creator.id, v_creator.id
  ) returning * into v_profile;

  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_creator.tenant_id, v_creator.id, 'user_created', 'user_management', v_profile.id, to_jsonb(v_profile));
  return v_profile.id;
end;
$$;

revoke all on function update_user_profile_with_audit(uuid, jsonb) from public;
revoke all on function submit_resignation_with_audit(uuid, jsonb, jsonb) from public;
revoke all on function review_resignation_with_audit(uuid, text) from public;
revoke all on function change_dropdown_with_audit(text, uuid, text, text, text, integer, boolean) from public;
revoke all on function invite_profile_with_audit(uuid, uuid, text, text, uuid, uuid, uuid, text, text, text[], user_role, text, uuid) from public;

grant execute on function update_user_profile_with_audit(uuid, jsonb) to authenticated;
grant execute on function submit_resignation_with_audit(uuid, jsonb, jsonb) to authenticated;
grant execute on function review_resignation_with_audit(uuid, text) to authenticated;
grant execute on function change_dropdown_with_audit(text, uuid, text, text, text, integer, boolean) to authenticated;
grant execute on function invite_profile_with_audit(uuid, uuid, text, text, uuid, uuid, uuid, text, text, text[], user_role, text, uuid) to service_role;
