-- Reconcile the approved employee roster in place. Kept profiles retain their
-- ids, so every task, FMS, form, CRM, availability and audit link survives.
-- Duplicate profiles hand their reporting/buddy links to the kept twin, and
-- employees absent from the roster are marked left. Auth emails, passwords and
-- account deletion stay in the service-role operator script because auth.users
-- cannot share this transaction.
set search_path = public, extensions;

-- True when any foreign key in the database still points at the profile, so a
-- delete would either fail or cascade away history.
create or replace function user_profile_has_linked_records(p_profile_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_fk record; v_found boolean;
begin
  for v_fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.user_profiles'::regclass
  loop
    execute format('select exists(select 1 from %s where %I = $1)', v_fk.tbl, v_fk.col) into v_found using p_profile_id;
    if v_found then return true; end if;
  end loop;
  return false;
end $$;

create or replace function reconcile_employee_roster_with_audit(p_roster jsonb, p_retire jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor user_profiles; v_old user_profiles; v_new user_profiles; v_ref user_profiles;
  r jsonb; v_target uuid; v_manager uuid;
  v_branch uuid; v_department uuid; v_designation uuid; v_role user_role; v_week_off text[];
  v_updated integer := 0; v_retired integer := 0; v_deletable jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if jsonb_typeof(p_roster) <> 'array' or jsonb_array_length(p_roster) = 0 then raise exception 'Roster must be a non-empty array' using errcode = '22023'; end if;
  if jsonb_typeof(p_retire) <> 'array' then raise exception 'Retire list must be an array' using errcode = '22023'; end if;
  if exists (select 1 from (select x->>'profile_id' id from jsonb_array_elements(p_roster) x union all select x->>'profile_id' from jsonb_array_elements(p_retire) x) ids group by lower(btrim(id)) having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(p_roster) x group by lower(btrim(x->>'work_email')) having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(p_roster) x group by lower(btrim(x->>'username')) having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(p_roster) x where nullif(btrim(coalesce(x->>'employee_code','')),'') is not null group by btrim(x->>'employee_code') having count(*) > 1) then
    raise exception 'Roster contains duplicate profiles, work emails, usernames or employee codes' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_retire) x where nullif(x->>'merge_into_profile_id','') is not null
    and not exists (select 1 from jsonb_array_elements(p_roster) k where k->>'profile_id' = x->>'merge_into_profile_id')) then
    raise exception 'A duplicate must merge into a roster profile' using errcode = '22023';
  end if;

  -- The earliest active Super Admin is the system actor, exactly as the
  -- earlier identity reconciliation RPCs resolve it. It is never retired.
  select * into v_actor from user_profiles where user_role = 'super_admin' and account_status = 'active' and is_login_enabled order by created_at limit 1;
  if v_actor.id is null then raise exception 'Active Super Admin is required' using errcode = '42501'; end if;
  if exists (select 1 from jsonb_array_elements(p_retire) x where (x->>'profile_id')::uuid = v_actor.id) then
    raise exception 'The system Super Admin cannot be retired' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_roster) x left join user_profiles p on p.id = (x->>'profile_id')::uuid and p.tenant_id = v_actor.tenant_id where p.id is null)
    or exists (select 1 from jsonb_array_elements(p_retire) x left join user_profiles p on p.id = (x->>'profile_id')::uuid and p.tenant_id = v_actor.tenant_id where p.id is null) then
    raise exception 'Roster profile is invalid' using errcode = '23503';
  end if;

  -- Free unique identifiers first so identifiers can move between profiles
  -- (for example a retired duplicate holding a kept employee's username).
  update user_profiles set username = null
    where id in (select (x->>'profile_id')::uuid from jsonb_array_elements(p_roster) x);
  update user_profiles set email = 'staged-' || id || '@mkjewels.invalid'
    where id in (select (x->>'profile_id')::uuid from jsonb_array_elements(p_roster) x);
  update user_profiles set employee_code = 'staged-' || id
    where id in (select (x->>'profile_id')::uuid from jsonb_array_elements(p_roster) x where nullif(btrim(coalesce(x->>'employee_code','')),'') is not null);
  -- A retiring profile can no longer sign in, so it releases a username the
  -- roster assigns. Emails and codes mirror Auth/HR records and must not move
  -- silently.
  update user_profiles set username = null
    where id in (select (x->>'profile_id')::uuid from jsonb_array_elements(p_retire) x)
      and lower(username) in (select lower(btrim(x->>'username')) from jsonb_array_elements(p_roster) x);
  if exists (select 1 from user_profiles p
    where p.tenant_id = v_actor.tenant_id
      and p.id not in (select (x->>'profile_id')::uuid from jsonb_array_elements(p_roster) x)
      and (lower(p.email) in (select lower(btrim(x->>'work_email')) from jsonb_array_elements(p_roster) x)
        or lower(p.username) in (select lower(btrim(x->>'username')) from jsonb_array_elements(p_roster) x)
        or p.employee_code in (select btrim(x->>'employee_code') from jsonb_array_elements(p_roster) x))) then
    raise exception 'A roster email, username or employee code is held by a profile outside the roster' using errcode = '23505';
  end if;

  -- Retire first: move organisation links off each retiring profile.
  for r in select value from jsonb_array_elements(p_retire) loop
    select * into v_old from user_profiles where id = (r->>'profile_id')::uuid for update;
    v_target := nullif(r->>'merge_into_profile_id','')::uuid;
    for v_ref in select * from user_profiles where (reports_to_user_id = v_old.id or buddy_id = v_old.id or secondary_buddy_id = v_old.id) and id <> v_old.id for update loop
      v_manager := v_ref.reports_to_user_id;
      if v_ref.reports_to_user_id = v_old.id then
        -- A merge keeps the same manager under the kept record; a leaver's
        -- reports are cleared for an admin to reassign.
        v_manager := case when v_target is null or v_target = v_ref.id or is_reporting_descendant(v_ref.id, v_target) then null else v_target end;
      end if;
      update user_profiles set
        reports_to_user_id = v_manager,
        buddy_id = case when buddy_id = v_old.id then (case when v_target = v_ref.id or v_target = v_ref.secondary_buddy_id then null else v_target end) else buddy_id end,
        secondary_buddy_id = case when secondary_buddy_id = v_old.id then (case when v_target = v_ref.id or v_target = v_ref.buddy_id then null else v_target end) else secondary_buddy_id end,
        updated_by = v_actor.id, updated_at = now()
      where id = v_ref.id returning * into v_new;
      -- A merge corrects identity, not the reporting line, so only a cleared
      -- manager is organisation history.
      if v_target is null and v_ref.reports_to_user_id is distinct from v_new.reports_to_user_id then
        insert into user_organization_history(tenant_id,user_profile_id,old_branch_id,new_branch_id,old_department_id,new_department_id,
          old_designation_id,new_designation_id,old_reports_to_user_id,new_reports_to_user_id,changed_by)
        values(v_new.tenant_id,v_new.id,v_ref.branch_id,v_new.branch_id,v_ref.department_id,v_new.department_id,
          v_ref.designation_id,v_new.designation_id,v_ref.reports_to_user_id,v_new.reports_to_user_id,v_actor.id);
      end if;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_ref.tenant_id,v_actor.id,case when v_target is null then 'roster_leaver_links_cleared' else 'roster_duplicate_links_merged' end,'user_management',v_ref.id,
        jsonb_build_object('reports_to_user_id',v_ref.reports_to_user_id,'buddy_id',v_ref.buddy_id,'secondary_buddy_id',v_ref.secondary_buddy_id),
        jsonb_build_object('reports_to_user_id',v_new.reports_to_user_id,'buddy_id',v_new.buddy_id,'secondary_buddy_id',v_new.secondary_buddy_id,'retired_profile_id',v_old.id));
    end loop;
    update branches set manager_id = v_target where manager_id = v_old.id;
    update departments set head_id = v_target where head_id = v_old.id;
    update user_profiles set working_status = 'resigned', account_status = 'left', is_login_enabled = false,
      reports_to_user_id = null, buddy_id = null, secondary_buddy_id = null, updated_by = v_actor.id, updated_at = now()
    where id = v_old.id returning * into v_new;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_old.tenant_id,v_actor.id,case when v_target is null then 'roster_employee_retired' else 'roster_duplicate_retired' end,'user_management',v_old.id,
      to_jsonb(v_old), to_jsonb(v_new) || jsonb_build_object('merged_into_profile_id', v_target));
    v_retired := v_retired + 1;
  end loop;

  -- Then write every roster profile from the approved list.
  for r in select value from jsonb_array_elements(p_roster) loop
    if nullif(btrim(r->>'employee_name'),'') is null or nullif(btrim(r->>'first_name'),'') is null
      or lower(btrim(r->>'username')) !~ '^[a-z0-9]{2,80}$'
      or lower(btrim(r->>'work_email')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Roster identity, username or work email is invalid' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(r->>'personal_email','')),'') is not null and lower(btrim(r->>'personal_email')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Personal email is invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(r->'week_off','[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(r->'week_off','[]'::jsonb)) > 1
      or exists(select 1 from jsonb_array_elements_text(coalesce(r->'week_off','[]'::jsonb)) d where lower(d) not in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')) then
      raise exception 'Week off must be one weekday or none' using errcode = '22023';
    end if;
    select * into v_old from user_profiles where id = (r->>'profile_id')::uuid for update;
    select id into v_branch from branches where tenant_id = v_actor.tenant_id and is_active and lower(name) = lower(btrim(r->>'branch'));
    select id into v_department from departments where tenant_id = v_actor.tenant_id and is_active and lower(name) = lower(btrim(r->>'department')) and (branch_id is null or branch_id = v_branch) order by branch_id nulls last limit 1;
    select id into v_designation from dropdown_masters where is_active and master_type = 'designation' and lower(label) = lower(btrim(r->>'designation')) and (tenant_id = v_actor.tenant_id or tenant_id is null) order by tenant_id nulls last limit 1;
    if v_branch is null or v_department is null or v_designation is null then raise exception 'Roster organization mapping is invalid' using errcode = '23503'; end if;
    -- A Super Admin is never demoted by the roster; other roles (hr, crm,
    -- manager ...) are kept for USER rows so section permissions do not shift.
    v_role := case
      when v_old.user_role = 'super_admin' then 'super_admin'::user_role
      when upper(btrim(r->>'access_level')) = 'ADMIN' then 'admin'::user_role
      when v_old.user_role = 'admin' then 'staff'::user_role
      else v_old.user_role end;
    select coalesce(array_agg(lower(d)), '{}'::text[]) into v_week_off from jsonb_array_elements_text(coalesce(r->'week_off','[]'::jsonb)) d;
    update user_profiles set
      employee_name = btrim(r->>'employee_name'), first_name = btrim(r->>'first_name'), last_name = nullif(btrim(coalesce(r->>'last_name','')),''),
      username = lower(btrim(r->>'username')), email = lower(btrim(r->>'work_email')), official_email = lower(btrim(r->>'work_email')),
      personal_email = coalesce(nullif(lower(btrim(coalesce(r->>'personal_email',''))),''), personal_email),
      employee_code = coalesce(nullif(btrim(coalesce(r->>'employee_code','')),''), v_old.employee_code),
      branch_id = v_branch, department_id = v_department, designation_id = v_designation,
      personal_mobile = coalesce(nullif(btrim(coalesce(r->>'personal_mobile','')),''), personal_mobile),
      official_mobile = coalesce(nullif(btrim(coalesce(r->>'official_mobile','')),''), official_mobile),
      user_role = v_role, account_status = 'active', working_status = 'active', is_login_enabled = true,
      updated_by = v_actor.id, updated_at = now()
    where id = v_old.id;
    -- Week off is written only when it changes: the column's trigger
    -- rematerialises availability on every write.
    if cardinality(v_week_off) > 0 and v_week_off is distinct from v_old.week_off then
      update user_profiles set week_off = v_week_off where id = v_old.id;
    end if;
    select * into v_new from user_profiles where id = v_old.id;
    if (v_old.branch_id,v_old.department_id,v_old.designation_id) is distinct from (v_new.branch_id,v_new.department_id,v_new.designation_id) then
      insert into user_organization_history(tenant_id,user_profile_id,old_branch_id,new_branch_id,old_department_id,new_department_id,
        old_designation_id,new_designation_id,old_reports_to_user_id,new_reports_to_user_id,changed_by)
      values(v_new.tenant_id,v_new.id,v_old.branch_id,v_new.branch_id,v_old.department_id,v_new.department_id,
        v_old.designation_id,v_new.designation_id,v_old.reports_to_user_id,v_new.reports_to_user_id,v_actor.id);
    end if;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_old.tenant_id,v_actor.id,'employee_roster_reconciled','user_management',v_old.id,to_jsonb(v_old),to_jsonb(v_new));
    v_updated := v_updated + 1;
  end loop;

  if not exists (select 1 from user_profiles where tenant_id = v_actor.tenant_id and user_role = 'super_admin' and account_status = 'active' and is_login_enabled) then
    raise exception 'At least one active super_admin is required' using errcode = '23514';
  end if;

  -- Retired profiles with no remaining linked record may be deleted by the
  -- operator script; everything else stays as a left account with history.
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'auth_user_id', p.auth_user_id)), '[]'::jsonb) into v_deletable
  from user_profiles p
  where p.id in (select (x->>'profile_id')::uuid from jsonb_array_elements(p_retire) x)
    and not user_profile_has_linked_records(p.id);

  return jsonb_build_object('updated', v_updated, 'retired', v_retired, 'deletable', v_deletable);
end $$;

revoke all on function user_profile_has_linked_records(uuid) from public, anon, authenticated;
revoke all on function reconcile_employee_roster_with_audit(jsonb, jsonb) from public, anon, authenticated;
grant execute on function user_profile_has_linked_records(uuid) to service_role;
grant execute on function reconcile_employee_roster_with_audit(jsonb, jsonb) to service_role;
notify pgrst, 'reload schema';
