-- A normal upload-required task is complete only when its evidence row and
-- completion state commit together. Storage upload happens first, but this
-- protected RPC owns every database-side state change in one transaction.
set search_path=public,extensions;

create function public.complete_uploaded_task_with_audit(p_task_id uuid,p_file_url text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare v_actor user_profiles; v_old task_instances; v_new task_instances; v_object storage.objects; v_attachment uuid; v_path text;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid() and account_status='active' and is_login_enabled;
  select * into v_old from task_instances where id=p_task_id for update;
  if v_actor.id is null or v_old.id is null or v_old.tenant_id<>v_actor.tenant_id
     or not exists(select 1 from task_assignees where task_instance_id=p_task_id and user_profile_id=v_actor.id and role_at_task='doer' and is_active) then
    raise exception 'Task is not accessible to an active doer' using errcode='42501';
  end if;
  if v_old.status in ('completed','blocked') or not v_old.requires_upload then
    raise exception 'Task is not eligible for upload completion' using errcode='22023';
  end if;
  if exists(select 1 from task_checklists where task_instance_id=p_task_id and is_required and not is_completed) then
    raise exception 'Complete all required checklist items first' using errcode='23514';
  end if;
  if v_old.requires_form then
    raise exception 'The required task form submission is missing' using errcode='23514';
  end if;
  if v_old.requires_remark then
    raise exception 'A completion remark is required' using errcode='23514';
  end if;
  v_path:=btrim(p_file_url);
  select * into v_object from storage.objects where bucket_id='task-attachments' and name=v_path;
  if v_object.id is null or v_path not like v_old.tenant_id::text||'/'||p_task_id::text||'/%' or v_path like '%..%'
     or coalesce(v_object.metadata->>'mimetype','') not in ('image/jpeg','image/png','application/pdf')
     or coalesce((v_object.metadata->>'size')::bigint,0) not between 1 and 10485760 then
    raise exception 'Invalid task attachment metadata' using errcode='22023';
  end if;
  insert into task_attachments(task_instance_id,file_url,uploaded_by) values(p_task_id,v_path,v_actor.id) returning id into v_attachment;
  update task_instances set status='completed',actual_datetime=now(),updated_by=v_actor.id,updated_at=now()
  where id=p_task_id returning * into v_new;
  update task_assignees set completed_at=now() where task_instance_id=p_task_id and role_at_task='doer' and is_active;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_upload_completed','tasks',p_task_id,to_jsonb(v_old),to_jsonb(v_new)||jsonb_build_object('attachment_id',v_attachment));
end $$;

revoke all on function public.complete_uploaded_task_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_uploaded_task_with_audit(uuid,text) to authenticated;
notify pgrst,'reload schema';
