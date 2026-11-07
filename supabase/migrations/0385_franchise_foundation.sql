-- Franchise foundation (Phase 1): Company -> Franchise group -> Branch -> Department -> Employee.
--
-- Design: docs/architecture/franchise-scope.md.
--
-- Concepts kept separate:
--   * capability   permission_effective_for() (role, department, designation, user
--                  layers) plus, while isolation is on, defaults conferred by a
--                  scope authority grant
--   * data scope   franchise / branch sets resolved here from persisted grants,
--                  branches.manager_id and the employee's own branch
--   * ownership    every record keeps its existing branch_id; its franchise is
--                  always derived from branches.franchise_group_id, never copied
--
-- Safety: isolation is OFF (tenant_franchise_controls). While it is off every
-- existing read and write behaves exactly as before; only the Super Admin
-- organisation tools added here (franchises, branch mapping, scope grants,
-- readiness report) are live. Turning isolation on is refused until every
-- active branch is mapped AND a Phase 2 migration replaces
-- franchise_enforcement_supported(). No existing row is deleted or rewritten.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------------

create table franchise_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  code text not null check (code ~ '^[A-Z0-9_-]{2,32}$'),
  city text,
  state text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references user_profiles(id) on delete set null,
  updated_by uuid references user_profiles(id) on delete set null,
  constraint franchise_groups_tenant_id_id_key unique (tenant_id, id),
  constraint franchise_groups_tenant_code_key unique (tenant_id, code)
);
create unique index franchise_groups_tenant_name_key on franchise_groups(tenant_id, lower(btrim(name)));

-- Composite keys let child rows prove they stay inside one tenant.
alter table branches add constraint branches_tenant_id_id_key unique (tenant_id, id);
alter table user_profiles add constraint user_profiles_tenant_id_id_key unique (tenant_id, id);

-- Nullable until the owner approves the mapping; isolation cannot be turned on
-- while an active branch is unmapped. location_kind records deliberately that a
-- branch is an exhibition or other non-store location; it never grants access.
alter table branches
  add column franchise_group_id uuid,
  add column location_kind text not null default 'store'
    check (location_kind in ('store', 'exhibition', 'office', 'warehouse'));
alter table branches add constraint branches_franchise_group_fk
  foreign key (tenant_id, franchise_group_id) references franchise_groups(tenant_id, id) on delete restrict;
create index branches_franchise_group_idx on branches(franchise_group_id) where franchise_group_id is not null;

-- The activation gate. No row means isolation is off.
create table tenant_franchise_controls (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  enforcement_enabled boolean not null default false,
  changed_by uuid references user_profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  change_reason text
);

-- Persisted data-scope authority. Director / Regional Admin / HR cover a whole
-- franchise (or, granted only by Super Admin, the whole company); Store Manager
-- and Store Access cover one branch each. A row grants scope, not capability:
-- what the person can do still comes from the permission system.
create table org_scope_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid not null,
  authority text not null check (authority in ('director', 'regional_admin', 'hr', 'store_manager', 'store_access')),
  scope_level text not null check (scope_level in ('company', 'franchise', 'branch')),
  franchise_group_id uuid,
  branch_id uuid,
  reason text,
  granted_by uuid references user_profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references user_profiles(id) on delete set null,
  revoke_reason text,
  constraint org_scope_grants_profile_fk foreign key (tenant_id, user_profile_id) references user_profiles(tenant_id, id) on delete cascade,
  constraint org_scope_grants_franchise_fk foreign key (tenant_id, franchise_group_id) references franchise_groups(tenant_id, id) on delete restrict,
  constraint org_scope_grants_branch_fk foreign key (tenant_id, branch_id) references branches(tenant_id, id) on delete restrict,
  constraint org_scope_grants_target check (
    (scope_level = 'company' and franchise_group_id is null and branch_id is null)
    or (scope_level = 'franchise' and franchise_group_id is not null and branch_id is null)
    or (scope_level = 'branch' and franchise_group_id is null and branch_id is not null)),
  constraint org_scope_grants_authority_level check ((authority in ('store_manager', 'store_access')) = (scope_level = 'branch'))
);
create unique index org_scope_grants_active_key on org_scope_grants(user_profile_id, authority, scope_level,
  coalesce(franchise_group_id, branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
create index org_scope_grants_active_profile on org_scope_grants(user_profile_id) where revoked_at is null;
create index org_scope_grants_tenant on org_scope_grants(tenant_id);

alter table franchise_groups enable row level security;
alter table tenant_franchise_controls enable row level security;
alter table org_scope_grants enable row level security;
revoke all on franchise_groups, tenant_franchise_controls, org_scope_grants from public, anon, authenticated;

create trigger tenant_realtime_settings_franchise_groups after insert or update or delete on franchise_groups
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_settings_franchise_controls after insert or update or delete on tenant_franchise_controls
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_settings_org_scope_grants after insert or update or delete on org_scope_grants
  for each row execute function emit_realtime_direct_event('settings');

-- ---------------------------------------------------------------------------
-- 2. Central scope resolver
-- ---------------------------------------------------------------------------

create function org_scope_enforced(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.enforcement_enabled from tenant_franchise_controls c where c.tenant_id = p_tenant_id), false);
$$;

-- Replaced by the Phase 2 migration once every module reads through the
-- resolver. Until then isolation cannot be switched on through the API.
create function franchise_enforcement_supported()
returns boolean language sql immutable set search_path = public as $$ select false $$;

create function org_profile_is_active(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.account_status = 'active' and p.is_login_enabled is true and p.working_status <> 'resigned' and p.removed_at is null
    from user_profiles p where p.id = p_profile_id), false);
$$;

