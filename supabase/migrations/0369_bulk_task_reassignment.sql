-- Task Control: move one person's work to someone else, one task or many at once.
-- Typical use is handing over a leaver's tasks before they are deleted.
--
-- task_reassignment_candidates lists every open task, open FMS step and recurring
-- schedule of one person (no date limit). reassign_task_work_with_audit moves an
-- explicit list of them (at most 100 per call, so the browser can show progress
-- and no call runs long). Each item is moved in its own savepoint: one item that
-- cannot move is reported back and never blocks the rest. Every move is audited.
-- The new person gets one summary notification per call instead of one per task.
set search_path = public, extensions;

-- Bulk moves send one summary notification, so the per-task assignment
-- notifications are skipped while this transaction-local flag is on.
do $quiet$
declare f text; n text; signature text;
begin
  foreach signature in array array['public.notify_task_assignment()','public.emit_task_notification_event()'] loop
    f := pg_get_functiondef(signature::regprocedure);
    n := regexp_replace(f, E'\\mbegin\\M',
      E'begin\n  if current_setting(''jewelos.bulk_task_reassignment'', true) = ''on'' then return new; end if;', 'i');
    if n = f then raise exception 'Assignment notification upgrade failed: %', signature; end if;
    execute n;
  end loop;
end $quiet$;

create or replace function task_reassignment_actor()
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare a user_profiles := current_profile();
begin
  perform assert_module_enabled('task_templates');
  if a.id is null or not current_profile_is_active() or not has_permission('tasks.view_all') then
    raise exception 'Only administrators can reassign tasks' using errcode = '42501';
  end if;
  return a;
end $$;

create or replace function task_reassignment_candidates(p_from_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles := task_reassignment_actor(); v_tasks jsonb; v_steps jsonb; v_schedules jsonb;
begin
  if not exists(select 1 from user_profiles where id = p_from_user_id and tenant_id = a.tenant_id) then
    raise exception 'Employee not found' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'task_template_id', t.task_template_id,
      'due_at', coalesce(t.revised_datetime, t.due_datetime, t.planned_datetime),
      'overdue', coalesce(t.revised_datetime, t.due_datetime, t.planned_datetime) < now())
      order by coalesce(t.revised_datetime, t.due_datetime, t.planned_datetime), t.id), '[]'::jsonb)
  into v_tasks
  from task_instances t
  where t.tenant_id = a.tenant_id and t.deleted_at is null and t.status <> 'completed' and t.task_type <> 'fms'
    and exists(select 1 from task_assignees ta where ta.task_instance_id = t.id and ta.user_profile_id = p_from_user_id
      and ta.role_at_task = 'doer' and ta.is_active);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', coalesce(fs.name, 'FMS step') || ' · ' || coalesce(i.title, i.reference_number, 'Workflow'),
      'due_at', s.planned_datetime) order by s.planned_datetime nulls last, s.id), '[]'::jsonb)
  into v_steps
  from fms_instance_stages s
  join fms_instances i on i.id = s.fms_instance_id
  left join fms_stages fs on fs.id = s.fms_stage_id
  where i.tenant_id = a.tenant_id and i.status in ('active','overdue')
    and s.status in ('pending','in_progress','in_review','overdue') and p_from_user_id = any(s.assigned_to);
  select coalesce(jsonb_agg(jsonb_build_object('id', tt.id, 'title', tt.title, 'is_active', tt.is_active) order by tt.title, tt.id), '[]'::jsonb)
  into v_schedules
  from task_templates tt
  where tt.tenant_id = a.tenant_id and tt.deleted_at is null and tt.default_assignee_user_id = p_from_user_id;
  return jsonb_build_object('tasks', v_tasks, 'fms_steps', v_steps, 'schedules', v_schedules);
end $$;

