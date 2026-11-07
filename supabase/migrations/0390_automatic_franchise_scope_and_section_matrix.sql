-- Automatic franchise scope and the bulk section-access matrix.
--
-- 1. Automatic franchise scope (owner request 2026-11-07). A person's franchise
--    is already known from their store (branches.franchise_group_id), so Admin
--    and HR no longer need a manual "Grant scope" row to cover it:
--      * Admin (role or dashboard authority) -> Regional Admin of the franchise
--        their own store belongs to;
--      * HR                                  -> HR of that franchise;
--      * a store's manager (branches.manager_id) already covers that store;
--      * everyone else keeps their own store.
--    It behaves exactly like the equivalent grant (data scope and, while
--    isolation is on, the scope-authority permission defaults). It is derived
--    on every call, so a change of store, role or franchise mapping moves it at
--    once; nothing is copied. Explicit grants still add to it (company scope, a
--    Director with the manager role, store access). A store with no franchise
--    (an exhibition) confers nothing beyond the person's own store. Isolation
--    is still Off until Super Admin switches it on; while it is off reads and
--    writes behave as before.
--
-- 2. Users > Section access for everyone at once: one read of every
--    employee's section overrides and inherited state, and one bulk save that
--    runs the existing audited per-user writer for each changed employee in a
--    single transaction (each employee keeps its own `user_access_saved`
--    audit row and every existing safeguard).
set search_path = public, extensions;

create function pg_temp.scope_patch(p_signature text, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0390: expected % match(es) in %, found %: %', p_expected, p_signature, found, left(p_old, 80);
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Automatic franchise scope
-- ---------------------------------------------------------------------------

-- The franchise authority a person's own role confers through their store.
-- At most one row: none when the role confers nothing, the store has no
-- franchise, the franchise is inactive, or the person is not active.
create function org_automatic_scope(p_profile_id uuid)
returns table(authority text, franchise_group_id uuid)
language sql stable security definer set search_path = public as $$
  select case coalesce(ua.dashboard_authority, p.user_role) when 'admin' then 'regional_admin' else 'hr' end, f.id
  from user_profiles p
  left join user_access_profiles ua on ua.user_profile_id = p.id
  join branches b on b.id = p.branch_id and b.tenant_id = p.tenant_id
  join franchise_groups f on f.id = b.franchise_group_id and f.tenant_id = b.tenant_id and f.is_active
  where p.id = p_profile_id
    and coalesce(ua.dashboard_authority, p.user_role) in ('admin', 'hr')
    and org_profile_is_active(p.id);
$$;
revoke all on function org_automatic_scope(uuid) from public, anon, authenticated, service_role;

create or replace function org_scope_branch_ids(p_profile_id uuid, p_manage boolean)
returns uuid[] language sql stable security definer set search_path = public as $$
  with actor as (
    select p.* from user_profiles p where p.id = p_profile_id and org_profile_is_active(p.id)
  ), grants as (
    select g.* from org_scope_grants g join actor a on a.id = g.user_profile_id and a.tenant_id = g.tenant_id
    where g.revoked_at is null
  ), automatic as (
    select s.franchise_group_id from actor a cross join lateral org_automatic_scope(a.id) s
  )
  select coalesce(array_agg(b.id order by b.id), '{}'::uuid[])
  from branches b join actor a on a.tenant_id = b.tenant_id
  where org_has_company_scope(a.id)
    or (not p_manage and b.id = a.branch_id)
    or b.manager_id = a.id
    or exists (select 1 from automatic s where s.franchise_group_id = b.franchise_group_id)
    or exists (select 1 from grants g join franchise_groups f on f.id = g.franchise_group_id and f.tenant_id = g.tenant_id and f.is_active
               where g.scope_level = 'franchise' and g.franchise_group_id = b.franchise_group_id)
    or exists (select 1 from grants g where g.scope_level = 'branch' and g.branch_id = b.id
               and (not p_manage or g.authority = 'store_manager'));
$$;

create or replace function org_scope_authorities(p_profile_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.authority order by x.authority), '{}'::text[]) from (
    select g.authority from org_scope_grants g join user_profiles p on p.id = g.user_profile_id and p.tenant_id = g.tenant_id
    where g.user_profile_id = p_profile_id and g.revoked_at is null
    union all
    select 'store_manager' from branches b where b.manager_id = p_profile_id
    union all
    select s.authority from org_automatic_scope(p_profile_id) s
  ) x;
$$;

-- Readiness: a leader with automatic franchise scope is covered.
select pg_temp.scope_patch('public.get_franchise_readiness_report()',
  'and not exists (select 1 from branches b where b.manager_id = p.id)), ''[]''::jsonb),',
  'and not exists (select 1 from branches b where b.manager_id = p.id)
        and not exists (select 1 from org_automatic_scope(p.id))), ''[]''::jsonb),', 1);

