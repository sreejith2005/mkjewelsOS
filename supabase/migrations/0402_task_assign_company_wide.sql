-- Assign tasks to anyone in the company (owner report 2026-11-10).
--
-- Problem: Settings > Permission management could grant "Assign tasks to other
-- users" to an Executive Assistant (staff role), but she still saw only herself.
-- That grant opens the person's existing scope only, and for anyone below
-- Manager the scope is their own department; managers were also never offered.
-- Nothing in Permission management could widen it.
--
-- Fix: one new configurable capability, tasks.assign_company_wide ("Assign
-- tasks to anyone in the company"), set per role, department, designation or
-- user like "Assign tasks to other users". Together with that permission it:
--   * gives company scope for task recipients (task_assignment_scope = tenant),
--     so the Users picker lists every active employee, still inside the
--     franchise boundary (org_recipient_allowed is unchanged);
--   * lets the person create the task in that employee's store and department
--     (create_delegation_task_with_audit's own department gate);
--   * adds Managers and HR as recipients. Admin, Director, Owner and Super Admin
--     accounts are never offered (owner decision 2026-11-10).
-- Every assignment path already shares task_assignment_scope /
-- task_assignment_recipient_allowed (create, transfer, schedules, run now,
-- FMS handoffs), so they all follow the switch. Default: Super Admin and Admin,
-- who already had company scope, so nobody's access changes until it is granted.
set search_path = public, extensions;

create function pg_temp.patch_0402(p_signature text, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0402: expected % match(es) in %, found %: %', p_expected, p_signature, found, left(p_old, 80);
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('tasks.assign_company_wide', 'action', null, '{super_admin,admin}', 37);
-- permission-catalog:end

-- 1. Company scope for task recipients.
select pg_temp.patch_0402('public.task_assignment_scope()',
  E'  if a.user_role in (''super_admin'',''admin'') then return ''tenant''; end if;\n',
  E'  if a.user_role in (''super_admin'',''admin'') then return ''tenant''; end if;\n'
  || E'  if has_permission(''tasks.assign_company_wide'') then return ''tenant''; end if;\n', 1);

-- 2. Managers and HR become recipients for holders of the capability; Admin,
--    Director, Owner and Super Admin accounts stay protected (0228).
create or replace function public.task_assignment_recipient_allowed(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists(
    select 1 from user_profiles u cross join current_profile() a
    left join user_access_profiles access on access.user_profile_id = u.id
    where u.id = p_user_id and u.tenant_id = a.tenant_id and (
      u.id = a.id or a.user_role in ('super_admin', 'admin') or (
        u.user_role not in ('super_admin', 'admin')
        and coalesce(access.dashboard_authority, u.user_role) not in ('super_admin', 'admin')
        and ((u.user_role <> 'manager' and coalesce(access.dashboard_authority, u.user_role) <> 'manager')
          or has_permission('tasks.assign_company_wide'))
        and not exists(select 1 from dropdown_masters d where d.id = u.designation_id
          and d.master_type = 'designation' and (d.tenant_id = u.tenant_id or d.tenant_id is null)
          and (lower(d.label) ~ '(^|[^a-z])(director|owner)([^a-z]|$)'
            or lower(d.value) ~ '(^|[^a-z])(director|owner)([^a-z]|$)'))
      )
    )
  );
$$;
revoke all on function task_assignment_recipient_allowed(uuid) from public, anon, authenticated, service_role;

-- 3. The creation contract's own department gate for staff authors.
select pg_temp.patch_0402('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
  E'      and v_actor.user_role not in (''super_admin'', ''admin'', ''manager'')\n',
  E'      and v_actor.user_role not in (''super_admin'', ''admin'', ''manager'')\n'
  || E'      and not public.has_permission(''tasks.assign_company_wide'')\n', 1);

-- 4. Departments can grant or deny it, like "Assign tasks to other users" (0221).
select pg_temp.patch_0402('public.permission_effective_for(uuid,text)',
  $o$(v_catalog.kind='module' or p_key='tasks.assign_others')$o$,
  $n$(v_catalog.kind='module' or p_key in ('tasks.assign_others','tasks.assign_company_wide'))$n$, 1);
select pg_temp.patch_0402('public.assert_department_section_override()',
  $o$(kind='module' or key='tasks.assign_others')$o$,
  $n$(kind='module' or key in ('tasks.assign_others','tasks.assign_company_wide'))$n$, 1);
select pg_temp.patch_0402('public.save_department_permissions_with_audit(uuid,jsonb)',
  $o$(kind='module' or key='tasks.assign_others')$o$,
  $n$(kind='module' or key in ('tasks.assign_others','tasks.assign_company_wide'))$n$, 1);
select pg_temp.patch_0402('public.get_user_access_breakdown(uuid)',
  $o$(c.kind='module' or c.key='tasks.assign_others')$o$,
  $n$(c.kind='module' or c.key in ('tasks.assign_others','tasks.assign_company_wide'))$n$, 1);

notify pgrst, 'reload schema';
