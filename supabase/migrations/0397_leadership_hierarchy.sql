-- Leadership hierarchy: Super Admin, Admin, Director (owner request 2026-11-09).
--
-- Owner rules:
--   * Super Admin can do everything.
--   * Admin sees every franchise and store (company scope). Admin keeps
--     user management (add / edit users), adding franchises and stores, task
--     and Task Control management and leave approval, but no longer builds or
--     edits FMS workflows, forms or the form builder, changes organisation
--     settings or notification rules, or deletes anything.
--   * Director is an Admin limited to the franchises and stores they oversee:
--     they see and manage only those, add stores to a franchise they oversee
--     and add ordinary employees there. A Director has no department or
--     designation (they sit in the company-wide Leadership department).
--
-- Data model: Director is the Admin role plus one or more `director` scope
-- grants (a whole franchise, or a single store). No user_role value is added:
-- about 420 database checks treat super_admin/admin as one group, and a
-- Director must keep every Admin read path, narrowed only by franchise scope.
-- An Admin without a Director grant has company scope. Franchise isolation
-- still decides when scope narrows reads (Users > Franchises).
set search_path = public, extensions;

create function pg_temp.patch(p_signature text, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0397: expected % match(es) in %, found %: %', p_expected, p_signature, found, left(p_old, 80);
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Capabilities
-- ---------------------------------------------------------------------------

-- New keys, then the Admin defaults the owner withdrew (Super Admin keeps all;
-- Manager keeps form authoring and own-branch defaults as before).
-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('tasks.delete', 'action', null, '{super_admin}', 1320),
('organization.add_locations', 'action', null, '{super_admin,admin}', 1330);
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('fms.manage', 'action', null, '{super_admin}', 90),
('forms.manage', 'action', null, '{super_admin,manager}', 110),
('notifications.manage', 'action', null, '{super_admin}', 140),
('settings.manage_organization', 'action', null, '{super_admin}', 250),
('settings.manage_branch', 'action', null, '{super_admin,manager}', 260),
('recording.manage_rubric', 'action', null, '{super_admin}', 1204)
on conflict (key) do update set default_roles = excluded.default_roles;
-- permission-catalog:end

-- A role-level grant would keep these for every Admin; remove it (audited).
-- Individual user overrides remain Super Admin's explicit choice.
with removed as (
  delete from role_permissions r
  where r.user_role = 'admin' and r.is_allowed
    and r.permission_key in ('fms.manage', 'forms.manage', 'notifications.manage', 'settings.manage_organization',
      'settings.manage_branch', 'recording.manage_rubric', 'tasks.delete', 'users.delete')
  returning r.*
)
insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
select tenant_id, null, 'role_permission_reset', 'permissions', null, to_jsonb(removed),
  jsonb_build_object('reason', 'Migration 0397: Admin views but does not build, configure or delete')
from removed;

-- Deleting tasks and task series needs tasks.delete as well as task administration.
select pg_temp.patch('public.delete_task_lifecycle_with_audit(uuid,boolean,text)',
  'not has_permission(''tasks.view_all'') then',
  'not has_permission(''tasks.view_all'') or not has_permission(''tasks.delete'') then', 1);
select pg_temp.patch('public.admin_delete_task_series_with_audit(uuid,text)',
  'not has_permission(''tasks.view_all'') then',
  'not has_permission(''tasks.view_all'') or not has_permission(''tasks.delete'') then', 1);
-- Form drafts follow form authoring like every other form write.
select pg_temp.patch('public.delete_form_draft_with_audit(uuid)',
  'v_actor.user_role not in (''super_admin'', ''admin'', ''manager'') then',
  'v_actor.user_role not in (''super_admin'', ''admin'', ''manager'') or not has_permission(''forms.manage'') then', 1);

-- ---------------------------------------------------------------------------
-- 2. Director scope
-- ---------------------------------------------------------------------------

-- A Director grant may cover the company, a franchise, or a single store.
alter table org_scope_grants drop constraint org_scope_grants_authority_level;
alter table org_scope_grants add constraint org_scope_grants_authority_level check (
  case authority
    when 'director' then true
    when 'store_manager' then scope_level = 'branch'
    when 'store_access' then scope_level = 'branch'
    else scope_level <> 'branch'
  end);

-- A Director: the Admin role (dashboard authority, else role) with at least one
-- franchise or store Director grant.
create function org_is_director(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_profiles p left join user_access_profiles a on a.user_profile_id = p.id
    where p.id = p_profile_id and coalesce(a.dashboard_authority, p.user_role) = 'admin'
      and exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.tenant_id = p.tenant_id
        and g.revoked_at is null and g.authority = 'director' and g.scope_level <> 'company'));