-- Company scope: Super Admin authority, or an explicit company grant (which
-- only Super Admin can create).
create function org_has_company_scope(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select org_profile_is_active(p_profile_id) and exists (
    select 1 from user_profiles p left join user_access_profiles a on a.user_profile_id = p.id
    where p.id = p_profile_id and (
      coalesce(a.dashboard_authority, p.user_role) = 'super_admin'
      or exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.tenant_id = p.tenant_id
        and g.revoked_at is null and g.scope_level = 'company')));
$$;

-- p_manage = false: branches whose operational data the person may read
--   (own branch, managed stores, franchise grants, store access grants).
-- p_manage = true: branches the person may administer (managed stores and
--   franchise authority grants; never just "own branch" or store access).
create function org_scope_branch_ids(p_profile_id uuid, p_manage boolean)
returns uuid[] language sql stable security definer set search_path = public as $$
  with actor as (
    select p.* from user_profiles p where p.id = p_profile_id and org_profile_is_active(p.id)
  ), grants as (
    select g.* from org_scope_grants g join actor a on a.id = g.user_profile_id and a.tenant_id = g.tenant_id
    where g.revoked_at is null
  )
  select coalesce(array_agg(b.id order by b.id), '{}'::uuid[])
  from branches b join actor a on a.tenant_id = b.tenant_id
  where org_has_company_scope(a.id)
    or (not p_manage and b.id = a.branch_id)
    or b.manager_id = a.id
    or exists (select 1 from grants g join franchise_groups f on f.id = g.franchise_group_id and f.tenant_id = g.tenant_id and f.is_active
               where g.scope_level = 'franchise' and g.franchise_group_id = b.franchise_group_id)
    or exists (select 1 from grants g where g.scope_level = 'branch' and g.branch_id = b.id
               and (not p_manage or g.authority = 'store_manager'));
$$;

-- Authorities a person holds (persisted manager_id counts as store_manager).
create function org_scope_authorities(p_profile_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.authority order by x.authority), '{}'::text[]) from (
    select g.authority from org_scope_grants g join user_profiles p on p.id = g.user_profile_id and p.tenant_id = g.tenant_id
    where g.user_profile_id = p_profile_id and g.revoked_at is null
    union all
    select 'store_manager' from branches b where b.manager_id = p_profile_id
  ) x;
$$;

-- Current-actor helpers. Policies call these through (select ...) so they run
-- once per statement.
create function org_my_readable_branch_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select org_scope_branch_ids((current_profile()).id, false);
$$;
create function org_my_manageable_branch_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select org_scope_branch_ids((current_profile()).id, true);
$$;

create function org_my_scope_enforced()
returns boolean language sql stable security definer set search_path = public as $$
  select org_scope_enforced(current_tenant_id());
$$;
create function org_i_have_company_scope()
returns boolean language sql stable security definer set search_path = public as $$
  select org_has_company_scope((current_profile()).id);
$$;

-- The predicate Phase 2 policies use for branch-owned records. While isolation
-- is off it preserves today's behaviour. While it is on, a record with no
-- branch is visible only to company scope: ambiguous ownership never widens.
create function org_branch_in_data_scope(p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not org_scope_enforced(current_tenant_id())
    or org_has_company_scope((current_profile()).id)
    or (p_branch_id is not null and p_branch_id = any(org_my_readable_branch_ids()));
$$;

create function franchise_of_branch(p_branch_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select franchise_group_id from branches where id = p_branch_id;
$$;

-- What the browser may know about its own scope. Informational only: every
-- contract re-resolves scope on the server.
create function get_my_org_scope()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := current_profile();
  if a.id is null or not current_profile_is_active() then
    raise exception 'Active profile required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'enforcement_enabled', org_scope_enforced(a.tenant_id),
    'company_scope', org_has_company_scope(a.id),
    'branch_id', a.branch_id,
    'franchise_group_id', franchise_of_branch(a.branch_id),
    'authorities', to_jsonb(org_scope_authorities(a.id)),
    'readable_branch_ids', to_jsonb(org_scope_branch_ids(a.id, false)),
    'manageable_branch_ids', to_jsonb(org_scope_branch_ids(a.id, true)),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'authority', g.authority, 'scope_level', g.scope_level,
        'franchise_group_id', g.franchise_group_id, 'branch_id', g.branch_id) order by g.granted_at)
      from org_scope_grants g where g.user_profile_id = a.id and g.revoked_at is null), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. Permissions: two new server-enforced capabilities and authority defaults
-- ---------------------------------------------------------------------------

-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('franchise.manage', 'protected', null, '{super_admin}', 1300),
('users.manage_scoped', 'action', null, '{super_admin}', 1310);
-- permission-catalog:end

-- While isolation is on, a scope authority confers these defaults. Explicit
-- user / department / designation overrides still decide first, so a deny
-- always wins. Mirrored by packages/core/src/permissions/catalog.ts.
alter table permission_catalog add column default_scope_authorities text[] not null default '{}'::text[];
update permission_catalog set default_scope_authorities = '{director,regional_admin,hr,store_manager}'
  where key in ('users.manage_scoped', 'users.view');

