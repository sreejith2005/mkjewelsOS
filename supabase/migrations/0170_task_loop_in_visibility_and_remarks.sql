-- Looped-in (watcher) visibility and task remarks.
--
-- 1. v_task_feed_scope gains task_template_id (appended, so existing columns
--    keep their positions). The shared feed filter uses it to surface upcoming
--    one-time tasks without pulling every future recurring occurrence.
-- 2. The watcher assignment event no longer carries the task's branch and
--    department. resolve_notification_recipients() drops any recipient outside
--    the event's department unless they are an admin/manager, so a staff member
--    looped in from another department silently received nothing. The creation
--    RPC has already authorized every watcher (tenant, active, manager branch),
--    so the event addresses exactly that one named person.
-- 3. Remarks: participants who can read a task (creator, doers, looped-in
--    users, elevated roles; see can_read_task) may add follow-up comments to
--    the existing task_comments table through an audited RPC, and list them.
set search_path = public, extensions;

create or replace view public.v_task_feed_scope with (security_invoker = true) as
  select
    ti.id,
    ti.tenant_id,
    ti.created_by,
    ta.user_profile_id as assignee_id,
    ti.task_type,
    ti.status,
    coalesce(ti.revised_datetime, ti.due_datetime, ti.planned_datetime) as effective_due_datetime,
    ti.planned_datetime,
    ti.task_template_id
  from public.task_instances ti
  left join public.task_assignees ta
    on ta.task_instance_id = ti.id
   and ta.is_active
   and ta.role_at_task = 'doer'
  union all
  select
    fis.id,
    fi.tenant_id,
    fi.started_by,
    unnest(fis.assigned_to),
    'fms'::public.task_type,
    fis.status,
    fis.planned_datetime,
    fis.planned_datetime,
    null::uuid
  from public.fms_instance_stages fis
  join public.fms_instances fi on fi.id = fis.fms_instance_id
  union all
  select
    starter.id,
    starter.tenant_id,
    starter.assigned_by,
    starter.user_profile_id,
    'fms'::public.task_type,
    'pending'::public.task_status,
    starter.created_at,
    starter.created_at,
    null::uuid
  from public.fms_starter_assignments starter
  where starter.status = 'pending';

revoke all on public.v_task_feed_scope from public, anon;
grant select on public.v_task_feed_scope to authenticated;

create or replace function public.emit_task_watcher_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task task_instances;
  v_actor user_profiles;
  v_watcher user_profiles;
begin
  select * into v_task from task_instances where id = new.task_instance_id;
  select * into v_actor from current_profile();
  select * into v_watcher from user_profiles where id = new.user_profile_id;

  -- Branch and department are deliberately null: the recipient is the one
  -- explicitly authorized watcher, not the task's organizational audience.
  perform enqueue_notification_event(
    v_task.tenant_id, null, null,
    'task_assigned', 'tasks', v_task.id, v_actor.id,
    jsonb_build_object(
      'actor_name', coalesce(v_actor.employee_name, 'System'),
      'assignee_name', v_watcher.employee_name,
      'task_title', v_task.title,
      'planned_datetime', coalesce(v_task.revised_datetime, v_task.planned_datetime),
      'priority', v_task.priority,
      '_assigned_user_ids', jsonb_build_array(new.user_profile_id),
      '_task_creator_id', v_task.created_by,
      '_link_url', '/tasks/delegation'
    ),
    'task_watcher:assignment:' || new.id,
    now()
  );
  return new;
end;
$$;

revoke all on function public.emit_task_watcher_notification_event() from public, anon, authenticated;

create or replace function public.add_task_comment_with_audit(p_task_id uuid, p_comment text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_task task_instances;
  v_comment_id uuid;
  v_text text := btrim(coalesce(p_comment, ''));
begin
  perform public.assert_module_enabled('checklist_tasks');
  select * into v_actor from current_profile();
  select * into v_task from task_instances where id = p_task_id;
  if v_actor.id is null or not current_profile_is_active()
     or v_task.id is null or v_task.tenant_id <> v_actor.tenant_id
     or not can_read_task(p_task_id) then
    raise exception 'Task remark denied' using errcode = '42501';
  end if;
  if length(v_text) < 1 or length(v_text) > 1000 then
    raise exception 'Remark must contain 1 to 1000 characters' using errcode = '22023';
  end if;

  insert into task_comments(task_instance_id, user_profile_id, comment)
  values (p_task_id, v_actor.id, v_text)
  returning id into v_comment_id;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'task_comment_added', 'tasks', p_task_id,
    jsonb_build_object('comment_id', v_comment_id, 'comment', v_text));
  return v_comment_id;
end;
$$;

create or replace function public.list_task_comments(p_task_id uuid)
returns table(id uuid, comment text, created_at timestamptz, author_id uuid, author_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_module_enabled('checklist_tasks');
  if not can_read_task(p_task_id) then
    raise exception 'Task remarks are not available' using errcode = '42501';
  end if;
  return query
    select tc.id, tc.comment, tc.created_at, tc.user_profile_id,
      coalesce(nullif(btrim(concat_ws(' ', up.first_name, up.last_name)), ''), up.employee_name, 'Team member')
    from task_comments tc
    left join user_profiles up on up.id = tc.user_profile_id
    where tc.task_instance_id = p_task_id
    order by tc.created_at, tc.id;
end;
$$;

revoke all on function public.add_task_comment_with_audit(uuid, text) from public, anon;
revoke all on function public.list_task_comments(uuid) from public, anon;
grant execute on function public.add_task_comment_with_audit(uuid, text) to authenticated;
grant execute on function public.list_task_comments(uuid) to authenticated;

notify pgrst, 'reload schema';
