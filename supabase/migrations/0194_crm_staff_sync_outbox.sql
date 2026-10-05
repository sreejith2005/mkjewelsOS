-- CRM roster sync, JewelOS side: an outbox of staff access changes for the CRM project.
-- Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
-- ("Roster sync", "Sync mechanism"); plan: docs/superpowers/plans/2026-10-05-crm-two-project-completion.md.
--
-- JewelOS Users is the only source of truth for who may use the CRM. Every change that can
-- alter a person's CRM access enqueues one `staff.access_changed` event IN THE SAME
-- TRANSACTION as the change (triggers), so no writer can skip it: the Users page RPCs,
-- invite/delete functions, roster reconciliation and imports alike.
--
-- Events carry no payload. The delivery worker (Edge Function crm-staff-sync, service_role)
-- claims due events and receives a snapshot of the person computed at claim time, so the CRM
-- project always gets the current state, never a stale one:
-- - at most one open event per person; a further change only bumps changed_at;
-- - a change that lands while an event is in flight keeps that event open (sent again).
-- Failures back off exponentially; after 10 attempts an event is dead and audited, and shows
-- in crm_sync_health(). Nothing here sends customer data: a snapshot is the staff member's
-- id, name, login email, role and branch.

set search_path = public, extensions;

create schema crm_sync;
revoke all on schema crm_sync from public;

create table crm_sync.outbox (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('staff.access_changed')),
  aggregate_id uuid not null,
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  dead_at timestamptz,
  last_error text check (char_length(last_error) <= 200)
);
comment on table crm_sync.outbox is
  'CRM roster sync outbox (0194). One open event per person; delivered as a snapshot computed at claim time.';

create unique index crm_sync_outbox_one_open on crm_sync.outbox (event_type, aggregate_id)
  where delivered_at is null and dead_at is null;
create index crm_sync_outbox_due on crm_sync.outbox (next_attempt_at, id)
  where delivered_at is null and dead_at is null;

revoke all on table crm_sync.outbox from public, anon, authenticated, service_role;

create function crm_sync.enqueue_staff(p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into crm_sync.outbox (event_type, aggregate_id)
  values ('staff.access_changed', p_profile_id)
  on conflict (event_type, aggregate_id) where delivered_at is null and dead_at is null
  do update set changed_at = clock_timestamp(),
    next_attempt_at = least(crm_sync.outbox.next_attempt_at, now());
$$;

-- ---------------------------------------------------------------------------
-- Triggers: every change that can alter CRM access
-- ---------------------------------------------------------------------------

create function crm_sync.user_profiles_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform crm_sync.enqueue_staff(old.id);
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.employee_name, new.email, new.user_role, new.branch_id, new.account_status,
          new.working_status, new.is_login_enabled, new.designation_id, new.tenant_id)
         is not distinct from
         (old.employee_name, old.email, old.user_role, old.branch_id, old.account_status,
          old.working_status, old.is_login_enabled, old.designation_id, old.tenant_id) then
    return null;
  end if;
  perform crm_sync.enqueue_staff(new.id);
  return null;
end
$$;

create trigger crm_sync_staff_changed
after insert or update or delete on public.user_profiles
for each row execute function crm_sync.user_profiles_changed();

create function crm_sync.user_access_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- user_permission_overrides: only crm.view matters. user_access_profiles: the dashboard
  -- authority is the effective role, so any change matters.
  if tg_table_name = 'user_permission_overrides' then
    if tg_op <> 'INSERT' and old.permission_key = 'crm.view' then perform crm_sync.enqueue_staff(old.user_profile_id); end if;
    if tg_op <> 'DELETE' and new.permission_key = 'crm.view' then perform crm_sync.enqueue_staff(new.user_profile_id); end if;
  else
    if tg_op <> 'INSERT' then perform crm_sync.enqueue_staff(old.user_profile_id); end if;
    if tg_op <> 'DELETE' then perform crm_sync.enqueue_staff(new.user_profile_id); end if;
  end if;
  return null;
end
$$;

create trigger crm_sync_staff_permission_changed
after insert or update or delete on public.user_permission_overrides
for each row execute function crm_sync.user_access_changed();

