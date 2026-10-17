set search_path=public,extensions;

-- Only a published, explicitly mapped file answer on the causal workflow may
-- be read through work context. This grants no access to its other answers.
create function can_read_fms_context_upload(p_path text) returns boolean
language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and module_enabled('fms_builder') and exists(
    select 1 from form_submission_files file join form_submissions submission on submission.id=file.form_submission_id
      join fms_instances instance on instance.tenant_id=file.tenant_id and instance.assignment_version=2
      join fms_instance_stages work on work.fms_instance_id=instance.id
      join fms_stages target on target.id=work.fms_stage_id
      cross join lateral jsonb_array_elements(coalesce(target.planned_time_rule#>'{taskDisplay,fields}','[]')) mapping
      join fms_stages source on source.fms_flow_id=instance.fms_flow_id and source.stage_key=mapping->>'sourceStageKey'
        and source.form_template_id=file.form_template_id
    where file.storage_path=p_path and file.tenant_id=current_tenant_id() and file.removed_at is null
      and submission.tenant_id=file.tenant_id and submission.status='submitted'
      and mapping->>'formTemplateId'=file.form_template_id::text and mapping->>'fieldKey'=file.field_key
      and submission.data->>file.field_key=file.id::text and can_read_fms_work_context(work.id)
      and exists(select 1 from form_fields field where field.form_template_id=file.form_template_id and field.field_key=file.field_key and field.field_type='file')
      and (exists(select 1 from fms_instance_stages causal where causal.id=any(work.execution_path) and causal.fms_instance_id=instance.id and causal.fms_stage_id=source.id and causal.form_submission_id=submission.id)
        or instance.context->>'form_submission_id'=submission.id::text and submission.submitted_by=instance.started_by
          and source.id=(select id from fms_stages where fms_flow_id=instance.fms_flow_id order by sort_order,id limit 1))
  )
$$;
create policy fms_context_form_uploads_select on storage.objects for select to authenticated
  using(bucket_id='form-uploads' and can_read_fms_context_upload(name));

do $$
declare f text; n text; marker text;
begin
  f:=pg_get_functiondef('get_fms_assigned_work_context(uuid,uuid,text,integer)'::regprocedure);
  marker:='''value'',answer,''userName'',case';
  n:=replace(f,marker,$attachment$'value',answer,'attachment',case when field->>'field_type'='file' then (
      select jsonb_build_object('id',file.id,'name',file.original_filename,'mimeType',file.mime_type,'sizeBytes',file.size_bytes)
      from form_submission_files file where file.id=nullif(submission.data->>(mapping->>'fieldKey'),'')::uuid
        and file.form_submission_id=submission.id and file.tenant_id=i.tenant_id and file.form_template_id=source_stage.form_template_id
        and file.field_key=mapping->>'fieldKey' and file.removed_at is null
    ) else null end,'userName',case$attachment$);
  if n=f then raise exception 'Work file presentation marker changed'; end if; execute n;
  f:=pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure);
  n:=replace(f,'state:=case when i.status=''completed''', 'state:=case when i.status=''on_hold'' then ''workflow_on_hold'' when i.status=''completed''');
  if n=f then raise exception 'Work hold result marker changed'; end if; execute n;
end $$;

create function get_fms_work_file_path(p_instance_id uuid,p_instance_stage_id uuid,p_file_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare context jsonb; path text;
begin
  context:=get_fms_assigned_work_context(p_instance_id,p_instance_stage_id,null,1);
  if not exists(select 1 from jsonb_array_elements(context->'receivedFields') received where received#>>'{attachment,id}'=p_file_id::text) then raise exception 'File is not part of this authorized work context' using errcode='42501'; end if;
  select storage_path into path from form_submission_files where id=p_file_id and tenant_id=current_tenant_id() and removed_at is null;
  if path is null then raise exception 'File is not available' using errcode='42501'; end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
    values(current_tenant_id(),(current_profile()).id,'fms_context_file_accessed','fms_instance_stages',p_instance_stage_id,jsonb_build_object('file_id',p_file_id));
  return path;
end $$;
revoke all on function can_read_fms_context_upload(text),get_fms_work_file_path(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function can_read_fms_context_upload(text),get_fms_work_file_path(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
