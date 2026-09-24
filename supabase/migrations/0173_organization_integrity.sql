-- Preserve organization integrity across concurrent saves and later employee edits.
set search_path = public, extensions;

create function enforce_department_code_uniqueness()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.tenant_id, lower(new.code)) is distinct from (old.tenant_id, lower(old.code)) then
    -- Serialize same-code writes without imposing a new index on existing data.
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || lower(new.code), 0));
    if exists (
      select 1 from departments d
      where d.tenant_id = new.tenant_id and lower(d.code) = lower(new.code) and d.id is distinct from new.id
    ) then
      raise exception 'Department code already exists' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

create trigger enforce_department_code_uniqueness_before_write
before insert or update of tenant_id, code on departments
for each row execute function enforce_department_code_uniqueness();

create function preserve_organization_leader_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only a change that could break a leader assignment is checked. A save that
  -- rewrites the same values must not fail because an older record was already
  -- inconsistent (for example a head recorded outside their department).
  if (new.branch_id, new.department_id, new.account_status, new.is_login_enabled, new.working_status)
     is not distinct from (old.branch_id, old.department_id, old.account_status, old.is_login_enabled, old.working_status) then
    return new;
  end if;
  if exists (
    select 1 from branches b where b.manager_id = new.id
      and (new.branch_id is distinct from b.id or new.account_status <> 'active' or not new.is_login_enabled or new.working_status = 'resigned')
  ) then
    raise exception 'Reassign the branch manager before moving or deactivating this employee' using errcode = '23514';
  end if;
  if exists (
    select 1 from departments d where d.head_id = new.id
      and (new.department_id is distinct from d.id or (d.branch_id is not null and new.branch_id is distinct from d.branch_id)
        or new.account_status <> 'active' or not new.is_login_enabled or new.working_status = 'resigned')
  ) then
    raise exception 'Reassign the department head before moving or deactivating this employee' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger preserve_organization_leader_assignment_before_update
before update of branch_id, department_id, account_status, is_login_enabled, working_status on user_profiles
for each row execute function preserve_organization_leader_assignment();

-- Earlier applied contracts guarded every employee except leavers. Only active
-- employees prevent unit deactivation; inactive profiles retain history.
do $$
declare
  v_branch text := pg_get_functiondef('save_branch_with_audit_impl(uuid,jsonb)'::regprocedure);
  v_department text := pg_get_functiondef('save_department_with_audit_impl(uuid,jsonb)'::regprocedure);
  v_guard text := 'u.account_status<>''left''';
begin
  if position(v_guard in v_branch) = 0 or position(v_guard in v_department) = 0 then
    raise exception 'Organization deactivation contract changed unexpectedly';
  end if;
  execute replace(v_branch, v_guard, 'u.account_status=''active''');
  execute replace(v_department, v_guard, 'u.account_status=''active''');
end $$;

revoke all on function enforce_department_code_uniqueness(), preserve_organization_leader_assignment() from public, anon, authenticated;
