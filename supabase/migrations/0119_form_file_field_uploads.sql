-- Form Builder "file" fields have been deferred since the Forms contract
-- landed (0009_forms_engine_contract.sql): assert_form_publishable refused to
-- publish any form containing one, and submit_form_locked_with_audit refused
-- to accept an answer for one. This lands the private Storage lifecycle for
-- form file uploads, following the same pattern already proven for
-- crm-documents (0012_crm_engine.sql) and fms-evidence (0010_fms_engine.sql):
-- a private bucket, ownership-scoped RLS on storage.objects, and a
-- SECURITY DEFINER registration RPC. A file is uploaded and registered
-- *before* the form is submitted; submit_form_locked_with_audit then verifies
-- the caller owns the referenced upload, that it targets this exact template
-- and field, and links it to the resulting submission so it can never be reused.
set search_path = public, extensions;

create table form_submission_files (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  form_template_id uuid not null references form_templates(id) on delete cascade,
  field_key text not null,
  form_submission_id uuid references form_submissions(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes between 1 and 10485760),
  uploaded_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references user_profiles(id),
  constraint form_submission_files_mime check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  constraint form_submission_files_extension check(lower(original_filename) ~ '\.(jpg|jpeg|png|webp|pdf)$')
);
create index idx_form_submission_files_submission on form_submission_files(form_submission_id);
create index idx_form_submission_files_pending_uploader on form_submission_files(uploaded_by,created_at) where form_submission_id is null;

alter table form_submission_files enable row level security;
create policy form_submission_files_select on form_submission_files for select to authenticated using (
  (form_submission_id is not null and can_read_form_submission(form_submission_id))
  or (form_submission_id is null and uploaded_by = (select (current_profile()).id))
);
revoke all privileges on table form_submission_files from public, anon, authenticated, service_role;
grant select on table form_submission_files to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('form-uploads','form-uploads',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function can_write_form_upload_object(p_name text)
returns boolean language sql stable security definer set search_path=public,storage as $$
  select current_profile_is_active() and split_part(p_name,'/',1)=current_tenant_id()::text
    and split_part(p_name,'/',2) ~ '^[0-9a-f-]{36}$'
    and can_access_form_template(split_part(p_name,'/',2)::uuid)
    and exists(select 1 from form_fields where form_template_id=split_part(p_name,'/',2)::uuid and field_type='file');
$$;
create function can_read_form_upload_object(p_name text) returns boolean language sql stable security definer set search_path=public,storage as $$
  select exists(
    select 1 from form_submission_files f where f.storage_path=p_name and f.removed_at is null
    and (
      (f.form_submission_id is not null and can_read_form_submission(f.form_submission_id))
      or (f.form_submission_id is null and f.uploaded_by=(current_profile()).id)
    )
  );
$$;

create policy form_upload_objects_insert on storage.objects for insert to authenticated with check(bucket_id='form-uploads' and owner_id=auth.uid()::text and can_write_form_upload_object(name));
create policy form_upload_objects_select on storage.objects for select to authenticated using(bucket_id='form-uploads' and can_read_form_upload_object(name));
grant execute on function can_write_form_upload_object(text), can_read_form_upload_object(text) to authenticated;

create function register_form_upload(p_form_template_id uuid,p_field_key text,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint)
returns uuid language plpgsql security definer set search_path=public,storage as $$
declare v_actor user_profiles; v_field form_fields; v_id uuid; v_expected_prefix text;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'An active profile is required to upload a file' using errcode='42501'; end if;
  if not can_access_form_template(p_form_template_id) then raise exception 'The form is outside the caller Forms Library scope' using errcode='42501'; end if;
  select * into v_field from form_fields where form_template_id=p_form_template_id and field_key=p_field_key;
  if v_field.id is null or v_field.field_type<>'file' then raise exception 'Unknown file field' using errcode='22023'; end if;
  v_expected_prefix := v_actor.tenant_id::text||'/'||p_form_template_id::text||'/';
  if p_storage_path not like v_expected_prefix||'%' or p_storage_path like '%..%'
     or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf')
     or p_size_bytes not between 1 and 10485760
     or lower(p_original_filename)!~'\.(jpg|jpeg|png|webp|pdf)$' then
    raise exception 'Upload metadata is invalid' using errcode='22023';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='form-uploads' and name=p_storage_path and owner_id=auth.uid()::text) then
    raise exception 'Uploaded object is not owned by the caller' using errcode='42501';
  end if;
  insert into form_submission_files(tenant_id,form_template_id,field_key,storage_path,original_filename,mime_type,size_bytes,uploaded_by)
  values(v_actor.tenant_id,p_form_template_id,p_field_key,p_storage_path,btrim(p_original_filename),p_mime_type,p_size_bytes,v_actor.id)
  returning id into v_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_file_uploaded','forms',v_id,jsonb_build_object('form_template_id',p_form_template_id,'field_key',p_field_key,'mime_type',p_mime_type,'size_bytes',p_size_bytes));
  return v_id;