-- Extend the live resolver in place (it was last text-patched by 0221), so no
-- earlier rule is lost: only the final role-default return gains the step.
do $$
declare body text; old_text text;
begin
  select pg_get_functiondef('public.permission_effective_for(uuid,text)'::regprocedure) into body;
  old_text := '  return coalesce(v_allowed,v_role=any(v_catalog.default_roles));';
  if position(old_text in body) = 0 then raise exception 'Permission resolver contract changed'; end if;
  body := replace(body, old_text,
    '  if coalesce(v_allowed,v_role=any(v_catalog.default_roles)) then return true; end if;' || chr(10) ||
    '  -- Scope authority defaults apply only while franchise isolation is on (0385).' || chr(10) ||
    '  return cardinality(v_catalog.default_scope_authorities) > 0' || chr(10) ||
    '    and public.org_scope_enforced(v_profile.tenant_id)' || chr(10) ||
    '    and public.org_profile_is_active(v_profile.id)' || chr(10) ||
    '    and public.org_scope_authorities(v_profile.id) && v_catalog.default_scope_authorities;');
  execute body;
end $$;

-- ---------------------------------------------------------------------------
-- 4. User-management scope (one assertion used by every user write contract)
-- ---------------------------------------------------------------------------

-- p_target_id: existing employee being changed (null when creating).
-- p_dest_branch: branch the employee will belong to (null = unchanged).
-- p_dest_role: role being assigned (null = unchanged).
create function assert_org_user_write(p_actor_id uuid, p_target_id uuid, p_dest_branch uuid, p_dest_role user_role)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  a user_profiles; t user_profiles;
  v_enforced boolean; v_full boolean; v_scoped boolean; v_company boolean; v_manageable uuid[];
begin
  select * into a from user_profiles where id = p_actor_id;
  if a.id is null or not org_profile_is_active(a.id) then
    raise exception 'Active profile required' using errcode = '42501';
  end if;
  v_enforced := org_scope_enforced(a.tenant_id);
  v_full := permission_effective_for(a.id, 'users.manage');
  v_scoped := permission_effective_for(a.id, 'users.manage_scoped');
  if not (v_full or v_scoped) then
    raise exception 'User management denied' using errcode = '42501';
  end if;
  if p_target_id is not null then
    select * into t from user_profiles where id = p_target_id;
    if t.id is null or t.tenant_id <> a.tenant_id then
      raise exception 'Profile not found or not accessible' using errcode = '42501';
    end if;
  end if;
  if p_dest_branch is not null and not exists (select 1 from branches b where b.id = p_dest_branch and b.tenant_id = a.tenant_id) then
    raise exception 'Branch is invalid' using errcode = '23503';
  end if;

  -- Before isolation, users.manage keeps its existing company-wide meaning.
  v_company := org_has_company_scope(a.id) or (v_full and not v_enforced);
  if not v_company then
    v_manageable := org_scope_branch_ids(a.id, true);
    if t.id is not null and not (t.branch_id = any(v_manageable)) then
      raise exception 'This employee is outside your franchise or store scope' using errcode = '42501';
    end if;
    if p_dest_branch is not null and not (p_dest_branch = any(v_manageable)) then
      raise exception 'The selected branch is outside your franchise or store scope' using errcode = '42501';
    end if;
    -- Regional authorities never manage company-scope or Director accounts;
    -- scoped-only managers manage ordinary employees only.
    if t.id is not null and t.id <> a.id and exists (
        select 1 from org_scope_grants g where g.user_profile_id = t.id and g.revoked_at is null
          and (g.scope_level = 'company' or g.authority = 'director' or not v_full)) then
      raise exception 'Only a higher authority can change this account' using errcode = '42501';
    end if;
    if not v_full and (t.user_role in ('super_admin', 'admin') or p_dest_role in ('super_admin', 'admin')) then
      raise exception 'Store and franchise managers cannot create or edit administrator accounts' using errcode = '42501';
    end if;
  end if;

  -- A franchise change is a separate audited transfer while isolation is on.
  if v_enforced and t.id is not null and p_dest_branch is not null
     and franchise_of_branch(p_dest_branch) is distinct from franchise_of_branch(t.branch_id) then
    raise exception 'Moving an employee to another franchise needs the franchise transfer' using errcode = '23514';
  end if;
end $$;

