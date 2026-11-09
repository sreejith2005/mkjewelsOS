-- Per-workflow FMS access (MK1 audit 2026-11-07).
--
-- Until now an FMS workflow definition was all-or-nothing: `fms.manage` (with
-- franchise ownership, 0387) could change every workflow, everybody else could
-- only run published ones. This adds explicit, audited grants on one workflow
-- family (every version of one workflow):
--
--   view     open the workflow in the builder read-only: steps, instructions,
--            conditions, routing and default assignees, including drafts
--   edit     view + save drafts and start a new version
--   publish  edit + publish and pause / resume the live version, change its
--            start trigger
--
-- Archive, delete, restore, erase and the module context stay `fms.manage`
-- only. Running work is unchanged: starting a workflow and completing a step
-- never depend on a definition grant, so a view-only grant can never block
-- assigned work. A grant works only while the person is active and holds the
-- FMS module (`fms.view`); revoking that permission or deactivating the person
-- switches the grant off at once (it is resolved on every call).
--
-- Who grants: anyone who can manage that workflow (`can_manage_fms_flow`).
-- With franchise isolation on, only people in the granter's own scope can be
-- named (`org_recipient_in_local_scope`); with it off this is company-wide,
-- like every other franchise rule.
--
-- Changes the bodies of existing FMS builder functions by exact text
-- replacement of their authorization check only (bodies stored with CRLF in
-- production are normalised first, as in 0387).

create function pg_temp.fms_access_patch(p_signature text, p_old text, p_new text, p_expected integer)
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
-- 1. Grants
-- ---------------------------------------------------------------------------

create table fms_flow_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- fms_flows.family_id: every version of one workflow shares it.
  family_id uuid not null,
  user_profile_id uuid not null references user_profiles(id),
  access_level text not null check (access_level in ('view', 'edit', 'publish')),
  granted_by uuid references user_profiles(id),
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references user_profiles(id),
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 500),
  check ((revoked_at is null) = (revoked_by is null))
);
-- One live grant per person and workflow; revoked rows stay as history.
create unique index fms_flow_access_grants_live on fms_flow_access_grants (family_id, user_profile_id) where revoked_at is null;
create index fms_flow_access_grants_person on fms_flow_access_grants (user_profile_id) where revoked_at is null;

alter table fms_flow_access_grants enable row level security;
revoke all on fms_flow_access_grants from public, anon, authenticated;
-- Reads go through the RPCs below; no direct table access for browsers.

