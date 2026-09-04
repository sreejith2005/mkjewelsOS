-- Upload-required tasks could not be completed from the browser at all in three
-- separate ways, and every retry failed identically because each cause is a
-- property of the task or the actor, not of the attempt:
--
--   1. Authorization diverged from every other completion contract. The Upload
--      button renders for elevated roles on any task in the tenant (see
--      deriveTaskMutationCapability), Storage accepts their object (see
--      can_write_task_attachment_object), update_task_with_audit accepts their
--      'complete', and add_task_attachment_with_audit accepts their evidence --
--      but this RPC demanded an active doer row. A manager or admin uploading
--      on a task assigned to somebody else stored the object, was rejected here,
--      and had the orphan cleaned up by the client. Forever.
--   2. requires_remark was a dead end. The atomic contract takes no remark
--      argument, and its only visible affordance is the Upload button, so a task
--      flagged both requires_upload and requires_remark rejected every upload
--      with a demand the caller had no way to satisfy. Evidence is the proof of
--      completion for these tasks: the gate is removed rather than made
--      satisfiable, matching the operational rule that an uploaded task
--      completes on upload.
--   3. requires_form raised unconditionally instead of checking whether the
--      submission exists, so the branch could only ever fail. It now mirrors
--      update_task_with_audit's real submission lookup.
--
-- A fourth defect made a successful upload look like it had not gone through.
-- Both upload-completion paths set only status and actual_datetime, leaving
-- completed_by, completion_mode, completion_delay_minutes, on_time_status and
-- verification_status untouched. The occurrence therefore reported no on-time
-- status and never re-entered its verifier's queue, so work that had in fact
-- been uploaded appeared stalled. Both paths now record the same completion
-- bookkeeping as update_task_with_audit (0109). An elevated actor completing
-- someone else's task is recorded as 'on_behalf'; unlike the remark-carrying
-- path it is not asked to explain itself in words, because the uploaded
-- evidence is the explanation.
set search_path=public,extensions;

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
  if exists(select 1 from task_checklists where task_instance_id=p_task_id and is_required and not is_completed) then
    raise exception 'Complete all required checklist items first' using errcode='23514';
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

revoke all on function public.complete_uploaded_task_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_uploaded_task_with_audit(uuid,text) to authenticated;

notify pgrst,'reload schema';

-- The recurring image-completion path shares both defects: it recognises only
-- an active assignee, and it recorded no completion bookkeeping. Its button is
-- rendered to anyone who can see the occurrence, so a manager's upload stored
-- the object and was then refused, identically, on every retry.
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

revoke all on function public.complete_recurring_task_with_image_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_recurring_task_with_image_with_audit(uuid,text) to authenticated;

notify pgrst,'reload schema';