-- Deletion keeps its own permission (users.delete); only the target scope is checked here.
create function assert_org_user_target_scope(p_actor_id uuid, p_target_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare a user_profiles; t user_profiles;
begin
  select * into a from user_profiles where id = p_actor_id;
  select * into t from user_profiles where id = p_target_id;
  if a.id is null or t.id is null or a.tenant_id <> t.tenant_id then
    raise exception 'Profile not found or not accessible' using errcode = '42501';
  end if;
  if org_scope_enforced(a.tenant_id) and not org_has_company_scope(a.id)
     and not (t.branch_id = any(org_scope_branch_ids(a.id, true))) then
    raise exception 'This employee is outside your franchise or store scope' using errcode = '42501';
  end if;
end $$;

-- Wire the assertion into the existing contracts (exact-text upgrades, as in
-- 0156/0235; each fails loudly if the contract changed underneath).
do $$
declare body text; old_text text;
begin
  select pg_get_functiondef('public.invite_profile_with_audit_v3(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],public.user_role,uuid)'::regprocedure) into body;
  old_text := 'not public.permission_effective_for(v_creator.id,''users.manage'')';
  if position(old_text in body) = 0 then raise exception 'Invite authorization contract changed'; end if;
  body := replace(body, old_text, 'not (public.permission_effective_for(v_creator.id,''users.manage'') or public.permission_effective_for(v_creator.id,''users.manage_scoped''))');
  old_text := '  v_name := concat_ws(';
  if position(old_text in body) = 0 then raise exception 'Invite profile build contract changed'; end if;
  body := replace(body, old_text, '  perform public.assert_org_user_write(v_creator.id,null,p_branch_id,p_user_role);' || chr(10) || old_text);
  execute body;

  select pg_get_functiondef('public.configure_invited_profile_coverage_with_audit(uuid,uuid,uuid,uuid)'::regprocedure) into body;
  old_text := 'not public.permission_effective_for(v_creator.id,''users.manage'')';
  if position(old_text in body) = 0 then raise exception 'Invited coverage authorization contract changed'; end if;
  body := replace(body, old_text, 'not (public.permission_effective_for(v_creator.id,''users.manage'') or public.permission_effective_for(v_creator.id,''users.manage_scoped''))');
  old_text := '  update user_profiles set secondary_buddy_id=';
  if position(old_text in body) = 0 then raise exception 'Invited coverage write contract changed'; end if;
  body := replace(body, old_text, '  perform public.assert_org_user_write(v_creator.id,p_profile_id,null,null);' || chr(10) || old_text);
  execute body;

  select pg_get_functiondef('public.update_user_profile_with_audit(uuid,jsonb)'::regprocedure) into body;
  old_text := 'not has_permission(''users.manage'')';
  if position(old_text in body) = 0 then raise exception 'User editor authorization contract changed'; end if;
  body := replace(body, old_text, 'not (has_permission(''users.manage'') or has_permission(''users.manage_scoped''))');
  old_text := '  update user_profiles set' || chr(10) || '    employee_name=';
  if position(old_text in body) = 0 then raise exception 'User editor write contract changed'; end if;
  body := replace(body, old_text, '  perform public.assert_org_user_write(v_actor.id,v_old.id,v_branch,case when v_role<>v_old.user_role then v_role end);' || chr(10) || old_text);
  execute body;

  select pg_get_functiondef('public.prepare_unused_user_deletion(uuid)'::regprocedure) into body;
  old_text := '  if v_target.id = v_actor.id then';
  if position(old_text in body) = 0 then raise exception 'User deletion contract changed'; end if;
  execute replace(body, old_text, '  perform public.assert_org_user_target_scope(v_actor.id,v_target.id);' || chr(10) || old_text);

  select pg_get_functiondef('public.remove_employee_with_audit(uuid)'::regprocedure) into body;
  old_text := '  if v_target.id = v_actor.id then';
  if position(old_text in body) = 0 then raise exception 'Employee removal contract changed'; end if;
  execute replace(body, old_text, '  perform public.assert_org_user_target_scope(v_actor.id,v_target.id);' || chr(10) || old_text);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Read policies
-- ---------------------------------------------------------------------------

create policy franchise_groups_select on franchise_groups for select to authenticated
  using ((select current_profile_is_active()) and tenant_id = (select current_tenant_id()));
create policy org_scope_grants_select on org_scope_grants for select to authenticated
  using ((select current_profile_is_active()) and tenant_id = (select current_tenant_id())
    and (user_profile_id = (select (current_profile()).id) or (select has_permission('franchise.manage'))));
create policy org_scope_grants_section_available on org_scope_grants as restrictive for select to authenticated
  using (module_accessible('users', false));
grant select on franchise_groups, org_scope_grants to authenticated;

-- Employee directory. While isolation is on: franchise and store authorities
-- see the people they manage (additive), and nobody below company scope sees
-- people outside their readable branches (restrictive). While off: unchanged.
create policy up_select_franchise_scope on user_profiles for select to authenticated using (
  (select org_my_scope_enforced())
  and (select current_profile_is_active())
  and tenant_id = (select current_tenant_id())
  and branch_id = any(coalesce((select org_my_manageable_branch_ids()), '{}'::uuid[]))
);
create policy up_select_franchise_boundary on user_profiles as restrictive for select to authenticated using (
  not (select org_my_scope_enforced())
  or auth_user_id = auth.uid()
  or (select org_i_have_company_scope())
  or branch_id = any(coalesce((select org_my_readable_branch_ids()), '{}'::uuid[]))
);

-- ---------------------------------------------------------------------------
-- 6. Branch franchise guard
-- ---------------------------------------------------------------------------

-- franchise_group_id and location_kind change only through the audited
-- assignment below, whatever writes the row.
create function guard_branch_franchise_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.franchise_group_id is null then
    new.franchise_group_id := nullif(current_setting('jewelos.new_branch_franchise_group_id', true), '')::uuid;
  end if;
  if tg_op = 'UPDATE'
     and (new.franchise_group_id, new.location_kind) is distinct from (old.franchise_group_id, old.location_kind)
     and coalesce(current_setting('jewelos.franchise_assignment', true), '') <> 'on' then
    raise exception 'Use the audited franchise assignment to change a branch''s franchise' using errcode = '42501';
  end if;
  if new.franchise_group_id is not null and (tg_op = 'INSERT' or new.franchise_group_id is distinct from old.franchise_group_id)
     and not exists (select 1 from franchise_groups f where f.id = new.franchise_group_id and f.tenant_id = new.tenant_id and f.is_active) then
    raise exception 'Franchise is invalid or inactive' using errcode = '23503';
  end if;
  -- Exhibitions need no franchise; new event locations can be opened any time.
  if new.is_active and new.franchise_group_id is null and new.location_kind <> 'exhibition' and tg_op = 'UPDATE'
     and old.franchise_group_id is not null and org_scope_enforced(new.tenant_id) then
    raise exception 'Every active branch needs a franchise while franchise isolation is on' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger branches_franchise_guard before insert or update on branches
  for each row execute function guard_branch_franchise_assignment();

-- ---------------------------------------------------------------------------
-- 7. Super Admin organisation contracts (franchise.manage, audited)
-- ---------------------------------------------------------------------------

create function assert_franchise_admin()
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  perform assert_module_enabled('users');
  a := current_profile();
  if a.id is null or not current_profile_is_active() or not has_permission('franchise.manage') then
    raise exception 'Franchise management denied' using errcode = '42501';
  end if;
  return a;
end $$;

create function save_franchise_group_with_audit(p_franchise_group_id uuid, p_payload jsonb)
returns franchise_groups language plpgsql security definer set search_path = public as $$
declare a user_profiles; old_row franchise_groups; new_row franchise_groups; v_name text; v_code text; v_active boolean;
begin
  a := assert_franchise_admin();
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','code','city','state','is_active'] <> '{}'::jsonb then
    raise exception 'Invalid franchise changes' using errcode = '22023';
  end if;
  if p_payload ? 'is_active' and jsonb_typeof(p_payload->'is_active') <> 'boolean' then
    raise exception 'Franchise active flag must be boolean' using errcode = '22023';
  end if;
  if p_franchise_group_id is not null then
    select * into old_row from franchise_groups where id = p_franchise_group_id for update;
    if old_row.id is null or old_row.tenant_id <> a.tenant_id then raise exception 'Franchise not accessible' using errcode = '42501'; end if;
  end if;
  v_name := btrim(coalesce(p_payload->>'name', old_row.name, ''));
  v_code := upper(btrim(coalesce(p_payload->>'code', old_row.code, '')));
  v_active := coalesce((p_payload->>'is_active')::boolean, old_row.is_active, true);
  if v_name = '' or char_length(v_name) > 120 or v_code !~ '^[A-Z0-9_-]{2,32}$' then
    raise exception 'Franchise name or code is invalid' using errcode = '22023';
  end if;
  if exists (select 1 from franchise_groups f where f.tenant_id = a.tenant_id and f.id is distinct from p_franchise_group_id
             and (f.code = v_code or lower(btrim(f.name)) = lower(v_name))) then
    raise exception 'A franchise with this name or code already exists' using errcode = '23505';
  end if;
  if not v_active and old_row.id is not null and (
      exists (select 1 from branches b where b.franchise_group_id = old_row.id and b.is_active)
      or exists (select 1 from org_scope_grants g where g.franchise_group_id = old_row.id and g.revoked_at is null)) then
    raise exception 'Move its active branches and revoke its scope grants before deactivating this franchise' using errcode = '23514';
  end if;
  if p_franchise_group_id is null then
    insert into franchise_groups(tenant_id, name, code, city, state, is_active, created_by, updated_by)
    values (a.tenant_id, v_name, v_code, nullif(btrim(p_payload->>'city'), ''), nullif(btrim(p_payload->>'state'), ''), v_active, a.id, a.id)
    returning * into new_row;
  else
    update franchise_groups set name = v_name, code = v_code,
      city = case when p_payload ? 'city' then nullif(btrim(p_payload->>'city'), '') else city end,
      state = case when p_payload ? 'state' then nullif(btrim(p_payload->>'state'), '') else state end,
      is_active = v_active, updated_by = a.id, updated_at = now()
    where id = p_franchise_group_id returning * into new_row;
  end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'franchise_group_saved', 'user_management', new_row.id, to_jsonb(old_row), to_jsonb(new_row));
  return new_row;