-- The signed-in person's live grant level on one workflow family, or null.
-- Null unless the person is active and still holds the FMS module.
create function fms_my_flow_access(p_family_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select g.access_level
  from fms_flow_access_grants g
  where g.family_id = p_family_id
    and g.revoked_at is null
    and g.user_profile_id = (select (current_profile()).id)
    and g.tenant_id = (select current_tenant_id())
    and (select current_profile_is_active())
    and has_permission('fms.view')
  limit 1;
$$;

-- Draft edits and new versions: `fms.manage` on the workflow, or an edit /
-- publish grant. A brand-new workflow (no id) still needs `fms.manage`.
create function can_edit_fms_flow(p_flow_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can_manage_fms_flow(p_flow_id)
    or (p_flow_id is not null and exists (
      select 1 from fms_flows f
      where f.id = p_flow_id and f.tenant_id = current_tenant_id()
        and fms_my_flow_access(f.family_id) in ('edit', 'publish')));
$$;

-- Publishing and switching the live version: `fms.manage`, or a publish grant.
create function can_publish_fms_flow(p_flow_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can_manage_fms_flow(p_flow_id)
    or (p_flow_id is not null and exists (
      select 1 from fms_flows f
      where f.id = p_flow_id and f.tenant_id = current_tenant_id()
        and fms_my_flow_access(f.family_id) = 'publish'));
$$;

-- ---------------------------------------------------------------------------
-- 2. Reading a granted workflow (every version, steps, routing, assignees)
-- ---------------------------------------------------------------------------

create policy fms_flow_granted_select on fms_flows for select to authenticated using (
  (select current_profile_is_active()) and tenant_id = (select current_tenant_id())
  and fms_my_flow_access(family_id) is not null
);
-- fms_stages_select already follows fms_flows visibility.
create policy fms_stage_assignees_granted_select on fms_stage_assignees for select to authenticated using (
  exists (select 1 from fms_stages s join fms_flows f on f.id = s.fms_flow_id
          where s.id = fms_stage_assignees.fms_stage_id and f.tenant_id = (select current_tenant_id())
            and fms_my_flow_access(f.family_id) is not null)
);
create policy fms_branch_rules_granted_select on fms_branch_rules for select to authenticated using (
  exists (select 1 from fms_stages s join fms_flows f on f.id = s.fms_flow_id
          where s.id = fms_branch_rules.fms_stage_id and f.tenant_id = (select current_tenant_id())
            and fms_my_flow_access(f.family_id) is not null)
);

-- ---------------------------------------------------------------------------
-- 3. Builder writes honour the grants
-- ---------------------------------------------------------------------------

select pg_temp.fms_access_patch('public.save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)',
  $o$not has_permission('fms.manage')$o$, $n$not can_edit_fms_flow(p_flow_id)$n$, 1);
select pg_temp.fms_access_patch('public.save_fms_flow_draft_before_assignment(uuid,jsonb,jsonb)',
  'can_manage_fms_flow(p_flow_id)', 'can_edit_fms_flow(p_flow_id)', 1);
select pg_temp.fms_access_patch('public.create_fms_revision_before_assignment(uuid)',
  'can_manage_fms_flow(p_flow_id)', 'can_edit_fms_flow(p_flow_id)', 1);
select pg_temp.fms_access_patch('public.test_fms_start_trigger(uuid,jsonb,jsonb)',
  'can_manage_fms_flow(p_flow_id)', 'can_edit_fms_flow(p_flow_id)', 1);
select pg_temp.fms_access_patch('public.publish_fms_flow_with_audit(uuid)',
  'can_manage_fms_flow(p_flow_id)', 'can_publish_fms_flow(p_flow_id)', 1);
select pg_temp.fms_access_patch('public.set_fms_flow_active_with_audit(uuid,boolean,text)',
  'can_manage_fms_flow(p_flow_id)', 'can_publish_fms_flow(p_flow_id)', 1);
select pg_temp.fms_access_patch('public.set_fms_flow_start_with_audit(uuid,text,jsonb)',
  $o$not has_permission('fms.manage') or not can_manage_fms_flow(p_flow_id)$o$, $n$not can_publish_fms_flow(p_flow_id)$n$, 1);

-- The definition write guard (0387) applies franchise ownership while
-- isolation is on. An explicit edit / publish grant on the workflow is the
-- owner's decision to let that person change it, so it passes the guard too.
create or replace function fms_definition_write_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); f fms_flows; v_flow uuid;
begin
  if a.id is null or not org_scope_enforced(a.tenant_id) or org_has_company_scope(a.id) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'fms_flows' then
    if tg_op = 'UPDATE' and (new.name, new.description, new.status, new.is_active, new.branch_id, new.department_id, new.trigger_type,
        new.start_mode, new.start_trigger, new.module_context, new.owner_franchise_group_id, new.scope_type, new.family_id)
       is not distinct from (old.name, old.description, old.status, old.is_active, old.branch_id, old.department_id, old.trigger_type,
        old.start_mode, old.start_trigger, old.module_context, old.owner_franchise_group_id, old.scope_type, old.family_id) then
      return new;
    end if;
    if tg_op in ('UPDATE', 'DELETE') and not org_definition_manageable(old.branch_id, old.owner_franchise_group_id)
       and coalesce(fms_my_flow_access(old.family_id), '') not in ('edit', 'publish') then
      raise exception 'This workflow belongs to another franchise or is shared company-wide; only its owner or Super Admin can change it' using errcode = '42501';
    end if;
    if tg_op in ('INSERT', 'UPDATE') and not org_definition_manageable(new.branch_id, new.owner_franchise_group_id)
       and coalesce(fms_my_flow_access(new.family_id), '') not in ('edit', 'publish') then
      raise exception 'This workflow belongs to another franchise or is shared company-wide; only its owner or Super Admin can change it' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_table_name = 'fms_stages' then
    v_flow := coalesce(new.fms_flow_id, old.fms_flow_id);
  else
    select s.fms_flow_id into v_flow from fms_stages s where s.id = coalesce(new.fms_stage_id, old.fms_stage_id);
  end if;
  select * into f from fms_flows where id = v_flow;
  if f.id is not null and not org_definition_manageable(f.branch_id, f.owner_franchise_group_id)
     and coalesce(fms_my_flow_access(f.family_id), '') not in ('edit', 'publish') then
    raise exception 'This workflow belongs to another franchise or is shared company-wide; only its owner or Super Admin can change it' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Managing grants (audited)
-- ---------------------------------------------------------------------------

-- People with access to one workflow. Managers of that workflow only.
create function list_fms_flow_access(p_flow_id uuid)
returns table (grant_id uuid, user_profile_id uuid, employee_name text, employee_code text, access_level text,
               granted_at timestamptz, granted_by_name text, account_active boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_family uuid;
begin
  perform assert_module_enabled('fms_builder');
  if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode = '42501'; end if;
  select f.family_id into v_family from fms_flows f where f.id = p_flow_id and f.tenant_id = current_tenant_id();
  return query
    select g.id, p.id, p.employee_name::text, p.employee_code::text, g.access_level, g.granted_at, gb.employee_name::text,
           (p.account_status = 'active' and p.working_status <> 'resigned' and p.is_login_enabled)
    from fms_flow_access_grants g
    join user_profiles p on p.id = g.user_profile_id
    left join user_profiles gb on gb.id = g.granted_by
    where g.family_id = v_family and g.revoked_at is null and g.tenant_id = current_tenant_id()
    order by p.employee_name;
end $$;

-- Gives or changes one person's access to a workflow (every version).
create function grant_fms_flow_access_with_audit(p_flow_id uuid, p_user_profile_id uuid, p_access_level text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); f fms_flows; p user_profiles; g fms_flow_access_grants;
begin
  perform assert_module_enabled('fms_builder');
  if a.id is null or not current_profile_is_active() or not can_manage_fms_flow(p_flow_id) then
    raise exception 'FMS builder access denied' using errcode = '42501';
  end if;
  if p_access_level is null or p_access_level not in ('view', 'edit', 'publish') then
    raise exception 'Access must be view, edit or publish' using errcode = '22023';
  end if;
  select * into f from fms_flows where id = p_flow_id and tenant_id = a.tenant_id;
  if f.id is null then raise exception 'Workflow not found' using errcode = 'P0002'; end if;
  select * into p from user_profiles where id = p_user_profile_id and tenant_id = a.tenant_id;
  if p.id is null or p.account_status <> 'active' or p.working_status = 'resigned' or not p.is_login_enabled then
    raise exception 'Choose an active employee' using errcode = '22023';
  end if;
  if p.id = a.id then raise exception 'You already manage this workflow' using errcode = '22023'; end if;
  -- Isolation on: only people in the granter's own franchise or stores.
  if not org_recipient_in_local_scope(a.id, p.id) then
    raise exception 'This employee is outside your franchise or store scope' using errcode = '42501';
  end if;
  select * into g from fms_flow_access_grants
   where family_id = f.family_id and user_profile_id = p.id and revoked_at is null for update;
  if g.id is not null then
    if g.access_level = p_access_level then return g.id; end if;
    update fms_flow_access_grants set access_level = p_access_level, granted_by = a.id, updated_at = now() where id = g.id;
  else
    insert into fms_flow_access_grants (tenant_id, family_id, user_profile_id, access_level, granted_by)
    values (a.tenant_id, f.family_id, p.id, p_access_level, a.id) returning * into g;
  end if;
  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'fms_flow_access_granted', 'fms_flows', f.id,
          case when g.access_level is distinct from p_access_level then jsonb_build_object('access_level', g.access_level) end,
          jsonb_build_object('grant_id', g.id, 'family_id', f.family_id, 'workflow', f.name, 'user_profile_id', p.id, 'access_level', p_access_level));
  return g.id;
end $$;

create function revoke_fms_flow_access_with_audit(p_grant_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); g fms_flow_access_grants; v_flow uuid;
begin
  perform assert_module_enabled('fms_builder');
  select * into g from fms_flow_access_grants where id = p_grant_id and tenant_id = a.tenant_id and revoked_at is null for update;
  if g.id is null then raise exception 'Access not found' using errcode = 'P0002'; end if;
  select f.id into v_flow from fms_flows f where f.family_id = g.family_id and f.tenant_id = g.tenant_id
   order by (f.status = 'published') desc, f.version desc limit 1;
  if a.id is null or not current_profile_is_active() or v_flow is null or not can_manage_fms_flow(v_flow) then
    raise exception 'FMS builder access denied' using errcode = '42501';
  end if;
  update fms_flow_access_grants set revoked_at = now(), revoked_by = a.id, revoke_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500), updated_at = now()
   where id = g.id;
  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (a.tenant_id, a.id, 'fms_flow_access_revoked', 'fms_flows', v_flow,
          jsonb_build_object('grant_id', g.id, 'family_id', g.family_id, 'user_profile_id', g.user_profile_id, 'access_level', g.access_level),
          jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)));