$$;

-- Company scope: Super Admin, an explicit company grant, or an Admin who is
-- not a Director.
create or replace function org_has_company_scope(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select org_profile_is_active(p_profile_id) and exists (
    select 1 from user_profiles p left join user_access_profiles a on a.user_profile_id = p.id
    where p.id = p_profile_id and (
      coalesce(a.dashboard_authority, p.user_role) = 'super_admin'
      or exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.tenant_id = p.tenant_id
        and g.revoked_at is null and g.scope_level = 'company')
      or (coalesce(a.dashboard_authority, p.user_role) = 'admin'
        and not exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.tenant_id = p.tenant_id
          and g.revoked_at is null and g.authority = 'director' and g.scope_level <> 'company'))));
$$;

-- Admin is now company-wide, so only HR still covers their store's franchise
-- automatically (0393).
create or replace function org_automatic_scope(p_profile_id uuid)
returns table(authority text, franchise_group_id uuid)
language sql stable security definer set search_path = public as $$
  select 'hr'::text, f.id
  from user_profiles p
  left join user_access_profiles ua on ua.user_profile_id = p.id
  join branches b on b.id = p.branch_id and b.tenant_id = p.tenant_id
  join franchise_groups f on f.id = b.franchise_group_id and f.tenant_id = b.tenant_id and f.is_active
  where p.id = p_profile_id
    and coalesce(ua.dashboard_authority, p.user_role) = 'hr'
    and org_profile_is_active(p.id);
$$;

-- A Director manages the single stores granted to them, like a store manager.
select pg_temp.patch('public.org_scope_branch_ids(uuid,boolean)',
  '(not p_manage or g.authority = ''store_manager'')',
  '(not p_manage or g.authority in (''store_manager'', ''director''))', 1);

-- Readiness: company-scope leaders are covered.
select pg_temp.patch('public.get_franchise_readiness_report()',
  'and not exists (select 1 from org_automatic_scope(p.id))), ''[]''::jsonb),',
  'and not exists (select 1 from org_automatic_scope(p.id))
        and not org_has_company_scope(p.id)), ''[]''::jsonb),', 1);

-- User management. A Director is never company scope (not even before
-- isolation), and only company scope creates or edits Admin and Director accounts.
select pg_temp.patch('public.assert_org_user_write(uuid,uuid,uuid,user_role)',
  'v_company := org_has_company_scope(a.id) or (v_full and not v_enforced);',
  'v_company := org_has_company_scope(a.id) or (v_full and not v_enforced and not org_is_director(a.id));', 1);