end $$;

-- What moving a branch affects, for the confirmation screen and the audit row.
create function franchise_branch_impact(p_branch_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'active_employees', (select count(*) from user_profiles u where u.branch_id = p_branch_id and u.account_status = 'active' and u.removed_at is null),
    'open_tasks', (select count(*) from task_instances t where t.branch_id = p_branch_id and t.status not in ('completed', 'rejected')),
    'active_fms_runs', (select count(*) from fms_instances i where i.branch_id = p_branch_id and i.status in ('active', 'on_hold', 'overdue')),
    'form_submissions', (select count(*) from form_submissions s where s.branch_id = p_branch_id),
    'branch_scope_grants', (select count(*) from org_scope_grants g where g.branch_id = p_branch_id and g.revoked_at is null)
  );
$$;

create function assign_branch_franchise_with_audit(p_branch_id uuid, p_franchise_group_id uuid, p_location_kind text, p_reason text)
returns branches language plpgsql security definer set search_path = public as $$
declare a user_profiles; old_row branches; new_row branches; v_kind text; v_reason text; v_impact jsonb;
begin
  a := assert_franchise_admin();
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  select * into old_row from branches where id = p_branch_id for update;
  if old_row.id is null or old_row.tenant_id <> a.tenant_id then raise exception 'Branch not accessible' using errcode = '42501'; end if;
  v_kind := coalesce(nullif(btrim(coalesce(p_location_kind, '')), ''), old_row.location_kind);
  if v_kind not in ('store', 'exhibition', 'office', 'warehouse') then raise exception 'Location type is invalid' using errcode = '22023'; end if;
  -- Exhibitions are temporary event locations (a new one most months): they need
  -- no franchise. Every other location belongs to one franchise.
  if p_franchise_group_id is null and v_kind <> 'exhibition' then raise exception 'Choose a franchise' using errcode = '22023'; end if;
  if p_franchise_group_id is not null and not exists (select 1 from franchise_groups f where f.id = p_franchise_group_id and f.tenant_id = a.tenant_id and f.is_active) then
    raise exception 'Franchise is invalid or inactive' using errcode = '23503';
  end if;
  -- Re-homing a mapped branch is an owner decision that must carry a written reason.
  if old_row.franchise_group_id is not null and old_row.franchise_group_id is distinct from p_franchise_group_id then
    if v_reason is null or char_length(v_reason) < 5 then
      raise exception 'Give a reason for this franchise assignment' using errcode = '22023';
    end if;
  end if;
  if (old_row.franchise_group_id, old_row.location_kind) is not distinct from (p_franchise_group_id, v_kind) then
    return old_row;
  end if;
  v_impact := franchise_branch_impact(old_row.id);
  perform set_config('jewelos.franchise_assignment', 'on', true);
  update branches set franchise_group_id = p_franchise_group_id, location_kind = v_kind, updated_by = a.id, updated_at = now()
  where id = old_row.id returning * into new_row;
  perform set_config('jewelos.franchise_assignment', '', true);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'branch_franchise_assigned', 'user_management', new_row.id,
    jsonb_build_object('franchise_group_id', old_row.franchise_group_id, 'location_kind', old_row.location_kind),
    jsonb_build_object('franchise_group_id', new_row.franchise_group_id, 'location_kind', new_row.location_kind, 'reason', v_reason, 'impact', v_impact));
  return new_row;
