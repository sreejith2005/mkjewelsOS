-- Normal task assignments must be visible to the assignee immediately. This
-- is intentionally transactional rather than waiting for the optional outbox
-- worker, which remains responsible for non-immediate/provider deliveries.
create or replace function emit_task_notification_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_task task_instances; v_assignee user_profiles; v_event_type text;
begin
  select * into v_task from task_instances where id=new.task_instance_id;
  select * into v_assignee from user_profiles where id=new.user_profile_id;
  v_event_type:=case when new.is_original then 'task_assigned' else 'task_delegated' end;
  insert into notifications(
    tenant_id,branch_id,department_id,user_profile_id,event_type,title,message,
    link_url,channel,delivered_status,priority,source_module,source_record_id,delivered_at
  ) values (
    v_task.tenant_id,v_task.branch_id,v_task.department_id,new.user_profile_id,v_event_type,
    case when new.is_original then 'New task assigned' else 'Task delegated to you' end,
    left(v_task.title,4000),'/tasks','in_app','delivered',v_task.priority,'tasks',v_task.id,now()
  );
  return new;
end $$;

revoke all on function emit_task_notification_event() from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