-- Admin context: list who is covered automatically, so the Franchises panel
-- shows it without anyone pressing Grant scope.
select pg_temp.scope_patch('public.get_franchise_admin_context()',
  'where g.tenant_id = a.tenant_id and g.revoked_at is null), ''[]''::jsonb)',
  'where g.tenant_id = a.tenant_id and g.revoked_at is null), ''[]''::jsonb),
    ''automatic_scopes'', coalesce((select jsonb_agg(jsonb_build_object(''user_profile_id'', p.id, ''employee_name'', p.employee_name,
        ''authority'', s.authority, ''franchise_group_id'', s.franchise_group_id, ''branch_id'', p.branch_id) order by p.employee_name)
      from user_profiles p cross join lateral org_automatic_scope(p.id) s
      where p.tenant_id = a.tenant_id and p.removed_at is null), ''[]''::jsonb)', 1);

-- ---------------------------------------------------------------------------
-- 2. Section access matrix (Users)
-- ---------------------------------------------------------------------------

-- Every employee's section overrides plus what each section resolves to without
-- the individual override (department, then designation, then role default:
-- the same order as get_user_access_breakdown / previewSectionAccess).
create function get_section_access_matrix()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  perform assert_module_access('users');
  return jsonb_build_object(
    'sections', coalesce((select jsonb_agg(c.key order by c.sort_order) from permission_catalog c where c.kind = 'module'), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'employee_name', p.employee_name, 'employee_code', p.employee_code,
        'branch_id', p.branch_id, 'department_id', p.department_id,
        'account_status', p.account_status, 'working_status', p.working_status,
        'effective_role', coalesce(ua.dashboard_authority, p.user_role),
        'overrides', coalesce((select jsonb_object_agg(o.permission_key, o.effect)
          from user_permission_overrides o join permission_catalog c on c.key = o.permission_key and c.kind = 'module'
          where o.user_profile_id = p.id), '{}'::jsonb),
        'inherited', coalesce((select jsonb_object_agg(c.key,
            case when coalesce(ua.dashboard_authority, p.user_role) = 'super_admin' then true
              when x.effect is not null then x.effect = 'grant'
              else coalesce(rp.is_allowed, coalesce(ua.dashboard_authority, p.user_role) = any(c.default_roles), false) end)
          from permission_catalog c
          left join departments dep on dep.id = p.department_id and dep.tenant_id = p.tenant_id
          left join department_permission_overrides dept on dept.department_id = p.department_id and dept.tenant_id = p.tenant_id and dept.permission_key = c.key
          left join dropdown_masters des on des.id = p.designation_id
          left join designation_permission_overrides dpo on dpo.tenant_id = p.tenant_id and dpo.designation_id = p.designation_id and dpo.permission_key = c.key
          left join role_permissions rp on rp.tenant_id = p.tenant_id and rp.user_role = coalesce(ua.dashboard_authority, p.user_role) and rp.permission_key = c.key
          cross join lateral (select coalesce(case when dep.is_active then dept.effect end, case when des.is_active then dpo.effect end) as effect) x
          where c.kind = 'module'), '{}'::jsonb)
      ) order by p.employee_name)
      from user_profiles p left join user_access_profiles ua on ua.user_profile_id = p.id
      where p.tenant_id = a.tenant_id and p.removed_at is null
        and org_record_in_filter((select org_my_branch_filter()), p.branch_id, array[p.id])), '[]'::jsonb)
  );
end $$;

-- p_changes: { "<profile id>": { "<section key>": "grant" | "deny" | null } }.
-- Runs the audited per-employee writer for each employee, in id order (a
-- stable lock order), all in this one transaction: one refusal saves nothing.
create function save_section_access_bulk_with_audit(p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; r record; v_saved integer := 0;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  perform assert_module_access('users');
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'A change object is required' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_changes)) > 500 then
    raise exception 'Save at most 500 employees at a time' using errcode = '22023';
  end if;
  for r in select key, value from jsonb_each(p_changes) order by key loop
    if r.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid employee id' using errcode = '22023';
    end if;
    if jsonb_typeof(r.value) <> 'object' or r.value = '{}'::jsonb then continue; end if;
    perform save_user_section_access_with_audit(r.key::uuid, r.value);
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved);
end $$;

revoke all on function get_section_access_matrix(), save_section_access_bulk_with_audit(jsonb) from public, anon, authenticated, service_role;
grant execute on function get_section_access_matrix(), save_section_access_bulk_with_audit(jsonb) to authenticated;
