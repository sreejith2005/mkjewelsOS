-- 0058_assignment_notification_triggers.sql
-- Creates triggers to insert notifications when a user is assigned a task, FMS step, or CRM follow-up.
-- TG_OP is not available in WHEN clauses; deduplication is done inside the function bodies.

set search_path = public, extensions;

-- ─── Task assignment notification ────────────────────────────────────────────

create or replace function notify_task_assignment()
returns trigger language plpgsql security definer as $$
declare
  v_title text;
  v_tenant_id uuid;
begin
  -- Only fire when the row becomes active (INSERT or reactivation via UPDATE)
  if not NEW.is_active then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.is_active = true then return NEW; end if;

  select title, tenant_id into v_title, v_tenant_id
  from task_instances where id = NEW.task_instance_id;

  insert into notifications (tenant_id, user_profile_id, event_type, title, message, link_url, channel)
  values (
    v_tenant_id,
    NEW.user_profile_id,
    'task_assigned',
    'New Task Assigned',
    'You have been assigned to task: ' || coalesce(v_title, 'Untitled Task'),
    '/tasks/checklist',
    'in_app'
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_task_assignment on task_assignees;
create trigger trg_notify_task_assignment
after insert or update on task_assignees
for each row
when (NEW.is_active = true)
execute function notify_task_assignment();


-- ─── FMS stage assignment notification ───────────────────────────────────────

create or replace function notify_fms_stage_assignment()
returns trigger language plpgsql security definer as $$
declare
  v_flow_name text;
  v_stage_name text;
begin
  -- Only fire when the row becomes active
  if not NEW.is_active then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.is_active = true then return NEW; end if;

  select ff.name, fs.name into v_flow_name, v_stage_name
  from fms_instance_stages fis
  join fms_instances fi on fi.id = fis.fms_instance_id
  join fms_flows ff on ff.id = fi.fms_flow_id
  join fms_stages fs on fs.id = fis.fms_stage_id
  where fis.id = NEW.fms_instance_stage_id;

  insert into notifications (tenant_id, user_profile_id, event_type, title, message, link_url, channel)
  values (
    NEW.tenant_id,
    NEW.user_profile_id,
    'fms_assigned',
    'FMS Step Assigned',
    'You have been assigned to ' || coalesce(v_flow_name, 'a flow') || ' - ' || coalesce(v_stage_name, 'a stage'),
    '/tasks/fms',
    'in_app'
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_fms_stage_assignment on fms_instance_stage_assignees;
create trigger trg_notify_fms_stage_assignment
after insert or update on fms_instance_stage_assignees
for each row
when (NEW.is_active = true)
execute function notify_fms_stage_assignment();


-- ─── CRM follow-up assignment notification ───────────────────────────────────

create or replace function notify_crm_followup_assignment()
returns trigger language plpgsql security definer as $$
begin
  -- Only fire for open follow-ups where assigned_to just got set
  if NEW.status <> 'open' or NEW.assigned_to is null then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.assigned_to = NEW.assigned_to then return NEW; end if;

  insert into notifications (tenant_id, user_profile_id, event_type, title, message, link_url, channel)
  values (
    NEW.tenant_id,
    NEW.assigned_to,
    'crm_followup_assigned',
    'CRM Follow-up Assigned',
    'You have been assigned a CRM follow-up: ' || coalesce(NEW.subject, 'Follow-up'),
    '/crm',
    'in_app'
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_crm_followup_assignment on client_followups;
create trigger trg_notify_crm_followup_assignment
after insert or update on client_followups
for each row
when (NEW.status = 'open' and NEW.assigned_to is not null)
execute function notify_crm_followup_assignment();