select pg_temp.patch('public.assert_org_user_write(uuid,uuid,uuid,user_role)',
  'if not v_full and (t.user_role in (''super_admin'', ''admin'') or p_dest_role in (''super_admin'', ''admin'')) then
      raise exception ''Store and franchise managers cannot create or edit administrator accounts'' using errcode = ''42501'';',
  'if (t.id is not null and t.id <> a.id and t.user_role in (''super_admin'', ''admin'')) or p_dest_role in (''super_admin'', ''admin'') then
      raise exception ''Only Super Admin or Admin can create or edit Admin and Director accounts'' using errcode = ''42501'';', 1);

-- Leaving the Admin role ends Director scope in the same transaction.
select pg_temp.patch('public.update_user_profile_with_audit(uuid,jsonb)',
  '  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_new.tenant_id,v_actor.id,''user_updated''',
  '  if v_old.user_role = ''admin'' and v_new.user_role <> ''admin'' then
    update org_scope_grants set revoked_at = now(), revoked_by = v_actor.id, revoke_reason = ''Role changed from Director''
    where user_profile_id = v_new.id and revoked_at is null and authority = ''director'' and scope_level <> ''company'';
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_new.tenant_id,v_actor.id,''user_updated''', 1);

-- The company-wide department Director accounts sit in (found, or created once).
create function org_leadership_department(p_tenant_id uuid, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text := 'LEADERSHIP'; n integer := 1;
begin
  select d.id into v_id from departments d
  where d.tenant_id = p_tenant_id and d.branch_id is null and d.is_active and lower(btrim(d.name)) = 'leadership'
  order by d.created_at, d.id limit 1;
  if v_id is not null then return v_id; end if;
  while exists (select 1 from departments d where d.tenant_id = p_tenant_id and lower(d.code) = lower(v_code)) loop
    n := n + 1; v_code := 'LEADERSHIP' || n;
  end loop;
  insert into departments(tenant_id, branch_id, name, code, is_active, created_by, updated_by)
  values (p_tenant_id, null, 'Leadership', v_code, true, p_actor_id, p_actor_id) returning id into v_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (p_tenant_id, p_actor_id, 'department_saved', 'user_management', v_id, null,
    jsonb_build_object('name', 'Leadership', 'code', v_code, 'branch_id', null, 'reason', 'Department for Director accounts'));
  return v_id;
end $$;

-- Replaces a Director's franchise and store grants with the chosen set.
-- Validates every id; a store inside a chosen franchise is already covered.
create function org_apply_director_scope(p_actor_id uuid, p_profile_id uuid, p_franchise_ids uuid[], p_branch_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t user_profiles; v_franchises uuid[]; v_branches uuid[]; v_old jsonb; v_new jsonb; v_reason text;
begin
  select * into t from user_profiles where id = p_profile_id;
  v_reason := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Director scope');
  select coalesce(array_agg(distinct x order by x), '{}') into v_franchises from unnest(coalesce(p_franchise_ids, '{}')) x where x is not null;
  if exists (select 1 from unnest(v_franchises) x where not exists (
      select 1 from franchise_groups f where f.id = x and f.tenant_id = t.tenant_id and f.is_active)) then
    raise exception 'A chosen franchise is invalid or inactive' using errcode = '23503';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_branches from unnest(coalesce(p_branch_ids, '{}')) x where x is not null;
  if exists (select 1 from unnest(v_branches) x where not exists (
      select 1 from branches b where b.id = x and b.tenant_id = t.tenant_id and b.is_active)) then
    raise exception 'A chosen store is invalid or inactive' using errcode = '23503';
  end if;
  select coalesce(array_agg(x order by x), '{}') into v_branches from unnest(v_branches) x
  where not exists (select 1 from branches b where b.id = x and b.franchise_group_id = any(v_franchises));
  if cardinality(v_franchises) + cardinality(v_branches) = 0 then
    raise exception 'Choose at least one franchise or store for this Director' using errcode = '22023';
  end if;
  v_old := jsonb_build_object(
    'franchise_group_ids', coalesce((select jsonb_agg(g.franchise_group_id order by g.franchise_group_id) from org_scope_grants g
      where g.user_profile_id = t.id and g.revoked_at is null and g.authority = 'director' and g.scope_level = 'franchise'), '[]'::jsonb),
    'branch_ids', coalesce((select jsonb_agg(g.branch_id order by g.branch_id) from org_scope_grants g
      where g.user_profile_id = t.id and g.revoked_at is null and g.authority = 'director' and g.scope_level = 'branch'), '[]'::jsonb));
  update org_scope_grants g set revoked_at = now(), revoked_by = p_actor_id, revoke_reason = v_reason
  where g.user_profile_id = t.id and g.revoked_at is null and g.authority = 'director' and g.scope_level <> 'company'
    and not ((g.scope_level = 'franchise' and g.franchise_group_id = any(v_franchises))
          or (g.scope_level = 'branch' and g.branch_id = any(v_branches)));
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, branch_id, reason, granted_by)
  select t.tenant_id, t.id, 'director', 'franchise', x, null, v_reason, p_actor_id from unnest(v_franchises) x
  where not exists (select 1 from org_scope_grants g where g.user_profile_id = t.id and g.revoked_at is null
    and g.authority = 'director' and g.scope_level = 'franchise' and g.franchise_group_id = x);
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, branch_id, reason, granted_by)
  select t.tenant_id, t.id, 'director', 'branch', null, x, v_reason, p_actor_id from unnest(v_branches) x
  where not exists (select 1 from org_scope_grants g where g.user_profile_id = t.id and g.revoked_at is null
    and g.authority = 'director' and g.scope_level = 'branch' and g.branch_id = x);
  v_new := jsonb_build_object('franchise_group_ids', to_jsonb(v_franchises), 'branch_ids', to_jsonb(v_branches), 'reason', v_reason);
  if v_old - 'reason' is distinct from v_new - 'reason' then
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (t.tenant_id, p_actor_id, 'director_scope_saved', 'user_management', t.id, v_old, v_new);
  end if;
  return v_new;
end $$;

-- The Director's home store (records that need one store, such as their own
-- leave): the requested store when it is inside the chosen scope, else the
-- first chosen store, else the first store of the first chosen franchise.
create function org_director_home_branch(p_tenant_id uuid, p_requested uuid, p_current uuid, p_franchise_ids uuid[], p_branch_ids uuid[])
returns uuid language sql stable security definer set search_path = public as $$
  select b.id from branches b
  where b.tenant_id = p_tenant_id and b.is_active
    and (b.id = any(coalesce(p_branch_ids, '{}')) or b.franchise_group_id = any(coalesce(p_franchise_ids, '{}')))
  order by (b.id = p_requested) desc, (b.id = p_current) desc, (b.id = any(coalesce(p_branch_ids, '{}'))) desc,
    (b.location_kind = 'store') desc, b.name, b.id
  limit 1;
$$;

-- Only company scope (Super Admin, Admin) with user management sets up Directors.
create function org_assert_director_writer(p_actor_id uuid)
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  select * into a from user_profiles where id = p_actor_id;
  if a.id is null or not org_profile_is_active(a.id) or not permission_effective_for(a.id, 'users.manage') then
    raise exception 'User management denied' using errcode = '42501';
  end if;
  if not org_has_company_scope(a.id) then
    raise exception 'Only Super Admin or Admin can set up a Director' using errcode = '42501';
  end if;
  return a;
end $$;

-- Create a Director (invite-user Edge Function, service role): the account,
-- the Leadership department and the Director scope in one transaction.
create function create_director_profile_with_audit(
  p_auth_user_id uuid, p_creator_profile_id uuid, p_personal_email text, p_first_name text, p_last_name text,
  p_official_email text, p_home_branch_id uuid, p_personal_mobile text, p_official_mobile text, p_week_off text[],
  p_franchise_ids uuid[], p_branch_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare a user_profiles; v_home uuid; v_department uuid; v_profile_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  a := org_assert_director_writer(p_creator_profile_id);
  v_home := org_director_home_branch(a.tenant_id, p_home_branch_id, null, p_franchise_ids, p_branch_ids);
  if v_home is null then raise exception 'Choose at least one active franchise or store for this Director' using errcode = '22023'; end if;
  v_department := org_leadership_department(a.tenant_id, a.id);
  v_profile_id := invite_profile_with_audit_v3(p_auth_user_id, a.id, p_personal_email, p_first_name, p_last_name, p_official_email,
    v_home, v_department, null, p_personal_mobile, p_official_mobile, p_week_off, 'admin', null);
  perform org_apply_director_scope(a.id, v_profile_id, p_franchise_ids, p_branch_ids, 'New Director');
  return v_profile_id;
end $$;

-- Make an employee a Director, or change a Director's franchises and stores.
-- Changing someone's role stays a Super Admin decision (as in the editor).
create function save_director_with_audit(p_profile_id uuid, p_franchise_ids uuid[], p_branch_ids uuid[], p_home_branch_id uuid, p_reason text)
returns user_profiles language plpgsql security definer set search_path = public as $$
declare a user_profiles; v_old user_profiles; v_new user_profiles; v_authority text; v_home uuid; v_department uuid;
begin
  perform assert_module_enabled('users');
  a := org_assert_director_writer((current_profile()).id);
  select * into v_old from user_profiles where id = p_profile_id for update;
  if v_old.id is null or v_old.tenant_id <> a.tenant_id or v_old.removed_at is not null then
    raise exception 'Profile not found or not accessible' using errcode = '42501';
  end if;
  if v_old.id = a.id then raise exception 'You cannot change your own Director scope' using errcode = '42501'; end if;
  select ua.dashboard_authority::text into v_authority from user_access_profiles ua where ua.user_profile_id = v_old.id;
  if v_old.user_role = 'super_admin' or v_authority = 'super_admin' or permission_effective_for(v_old.id, 'permissions.manage') then
    raise exception 'A Super Admin account cannot be a Director' using errcode = '42501';
  end if;
  if v_authority is not null and v_authority <> 'admin' then
    raise exception 'This employee has a dashboard authority override; Super Admin must clear it first' using errcode = '42501';
  end if;
  if v_old.user_role <> 'admin' and coalesce((select ua.dashboard_authority::text from user_access_profiles ua where ua.user_profile_id = a.id), a.user_role::text) <> 'super_admin' then
    raise exception 'Only Super Admin can change an employee''s role' using errcode = '42501';
  end if;
  v_home := org_director_home_branch(a.tenant_id, p_home_branch_id, v_old.branch_id, p_franchise_ids, p_branch_ids);
  if v_home is null then raise exception 'Choose at least one active franchise or store for this Director' using errcode = '22023'; end if;
  v_department := org_leadership_department(a.tenant_id, a.id);
  update user_profiles set user_role = 'admin', branch_id = v_home, department_id = v_department, designation_id = null,
    buddy_id = null, secondary_buddy_id = null, reports_to_user_id = null, updated_by = a.id, updated_at = now()
  where id = v_old.id returning * into v_new;
  if (v_old.branch_id, v_old.department_id, v_old.designation_id, v_old.reports_to_user_id) is distinct from
     (v_new.branch_id, v_new.department_id, v_new.designation_id, v_new.reports_to_user_id) then
    insert into user_organization_history(tenant_id, user_profile_id, old_branch_id, new_branch_id, old_department_id, new_department_id,
      old_designation_id, new_designation_id, old_reports_to_user_id, new_reports_to_user_id, changed_by)
    values (v_new.tenant_id, v_new.id, v_old.branch_id, v_new.branch_id, v_old.department_id, v_new.department_id,
      v_old.designation_id, v_new.designation_id, v_old.reports_to_user_id, v_new.reports_to_user_id, a.id);
  end if;
  if to_jsonb(v_old) - 'updated_at' - 'updated_by' is distinct from to_jsonb(v_new) - 'updated_at' - 'updated_by' then
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (v_new.tenant_id, a.id, 'user_updated', 'user_management', v_new.id, to_jsonb(v_old), to_jsonb(v_new));
  end if;
  perform org_apply_director_scope(a.id, v_new.id, p_franchise_ids, p_branch_ids, p_reason);
  return v_new;
end $$;

-- A Director becomes a company-wide Admin.
create function end_director_with_audit(p_profile_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a user_profiles; t user_profiles; v_revoked integer;
begin
  perform assert_module_enabled('users');
  a := org_assert_director_writer((current_profile()).id);
  select * into t from user_profiles where id = p_profile_id;
  if t.id is null or t.tenant_id <> a.tenant_id then raise exception 'Profile not found or not accessible' using errcode = '42501'; end if;
  if t.id = a.id then raise exception 'You cannot change your own Director scope' using errcode = '42501'; end if;
  update org_scope_grants g set revoked_at = now(), revoked_by = a.id,
    revoke_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Director made Admin')
  where g.user_profile_id = t.id and g.revoked_at is null and g.authority = 'director' and g.scope_level <> 'company';
  get diagnostics v_revoked = row_count;
  if v_revoked > 0 then
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (t.tenant_id, a.id, 'director_scope_ended', 'user_management', t.id, jsonb_build_object('director_grants', v_revoked),
      jsonb_build_object('reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Director made Admin')));
  end if;
end $$;

-- Who is a Director, and what they oversee, for the employees the viewer may see.
create function list_director_scopes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := current_profile();
  if a.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode = '42501'; end if;
  perform assert_module_access('users');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'user_profile_id', p.id,
      'franchise_group_ids', coalesce((select jsonb_agg(g.franchise_group_id order by g.franchise_group_id) from org_scope_grants g
        where g.user_profile_id = p.id and g.revoked_at is null and g.authority = 'director' and g.scope_level = 'franchise'), '[]'::jsonb),
      'branch_ids', coalesce((select jsonb_agg(g.branch_id order by g.branch_id) from org_scope_grants g
        where g.user_profile_id = p.id and g.revoked_at is null and g.authority = 'director' and g.scope_level = 'branch'), '[]'::jsonb))
      order by p.employee_name)
    from user_profiles p
    where p.tenant_id = a.tenant_id and p.removed_at is null and org_is_director(p.id)
      and org_record_in_filter((select org_my_branch_filter()), p.branch_id, array[p.id])), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Adding franchises and stores
-- ---------------------------------------------------------------------------

-- p_franchise_group_id null = adding a franchise (company scope only);
-- otherwise adding a store to that franchise (company scope, or a Director of
-- that whole franchise). Super Admin (franchise.manage) may always.
create function org_assert_location_creator(p_franchise_group_id uuid)
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  perform assert_module_enabled('users');
  a := current_profile();
  if a.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode = '42501'; end if;
  if has_permission('franchise.manage') then return a; end if;
  if not has_permission('organization.add_locations') then
    raise exception 'Adding franchises and stores denied' using errcode = '42501';
  end if;
  if p_franchise_group_id is null then
    if not org_has_company_scope(a.id) then
      raise exception 'Only Super Admin or Admin can add a franchise' using errcode = '42501';
    end if;
  elsif not org_has_company_scope(a.id) and not exists (select 1 from org_scope_grants g
      where g.user_profile_id = a.id and g.tenant_id = a.tenant_id and g.revoked_at is null and g.authority = 'director'
        and g.scope_level = 'franchise' and g.franchise_group_id = p_franchise_group_id) then
    raise exception 'You can add stores only to a franchise you oversee' using errcode = '42501';
  end if;
  return a;
end $$;

-- Adding a franchise; editing or deactivating one stays Super Admin.
select pg_temp.patch('public.save_franchise_group_with_audit(uuid,jsonb)',
  '  a := assert_franchise_admin();',
  '  a := case when p_franchise_group_id is null then org_assert_location_creator(null) else assert_franchise_admin() end;', 1);

-- Adding a store to a franchise; editing stores stays Super Admin
-- (organization.manage). The setting is transaction-local and cleared at once.
select pg_temp.patch('public.create_branch_in_franchise_with_audit(uuid,jsonb)',
  '  a := assert_franchise_admin();',
  '  a := org_assert_location_creator(p_franchise_group_id);
  if p_payload ? ''manager_id'' and nullif(p_payload->>''manager_id'', '''') is not null then
    raise exception ''Set the store manager after employees join the store'' using errcode = ''22023'';
  end if;
  perform set_config(''jewelos.location_create'', ''on'', true);', 1);
select pg_temp.patch('public.create_branch_in_franchise_with_audit(uuid,jsonb)',
  '  v_row := save_branch_with_audit(null, p_payload);',
  '  v_row := save_branch_with_audit(null, p_payload);
  perform set_config(''jewelos.location_create'', '''', true);', 1);
select pg_temp.patch('public.save_branch_with_audit_impl(uuid,jsonb)',
  'not has_permission(''organization.manage'') then',
  'not (has_permission(''organization.manage'')
    or (p_branch_id is null and coalesce(current_setting(''jewelos.location_create'', true), '''') = ''on'')) then', 1);

-- The franchises and stores the viewer may see, and where they may add.
create function get_org_locations()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles; v_company boolean; v_readable uuid[]; v_overseen uuid[];
begin
  perform assert_module_access('users');
  a := current_profile();
  if a.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode = '42501'; end if;
  if not (has_permission('franchise.manage') or has_permission('organization.add_locations')) then
    raise exception 'Franchise and store list denied' using errcode = '42501';
  end if;
  v_company := org_has_company_scope(a.id);
  v_readable := org_scope_branch_ids(a.id, false);
  select coalesce(array_agg(g.franchise_group_id), '{}') into v_overseen from org_scope_grants g
  where g.user_profile_id = a.id and g.tenant_id = a.tenant_id and g.revoked_at is null and g.authority = 'director' and g.scope_level = 'franchise';
  return jsonb_build_object(
    'company_scope', v_company,
    'can_add_franchise', v_company,
    'addable_franchise_ids', coalesce((select jsonb_agg(f.id order by f.name) from franchise_groups f
      where f.tenant_id = a.tenant_id and f.is_active and (v_company or f.id = any(v_overseen))), '[]'::jsonb),
    'franchises', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'code', f.code, 'city', f.city,
        'state', f.state, 'is_active', f.is_active) order by f.name)
      from franchise_groups f where f.tenant_id = a.tenant_id and (v_company or f.id = any(v_overseen)
        or exists (select 1 from branches b where b.franchise_group_id = f.id and b.id = any(v_readable)))), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code, 'city', b.city,
        'is_active', b.is_active, 'franchise_group_id', b.franchise_group_id, 'location_kind', b.location_kind, 'manager_id', b.manager_id) order by b.name)
      from branches b where b.tenant_id = a.tenant_id and (v_company or b.id = any(v_readable))), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. Existing Directors
