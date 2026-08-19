-- FMS stages reuse the Form Builder submission engine.  The original Forms
-- contract only admitted standalone and task-linked submissions, even though
-- the FMS runner correctly identifies a stage form as `fms_stage`.
--
-- This forward-only replacement preserves the existing validation rules and
-- audit log, adds the FMS authorization/link checks, and records the exact
-- output submission on the instance stage for branch evaluation.
set search_path = public, extensions;

create or replace function submit_form_with_audit(
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

  for v_field in select * from form_fields where form_template_id=v_template.id order by sort_order loop
    v_visible := v_field.is_shown and form_condition_matches(v_field.conditional_logic,v_normalized);
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
    if v_field.field_type in ('text','textarea','email','phone','date','datetime','select','radio','user_dropdown','branch_dropdown','department_dropdown') then
      if jsonb_typeof(v_value)<>'string' then raise exception 'Field % must be a string',v_field.field_key using errcode='22023'; end if;
      v_text := v_value #>> '{}';
      if length(v_text)>5000 then raise exception 'Field % exceeds the value limit',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='email' and v_text !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Field % is not a valid email',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='phone' and (v_text !~ '^[0-9+() .-]+$' or length(regexp_replace(v_text,'\D','','g')) not between 7 and 15) then raise exception 'Field % is not a valid phone number',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='date' and not is_valid_form_date(v_text) then raise exception 'Field % is not a valid date',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='datetime' and not is_valid_form_datetime(v_text) then raise exception 'Field % is not a valid datetime',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type in ('select','radio') and not (v_field.options @> jsonb_build_array(to_jsonb(v_text))) then raise exception 'Field % contains an invalid option',v_field.field_key using errcode='22023'; end if;
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
         or exists(select 1 from jsonb_array_elements(v_value) choice where jsonb_typeof(choice)<>'string' or not (v_field.options @> jsonb_build_array(choice)))
         or (select count(*) from jsonb_array_elements_text(v_value))<>(select count(distinct choice) from jsonb_array_elements_text(v_value) choice) then
        raise exception 'Field % must contain unique configured options',v_field.field_key using errcode='22023';
      end if;
    else
      raise exception 'Deferred field type % cannot be submitted',v_field.field_type using errcode='0A000';
    end if;
    v_normalized := v_normalized || jsonb_build_object(v_field.field_key,v_value);
  end loop;

  insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,linked_module,linked_record_id,data,submitted_by,status)
  values(v_actor.tenant_id,v_actor.branch_id,v_actor.department_id,v_template.id,p_linked_module,p_linked_record_id,v_normalized,v_actor.id,'submitted')
  returning * into v_submission;
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

alter function submit_form_with_audit(uuid,jsonb,text,uuid) owner to postgres;
revoke all on function submit_form_with_audit(uuid,jsonb,text,uuid) from public, anon, service_role;
grant execute on function submit_form_with_audit(uuid,jsonb,text,uuid) to authenticated;

notify pgrst, 'reload schema';