end $$;

create function create_branch_in_franchise_with_audit(p_franchise_group_id uuid, p_payload jsonb)
returns branches language plpgsql security definer set search_path = public as $$
declare a user_profiles; v_row branches;
begin
  a := assert_franchise_admin();
  if not exists (select 1 from franchise_groups f where f.id = p_franchise_group_id and f.tenant_id = a.tenant_id and f.is_active) then
    raise exception 'Franchise is invalid or inactive' using errcode = '23503';
  end if;
  perform set_config('jewelos.new_branch_franchise_group_id', p_franchise_group_id::text, true);
  v_row := save_branch_with_audit(null, p_payload);
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'branch_franchise_assigned', 'user_management', v_row.id, null,
    jsonb_build_object('franchise_group_id', v_row.franchise_group_id, 'location_kind', v_row.location_kind, 'reason', 'new branch'));
  return v_row;
end $$;

create function grant_org_scope_with_audit(p_profile_id uuid, p_authority text, p_franchise_group_id uuid, p_branch_id uuid, p_company boolean, p_reason text)
returns org_scope_grants language plpgsql security definer set search_path = public as $$
declare a user_profiles; t user_profiles; v_level text; v_row org_scope_grants;
begin
  a := assert_franchise_admin();
  select * into t from user_profiles where id = p_profile_id;
  if t.id is null or t.tenant_id <> a.tenant_id then raise exception 'Profile not found or not accessible' using errcode = '42501'; end if;
  if not org_profile_is_active(t.id) then raise exception 'Scope can be granted only to an active employee' using errcode = '22023'; end if;
  if p_authority not in ('director', 'regional_admin', 'hr', 'store_manager', 'store_access') then
    raise exception 'Authority is invalid' using errcode = '22023';
  end if;
  v_level := case when coalesce(p_company, false) then 'company'
    when p_authority in ('store_manager', 'store_access') then 'branch' else 'franchise' end;
  if v_level = 'company' and (p_authority in ('store_manager', 'store_access') or p_franchise_group_id is not null or p_branch_id is not null) then
    raise exception 'Company scope applies to Director, Regional Admin or HR only, without a franchise or store' using errcode = '22023';
  end if;
  if v_level = 'franchise' and (p_franchise_group_id is null or p_branch_id is not null
      or not exists (select 1 from franchise_groups f where f.id = p_franchise_group_id and f.tenant_id = a.tenant_id and f.is_active)) then
    raise exception 'Choose an active franchise' using errcode = '22023';
  end if;
  if v_level = 'branch' and (p_branch_id is null or p_franchise_group_id is not null
      or not exists (select 1 from branches b where b.id = p_branch_id and b.tenant_id = a.tenant_id and b.is_active)) then
    raise exception 'Choose an active store' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for this scope grant' using errcode = '22023'; end if;
  if exists (select 1 from org_scope_grants g where g.user_profile_id = t.id and g.authority = p_authority and g.scope_level = v_level
             and g.revoked_at is null and g.franchise_group_id is not distinct from p_franchise_group_id and g.branch_id is not distinct from p_branch_id) then
    raise exception 'This scope is already granted' using errcode = '23505';
  end if;
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, branch_id, reason, granted_by)
  values (a.tenant_id, t.id, p_authority, v_level, case when v_level = 'franchise' then p_franchise_group_id end,
    case when v_level = 'branch' then p_branch_id end, btrim(p_reason), a.id)
  returning * into v_row;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'org_scope_granted', 'user_management', t.id, null, to_jsonb(v_row));
  return v_row;
end $$;

create function revoke_org_scope_with_audit(p_grant_id uuid, p_reason text)
returns org_scope_grants language plpgsql security definer set search_path = public as $$
declare a user_profiles; old_row org_scope_grants; new_row org_scope_grants;
begin
  a := assert_franchise_admin();
  select * into old_row from org_scope_grants where id = p_grant_id for update;
  if old_row.id is null or old_row.tenant_id <> a.tenant_id then raise exception 'Scope grant not accessible' using errcode = '42501'; end if;
  if old_row.revoked_at is not null then return old_row; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for revoking this scope' using errcode = '22023'; end if;
  update org_scope_grants set revoked_at = now(), revoked_by = a.id, revoke_reason = btrim(p_reason)
  where id = old_row.id returning * into new_row;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'org_scope_revoked', 'user_management', old_row.user_profile_id, to_jsonb(old_row), to_jsonb(new_row));
  return new_row;
end $$;