end $$;

-- The signed-in person's own workflow grants, so the FMS list can offer
-- View / Edit / Publish on exactly those workflows. Informational only.
create function list_my_fms_flow_access()
returns table (family_id uuid, access_level text)
language sql stable security definer set search_path = public as $$
  select g.family_id, g.access_level from fms_flow_access_grants g
  where g.user_profile_id = (select (current_profile()).id) and g.revoked_at is null
    and g.tenant_id = (select current_tenant_id()) and (select current_profile_is_active()) and has_permission('fms.view');
$$;

revoke all on function fms_my_flow_access(uuid), can_edit_fms_flow(uuid), can_publish_fms_flow(uuid),
  list_fms_flow_access(uuid), grant_fms_flow_access_with_audit(uuid, uuid, text),
  revoke_fms_flow_access_with_audit(uuid, text), list_my_fms_flow_access() from public, anon;
grant execute on function fms_my_flow_access(uuid), can_edit_fms_flow(uuid), can_publish_fms_flow(uuid),
  list_fms_flow_access(uuid), grant_fms_flow_access_with_audit(uuid, uuid, text),
  revoke_fms_flow_access_with_audit(uuid, text), list_my_fms_flow_access() to authenticated;

drop function pg_temp.fms_access_patch(text, text, text, integer);
notify pgrst, 'reload schema';