create or replace function reassign_task_work_with_audit(
  p_from_user_id uuid, p_to_user_id uuid, p_reason text,
  p_task_ids uuid[] default '{}', p_fms_stage_ids uuid[] default '{}', p_template_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a user_profiles := task_reassignment_actor(); v_from user_profiles; v_to user_profiles;
  v_task task_instances; v_template task_templates; v_id uuid; v_before jsonb; v_after jsonb; v_remaining integer;
  v_reason text := left(btrim(coalesce(p_reason, '')), 1000);
  v_moved uuid[] := '{}'; v_skipped jsonb := '[]'::jsonb; v_moved_work integer := 0; v_moved_schedules integer := 0;
begin
  if v_reason = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  if p_from_user_id = p_to_user_id then raise exception 'Choose a different person to receive the work' using errcode = '22023'; end if;
  if coalesce(cardinality(p_task_ids), 0) + coalesce(cardinality(p_fms_stage_ids), 0) + coalesce(cardinality(p_template_ids), 0) > 100 then
    raise exception 'Reassign at most 100 items at a time' using errcode = '22023';
  end if;
  select * into v_from from user_profiles where id = p_from_user_id and tenant_id = a.tenant_id;
  if v_from.id is null then raise exception 'Employee not found' using errcode = '42501'; end if;
  perform assert_task_assignment_targets(array[p_to_user_id]);
  select * into v_to from user_profiles where id = p_to_user_id;
  perform set_config('jewelos.bulk_task_reassignment', 'on', true);

  foreach v_id in array coalesce(p_task_ids, '{}') loop
    begin
      select * into v_task from task_instances where id = v_id and tenant_id = a.tenant_id for update;
      if v_task.id is null or v_task.deleted_at is not null then raise exception 'This task no longer exists'; end if;
      if v_task.task_type = 'fms' then raise exception 'FMS work moves with its FMS step'; end if;
      if v_task.status = 'completed' then raise exception 'This task is already completed'; end if;
      if not exists(select 1 from task_assignees where task_instance_id = v_id and user_profile_id = p_from_user_id and role_at_task = 'doer' and is_active) then
        raise exception '% is not assigned to this task', v_from.employee_name;
      end if;
      select coalesce(jsonb_agg(to_jsonb(ta) order by ta.id), '[]'::jsonb) into v_before from task_assignees ta where ta.task_instance_id = v_id;
      -- The new doer stops being "In Loop" on this task.
      delete from task_watchers where task_instance_id = v_id and user_profile_id = p_to_user_id;
      update task_assignees set is_active = false where task_instance_id = v_id and user_profile_id = p_from_user_id and is_active;
      if not exists(select 1 from task_assignees where task_instance_id = v_id and user_profile_id = p_to_user_id and is_active) then
        insert into task_assignees(task_instance_id, user_profile_id, role_at_task, is_original, is_active)
        values (v_id, p_to_user_id, 'doer', false, true);
      end if;
      -- A task that now belongs only to the new doer follows their branch and department.
      select count(*) into v_remaining from task_assignees where task_instance_id = v_id and is_active and user_profile_id <> p_to_user_id;
      update task_instances set
        branch_id = case when v_remaining = 0 then v_to.branch_id else branch_id end,
        department_id = case when v_remaining = 0 then v_to.department_id else department_id end,
        assignment_status = 'assigned', updated_by = a.id, updated_at = now()
      where id = v_id;
      select coalesce(jsonb_agg(to_jsonb(ta) order by ta.id), '[]'::jsonb) into v_after from task_assignees ta where ta.task_instance_id = v_id;
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
      values (a.tenant_id, a.id, 'task_doer_transferred', 'tasks', v_id, jsonb_build_object('assignments', v_before),
        jsonb_build_object('assignments', v_after, 'from_user_id', p_from_user_id, 'to_user_id', p_to_user_id, 'reason', v_reason, 'bulk', true));
      v_moved := v_moved || v_id; v_moved_work := v_moved_work + 1;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', sqlerrm);
    end;
  end loop;

  foreach v_id in array coalesce(p_fms_stage_ids, '{}') loop
    begin
      if not exists(select 1 from fms_instance_stages s join fms_instances i on i.id = s.fms_instance_id where s.id = v_id and i.tenant_id = a.tenant_id) then
        raise exception 'This FMS step no longer exists';
      end if;
      perform reassign_fms_stage_with_audit(v_id, p_from_user_id, p_to_user_id, v_reason);
      v_moved := v_moved || v_id; v_moved_work := v_moved_work + 1;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', case when sqlerrm = 'Invalid reassignment' then 'This FMS step is finished or no longer assigned to ' || v_from.employee_name else sqlerrm end);
    end;
  end loop;

  foreach v_id in array coalesce(p_template_ids, '{}') loop
    begin
      select * into v_template from task_templates where id = v_id and tenant_id = a.tenant_id and deleted_at is null for update;
      if v_template.id is null then raise exception 'This recurring schedule no longer exists'; end if;
      if v_template.default_assignee_user_id is distinct from p_from_user_id then
        raise exception 'This recurring schedule is not assigned to %', v_from.employee_name;
      end if;
      update task_templates set default_assignee_user_id = p_to_user_id, default_assignee_type = 'specific_user',
        branch_id = case when branch_id is null then null else v_to.branch_id end,
        department_id = case when department_id is null then null else v_to.department_id end,
        assignment_status = 'assigned', updated_by = a.id, updated_at = now()
      where id = v_id;
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
      values (a.tenant_id, a.id, 'task_template_assignee_transferred', 'task_templates', v_id,
        jsonb_build_object('default_assignee_user_id', p_from_user_id, 'branch_id', v_template.branch_id, 'department_id', v_template.department_id),
        jsonb_build_object('default_assignee_user_id', p_to_user_id, 'reason', v_reason, 'bulk', true));
      v_moved := v_moved || v_id; v_moved_schedules := v_moved_schedules + 1;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', sqlerrm);
    end;
  end loop;

  perform set_config('jewelos.bulk_task_reassignment', 'off', true);
  if v_moved_work + v_moved_schedules > 0 then
    insert into notifications(tenant_id, branch_id, department_id, user_profile_id, event_type, title, message,
      link_url, channel, delivered_status, priority, source_module, delivered_at)
    values (a.tenant_id, v_to.branch_id, v_to.department_id, p_to_user_id, 'task_delegated', 'Work handed over to you',
      concat_ws(' ', case when v_moved_work > 0 then v_moved_work || ' task(s)' end,
        case when v_moved_work > 0 and v_moved_schedules > 0 then 'and' end,
        case when v_moved_schedules > 0 then v_moved_schedules || ' recurring schedule(s)' end,
        'moved to you from ' || v_from.employee_name || '. Reason: ' || v_reason),
      '/tasks', 'in_app', 'delivered', 'medium', 'tasks', now());
  end if;
  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', v_skipped);
end $$;

revoke all on function task_reassignment_actor() from public, anon, authenticated;
revoke all on function task_reassignment_candidates(uuid) from public, anon;
revoke all on function reassign_task_work_with_audit(uuid, uuid, text, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function task_reassignment_candidates(uuid) to authenticated;
grant execute on function reassign_task_work_with_audit(uuid, uuid, text, uuid[], uuid[], uuid[]) to authenticated;
notify pgrst, 'reload schema';
