-- Original CRM identity bridge (owner decision 2026-09-25).
-- Design: docs/superpowers/specs/2026-09-25-crm-native-integration-design.md
--
-- JewelOS login is the only login. A request reaches CRM data only when the signed-in
-- JewelOS profile is active, holds crm.view, the crm section is available, its role
-- maps to a CRM role, and an administrator has linked it to a historical crm.users row
-- (crm.users ids stay unchanged because CRM history references them). Everything else
-- fails closed: current_user_role() is NULL, which every original CRM policy and RPC
-- already treats as "no access".
--
-- CRM role is derived from the JewelOS effective role (current_profile(), so dashboard
-- authority applies), with the map from sreejith-crm/web-app/lib/sso/access.ts:
--   super_admin, admin -> super_admin; manager -> branch_manager; crm, staff -> salesperson;
--   every other role -> no CRM access.
-- The CRM branch of a non-super-admin is the crm.branches row linked to the profile's
-- JewelOS branch; without one there is no access.
--
-- There is no automatic linking by name or email. Links change only through the audited
-- admin RPCs below.

-- ---------------------------------------------------------------------------
-- 1. Link columns
-- ---------------------------------------------------------------------------

alter table crm.users add column jewelos_profile_id uuid;
alter table crm.users
  add constraint users_jewelos_profile_id_key unique (jewelos_profile_id),
  add constraint users_jewelos_profile_id_fkey foreign key (jewelos_profile_id)
    references public.user_profiles(id) on delete set null;
comment on column crm.users.jewelos_profile_id is
  'JewelOS profile that acts as this historical CRM user. Set only by crm.link_jewelos_profile.';

alter table crm.branches add column jewelos_branch_id uuid;
alter table crm.branches
  add constraint branches_jewelos_branch_id_key unique (jewelos_branch_id),
  add constraint branches_jewelos_branch_id_fkey foreign key (jewelos_branch_id)
    references public.branches(id) on delete set null;
comment on column crm.branches.jewelos_branch_id is
  'JewelOS branch whose staff work in this CRM branch. Set only by crm.link_jewelos_branch.';

-- ---------------------------------------------------------------------------
-- 2. Private helpers (schema not exposed to the Data API)
-- ---------------------------------------------------------------------------

create schema crm_private;
comment on schema crm_private is
  'Internal helpers for schema crm. Never add this schema to the exposed API schemas.';
revoke all on schema crm_private from public, anon;
grant usage on schema crm_private to authenticated;

create function crm_private.jewelos_role_to_crm_role(p_role public.user_role)
returns crm.user_role
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'super_admin' then 'super_admin'::crm.user_role
    when 'admin' then 'super_admin'::crm.user_role
    when 'manager' then 'branch_manager'::crm.user_role
    when 'crm' then 'salesperson'::crm.user_role
    when 'staff' then 'salesperson'::crm.user_role
    else null
  end
$$;