end;
$$;

create function get_form_upload_path(p_file_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_file form_submission_files; v_actor user_profiles;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'An active profile is required to access this file' using errcode='42501'; end if;
  select * into v_file from form_submission_files where id=p_file_id and removed_at is null;
  if v_file.id is null or not (
    (v_file.form_submission_id is not null and can_read_form_submission(v_file.form_submission_id))
    or (v_file.form_submission_id is null and v_file.uploaded_by=v_actor.id)
  ) then raise exception 'File not found' using errcode='42501'; end if;
  return v_file.storage_path;
end;
$$;

-- assert_form_publishable (0114_form_field_visibility_rules.sql), verbatim
-- except the 'file' block below is removed now that a Storage lifecycle exists.
create or replace function assert_form_publishable(p_template_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $fn$
declare v_count integer; v_sections jsonb;
begin
  select count(*) into v_count from form_fields where form_template_id = p_template_id;
  if v_count = 0 then raise exception 'A published form must contain at least one field' using errcode = '23514'; end if;
  if v_count > 100 then raise exception 'A form can contain at most 100 fields' using errcode = '23514'; end if;
  if exists (
    select 1 from form_fields ff
    where ff.form_template_id = p_template_id
      and ff.sort_order <> (select count(*) from form_fields earlier where earlier.form_template_id = p_template_id and earlier.sort_order < ff.sort_order)
  ) then raise exception 'Field ordering must be zero-based and contiguous' using errcode = '23514'; end if;
  select coalesce(sections,'[]'::jsonb) into v_sections from form_templates where id = p_template_id;
  perform normalize_form_fields(coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'key',ff.field_key,'label',ff.field_name,'type',ff.field_type,
      'sectionKey',ff.group_name,
      'required',ff.is_required,'shown',ff.is_shown,'editable',ff.is_editable,
      'placeholder',ff.placeholder,'helperText',ff.helper_text,'options',ff.options,
      'optionSource', case when ff.option_source = 'dropdown_master'
        then jsonb_build_object('kind','master','masterType',ff.dropdown_master_type) end,
      'branches',ff.branch_logic,
      'validation',ff.validation,
      'condition', case when ff.conditional_logic ? 'kind' then null else ff.conditional_logic end,
      'rule', case when ff.conditional_logic ? 'kind' then ff.conditional_logic else null end
    )) order by ff.sort_order)
    from form_fields ff where ff.form_template_id=p_template_id
  ),'[]'::jsonb), v_sections);
end;
$fn$;