-- Cross-franchise employee move: separate, audited, with an impact summary.
-- Task, FMS and form history keeps its own branch and is never rewritten.
create function transfer_employee_franchise_with_audit(p_profile_id uuid, p_branch_id uuid, p_department_id uuid, p_reason text)
returns user_profiles language plpgsql security definer set search_path = public as $$
declare a user_profiles; old_row user_profiles; new_row user_profiles; v_impact jsonb; v_revoked int;
begin
  a := assert_franchise_admin();
  if nullif(btrim(coalesce(p_reason, '')), '') is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'Give a reason for this transfer' using errcode = '22023';
  end if;
  select * into old_row from user_profiles where id = p_profile_id for update;
  if old_row.id is null or old_row.tenant_id <> a.tenant_id or old_row.removed_at is not null then
    raise exception 'Profile not found or not accessible' using errcode = '42501';
  end if;
  if not exists (select 1 from branches b where b.id = p_branch_id and b.tenant_id = a.tenant_id and b.is_active and b.franchise_group_id is not null) then
    raise exception 'Choose an active branch that belongs to a franchise' using errcode = '23503';
  end if;
  if franchise_of_branch(p_branch_id) is not distinct from franchise_of_branch(old_row.branch_id) then
    raise exception 'Both branches are in the same franchise; use Edit user' using errcode = '22023';
  end if;
  if not exists (select 1 from departments d where d.id = p_department_id and d.tenant_id = a.tenant_id and d.is_active
                 and (d.branch_id is null or d.branch_id = p_branch_id)) then
    raise exception 'Department is invalid or inactive for this branch' using errcode = '23503';
  end if;
  v_impact := jsonb_build_object(
    'open_tasks', (select count(*) from task_assignees ta join task_instances t on t.id = ta.task_instance_id
                   where ta.user_profile_id = old_row.id and t.status not in ('completed', 'rejected')),
    'reports', (select count(*) from user_profiles u where u.reports_to_user_id = old_row.id and u.removed_at is null),
    'buddy_links', (select count(*) from user_profiles u where (u.buddy_id = old_row.id or u.secondary_buddy_id = old_row.id) and u.removed_at is null));
  -- preserve_organization_leader_assignment() still refuses a branch manager or
  -- department head until they are replaced.
  update user_profiles set branch_id = p_branch_id, department_id = p_department_id, updated_by = a.id, updated_at = now()
  where id = old_row.id returning * into new_row;
  update org_scope_grants g set revoked_at = now(), revoked_by = a.id, revoke_reason = 'franchise transfer: ' || btrim(p_reason)
  where g.user_profile_id = old_row.id and g.revoked_at is null and g.scope_level <> 'company';
  get diagnostics v_revoked = row_count;
  insert into user_organization_history(tenant_id, user_profile_id, old_branch_id, new_branch_id, old_department_id, new_department_id,
    old_designation_id, new_designation_id, old_reports_to_user_id, new_reports_to_user_id, changed_by)
  values (new_row.tenant_id, new_row.id, old_row.branch_id, new_row.branch_id, old_row.department_id, new_row.department_id,
    old_row.designation_id, new_row.designation_id, old_row.reports_to_user_id, new_row.reports_to_user_id, a.id);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'employee_franchise_transferred', 'user_management', new_row.id,
    jsonb_build_object('branch_id', old_row.branch_id, 'department_id', old_row.department_id, 'franchise_group_id', franchise_of_branch(old_row.branch_id)),
    jsonb_build_object('branch_id', new_row.branch_id, 'department_id', new_row.department_id, 'franchise_group_id', franchise_of_branch(new_row.branch_id),
      'reason', btrim(p_reason), 'impact', v_impact, 'scope_grants_revoked', v_revoked));
  return new_row;
end $$;

-- Readiness and exception report: what must be decided before isolation can
-- be switched on. Counts only for records; names only for organisation rows.
create function get_franchise_readiness_report()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles; v_unmapped jsonb; v_report jsonb;
begin
  a := assert_franchise_admin();
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code, 'city', b.city, 'location_kind', b.location_kind) order by b.name), '[]'::jsonb)
    into v_unmapped from branches b where b.tenant_id = a.tenant_id and b.is_active and b.franchise_group_id is null and b.location_kind <> 'exhibition';
  v_report := jsonb_build_object(
    'enforcement_enabled', org_scope_enforced(a.tenant_id),
    'enforcement_supported', franchise_enforcement_supported(),
    'unmapped_active_branches', v_unmapped,
    'exhibition_like_branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'location_kind', b.location_kind,
        'franchise_group_id', b.franchise_group_id) order by b.name)
      from branches b where b.tenant_id = a.tenant_id and (b.location_kind = 'exhibition' or b.name ~* 'exhib|expo|event|mobile')), '[]'::jsonb),
    'unmapped_inactive_branches', (select count(*) from branches b where b.tenant_id = a.tenant_id and not b.is_active and b.franchise_group_id is null),
    -- Leaders whose access narrows to their own branch on activation unless granted scope.
    'leaders_without_scope', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'employee_name', p.employee_name,
        'role', coalesce(ua.dashboard_authority, p.user_role), 'branch_id', p.branch_id) order by p.employee_name)
      from user_profiles p left join user_access_profiles ua on ua.user_profile_id = p.id
      where p.tenant_id = a.tenant_id and p.account_status = 'active' and p.removed_at is null
        and coalesce(ua.dashboard_authority, p.user_role) in ('admin', 'hr', 'manager')
        and not exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.revoked_at is null)
        and not exists (select 1 from branches b where b.manager_id = p.id)), '[]'::jsonb),
    -- Records with no branch stay visible only to company scope on activation.
    'records_without_branch', jsonb_build_object(
      'task_instances', (select count(*) from task_instances where tenant_id = a.tenant_id and branch_id is null),
      'task_templates', (select count(*) from task_templates where tenant_id = a.tenant_id and branch_id is null),
      'form_templates_shared', (select count(*) from form_templates where tenant_id = a.tenant_id and branch_id is null),
      'form_submissions', (select count(*) from form_submissions where tenant_id = a.tenant_id and branch_id is null),
      'fms_flows_shared', (select count(*) from fms_flows where tenant_id = a.tenant_id and branch_id is null),
      'fms_instances', (select count(*) from fms_instances where tenant_id = a.tenant_id and branch_id is null),
      'notifications', (select count(*) from notifications where tenant_id = a.tenant_id and branch_id is null),
      'clients', (select count(*) from clients where tenant_id = a.tenant_id and branch_id is null)),
    'users_department_branch_mismatch', (select count(*) from user_profiles p join departments d on d.id = p.department_id
      where p.tenant_id = a.tenant_id and p.removed_at is null and d.branch_id is not null and d.branch_id <> p.branch_id)
  );
  return v_report || jsonb_build_object('mappings_complete', jsonb_array_length(v_unmapped) = 0);
