-- Completion is no longer gated behind the task's own checklist.
--
-- Every imported checklist occurrence carries exactly one required checklist
-- item whose text repeats the task headline (see 0132). That item is only
-- reachable after expanding "View details", so the Complete action sat greyed
-- out on the feed and the one-shot Upload button was withheld: in practice a
-- checklist occurrence could not be finished at all. Since the import began,
-- 217 checklist items have been created and not one has ever been ticked.
--
-- The checklist is a working aid, not a second gate. Completing the task now
-- closes whatever is still outstanding on its checklist, attributed to the
-- actor and stamped at the completion moment, so the checklist still records
-- what was done instead of blocking it. Ticking items by hand keeps working
-- exactly as before for anyone who wants the intermediate progress.
set search_path=public,extensions;

create or replace function public.complete_task_checklist_items(p_task_id uuid, p_actor_id uuid)
returns void language sql security definer set search_path=public as $$
  update public.task_checklists
  set is_completed = true, completed_by = p_actor_id, completed_at = now()
  where task_instance_id = p_task_id and not is_completed;
$$;

revoke all on function public.complete_task_checklist_items(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.update_task_with_audit(
  p_task_id uuid,
  p_action text,
  p_checklist_id uuid default null,
  p_completed boolean default null,
  p_remark text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor user_profiles;
  v_old task_instances;
  v_new task_instances;
  v_linked_module text;
  v_own boolean;
  v_due timestamptz;
  v_delay integer;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_old from task_instances where id = p_task_id for update;
  v_own := exists (
    select 1 from task_assignees
    where task_instance_id = p_task_id and user_profile_id = v_actor.id
      and role_at_task = 'doer' and is_active
  );
  if v_actor.id is null or not current_profile_is_active() or v_old.id is null
     or v_old.tenant_id <> v_actor.tenant_id
     or not (v_actor.user_role in ('super_admin','admin','manager') or v_own) then
    raise exception 'Task is not accessible to an active doer' using errcode = '42501';
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
       or v_old.status not in ('pending','in_progress','rejected') then
      raise exception 'Checklist update is invalid for this task state' using errcode = '22023';
    end if;
    update task_checklists
    set is_completed = p_completed,
        completed_by = case when p_completed then v_actor.id else null end,
        completed_at = case when p_completed then now() else null end
    where id = p_checklist_id and task_instance_id = p_task_id;
    if not found then
      raise exception 'Checklist item not found' using errcode = '22023';
    end if;
    if v_old.status in ('pending','rejected') and p_completed then
      update task_instances
      set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
      where id = p_task_id;
    end if;
    select * into v_new from task_instances where id = p_task_id;
  elsif p_action = 'complete' then
    if v_old.status in ('completed','blocked') then
      raise exception 'Completed or coverage-blocked tasks cannot be completed' using errcode = '22023';
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
        select 1 from form_submissions fs
        where fs.tenant_id = v_old.tenant_id
          and fs.linked_record_id = p_task_id
          and fs.linked_module = v_linked_module
          and fs.form_template_id = v_old.form_template_id
      )
    ) then
      raise exception 'The required task form submission is missing' using errcode = '23514';
    end if;
    if v_old.requires_remark and nullif(btrim(p_remark),'') is null then
      raise exception 'A completion remark is required' using errcode = '23514';
    end if;
    -- Completing someone else's work is an exception that has to be explained,
    -- exactly as the reference demands for an on-behalf completion.
    if not v_own and nullif(btrim(p_remark),'') is null then
      raise exception 'A remark is required when completing a task on behalf of the doer'
        using errcode = '23514';
    end if;
    perform complete_task_checklist_items(p_task_id, v_actor.id);
    v_due := task_effective_due_datetime(v_old);
    v_delay := greatest(0, (round(extract(epoch from (now() - v_due)) / 60))::integer);
    update task_instances
    set status = 'completed', actual_datetime = now(),
        completion_remark = nullif(btrim(p_remark),''),
        completed_by = v_actor.id,
        completion_mode = case when v_own then 'own' else 'on_behalf' end,
        completion_delay_minutes = v_delay,
        on_time_status = case when v_delay > 0 then 'delayed' else 'on_time' end,
        -- A redone occurrence goes back in front of its verifier.
        verification_status = case when verification_status = 'not_required'
          then verification_status else 'pending' end,
        verified_by = case when verification_status = 'not_required' then verified_by else null end,
        verified_at = case when verification_status = 'not_required' then verified_at else null end,
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
    v_actor.tenant_id, v_actor.id,
    case when p_action = 'complete' and not v_own then 'task_complete_on_behalf' else 'task_' || p_action end,
    'tasks', p_task_id, to_jsonb(v_old), to_jsonb(v_new)
  );
