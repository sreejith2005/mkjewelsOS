-- Watchers may read a watched task, but must never change task state or checklist data.
-- This forward correction aligns the SECURITY DEFINER RPC with task watcher RLS.
create or replace function update_task_with_audit(
  p_task_id uuid,
  p_action text,
  p_checklist_id uuid default null,
  p_completed boolean default null,
  p_remark text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old task_instances;
  v_new task_instances;
  v_linked_module text;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_old from task_instances where id = p_task_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_old.id is null
     or v_old.tenant_id <> v_actor.tenant_id or not (
        v_actor.user_role in ('super_admin', 'admin', 'manager')
        or exists (
          select 1 from task_assignees
          where task_instance_id = p_task_id
            and user_profile_id = v_actor.id
            and role_at_task = 'doer'
            and is_active
        )
     ) then
    raise exception 'Task is not accessible to an active doer'
      using errcode = '42501';
  end if;

  if p_action = 'start' then
    if v_old.status <> 'pending' then
      raise exception 'Only pending tasks can be started' using errcode = '22023';
    end if;
    update task_instances
    set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
    where id = p_task_id
    returning * into v_new;
  elsif p_action = 'checklist' then
    if p_checklist_id is null or p_completed is null
       or v_old.status not in ('pending', 'in_progress') then
      raise exception 'Checklist update is invalid for this task state'
        using errcode = '22023';
    end if;
    update task_checklists
    set is_completed = p_completed,
        completed_by = case when p_completed then v_actor.id else null end,
        completed_at = case when p_completed then now() else null end
    where id = p_checklist_id and task_instance_id = p_task_id;
    if not found then
      raise exception 'Checklist item not found' using errcode = '22023';
    end if;
    if v_old.status = 'pending' and p_completed then
      update task_instances
      set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
      where id = p_task_id;
    end if;
    select * into v_new from task_instances where id = p_task_id;
  elsif p_action = 'complete' then
    if v_old.status in ('completed', 'blocked') then
      raise exception 'Completed or coverage-blocked tasks cannot be completed'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from task_checklists
      where task_instance_id = p_task_id and is_required and not is_completed
    ) then
      raise exception 'Complete all required checklist items first' using errcode = '23514';
    end if;
    if v_old.requires_upload and not exists (
      select 1 from task_attachments where task_instance_id = p_task_id
    ) then
      raise exception 'A required upload is missing' using errcode = '23514';
    end if;
    v_linked_module := case v_old.task_type
      when 'checklist' then 'checklist_task'
      when 'delegation' then 'delegation_task'
      else null
    end;
    if v_old.requires_form and (
      v_old.form_template_id is null or v_linked_module is null or not exists (
        select 1
        from form_submissions fs
        where fs.tenant_id = v_old.tenant_id
          and fs.linked_record_id = p_task_id
          and fs.linked_module = v_linked_module
          and fs.form_template_id = v_old.form_template_id
      )
    ) then
      raise exception 'The required task form submission is missing' using errcode = '23514';
    end if;
    if v_old.requires_remark and nullif(btrim(p_remark), '') is null then
      raise exception 'A completion remark is required' using errcode = '23514';
    end if;
    update task_instances
    set status = 'completed', actual_datetime = now(),
        completion_remark = nullif(btrim(p_remark), ''),
        updated_by = v_actor.id, updated_at = now()
    where id = p_task_id
    returning * into v_new;
    update task_assignees
    set completed_at = now()
    where task_instance_id = p_task_id and role_at_task = 'doer' and is_active;
  else
    raise exception 'Unsupported task action' using errcode = '22023';
  end if;

  insert into audit_logs(
    tenant_id, actor_user_id, action, module, record_id, old_value, new_value
  ) values (
    v_actor.tenant_id, v_actor.id, 'task_' || p_action, 'tasks', p_task_id,
    to_jsonb(v_old), to_jsonb(v_new)
  );
end;
$$;

revoke all on function update_task_with_audit(uuid, text, uuid, boolean, text) from public;
grant execute on function update_task_with_audit(uuid, text, uuid, boolean, text) to authenticated;
