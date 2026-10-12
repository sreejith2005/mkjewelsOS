-- Assignment is a configurable capability, independent of dashboard authority.
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('tasks.assign_others', 'action', null, '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 35);
-- permission-catalog:end

-- Only the approved assignment action extends department section overrides.
-- Keep all other actions and protected authority outside department control.
do $department$
declare f text; n text; signature text;
begin
  foreach signature in array array[
    'public.assert_department_section_override()',
    'public.save_department_permissions_with_audit(uuid,jsonb)'
  ] loop
    f:=pg_get_functiondef(signature::regprocedure);
    n:=replace(f,$old$kind='module'$old$, $new$(kind='module' or key='tasks.assign_others')$new$);
    if n=f then raise exception 'Department assignment validation upgrade failed: %',signature; end if;
    execute n;
  end loop;
  f:=pg_get_functiondef('public.permission_effective_for(uuid,text)'::regprocedure);
  n:=replace(f,$old$if v_catalog.kind='module' and$old$, $new$if (v_catalog.kind='module' or p_key='tasks.assign_others') and$new$);
  if n=f then raise exception 'Department assignment resolution upgrade failed'; end if;
  execute n;
  f:=pg_get_functiondef('public.get_user_access_breakdown(uuid)'::regprocedure);
  n:=replace(f,$old$case when c.kind='module' and$old$, $new$case when (c.kind='module' or c.key='tasks.assign_others') and$new$);
  if n=f then raise exception 'Department assignment breakdown upgrade failed'; end if;
  execute n;
end $department$;

-- These internal predicates always resolve the authenticated actor themselves.
create function public.task_assignment_scope()
returns text language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  if a.id is null or not current_profile_is_active() then return 'none'; end if;
  if a.user_role in ('super_admin','admin') then return 'tenant'; end if;
  if a.user_role='manager' then return 'branch'; end if;
  if exists(select 1 from dropdown_masters d where d.id=a.designation_id
    and d.master_type='designation' and d.is_active
    and (d.tenant_id=a.tenant_id or d.tenant_id is null) and lower(d.value)='process_coordinator') then
    return 'tenant';
  end if;
  return 'department';
end $$;

create function public.task_assignment_user_in_scope(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and exists(
    select 1 from user_profiles u
    join branches b on b.id=u.branch_id and b.tenant_id=u.tenant_id and b.is_active
    join departments d on d.id=u.department_id and d.tenant_id=u.tenant_id and d.is_active
    cross join current_profile() a
    where u.id=p_user_id and u.tenant_id=a.tenant_id and u.working_status='active'
      and u.account_status in ('active','invited')
      and (u.account_status='invited' or u.is_login_enabled)
      and (task_assignment_scope()='tenant'
        or (task_assignment_scope()='branch' and u.branch_id=a.branch_id)
        or (task_assignment_scope()='department' and u.department_id=a.department_id))
  );
$$;

create function public.assert_task_assignment_targets(p_doer_ids uuid[],p_watcher_ids uuid[] default '{}')
returns void language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  perform assert_module_access('tasks');
  if a.id is null or not current_profile_is_active() then
    raise exception 'Active task author is required' using errcode='42501';
  end if;
  if not has_permission('tasks.assign_others') and exists(
    select 1 from unnest(coalesce(p_doer_ids,'{}')) requested(id) where id is distinct from a.id
  ) then
    raise exception 'Assigning tasks to other users is denied' using errcode='42501';
  end if;
  if exists(select 1 from unnest(coalesce(p_doer_ids,'{}')||coalesce(p_watcher_ids,'{}')) requested(id)
    where not task_assignment_user_in_scope(id)) then
    raise exception 'Task participant is inactive or outside your assignment scope' using errcode='42501';
  end if;
end $$;

-- This task-specific roster deliberately bypasses directory RLS without
-- granting access to user contact details or the employee administration API.
create function public.list_task_assignment_users()
returns table(id uuid,tenant_id uuid,branch_id uuid,department_id uuid,employee_code text,
  employee_name text,first_name text,last_name text,user_role user_role,working_status working_status,
  buddy_id uuid,secondary_buddy_id uuid,reports_to_user_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); allowed boolean:=has_permission('tasks.assign_others');
begin
  perform assert_module_access('tasks');
  if a.id is null or not current_profile_is_active() then
    raise exception 'Active task author is required' using errcode='42501';
  end if;
  return query select u.id,u.tenant_id,u.branch_id,u.department_id,u.employee_code,
    u.employee_name,u.first_name,u.last_name,u.user_role,u.working_status,
    u.buddy_id,u.secondary_buddy_id,u.reports_to_user_id
  from user_profiles u
  where u.tenant_id=a.tenant_id and (allowed or u.id=a.id) and task_assignment_user_in_scope(u.id)
  order by u.employee_name,u.id;
end $$;

-- Extend audited contracts in place; retain all existing payload validation,
-- work identity, audit writes, notifications and installed-client signatures.
do $writes$
declare f text; n text; signature text;
begin
  signature:='public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)';
  f:=pg_get_functiondef(signature::regprocedure);
  n:=replace(f,'  if jsonb_typeof(p_payload)',E'  perform assert_task_assignment_targets(p_doer_ids,p_watcher_ids);\n  if jsonb_typeof(p_payload)');
  if n=f then raise exception 'Task creation assignment guard upgrade failed'; end if;
  execute n;
  signature:='public.delegate_task_with_audit(uuid,uuid,uuid,text)';
  f:=pg_get_functiondef(signature::regprocedure);
  n:=replace(f,$old$  if v_task.status = 'completed'$old$,E'  perform assert_task_assignment_targets(array[p_to_user_id]);\n  if v_task.status = ''completed''');
  if n=f then raise exception 'Task transfer assignment guard upgrade failed'; end if;
  execute n;
  -- Both the current wrapper and its directly callable compatibility contract
  -- need the same guard; neither may bypass an explicit denial.
  foreach signature in array array[
    'public.assign_imported_task_with_audit(text,uuid,uuid)',
    'public.assign_imported_task_with_audit_v0104(text,uuid,uuid)'
  ] loop
    f:=pg_get_functiondef(signature::regprocedure);
    n:=regexp_replace(f,E'\\mbegin\\M',E'begin\n  perform assert_task_assignment_targets(array[p_user_profile_id]);','i');
    if n=f then raise exception 'Imported assignment guard upgrade failed: %',signature; end if;
    execute n;
  end loop;
end $writes$;

revoke all on function task_assignment_scope(),task_assignment_user_in_scope(uuid),
  assert_task_assignment_targets(uuid[],uuid[]),list_task_assignment_users() from public,anon,authenticated,service_role;
grant execute on function list_task_assignment_users() to authenticated;
notify pgrst,'reload schema';