create function crm_private.current_crm_identity(
  out crm_user_id uuid,
  out crm_role crm.user_role,
  out crm_branch_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.user_profiles;
  v_role crm.user_role;
begin
  -- Server-side legacy walk-in ingest only: a verified service_role JWT whose subject
  -- crm.submit_legacy_walkin_visit (SECURITY DEFINER) has set to its crm.users ingest
  -- actor, exactly as the original. A browser JWT can never carry this role.
  if auth.role() = 'service_role' then
    select u.id, u.role, u.branch_id
      into crm_user_id, crm_role, crm_branch_id
    from crm.users as u
    where u.id = auth.uid() and u.active;
    return;
  end if;

  v_profile := public.current_profile();
  if v_profile.id is null
     or not public.current_profile_is_active()
     or not public.has_permission('crm.view')
     or not public.module_accessible('crm', false) then
    return;
  end if;

  v_role := crm_private.jewelos_role_to_crm_role(v_profile.user_role);
  if v_role is null then
    return;
  end if;

  select u.id into crm_user_id
  from crm.users as u
  where u.jewelos_profile_id = v_profile.id and u.active;
  if crm_user_id is null then
    return;
  end if;

  if v_role <> 'super_admin' then
    select b.id into crm_branch_id
    from crm.branches as b
    where b.jewelos_branch_id = v_profile.branch_id;
    if crm_branch_id is null then
      crm_user_id := null;
      return;
    end if;
  end if;

  crm_role := v_role;
end
$$;

-- Additive JewelOS audit row for a CRM mutating RPC, written in the caller's
-- transaction (an exception in the RPC rolls it back with everything else).
create function crm_private.write_audit_log(p_action text, p_record_id uuid, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_profiles := public.current_profile();
  v_crm_user_id uuid := crm.current_crm_user_id();
  v_tenant_id uuid := v_profile.tenant_id;
begin
  if p_action is null or p_action !~ '^crm\.[a-z_]+$' then
    raise exception 'Invalid CRM audit action' using errcode = '22023';
  end if;
  if v_tenant_id is null then
    -- Server-side ingest has no JewelOS profile; attribute the row to the tenant of the
    -- acting CRM user's linked branch when there is one.
    select jewelos_branch.tenant_id into v_tenant_id
    from crm.users as crm_user
    join crm.branches as crm_branch on crm_branch.id = crm_user.branch_id
    join public.branches as jewelos_branch on jewelos_branch.id = crm_branch.jewelos_branch_id
    where crm_user.id = v_crm_user_id;
  end if;
  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (
    v_tenant_id, v_profile.id, p_action, 'crm', p_record_id,
    jsonb_build_object('crm_user_id', v_crm_user_id) || coalesce(p_details, '{}'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Original identity helpers, re-implemented through the bridge
--    (same names, signatures and return shapes as the original)
-- ---------------------------------------------------------------------------

create function crm.current_crm_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select identity.crm_user_id from crm_private.current_crm_identity() as identity
$$;

create function crm.current_user_role()
returns crm.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select identity.crm_role from crm_private.current_crm_identity() as identity
$$;

create function crm.current_user_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select identity.crm_branch_id from crm_private.current_crm_identity() as identity
$$;

create function crm.get_my_profile()
returns table ("name" text, "role" crm.user_role, "branch_name" text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.name::text, identity.crm_role, branch.name::text
  from crm_private.current_crm_identity() as identity
  join crm.users as profile on profile.id = identity.crm_user_id
  left join crm.branches as branch on branch.id = identity.crm_branch_id
$$;

-- ---------------------------------------------------------------------------
-- 4. Audited link administration (JewelOS super_admin / admin only)
-- ---------------------------------------------------------------------------

create function crm_private.assert_link_admin()
returns public.user_profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.user_profiles := public.current_profile();
begin
  perform public.assert_module_enabled('crm');
  if v_actor.id is null
     or not public.current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin') then
    raise exception 'Only an active super_admin or admin can manage CRM identity links'
      using errcode = '42501';
  end if;
  return v_actor;
end
$$;

create function crm.link_jewelos_profile(p_crm_user_id uuid, p_jewelos_profile_id uuid)
returns crm.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.user_profiles := crm_private.assert_link_admin();
  v_target crm.users;
  v_old_profile_id uuid;
begin
  select * into v_target from crm.users where id = p_crm_user_id for update;
  if v_target.id is null then
    raise exception 'CRM user not found' using errcode = 'P0002';
  end if;
  v_old_profile_id := v_target.jewelos_profile_id;
  if v_old_profile_id is not null and not exists (
    select 1 from public.user_profiles p where p.id = v_old_profile_id and p.tenant_id = v_actor.tenant_id
  ) then
    raise exception 'This CRM user is linked outside your organization' using errcode = '42501';
  end if;
  if p_jewelos_profile_id is not null then
    if not exists (
      select 1 from public.user_profiles p where p.id = p_jewelos_profile_id and p.tenant_id = v_actor.tenant_id
    ) then
      raise exception 'JewelOS profile not found or not accessible' using errcode = '42501';
    end if;
    if exists (
      select 1 from crm.users u where u.jewelos_profile_id = p_jewelos_profile_id and u.id <> p_crm_user_id
    ) then
      raise exception 'This JewelOS profile is already linked to another CRM user' using errcode = '23505';
    end if;
  end if;
  if v_old_profile_id is not distinct from p_jewelos_profile_id then
    return v_target;
  end if;

  update crm.users set jewelos_profile_id = p_jewelos_profile_id
  where id = p_crm_user_id
  returning * into v_target;

  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (
    v_actor.tenant_id, v_actor.id,
    case when p_jewelos_profile_id is null then 'crm.unlink_jewelos_profile' else 'crm.link_jewelos_profile' end,
    'crm', p_crm_user_id,
    jsonb_build_object('jewelos_profile_id', v_old_profile_id),
    jsonb_build_object('jewelos_profile_id', p_jewelos_profile_id, 'crm_user_name', v_target.name)
  );
  return v_target;
end
$$;

create function crm.link_jewelos_branch(p_crm_branch_id uuid, p_jewelos_branch_id uuid)
returns crm.branches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.user_profiles := crm_private.assert_link_admin();
  v_target crm.branches;
  v_old_branch_id uuid;
begin
  select * into v_target from crm.branches where id = p_crm_branch_id for update;
  if v_target.id is null then
    raise exception 'CRM branch not found' using errcode = 'P0002';
  end if;
  v_old_branch_id := v_target.jewelos_branch_id;
  if v_old_branch_id is not null and not exists (
    select 1 from public.branches b where b.id = v_old_branch_id and b.tenant_id = v_actor.tenant_id
  ) then
    raise exception 'This CRM branch is linked outside your organization' using errcode = '42501';
  end if;
  if p_jewelos_branch_id is not null then
    if not exists (
      select 1 from public.branches b where b.id = p_jewelos_branch_id and b.tenant_id = v_actor.tenant_id
    ) then
      raise exception 'JewelOS branch not found or not accessible' using errcode = '42501';
    end if;
    if exists (
      select 1 from crm.branches c where c.jewelos_branch_id = p_jewelos_branch_id and c.id <> p_crm_branch_id
    ) then
      raise exception 'This JewelOS branch is already linked to another CRM branch' using errcode = '23505';
    end if;
  end if;
  if v_old_branch_id is not distinct from p_jewelos_branch_id then
    return v_target;
  end if;

  update crm.branches set jewelos_branch_id = p_jewelos_branch_id
  where id = p_crm_branch_id
  returning * into v_target;

  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (
    v_actor.tenant_id, v_actor.id,
    case when p_jewelos_branch_id is null then 'crm.unlink_jewelos_branch' else 'crm.link_jewelos_branch' end,
    'crm', p_crm_branch_id,
    jsonb_build_object('jewelos_branch_id', v_old_branch_id),
    jsonb_build_object('jewelos_branch_id', p_jewelos_branch_id, 'crm_branch_name', v_target.name)
  );
  return v_target;
end
$$;

-- Read side of the link administration. An administrator who is not yet linked has
-- no CRM row access, so the link screen cannot read crm.users/branches directly.
create function crm.list_identity_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform crm_private.assert_link_admin();
  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'name', u.name, 'email', u.email, 'role', u.role, 'branch_id', u.branch_id,
        'active', u.active, 'jewelos_profile_id', u.jewelos_profile_id
      ) order by u.name, u.id)
      from crm.users as u
    ), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'active', b.active, 'jewelos_branch_id', b.jewelos_branch_id
      ) order by b.name, b.id)
      from crm.branches as b
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges (0184 re-applies the crm grants after its clean-slate revoke)
-- ---------------------------------------------------------------------------

revoke all on all functions in schema crm_private from public, anon, authenticated, service_role;
-- Invoker-rights CRM RPCs (create_entry_queue, submit_walkin_visit, ...) call the audit
-- writer as the signed-in user; it is unreachable through the API (schema not exposed).
grant execute on function crm_private.write_audit_log(text, uuid, jsonb) to authenticated;

revoke all on function
  crm.current_crm_user_id(), crm.current_user_role(), crm.current_user_branch_id(), crm.get_my_profile(),
  crm.link_jewelos_profile(uuid, uuid), crm.link_jewelos_branch(uuid, uuid), crm.list_identity_links()
from public, anon;
grant execute on function
  crm.current_crm_user_id(), crm.current_user_role(), crm.current_user_branch_id(), crm.get_my_profile(),
  crm.link_jewelos_profile(uuid, uuid), crm.link_jewelos_branch(uuid, uuid), crm.list_identity_links()
to authenticated;