-- submit_form_locked_with_audit is the actual submission implementation as of
-- 0113_form_sections_branching_and_dropdown_references.sql (submit_form_with_audit
-- is a thin 0088 wrapper around it that only adds a task lock and is left
-- untouched here). This is that body, verbatim, except the 'file' field type
-- now validates and links its upload instead of falling through to the
-- deferred-type exception.
create or replace function submit_form_locked_with_audit(
  p_form_template_id uuid,
  p_answers jsonb,
  p_linked_module text default null,
  p_linked_record_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_template form_templates;
  v_task task_instances;
  v_instance_stage fms_instance_stages;
  v_instance fms_instances;
  v_stage fms_stages;
  v_field form_fields;
  v_value jsonb;
  v_text text;
  v_visible boolean;
  v_empty boolean;
  v_normalized jsonb := '{}'::jsonb;
  v_submission form_submissions;
  v_number numeric;
  v_reachable text[];
  v_option_values jsonb;
  v_upload form_submission_files;
  v_file_ids uuid[] := '{}';
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then
    raise exception 'An active profile is required to submit a form' using errcode='42501';
  end if;
  if jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>65536
     or (select count(*) from jsonb_object_keys(p_answers))>100 then
    raise exception 'Answers must be an object within the form payload limits' using errcode='22023';
  end if;
  if (p_linked_module is null)<>(p_linked_record_id is null) then
    raise exception 'Linked module and record must be supplied together' using errcode='22023';
  end if;

  select * into v_template from form_templates where id=p_form_template_id for share;
  if v_template.id is null or v_template.tenant_id<>v_actor.tenant_id then
    raise exception 'Published form version not found' using errcode='42501';
  end if;
  if exists(
    select 1 from jsonb_object_keys(p_answers) answer_key
    where not exists(select 1 from form_fields ff where ff.form_template_id=v_template.id and ff.field_key=answer_key)
  ) then
    raise exception 'Answers contain an unknown field key' using errcode='22023';
  end if;

  if p_linked_module is null then
    if v_template.lifecycle<>'published' or not v_template.is_active then
      raise exception 'Current published form version not found' using errcode='42501';
    end if;
    if not can_access_form_template(v_template.id) then
      raise exception 'The form is outside the caller Forms Library scope' using errcode='42501';
    end if;
  elsif p_linked_module in ('checklist_task','delegation_task') then
    if v_template.published_at is null or v_template.lifecycle not in ('published','archived') then
      raise exception 'Task form version has never been published' using errcode='42501';
    end if;
    select * into v_task from task_instances where id=p_linked_record_id for share;
    if v_task.id is null or v_task.tenant_id<>v_actor.tenant_id
       or not v_task.requires_form or v_task.form_template_id<>v_template.id
       or (p_linked_module='checklist_task' and v_task.task_type<>'checklist')
       or (p_linked_module='delegation_task' and v_task.task_type<>'delegation') then
      raise exception 'Task link does not require this exact published form version' using errcode='42501';
    end if;
    if not (
      v_actor.user_role in ('super_admin','admin')
      or (v_actor.user_role='manager' and v_task.branch_id=v_actor.branch_id)
      or exists(select 1 from task_assignees ta where ta.task_instance_id=v_task.id and ta.user_profile_id=v_actor.id and ta.is_active and ta.role_at_task='doer')
    ) then
      raise exception 'Caller is not an active task participant or correctly scoped reviewer' using errcode='42501';
    end if;
    if v_task.status='completed' then
      raise exception 'Completed tasks cannot accept new form submissions' using errcode='23514';
    end if;
  elsif p_linked_module='fms_stage' then
    select * into v_instance_stage from fms_instance_stages where id=p_linked_record_id for update;
    select * into v_instance from fms_instances where id=v_instance_stage.fms_instance_id for share;
    select * into v_stage from fms_stages where id=v_instance_stage.fms_stage_id for share;
    if v_instance_stage.id is null or v_instance.id is null or v_stage.id is null
       or v_instance.tenant_id<>v_actor.tenant_id or v_stage.form_template_id<>v_template.id
       or v_instance.status not in ('active','overdue')
       or v_instance_stage.status not in ('pending','in_progress','in_review','overdue') then
      raise exception 'FMS stage does not require this exact active form' using errcode='42501';
    end if;
    if not (
      v_actor.id=any(v_instance_stage.assigned_to)
      or v_actor.user_role in ('super_admin','admin')
      or (v_actor.user_role='manager' and v_actor.branch_id=v_instance.branch_id)
    ) then
      raise exception 'Caller is not allowed to submit this FMS stage form' using errcode='42501';
    end if;
    if v_instance_stage.form_submission_id is not null then
      raise exception 'This FMS stage already has a submitted form output' using errcode='23514';
    end if;
  else
    raise exception 'Linked module is not an approved task or FMS module' using errcode='22023';
  end if;

  v_reachable := form_reachable_sections(v_template.id, p_answers);

  for v_field in select * from form_fields where form_template_id=v_template.id order by sort_order loop
    v_visible := v_field.is_shown and form_condition_matches(v_field.conditional_logic,v_normalized)
      and (v_reachable is null or form_field_section_key(v_field.group_name, coalesce(v_template.sections,'[]'::jsonb)) = any(v_reachable));
    v_value := p_answers->v_field.field_key;
    if not v_visible or v_field.field_type in ('section_header','divider') then continue; end if;
    if v_field.field_type in ('text','textarea','email','phone','date','datetime','select','radio','user_dropdown','branch_dropdown','department_dropdown')
       and jsonb_typeof(v_value)='string' then
      v_value := to_jsonb(btrim(v_value #>> '{}'));
    end if;
    v_empty := v_value is null or v_value='null'::jsonb or v_value='""'::jsonb or v_value='[]'::jsonb;
    if v_field.is_required and (v_empty or (v_field.field_type='checkbox' and v_value<>'true'::jsonb)) then
      raise exception 'Required visible field % is missing',v_field.field_key using errcode='23514';
    end if;
    if v_empty then continue; end if;
    v_option_values := form_field_option_values(v_field.options, v_field.dropdown_master_type, v_actor.tenant_id);
    if v_field.field_type in ('text','textarea','email','phone','date','datetime','select','radio','user_dropdown','branch_dropdown','department_dropdown') then
      if jsonb_typeof(v_value)<>'string' then raise exception 'Field % must be a string',v_field.field_key using errcode='22023'; end if;
      v_text := v_value #>> '{}';
      if length(v_text)>5000 then raise exception 'Field % exceeds the value limit',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='email' and v_text !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Field % is not a valid email',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='phone' and (v_text !~ '^[0-9+() .-]+$' or length(regexp_replace(v_text,'\D','','g')) not between 7 and 15) then raise exception 'Field % is not a valid phone number',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='date' and not is_valid_form_date(v_text) then raise exception 'Field % is not a valid date',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='datetime' and not is_valid_form_datetime(v_text) then raise exception 'Field % is not a valid datetime',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type in ('select','radio') and not (v_option_values @> jsonb_build_array(to_jsonb(v_text))) then raise exception 'Field % contains an invalid option',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'minLength' and length(v_text)<(v_field.validation->>'minLength')::integer then raise exception 'Field % is shorter than allowed',v_field.field_key using errcode='23514'; end if;
      if v_field.validation ? 'maxLength' and length(v_text)>(v_field.validation->>'maxLength')::integer then raise exception 'Field % exceeds its maximum',v_field.field_key using errcode='23514'; end if;
      if v_field.field_type='user_dropdown' and not exists(select 1 from user_profiles up where up.id=v_text::uuid and up.tenant_id=v_actor.tenant_id and up.working_status='active') then raise exception 'Field % references an invalid user',v_field.field_key using errcode='23503'; end if;
      if v_field.field_type='branch_dropdown' and not exists(select 1 from branches b where b.id=v_text::uuid and b.tenant_id=v_actor.tenant_id and b.is_active) then raise exception 'Field % references an invalid branch',v_field.field_key using errcode='23503'; end if;
      if v_field.field_type='department_dropdown' and not exists(select 1 from departments d where d.id=v_text::uuid and d.tenant_id=v_actor.tenant_id and d.is_active) then raise exception 'Field % references an invalid department',v_field.field_key using errcode='23503'; end if;
      v_value := to_jsonb(v_text);
    elsif v_field.field_type in ('number','currency','rating') then
      if jsonb_typeof(v_value)<>'number' then raise exception 'Field % must be a JSON number',v_field.field_key using errcode='22023'; end if;
      v_number := (v_value #>> '{}')::numeric;
      if v_field.field_type='rating' and (v_number<>trunc(v_number) or v_number not between 1 and 5) then raise exception 'Field % must be an integer rating from 1 to 5',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'min' and v_number<(v_field.validation->>'min')::numeric then raise exception 'Field % is below its minimum',v_field.field_key using errcode='23514'; end if;
      if v_field.validation ? 'max' and v_number>(v_field.validation->>'max')::numeric then raise exception 'Field % exceeds its maximum',v_field.field_key using errcode='23514'; end if;
    elsif v_field.field_type='checkbox' then
      if jsonb_typeof(v_value)<>'boolean' then raise exception 'Field % must be boolean',v_field.field_key using errcode='22023'; end if;
    elsif v_field.field_type='multiselect' then
      if jsonb_typeof(v_value)<>'array' or jsonb_array_length(v_value)>100
         or exists(select 1 from jsonb_array_elements(v_value) choice where jsonb_typeof(choice)<>'string' or not (v_option_values @> jsonb_build_array(choice)))
         or (select count(*) from jsonb_array_elements_text(v_value))<>(select count(distinct choice) from jsonb_array_elements_text(v_value) choice) then
        raise exception 'Field % must contain unique configured options',v_field.field_key using errcode='22023';
      end if;
    elsif v_field.field_type='file' then
      if jsonb_typeof(v_value)<>'string' then raise exception 'Field % must reference an uploaded file',v_field.field_key using errcode='22023'; end if;
      v_text := v_value #>> '{}';
      select * into v_upload from form_submission_files where id=v_text::uuid;
      if v_upload.id is null or v_upload.tenant_id<>v_actor.tenant_id or v_upload.form_template_id<>v_template.id
         or v_upload.field_key<>v_field.field_key or v_upload.uploaded_by<>v_actor.id
         or v_upload.form_submission_id is not null or v_upload.removed_at is not null then
        raise exception 'Field % references an invalid or already used upload',v_field.field_key using errcode='23503';
      end if;
      v_file_ids := array_append(v_file_ids,v_upload.id);
      v_value := to_jsonb(v_text);
    else
      raise exception 'Deferred field type % cannot be submitted',v_field.field_type using errcode='0A000';
    end if;
    v_normalized := v_normalized || jsonb_build_object(v_field.field_key,v_value);
  end loop;

  insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,linked_module,linked_record_id,data,submitted_by,status)
  values(v_actor.tenant_id,v_actor.branch_id,v_actor.department_id,v_template.id,p_linked_module,p_linked_record_id,v_normalized,v_actor.id,'submitted')
  returning * into v_submission;
  if array_length(v_file_ids,1) > 0 then
    update form_submission_files set form_submission_id=v_submission.id where id=any(v_file_ids);
  end if;
  if p_linked_module='fms_stage' then
    update fms_instance_stages set form_submission_id=v_submission.id where id=v_instance_stage.id;
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(v_instance_stage.id,v_actor.id,'form_submitted',jsonb_build_object('form_submission_id',v_submission.id,'form_template_id',v_template.id));
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_submitted','forms',v_submission.id,jsonb_build_object('form_template_id',v_template.id,'linked_module',p_linked_module,'linked_record_id',p_linked_record_id,'answer_keys',(select jsonb_agg(key order by key) from jsonb_object_keys(v_normalized) key)));
  return v_submission.id;
end;
$$;

alter function submit_form_locked_with_audit(uuid,jsonb,text,uuid) owner to postgres;
revoke all on function submit_form_locked_with_audit(uuid,jsonb,text,uuid) from public, anon, authenticated, service_role;

alter function register_form_upload(uuid,text,text,text,text,bigint) owner to postgres;
revoke all privileges on function register_form_upload(uuid,text,text,text,text,bigint) from public, anon, service_role;
grant execute on function register_form_upload(uuid,text,text,text,text,bigint) to authenticated;

alter function get_form_upload_path(uuid) owner to postgres;
revoke all privileges on function get_form_upload_path(uuid) from public, anon, service_role;
grant execute on function get_form_upload_path(uuid) to authenticated;

revoke all privileges on function assert_form_publishable(uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
