-- New watcher alerts open the supervision tab added to the Tasks workspace.
-- Existing alerts remain readable and the old /tasks/delegation route stays valid.
set search_path = public, extensions;

create or replace function public.emit_task_watcher_notification_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task task_instances;
  v_actor user_profiles;
  v_watcher user_profiles;
begin
  select * into v_task from task_instances where id = new.task_instance_id;
  select * into v_actor from current_profile();
  select * into v_watcher from user_profiles where id = new.user_profile_id;

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
      '_link_url', '/tasks/in-loop'
    ),
    'task_watcher:assignment:' || new.id,
    now()
  );
  return new;
end;
$$;

revoke all on function public.emit_task_watcher_notification_event() from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