end $$;

create function get_franchise_admin_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_franchise_admin();
  return jsonb_build_object(
    'enforcement_enabled', org_scope_enforced(a.tenant_id),
    'franchises', coalesce((select jsonb_agg(to_jsonb(f) order by f.name) from franchise_groups f where f.tenant_id = a.tenant_id), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code, 'city', b.city, 'is_active', b.is_active,
        'franchise_group_id', b.franchise_group_id, 'location_kind', b.location_kind, 'manager_id', b.manager_id) order by b.name)
      from branches b where b.tenant_id = a.tenant_id), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'user_profile_id', g.user_profile_id, 'employee_name', p.employee_name,
        'authority', g.authority, 'scope_level', g.scope_level, 'franchise_group_id', g.franchise_group_id, 'branch_id', g.branch_id,
        'reason', g.reason, 'granted_at', g.granted_at) order by p.employee_name, g.granted_at)
      from org_scope_grants g join user_profiles p on p.id = g.user_profile_id
      where g.tenant_id = a.tenant_id and g.revoked_at is null), '[]'::jsonb)
  );
end $$;

-- Switching isolation on needs complete mappings and Phase 2 support. Switching
-- it off is always allowed: it is the rollback lever.
create function set_franchise_enforcement_with_audit(p_enabled boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; v_old boolean; v_report jsonb;
begin
  a := assert_franchise_admin();
  if p_enabled is null then raise exception 'Choose on or off' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason' using errcode = '22023'; end if;
  v_old := org_scope_enforced(a.tenant_id);
  if p_enabled and not v_old then
    if not franchise_enforcement_supported() then
      raise exception 'Franchise isolation cannot be switched on until the Phase 2 module integration is installed' using errcode = '55000';
    end if;
    v_report := get_franchise_readiness_report();
    if not (v_report->>'mappings_complete')::boolean then
      raise exception 'Map every active branch to a franchise first' using errcode = '55000';
    end if;
  end if;
  insert into tenant_franchise_controls(tenant_id, enforcement_enabled, changed_by, changed_at, change_reason)
  values (a.tenant_id, p_enabled, a.id, now(), btrim(p_reason))
  on conflict (tenant_id) do update set enforcement_enabled = excluded.enforcement_enabled, changed_by = excluded.changed_by,
    changed_at = excluded.changed_at, change_reason = excluded.change_reason;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'franchise_enforcement_changed', 'user_management', a.tenant_id,
    jsonb_build_object('enforcement_enabled', v_old), jsonb_build_object('enforcement_enabled', p_enabled, 'reason', btrim(p_reason)));
  return jsonb_build_object('enforcement_enabled', p_enabled);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

-- Internal helpers: callable by policies and contracts (definer), not by clients
-- with arbitrary profile ids.
revoke all on function org_scope_enforced(uuid), franchise_enforcement_supported(), org_profile_is_active(uuid),
  org_has_company_scope(uuid), org_scope_branch_ids(uuid, boolean), org_scope_authorities(uuid),
  franchise_of_branch(uuid), assert_org_user_write(uuid, uuid, uuid, user_role), assert_org_user_target_scope(uuid, uuid),
  guard_branch_franchise_assignment(), assert_franchise_admin(), franchise_branch_impact(uuid)
  from public, anon, authenticated;
-- Policy helpers evaluated as the querying role must stay executable.
revoke all on function org_my_readable_branch_ids(), org_my_manageable_branch_ids(), org_branch_in_data_scope(uuid),
  org_my_scope_enforced(), org_i_have_company_scope()
  from public, anon;
grant execute on function org_my_readable_branch_ids(), org_my_manageable_branch_ids(), org_branch_in_data_scope(uuid),
  org_my_scope_enforced(), org_i_have_company_scope() to authenticated;
-- Client contracts.
revoke all on function get_my_org_scope(), save_franchise_group_with_audit(uuid, jsonb),
  assign_branch_franchise_with_audit(uuid, uuid, text, text), create_branch_in_franchise_with_audit(uuid, jsonb),
  grant_org_scope_with_audit(uuid, text, uuid, uuid, boolean, text), revoke_org_scope_with_audit(uuid, text),
  transfer_employee_franchise_with_audit(uuid, uuid, uuid, text), get_franchise_readiness_report(),
  get_franchise_admin_context(), set_franchise_enforcement_with_audit(boolean, text)
  from public, anon;
grant execute on function get_my_org_scope(), save_franchise_group_with_audit(uuid, jsonb),
  assign_branch_franchise_with_audit(uuid, uuid, text, text), create_branch_in_franchise_with_audit(uuid, jsonb),
  grant_org_scope_with_audit(uuid, text, uuid, uuid, boolean, text), revoke_org_scope_with_audit(uuid, text),
  transfer_employee_franchise_with_audit(uuid, uuid, uuid, text), get_franchise_readiness_report(),
  get_franchise_admin_context(), set_franchise_enforcement_with_audit(boolean, text)
  to authenticated;

notify pgrst, 'reload schema';