-- ---------------------------------------------------------------------------

-- An Admin whose designation is "Director" becomes a Director of their own
-- store's franchise, and moves to the Leadership department with no
-- designation. This only narrows access (company scope -> one franchise).
-- When the profile cannot move (for example a department head), the scope is
-- still applied and the department is left for Super Admin to change.
do $$
declare r record; v_department uuid;
begin
  for r in
    select p.id, p.tenant_id, b.franchise_group_id
    from user_profiles p
    left join user_access_profiles ua on ua.user_profile_id = p.id
    join branches b on b.id = p.branch_id and b.tenant_id = p.tenant_id
    join franchise_groups f on f.id = b.franchise_group_id and f.tenant_id = b.tenant_id and f.is_active
    join dropdown_masters dm on dm.id = p.designation_id
    where p.removed_at is null and coalesce(ua.dashboard_authority, p.user_role) = 'admin'
      and lower(btrim(dm.label)) in ('director', 'directors')
      and not exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.revoked_at is null and g.authority = 'director')
    order by p.id
  loop
    perform org_apply_director_scope(null, r.id, array[r.franchise_group_id], '{}', 'Migration 0397: designation Director, franchise of own store');
    begin
      v_department := org_leadership_department(r.tenant_id, null);
      with old as (select * from user_profiles where id = r.id), changed as (
        update user_profiles set department_id = v_department, designation_id = null, buddy_id = null, secondary_buddy_id = null,
          reports_to_user_id = null, updated_at = now()
        where id = r.id returning *)
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
      select changed.tenant_id, null, 'user_updated', 'user_management', changed.id, to_jsonb(old), to_jsonb(changed) from old, changed;
    exception when others then
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
      values (r.tenant_id, null, 'director_department_unchanged', 'user_management', r.id, null,
        jsonb_build_object('reason', 'Migration 0397 could not move this Director to Leadership', 'sqlstate', sqlstate));
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke all on function org_is_director(uuid), org_leadership_department(uuid, uuid),
  org_apply_director_scope(uuid, uuid, uuid[], uuid[], text), org_director_home_branch(uuid, uuid, uuid, uuid[], uuid[]),
  org_assert_director_writer(uuid), org_assert_location_creator(uuid)
  from public, anon, authenticated, service_role;
revoke all on function create_director_profile_with_audit(uuid, uuid, text, text, text, text, uuid, text, text, text[], uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function create_director_profile_with_audit(uuid, uuid, text, text, text, text, uuid, text, text, text[], uuid[], uuid[])
  to service_role;
revoke all on function save_director_with_audit(uuid, uuid[], uuid[], uuid, text), end_director_with_audit(uuid, text),
  list_director_scopes(), get_org_locations()
  from public, anon, service_role;
grant execute on function save_director_with_audit(uuid, uuid[], uuid[], uuid, text), end_director_with_audit(uuid, text),
  list_director_scopes(), get_org_locations()
  to authenticated;

notify pgrst, 'reload schema';
