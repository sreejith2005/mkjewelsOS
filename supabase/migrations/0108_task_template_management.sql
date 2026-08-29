-- Task Templates / Management.
--
-- Adds the administrator-facing Task Templates directory: one authorized read
-- contract that returns every task template in the tenant with its owner,
-- department, schedule, evidence rule and origin, plus the narrow audited
-- write contracts the directory needs (schedule a start date, delete a
-- template without destroying completed work).
--
-- Historical work is never destroyed. Deleting a template removes only the
-- occurrences that have not been worked on (pending / in progress / overdue /
-- blocked); completed, in-review and rejected occurrences are preserved and the
-- template is archived instead of dropped when any of them remain.

set search_path = public, extensions;

-- 1. Section maintenance contract must know the new route ------------------

create or replace function default_section_availability()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'home', true, 'dashboard', true, 'crm', true, 'checklist_tasks', true,
    'recurring_todo', true, 'task_templates', true, 'delegation_tasks', true,
    'fms_tasks', true, 'fms_builder', true, 'forms_library', true,
    'meeting_ai', true, 'notifications', true, 'users', true,
    'availability', true, 'reports', true, 'dropdown_master', true,
    'settings', true
  );
$$;

create or replace function validated_section_availability(p_availability jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_key text;
begin
  perform assert_json_keys(p_availability, array[
    'home','dashboard','crm','checklist_tasks','recurring_todo','task_templates',
    'delegation_tasks','fms_tasks','fms_builder','forms_library','meeting_ai',
    'notifications','users','availability','reports','dropdown_master','settings'
  ], 'section availability');

  for v_key in select jsonb_object_keys(p_availability) loop
    if jsonb_typeof(p_availability -> v_key) <> 'boolean' then
      raise exception 'Section availability values must be boolean' using errcode = '22023';
    end if;
  end loop;

  return default_section_availability() || p_availability;
end $$;

alter function default_section_availability() owner to postgres;
alter function validated_section_availability(jsonb) owner to postgres;

-- 2. Directory read contract ------------------------------------------------

create or replace function public.get_task_template_directory(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor public.user_profiles; v_search text; v_rows jsonb;
begin
  select * into v_actor from public.user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not public.current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin') then
    raise exception 'Task template directory access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_filter,'{}'::jsonb)) <> 'object' then
    raise exception 'Task template filter is invalid' using errcode = '22023';
  end if;
  v_search := lower(btrim(coalesce(p_filter->>'search','')));

  select coalesce(jsonb_agg(listing.entry order by listing.entry->>'assignee_name', listing.entry->>'title'),'[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'description', t.description,
      'assignee_user_id', t.default_assignee_user_id,
      'assignee_name', coalesce(u.employee_name,''),
      'assignee_type', t.default_assignee_type,
      'department_id', t.department_id,
      'department_name', coalesce(d.name,''),
      'branch_id', t.branch_id,
      'branch_name', coalesce(b.name,''),
      'task_type', t.task_type,
      'schedule_kind', t.schedule_kind,
      'recurrence_rule', t.recurrence_rule,
      'starts_on', t.starts_on,
      'planned_time', t.planned_time,
      'due_time', t.due_time,
      'priority', t.priority,
      'requires_upload', coalesce(t.requires_upload,false),
      'requires_form', coalesce(t.requires_form,false),
      'verification_required', t.verification_required,
      'followup_enabled', t.followup_enabled,
      'buddy_assignment_allowed', t.buddy_assignment_allowed,
      'is_active', coalesce(t.is_active,false),
      'assignment_status', t.assignment_status,
      'schedule_status', case
        when t.assignment_status = 'assigning_left' then 'assigning_left'
        when t.schedule_kind <> 'as_required' and t.starts_on is null then 'needs_start_date'
        when coalesce(t.is_active,false) then 'ready'
        else 'paused' end,
      'source', case when exists(
          select 1 from public.task_import_items i where i.task_template_id = t.id
          union all
          select 1 from public.task_import_row_registry r where r.task_template_id = t.id
        ) then 'bulk_import' else 'web_app' end,
      'checklist_count', case when jsonb_typeof(t.checklist_items) = 'array'
        then jsonb_array_length(t.checklist_items) else 0 end,
      'open_instance_count', (
        select count(*) from public.task_instances ti
        where ti.task_template_id = t.id
          and ti.status in ('pending','in_progress','overdue','blocked')),
      'preserved_instance_count', (
        select count(*) from public.task_instances ti
        where ti.task_template_id = t.id
          and ti.status in ('completed','in_review','rejected')),
      'created_at', t.created_at,
      'updated_at', t.updated_at
    ) as entry
    from public.task_templates t
    left join public.user_profiles u on u.id = t.default_assignee_user_id
    left join public.departments d on d.id = t.department_id
    left join public.branches b on b.id = t.branch_id
    where t.tenant_id = v_actor.tenant_id
      and t.task_type in ('checklist','delegation')
      and (v_search = '' or lower(
            coalesce(t.title,'') || ' ' || coalesce(t.description,'') || ' ' ||
            coalesce(u.employee_name,'') || ' ' || coalesce(d.name,'')
          ) like '%' || v_search || '%')
  ) listing;

  return jsonb_build_object('templates', v_rows);
end;
$$;

-- 3. Schedule a start date --------------------------------------------------

create or replace function public.set_task_template_schedule_with_audit(p_template_id uuid, p_starts_on date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor public.user_profiles; v_old public.task_templates; v_new public.task_templates;
begin
  select * into v_actor from public.user_profiles where auth_user_id = auth.uid();
  select * into v_old from public.task_templates where id = p_template_id for update;
  if v_actor.id is null or not public.current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin')
     or v_old.id is null or v_old.tenant_id <> v_actor.tenant_id then
    raise exception 'Task template scheduling denied' using errcode = '42501';
  end if;
  if p_starts_on is null then
    raise exception 'A task start date is required' using errcode = '22023';
  end if;

  update public.task_templates set
    starts_on = p_starts_on,
    is_active = case
      when v_old.schedule_kind = 'as_required' then false
      when v_old.assignment_status = 'assigning_left' then coalesce(v_old.is_active,false)
      else true end,
    updated_by = v_actor.id,
    updated_at = now()
  where id = p_template_id
  returning * into v_new;

  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_template_schedule_updated','task_templates',p_template_id,
    to_jsonb(v_old), to_jsonb(v_new));

  return jsonb_build_object('template_id',p_template_id,'starts_on',p_starts_on,'is_active',coalesce(v_new.is_active,false));
end;
$$;

-- 4. Activation guard: a dated schedule cannot go live without a start date --

create or replace function public.set_recurring_todo_template_active_with_audit(p_template_id uuid,p_active boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old task_templates; v_new task_templates;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_old from task_templates where id=p_template_id for update;
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager')
     or v_old.id is null or v_old.tenant_id<>v_actor.tenant_id
     or (v_actor.user_role='manager' and v_old.branch_id is distinct from v_actor.branch_id) then
    raise exception 'Recurring schedule activation denied' using errcode='42501';
  end if;
  if v_old.schedule_kind='as_required' and p_active then
    raise exception 'As-required schedules are run manually and cannot be activated' using errcode='23514';
  end if;
  if p_active and v_old.schedule_kind<>'as_required' and v_old.starts_on is null then
    raise exception 'Set the task start date before activating this schedule' using errcode='23514';
  end if;
  update task_templates set is_active=p_active,updated_by=v_actor.id,updated_at=now()
    where id=p_template_id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,case when p_active then 'recurring_todo_activated' else 'recurring_todo_paused' end,
    'recurring_todo',p_template_id,to_jsonb(v_old),to_jsonb(v_new));
  return p_active;
end;
$$;

-- 5. Persist the scheduled start time and the due time separately -----------
--
-- The template editor collects a scheduled start time and a due time, but the
-- save contract only ever forwarded one of them, so web-authored schedules had
-- `due_time` null and the Task Templates directory could not show a real
-- deadline. `task_instances_apply_template_deadline` (0100) already expects
-- `task_templates.due_time`, so the value only had to reach the column.
-- `save_task_template_with_audit` keeps its strict field allowlist; the
-- recurring wrapper strips `due_time` before delegating and applies it itself,
-- exactly as it already does for schedule_kind and the other recurring fields.

create or replace function public.save_recurring_todo_template_with_audit(p_template_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_actor user_profiles; v_old task_templates; v_new task_templates;
  v_base jsonb; v_kind text; v_starts_on date; v_task_type task_type; v_due_time time;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Recurring schedule management denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload)<>'object' then raise exception 'Recurring schedule payload is invalid' using errcode='22023'; end if;
  v_task_type:=coalesce(nullif(p_payload->>'task_type','')::task_type,'checklist');
  if v_task_type not in ('checklist','delegation') then raise exception 'Recurring task type is unsupported' using errcode='22023'; end if;
  v_kind:=coalesce(nullif(p_payload->>'schedule_kind',''),'recurring');
  if v_kind not in ('recurring','daily','weekly','monthly','nth_weekday','quarterly','yearly','one_time','as_required') then raise exception 'Schedule kind is unsupported' using errcode='22023'; end if;
  v_starts_on:=coalesce(nullif(p_payload->>'starts_on','')::date,case when p_template_id is null then (now() at time zone 'Asia/Kolkata')::date else null end);
  if p_template_id is not null then
    select * into v_old from task_templates where id=p_template_id for update;
    if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or (v_actor.user_role='manager' and v_old.branch_id is distinct from v_actor.branch_id) then raise exception 'Recurring schedule not found' using errcode='42501'; end if;
    -- task_templates_due_after_start compares the stored due time against the
    -- incoming start time, so shifting a schedule later in one save would trip
    -- it inside the delegate. Release the deadline here and restore it below
    -- once the new start time is in place.
    update task_templates set task_type='checklist', due_time=null where id=p_template_id;
  end if;
  v_due_time:=case when p_payload ? 'due_time' then nullif(p_payload->>'due_time','')::time else v_old.due_time end;
  v_base:=p_payload-array['schedule_kind','starts_on','verification_required','followup_enabled','personal_performance_enabled','task_type','buddy_assignment_allowed','due_time'];
  v_base:=v_base||jsonb_build_object('requires_upload',v_task_type='delegation','checklist_items',case when v_task_type='delegation' then '[]'::jsonb else coalesce(p_payload->'checklist_items','[]'::jsonb) end);
  if v_kind='as_required' then
    v_base:=v_base||jsonb_build_object('is_active',false);
  elsif p_template_id is null then
    v_base:=v_base||jsonb_build_object('initial_planned_datetime',(v_starts_on::text||' '||coalesce(nullif(p_payload->>'planned_time',''),'09:00')||' Asia/Kolkata')::timestamptz);
  end if;
  v_id:=save_task_template_with_audit(p_template_id,v_base);
  update task_templates set task_type=v_task_type, buddy_assignment_allowed=coalesce((p_payload->>'buddy_assignment_allowed')::boolean,true),
    requires_upload=(v_task_type='delegation'), checklist_items=case when v_task_type='delegation' then '[]'::jsonb else checklist_items end,
    schedule_kind=v_kind,starts_on=coalesce(v_starts_on,starts_on),verification_required=coalesce((p_payload->>'verification_required')::boolean,false),
    followup_enabled=coalesce((p_payload->>'followup_enabled')::boolean,false),personal_performance_enabled=coalesce((p_payload->>'personal_performance_enabled')::boolean,true),
    due_time=v_due_time,
    updated_by=v_actor.id,updated_at=now() where id=v_id returning * into v_new;
  update task_instances set task_type=v_task_type,requires_upload=(v_task_type='delegation'),buddy_assignment_allowed=v_new.buddy_assignment_allowed,
    due_datetime=case when v_new.due_time is null then due_datetime
      else (coalesce(scheduled_date,(planned_datetime at time zone 'Asia/Kolkata')::date)::text||' '||v_new.due_time::text||' Asia/Kolkata')::timestamptz end,
    updated_by=v_actor.id,updated_at=now() where task_template_id=v_id and status='pending'
    and (planned_datetime at time zone 'Asia/Kolkata')::date=coalesce(v_starts_on,v_new.starts_on);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values
    (v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'recurring_todo_created' else 'recurring_todo_updated' end,'recurring_todo',v_id,
     case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return v_id;
end;
$$;

-- 6. Delete a template, preserving worked occurrences -----------------------

create or replace function public.delete_task_template_with_audit(p_template_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor public.user_profiles;
  v_old public.task_templates;
  v_open uuid[];
  v_removed integer := 0;
  v_preserved integer := 0;
  v_outcome text;
begin
  select * into v_actor from public.user_profiles where auth_user_id = auth.uid();
  select * into v_old from public.task_templates where id = p_template_id for update;
  if v_actor.id is null or not public.current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin')
     or v_old.id is null or v_old.tenant_id <> v_actor.tenant_id then
    raise exception 'Task template deletion denied' using errcode = '42501';
  end if;

  select coalesce(array_agg(ti.id),'{}'::uuid[]) into v_open
  from public.task_instances ti
  where ti.task_template_id = p_template_id
    and ti.status in ('pending','in_progress','overdue','blocked');

  if array_length(v_open,1) is not null then
    -- Import bookkeeping and buddy rows do not cascade; release them first so
    -- the import history stays readable after the occurrence is removed.
    update public.task_import_items set task_instance_id = null where task_instance_id = any(v_open);
    update public.task_import_row_registry set task_instance_id = null where task_instance_id = any(v_open);
    delete from public.buddy_assignments where task_instance_id = any(v_open);
    delete from public.task_instances where id = any(v_open);
    v_removed := array_length(v_open,1);
  end if;

  select count(*) into v_preserved from public.task_instances where task_template_id = p_template_id;

  if v_preserved = 0 then
    update public.task_import_items set task_template_id = null where task_template_id = p_template_id;
    update public.task_import_row_registry set task_template_id = null where task_template_id = p_template_id;
    delete from public.task_templates where id = p_template_id;
    v_outcome := 'deleted';
  else
    update public.task_templates set is_active = false, updated_by = v_actor.id, updated_at = now()
      where id = p_template_id;
    v_outcome := 'archived';
  end if;

  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_template_'||v_outcome,'task_templates',p_template_id,
    to_jsonb(v_old),
    jsonb_build_object('outcome',v_outcome,'open_instances_removed',v_removed,'instances_preserved',v_preserved));

  return jsonb_build_object('outcome',v_outcome,'open_instances_removed',v_removed,'instances_preserved',v_preserved,'title',v_old.title);
end;
$$;

-- 7. Grants ------------------------------------------------------------------

revoke all on function public.save_recurring_todo_template_with_audit(uuid,jsonb) from public,anon;
grant execute on function public.save_recurring_todo_template_with_audit(uuid,jsonb) to authenticated;
revoke all on function public.get_task_template_directory(jsonb) from public,anon;
grant execute on function public.get_task_template_directory(jsonb) to authenticated;
revoke all on function public.set_task_template_schedule_with_audit(uuid,date) from public,anon;
grant execute on function public.set_task_template_schedule_with_audit(uuid,date) to authenticated;
revoke all on function public.delete_task_template_with_audit(uuid) from public,anon;
grant execute on function public.delete_task_template_with_audit(uuid) to authenticated;
revoke all on function public.set_recurring_todo_template_active_with_audit(uuid,boolean) from public,anon;
grant execute on function public.set_recurring_todo_template_active_with_audit(uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