end;
$$;

-- The atomic upload-completion path carried the same gate, which is what kept
-- the header Upload button off any occurrence that had a checklist.
create or replace function public.complete_uploaded_task_with_audit(p_task_id uuid,p_file_url text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare
  v_actor user_profiles; v_old task_instances; v_new task_instances;
  v_object storage.objects; v_attachment uuid; v_path text; v_linked_module text;
  v_own boolean; v_due timestamptz; v_delay integer;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid() and account_status='active' and is_login_enabled;
  select * into v_old from task_instances where id=p_task_id for update;
  v_own:=exists(select 1 from task_assignees
                 where task_instance_id=p_task_id and user_profile_id=v_actor.id
                   and role_at_task='doer' and is_active);
  if v_actor.id is null or v_old.id is null or v_old.tenant_id<>v_actor.tenant_id
     or not (v_own or v_actor.user_role in ('super_admin','admin','manager')) then
    raise exception 'Task is not accessible to an active doer' using errcode='42501';
  end if;
  if v_old.status in ('completed','blocked') or not v_old.requires_upload then
    raise exception 'Task is not eligible for upload completion' using errcode='22023';
  end if;
  v_linked_module:=case v_old.task_type when 'checklist' then 'checklist_task' when 'delegation' then 'delegation_task' else null end;
  if v_old.requires_form and (
    v_old.form_template_id is null or v_linked_module is null or not exists(
      select 1 from form_submissions fs
       where fs.tenant_id=v_old.tenant_id and fs.linked_record_id=p_task_id
         and fs.linked_module=v_linked_module and fs.form_template_id=v_old.form_template_id
    )
  ) then
    raise exception 'The required task form submission is missing' using errcode='23514';
  end if;
  v_path:=btrim(p_file_url);
  select * into v_object from storage.objects where bucket_id='task-attachments' and name=v_path;
  if v_object.id is null or v_path not like v_old.tenant_id::text||'/'||p_task_id::text||'/%' or v_path like '%..%'
     or coalesce(v_object.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp','application/pdf')
     or coalesce((v_object.metadata->>'size')::bigint,0) not between 1 and 10485760 then
    raise exception 'Invalid task attachment metadata' using errcode='22023';
  end if;
  insert into task_attachments(task_instance_id,file_url,uploaded_by,original_filename,mime_type,size_bytes)
  values(p_task_id,v_path,v_actor.id,task_attachment_display_name(v_path),
    v_object.metadata->>'mimetype',(v_object.metadata->>'size')::bigint)
  returning id into v_attachment;
  perform complete_task_checklist_items(p_task_id, v_actor.id);
  v_due:=task_effective_due_datetime(v_old);
  v_delay:=greatest(0,(round(extract(epoch from (now()-v_due))/60))::integer);
  update task_instances set
    status='completed', actual_datetime=now(), completed_by=v_actor.id,
    completion_mode=case when v_own then 'own' else 'on_behalf' end,
    completion_delay_minutes=v_delay,
    on_time_status=case when v_delay>0 then 'delayed' else 'on_time' end,
    verification_status=case when verification_status='not_required' then verification_status else 'pending' end,
    verified_by=case when verification_status='not_required' then verified_by else null end,
    verified_at=case when verification_status='not_required' then verified_at else null end,
    updated_by=v_actor.id, updated_at=now()
  where id=p_task_id returning * into v_new;
  update task_assignees set completed_at=now() where task_instance_id=p_task_id and role_at_task='doer' and is_active;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_upload_completed','tasks',p_task_id,to_jsonb(v_old),to_jsonb(v_new)||jsonb_build_object('attachment_id',v_attachment));
end $$;

-- The recurring image-completion path never checked the checklist, but it left
-- the items open on a finished occurrence. Close them the same way.
create or replace function public.complete_recurring_task_with_image_with_audit(p_task_id uuid,p_file_url text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare
  v_actor public.user_profiles; v_task public.task_instances; v_object storage.objects;
  v_attachment uuid; v_own boolean; v_due timestamptz; v_delay integer;
begin
  select * into v_actor from public.user_profiles where auth_user_id=auth.uid();
  select * into v_task from public.task_instances where id=p_task_id for update;
  v_own:=exists(select 1 from public.task_assignees
                 where task_instance_id=p_task_id and user_profile_id=v_actor.id and is_active);
  if v_actor.id is null or not public.current_profile_is_active() or v_task.id is null
     or v_task.tenant_id<>v_actor.tenant_id or v_task.task_template_id is null
     or v_task.task_type<>'delegation' or v_task.status='completed'
     or not (v_own or v_actor.user_role in ('super_admin','admin','manager')) then
    raise exception 'Recurring image task completion denied' using errcode='42501';
  end if;
  select * into v_object from storage.objects where bucket_id='task-attachments' and name=btrim(p_file_url);
  if v_object.id is null or v_object.name !~ ('^'||v_task.tenant_id::text||'/'||v_task.id::text||'/')
     or coalesce(v_object.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp')
     or coalesce((v_object.metadata->>'size')::bigint,0) not between 1 and 5242880 then
    raise exception 'Task completion requires a permitted image upload' using errcode='23514';
  end if;
  insert into public.task_attachments(task_instance_id,file_url,uploaded_by,original_filename,mime_type,size_bytes)
  values(p_task_id,v_object.name,v_actor.id,task_attachment_display_name(v_object.name),
    v_object.metadata->>'mimetype',(v_object.metadata->>'size')::bigint)
  returning id into v_attachment;
  perform public.complete_task_checklist_items(p_task_id, v_actor.id);
  v_due:=public.task_effective_due_datetime(v_task);
  v_delay:=greatest(0,(round(extract(epoch from (now()-v_due))/60))::integer);
  update public.task_instances set
    status='completed', actual_datetime=now(), completed_by=v_actor.id,
    completion_mode=case when v_own then 'own' else 'on_behalf' end,
    completion_delay_minutes=v_delay,
    on_time_status=case when v_delay>0 then 'delayed' else 'on_time' end,
    verification_status=case when verification_status='not_required' then verification_status else 'pending' end,
    verified_by=case when verification_status='not_required' then verified_by else null end,
    verified_at=case when verification_status='not_required' then verified_at else null end,
    updated_by=v_actor.id, updated_at=now()
  where id=p_task_id;
  update public.task_assignees set completed_at=now() where task_instance_id=p_task_id and is_active;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_task_image_completed','recurring_todo',p_task_id,
    jsonb_build_object('attachment_id',v_attachment,'completion_mode',case when v_own then 'own' else 'on_behalf' end));
end $$;

revoke all on function public.update_task_with_audit(uuid,text,uuid,boolean,text) from public,anon;
grant execute on function public.update_task_with_audit(uuid,text,uuid,boolean,text) to authenticated;
revoke all on function public.complete_uploaded_task_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_uploaded_task_with_audit(uuid,text) to authenticated;
revoke all on function public.complete_recurring_task_with_image_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_recurring_task_with_image_with_audit(uuid,text) to authenticated;

notify pgrst,'reload schema';
