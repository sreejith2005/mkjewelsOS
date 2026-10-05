-- CRM walk-in -> JewelOS task (approved extension, 2026-10-01).
-- Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
-- ("Event catalog": walkin.registered, walkin.form_completed).
--
-- The CRM project sends one snapshot per walk-in queue entry (Edge Function sync-deliver ->
-- crm-sync-receive here -> crm_sync_apply_walkin as service_role):
-- - registered, not completed: create the delegation task "Complete walk-in form - {name}
--   ({MKC})" for the queue's salesperson (JewelOS profile resolved by the CRM roster). If the
--   salesperson does not resolve, it goes to the branch manager and the task says so. If
--   nobody resolves, no task is created and the outcome is recorded (sync health);
-- - completed (the walk-in form was submitted in the CRM): close the task. Completion comes
--   from durable CRM state, never from a client.
-- The task is keyed by source = 'crm_walkin' and source_ref_id = the CRM queue id. Applying is
-- idempotent (inbox by event id) and ordered (an older snapshot never overwrites a newer one).
-- Task creation goes through task_assignees, so the existing assignment alert and realtime
-- triggers fire as for any delegation task; closing fires the completion triggers.
-- The snapshot carries no phone or address: the client's display name and MKC only.

set search_path = public, extensions;

create table crm_sync.inbox (
  event_id text primary key check (event_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  event_type text not null,
  aggregate_id uuid,
  result jsonb not null,
  received_at timestamptz not null default now()
);
create index crm_sync_inbox_received_at on crm_sync.inbox (received_at desc);

create table crm_sync.walkin_state (
  queue_id uuid primary key,
  snapshot_at timestamptz not null,
  outcome text not null,
  task_id uuid references public.task_instances (id),
  applied_at timestamptz not null default now()
);
revoke all on crm_sync.inbox, crm_sync.walkin_state from public, anon, authenticated, service_role;

create index idx_task_instances_crm_walkin on public.task_instances (source_ref_id) where source = 'crm_walkin';

-- An active JewelOS person who can do work in the tenant of this snapshot.
create function crm_sync.walkin_doer(p_profile_id uuid)
returns public.user_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.user_profiles p
  where p.id = p_profile_id
    and p.account_status = 'active'
    and p.working_status <> 'resigned'
    and coalesce(p.is_login_enabled, false);
$$;

create function public.crm_sync_apply_walkin(p_event_id text, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior jsonb;
  v_queue uuid;
  v_at timestamptz;
  v_state crm_sync.walkin_state;
  v_task task_instances;
  v_new task_instances;
  v_doer user_profiles;
  v_flagged boolean := false;
  v_manager uuid;
  v_branch uuid;
  v_title text;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_.:-]{1,160}$' or jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'invalid sync event' using errcode = '22023';
  end if;
  begin
    v_queue := (p_snapshot ->> 'queue_id')::uuid;
    v_at := (p_snapshot ->> 'snapshot_at')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid sync event' using errcode = '22023';
  end;
  if v_queue is null or v_at is null then
    raise exception 'invalid sync event' using errcode = '22023';
  end if;

  select i.result into v_prior from crm_sync.inbox i where i.event_id = p_event_id;
  if found then
    return v_prior || jsonb_build_object('duplicate', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('crm_sync.walkin:' || v_queue::text, 0));
  select * into v_state from crm_sync.walkin_state where queue_id = v_queue for update;
  if v_state.queue_id is not null and v_state.snapshot_at >= v_at then
    v_result := jsonb_build_object('outcome', 'stale', 'task_id', v_state.task_id);
  else
    select * into v_task from task_instances
    where source = 'crm_walkin' and source_ref_id = v_queue
    order by created_at limit 1
    for update;

    if coalesce((p_snapshot ->> 'completed')::boolean, false) or not coalesce((p_snapshot ->> 'present')::boolean, false) then
      -- The walk-in form was submitted (or the queue entry is gone): close the task.
      if v_task.id is null then
        v_result := jsonb_build_object('outcome', 'no_task');
      elsif v_task.status in ('completed', 'rejected') then
        v_result := jsonb_build_object('outcome', 'already_closed', 'task_id', v_task.id);
      else
        update task_instances
        set status = 'completed', actual_datetime = now(), updated_at = now(),
            updated_by = coalesce((select a.user_profile_id from task_assignees a where a.task_instance_id = v_task.id and a.is_active and a.role_at_task = 'doer' order by a.id limit 1), v_task.created_by)
        where id = v_task.id returning * into v_new;
        update task_assignees set completed_at = now() where task_instance_id = v_task.id and is_active and completed_at is null;
        insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
        values (v_task.tenant_id, null, 'crm_walkin_task_completed', 'tasks', v_task.id,
          jsonb_build_object('status', v_task.status),
          jsonb_build_object('status', v_new.status, 'crm_queue_id', v_queue, 'event_id', p_event_id));
        v_result := jsonb_build_object('outcome', 'completed', 'task_id', v_task.id);
      end if;
    elsif v_task.id is not null then
      v_result := jsonb_build_object('outcome', 'already_created', 'task_id', v_task.id);
    else
      -- Registered: create the task for the resolved salesperson, else a branch manager.
      v_doer := crm_sync.walkin_doer(nullif(p_snapshot ->> 'assignee_jewelos_user_id', '')::uuid);
      if v_doer.id is null then
        for v_manager in select value::uuid from jsonb_array_elements_text(coalesce(p_snapshot -> 'manager_jewelos_user_ids', '[]'::jsonb)) loop
          v_doer := crm_sync.walkin_doer(v_manager);
          exit when v_doer.id is not null;
        end loop;
        v_flagged := true;
      end if;
      if v_doer.id is null then
        v_result := jsonb_build_object('outcome', 'unassigned');
      else
        v_branch := coalesce(
          (select b.id from branches b where b.id = nullif(p_snapshot ->> 'jewelos_branch_id', '')::uuid and b.tenant_id = v_doer.tenant_id),
          v_doer.branch_id);
        v_title := left('Complete walk-in form - ' || coalesce(nullif(btrim(p_snapshot ->> 'client_name'), ''), 'Walk-in client')
          || coalesce(' (' || nullif(p_snapshot ->> 'client_code', '') || ')', ''), 200);
        insert into task_instances (
          tenant_id, branch_id, department_id, task_type, title, description, priority,
          planned_datetime, source, source_ref_id, created_by, updated_by
        ) values (
          v_doer.tenant_id, v_branch, v_doer.department_id, 'delegation', v_title,
          'Created by the CRM walk-in queue (token ' || coalesce(p_snapshot ->> 'token', '-') || '). '
            || 'It closes by itself when the walk-in form is submitted in the CRM.'
            || case when v_flagged then ' The queue salesperson could not be matched to a JewelOS user, so it was assigned to the branch manager.' else '' end,
          'high', now(), 'crm_walkin', v_queue, v_doer.id, v_doer.id
        ) returning * into v_new;
        insert into task_assignees (task_instance_id, user_profile_id, role_at_task, is_original, is_active)
        values (v_new.id, v_doer.id, 'doer', true, true);
        insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
        values (v_doer.tenant_id, null, 'crm_walkin_task_created', 'tasks', v_new.id,
          jsonb_build_object('crm_queue_id', v_queue, 'doer_id', v_doer.id, 'flagged', v_flagged, 'event_id', p_event_id));
        v_result := jsonb_build_object('outcome', case when v_flagged then 'created_for_manager' else 'created' end, 'task_id', v_new.id);
      end if;
    end if;

    insert into crm_sync.walkin_state as s (queue_id, snapshot_at, outcome, task_id, applied_at)
    values (v_queue, v_at, v_result ->> 'outcome', (v_result ->> 'task_id')::uuid, now())
    on conflict (queue_id) do update
      set snapshot_at = excluded.snapshot_at, outcome = excluded.outcome,
          task_id = coalesce(excluded.task_id, s.task_id), applied_at = excluded.applied_at;
  end if;

  insert into crm_sync.inbox (event_id, event_type, aggregate_id, result)
  values (p_event_id, 'walkin.changed', v_queue, v_result);
  return v_result;
end
$$;

-- Sync health gains the inbound side (counts only).
drop function public.crm_sync_health();
create function public.crm_sync_health()
returns table (open_events integer, failing_events integer, dead_events integer,
  oldest_open_at timestamptz, last_delivered_at timestamptz,
  walkin_events_7d jsonb, last_walkin_event_at timestamptz)
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
    max(o.delivered_at),
    coalesce((select jsonb_object_agg(t.k, t.n) from (
      select i.result ->> 'outcome' as k, count(*) as n from crm_sync.inbox i
      where i.event_type = 'walkin.changed' and i.received_at > now() - interval '7 days' group by 1) t), '{}'::jsonb),
    (select max(i.received_at) from crm_sync.inbox i where i.event_type = 'walkin.changed')
  from crm_sync.outbox o;
end
$$;

revoke all on function crm_sync.walkin_doer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_sync_apply_walkin(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.crm_sync_apply_walkin(text, jsonb) to service_role;
revoke all on function public.crm_sync_health() from public, anon, service_role;
grant execute on function public.crm_sync_health() to authenticated;