create trigger crm_sync_staff_authority_changed
after insert or update or delete on public.user_access_profiles
for each row execute function crm_sync.user_access_changed();

create function crm_sync.enqueue_crm_view_rule(p_table text, p_rule jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Role and designation rules for crm.view affect many people: enqueue each one affected.
  if p_rule ->> 'permission_key' is distinct from 'crm.view' then
    return;
  end if;
  if p_table = 'role_permissions' then
    perform crm_sync.enqueue_staff(profile.id)
    from public.user_profiles as profile
    left join public.user_access_profiles as access on access.user_profile_id = profile.id
    where profile.tenant_id = (p_rule ->> 'tenant_id')::uuid
      and coalesce(access.dashboard_authority, profile.user_role)::text = p_rule ->> 'user_role';
  else
    perform crm_sync.enqueue_staff(profile.id)
    from public.user_profiles as profile
    where profile.tenant_id = (p_rule ->> 'tenant_id')::uuid
      and profile.designation_id = (p_rule ->> 'designation_id')::uuid;
  end if;
end
$$;

create function crm_sync.crm_view_rule_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then perform crm_sync.enqueue_crm_view_rule(tg_table_name, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then perform crm_sync.enqueue_crm_view_rule(tg_table_name, to_jsonb(new)); end if;
  return null;
end
$$;

create trigger crm_sync_role_rule_changed
after insert or update or delete on public.role_permissions
for each row execute function crm_sync.crm_view_rule_changed();

create trigger crm_sync_designation_rule_changed
after insert or update or delete on public.designation_permission_overrides
for each row execute function crm_sync.crm_view_rule_changed();

-- ---------------------------------------------------------------------------
-- Snapshot of one person's CRM access, as JewelOS decides it now
-- ---------------------------------------------------------------------------

-- Role map (unchanged from 0184): super_admin/admin -> super_admin, manager ->
-- branch_manager, crm/staff -> salesperson, any other role -> no CRM access. The effective
-- role applies the dashboard authority, as permission_effective_for() does.
-- eligible = login enabled, not resigned, account active, a mapped role and crm.view.
-- The tenant's CRM section switch is not part of it: the login bridge checks it at every
-- sign-in, and switching the section off must not wipe the roster.
create function crm_sync.staff_snapshot(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile user_profiles;
  v_role user_role;
  v_crm_role text;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('jewelos_user_id', p_profile_id, 'present', false, 'eligible', false,
      'snapshot_at', clock_timestamp());
  end if;
  select coalesce((select a.dashboard_authority from user_access_profiles a where a.user_profile_id = v_profile.id),
    v_profile.user_role) into v_role;
  v_crm_role := case v_role
    when 'super_admin' then 'super_admin'
    when 'admin' then 'super_admin'
    when 'manager' then 'branch_manager'
    when 'crm' then 'salesperson'
    when 'staff' then 'salesperson'
  end;
  return jsonb_build_object(
    'jewelos_user_id', v_profile.id,
    'present', true,
    'tenant_id', v_profile.tenant_id,
    'name', btrim(v_profile.employee_name),
    'email', lower(btrim(v_profile.email)),
    'jewelos_role', v_role,
    'crm_role', v_crm_role,
    'jewelos_branch_id', v_profile.branch_id,
    'eligible', coalesce(v_profile.is_login_enabled, false)
      and v_profile.working_status <> 'resigned'
      and v_profile.account_status = 'active'
      and v_crm_role is not null
      and permission_effective_for(v_profile.id, 'crm.view'),
    'snapshot_at', clock_timestamp()
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Delivery worker contract (service_role only)
-- ---------------------------------------------------------------------------

create function public.crm_sync_claim_staff_events(p_limit integer default 50)
returns table (event_id bigint, event_type text, aggregate_id uuid, snapshot jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  with due as (
    select o.id from crm_sync.outbox o
    where o.delivered_at is null and o.dead_at is null and o.next_attempt_at <= now()
    order by o.next_attempt_at, o.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), claimed as (
    -- The lease: an event a crashed worker never finishes becomes due again in 5 minutes.
    update crm_sync.outbox o
    set claimed_at = clock_timestamp(), attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
    from due where o.id = due.id
    returning o.id, o.event_type, o.aggregate_id
  )
  select claimed.id, claimed.event_type, claimed.aggregate_id, crm_sync.staff_snapshot(claimed.aggregate_id)
  from claimed order by claimed.id;
end
$$;

-- p_error is a short error code from the worker (never a response body): anything else is
-- stored as 'error'. Result: delivered | requeued | retry | dead | ignored.
create function public.crm_sync_finish_staff_event(p_event_id bigint, p_ok boolean, p_error text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event crm_sync.outbox;
  v_error text := case when p_error ~ '^[a-z0-9_.:-]{1,80}$' then p_error else 'error' end;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_event from crm_sync.outbox where id = p_event_id for update;
  if v_event.id is null or v_event.delivered_at is not null or v_event.dead_at is not null or v_event.claimed_at is null then
    return 'ignored';
  end if;
  if p_ok then
    if v_event.changed_at > v_event.claimed_at then
      -- Changed while in flight: the delivered snapshot may be stale, so send again now.
      update crm_sync.outbox set attempts = 0, next_attempt_at = now(), last_error = null where id = v_event.id;
      return 'requeued';
    end if;
    update crm_sync.outbox set delivered_at = now(), last_error = null where id = v_event.id;
    return 'delivered';
  end if;
  if v_event.attempts >= 10 then
    update crm_sync.outbox set dead_at = now(), last_error = v_error where id = v_event.id;
    insert into audit_logs (tenant_id, action, module, record_id, new_value)
    select profile.tenant_id, 'crm_sync.event_dead', 'crm', v_event.aggregate_id,
      jsonb_build_object('event_id', v_event.id, 'event_type', v_event.event_type, 'attempts', v_event.attempts, 'error', v_error)
    from (select (select tenant_id from user_profiles where id = v_event.aggregate_id) as tenant_id) as profile;
    return 'dead';
  end if;
  update crm_sync.outbox
  set next_attempt_at = now() + least(interval '1 minute' * power(2, greatest(v_event.attempts - 1, 0)), interval '6 hours'),
      last_error = v_error
  where id = v_event.id;
  return 'retry';
end
$$;

-- Full roster for the daily reconciliation: one snapshot per JewelOS profile.
create function public.crm_sync_staff_roster()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(crm_sync.staff_snapshot(profile.id) order by profile.id) from user_profiles profile), '[]'::jsonb);
end
$$;

-- Sync health for active super admins and admins (counts only).
create function public.crm_sync_health()
returns table (open_events integer, failing_events integer, dead_events integer,
  oldest_open_at timestamptz, last_delivered_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(current_profile_is_active() and current_role_level() in ('super_admin', 'admin'), false) then
    raise exception 'Only an active super admin or admin can read sync health' using errcode = '42501';
  end if;
  return query
  select
    (count(*) filter (where o.delivered_at is null and o.dead_at is null))::integer,
    (count(*) filter (where o.delivered_at is null and o.dead_at is null and o.last_error is not null))::integer,
    (count(*) filter (where o.dead_at is not null))::integer,
    min(o.created_at) filter (where o.delivered_at is null and o.dead_at is null),
    max(o.delivered_at)
  from crm_sync.outbox o;
end
$$;

revoke all on function crm_sync.enqueue_staff(uuid), crm_sync.user_profiles_changed(),
  crm_sync.user_access_changed(), crm_sync.enqueue_crm_view_rule(text, jsonb), crm_sync.crm_view_rule_changed(),
  crm_sync.staff_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.crm_sync_claim_staff_events(integer), public.crm_sync_finish_staff_event(bigint, boolean, text),
  public.crm_sync_staff_roster(), public.crm_sync_health()
  from public, anon, authenticated, service_role;
grant execute on function public.crm_sync_claim_staff_events(integer), public.crm_sync_finish_staff_event(bigint, boolean, text),
  public.crm_sync_staff_roster() to service_role;
grant execute on function public.crm_sync_health() to authenticated;

-- Seed: every existing profile is sent once, so the first delivery provisions the roster.
insert into crm_sync.outbox (event_type, aggregate_id)
select 'staff.access_changed', profile.id from public.user_profiles profile
on conflict do nothing;
