-- In-loop task participants receive the same actionable in-app assignment event
-- as doers. Delivery and visibility remain governed by the notification outbox
-- and its existing RLS policies.
create or replace function emit_task_watcher_notification_event()
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

  perform enqueue_notification_event(
    v_task.tenant_id, v_task.branch_id, v_task.department_id,
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

create trigger task_watcher_notification_event
after insert on task_watchers
for each row execute function emit_task_watcher_notification_event();

revoke all on function emit_task_watcher_notification_event() from public, anon, authenticated;
