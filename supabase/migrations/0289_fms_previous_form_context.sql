set search_path=public,extensions;
create index fms_context_submission_visit on fms_instance_stages(form_submission_id) where form_submission_id is not null;

-- Private causal projection; callers must authorize the exact destination visit.
create function fms_context_form_visits(p_work_id uuid)
returns table(visit_id uuid,submission_id uuid,is_initial boolean)
language sql stable security definer set search_path=public as $$
  with recursive destination as (
    select work.*,instance.context,instance.started_by,instance.tenant_id from fms_instance_stages work
    join fms_instances instance on instance.id=work.fms_instance_id where work.id=p_work_id
  ), ancestry(id) as (
    select unnest(array_remove(coalesce(work.execution_path,'{}')||work.previous_instance_stage_id,null)) from destination work
    union
    select parent.id from ancestry path join fms_instance_stages prior on prior.id=path.id
      join destination work on work.fms_instance_id=prior.fms_instance_id
      cross join lateral unnest(array_remove(coalesce(prior.execution_path,'{}')||prior.previous_instance_stage_id,null)) parent(id)
  )
  select prior.id,submission.id,submission.id::text=work.context->>'form_submission_id'
  from destination work join fms_instance_stages prior on prior.fms_instance_id=work.fms_instance_id and prior.id<>work.id
  join fms_stages stage on stage.id=prior.fms_stage_id
  join form_submissions submission on submission.id=prior.form_submission_id and submission.tenant_id=work.tenant_id
    and submission.form_template_id=stage.form_template_id and submission.status='submitted'
  where prior.status='completed' and prior.outcome is distinct from 'condition_skipped'
    and (prior.id in(select id from ancestry) or submission.id::text=work.context->>'form_submission_id' and submission.submitted_by=work.started_by
      and stage.id=(select id from fms_stages where fms_flow_id=stage.fms_flow_id order by sort_order,id limit 1))
$$;

-- Match the form runner's section traversal against the saved definition, since
-- published templates can be edited in place after a submission.
create function fms_context_reachable_sections(p_fields jsonb,p_sections jsonb,p_answers jsonb)
returns text[] language plpgsql stable set search_path=public as $$
declare
  v_sections jsonb; v_count integer; v_index integer := 0; v_next_index integer;
  v_reached text[] := array[]::text[]; v_key text; v_target text; v_destination text;
  v_undecided boolean; v_field jsonb; v_branch jsonb; v_value jsonb; v_matched boolean;
begin
  v_sections := p_sections;
  if v_sections is null or jsonb_typeof(v_sections) <> 'array' or jsonb_array_length(v_sections) = 0 then return null; end if;
  v_count := jsonb_array_length(v_sections);
  while v_index >= 0 and v_index < v_count loop
    v_key := v_sections->v_index->>'key';
    exit when v_key = any(v_reached);
    v_reached := array_append(v_reached, v_key);
    v_target := null; v_undecided := false;
    for v_field in
      select value from jsonb_array_elements(p_fields)
      where jsonb_typeof(value->'branch_logic')='array'
        and form_field_section_key(value->>'group_name', v_sections) = v_key
      order by coalesce((value->>'sort_order')::integer,0)
    loop
      continue when not (coalesce((v_field->>'is_shown')::boolean,true) and form_condition_matches(v_field->'conditional_logic', p_answers));
      v_matched := false;
      for v_branch in select value from jsonb_array_elements(v_field->'branch_logic') loop
        if form_condition_matches(jsonb_strip_nulls(jsonb_build_object(
             'fieldKey', (v_field->>'field_key'), 'operator', v_branch->>'operator', 'value', v_branch->'value')), p_answers) then
          v_target := v_branch->>'targetSectionKey'; v_matched := true;
        end if;
      end loop;
      v_value := p_answers->(v_field->>'field_key');
      if not v_matched and (v_value is null or v_value = 'null'::jsonb or v_value = '""'::jsonb or v_value = '[]'::jsonb) then
        v_undecided := true;
      end if;
    end loop;
    -- An unanswered branching question has no destination yet.
    exit when v_undecided and v_target is null;
    v_destination := coalesce(v_target, v_sections->v_index->>'next');
    exit when v_destination = '__submit__';
    if v_destination is null then
      v_next_index := v_index + 1;
    else
      select position - 1 into v_next_index from jsonb_array_elements(v_sections) with ordinality as entries(section, position)
      where section->>'key' = v_destination;
    end if;
    exit when v_next_index is null or v_next_index <= v_index;
    v_index := v_next_index;
  end loop;
  return v_reached;
end;
$$;

create function fms_context_form_fields(p_visit_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare work fms_instance_stages; stage fms_stages; submission form_submissions; snapshot jsonb; fields jsonb; field jsonb;
  answer jsonb; options jsonb; result jsonb:='[]'::jsonb; reached text[]; form_name text; form_version integer; label text;
begin
  select * into work from fms_instance_stages where id=p_visit_id;
  select * into stage from fms_stages where id=work.fms_stage_id;
  select * into submission from form_submissions where id=work.form_submission_id and form_template_id=stage.form_template_id and status='submitted';
  if submission.id is null then return result; end if;
  snapshot:=submission.template_snapshot;
  fields:=snapshot->'fields';
  if jsonb_typeof(fields) is distinct from 'array' or jsonb_array_length(fields)=0 then
    select coalesce(jsonb_agg(to_jsonb(item) order by sort_order,id),'[]') into fields from form_fields item where form_template_id=stage.form_template_id;
  end if;
  form_name:=coalesce(snapshot#>>'{template,name}',(select name from form_templates where id=stage.form_template_id),'Historical form');
  form_version:=coalesce((snapshot#>>'{template,version}')::integer,(select version from form_templates where id=stage.form_template_id),1);
  reached:=fms_context_reachable_sections(fields,coalesce(snapshot#>'{template,sections}',(select sections from form_templates where id=stage.form_template_id),'[]'),submission.data);
  for field in select value from jsonb_array_elements(fields) order by coalesce((value->>'sort_order')::integer,0) loop
    if field->>'field_type' in ('section_header','divider') or not coalesce((field->>'is_shown')::boolean,true)
      or not form_condition_matches(field->'conditional_logic',submission.data) then continue; end if;
    if reached is not null and not form_field_section_key(field->>'group_name',coalesce(snapshot#>'{template,sections}',(select sections from form_templates where id=stage.form_template_id),'[]'))=any(reached) then continue; end if;
    answer:=coalesce(submission.data->(field->>'field_key'),'null'); label:=null;
    if field->>'field_type' in ('user_dropdown','branch_dropdown','department_dropdown') and answer#>>'{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      if field->>'field_type'='user_dropdown' then select employee_name into label from user_profiles where id=(answer#>>'{}')::uuid and tenant_id=submission.tenant_id;
      elsif field->>'field_type'='branch_dropdown' then select name into label from branches where id=(answer#>>'{}')::uuid and tenant_id=submission.tenant_id;
      else select name into label from departments where id=(answer#>>'{}')::uuid and tenant_id=submission.tenant_id; end if;
    end if;
    options:=case when jsonb_typeof(field->'dropdown_option_snapshot')='array' and jsonb_array_length(field->'dropdown_option_snapshot')>0 then field->'dropdown_option_snapshot' when jsonb_typeof(field->'options')='array' then field->'options' else '[]'::jsonb end;
    result:=result||jsonb_build_array(jsonb_build_object('sourceStageKey',stage.stage_key,'submissionId',submission.id,'formTemplateId',stage.form_template_id,
      'formName',form_name,'formVersion',form_version,'value',case when field->>'field_type'='file' and answer<>'null'::jsonb then '"Attachment provided"'::jsonb else answer end,
      'userName',label,'valueLabel',label,'field',jsonb_build_object('key',field->>'field_key','label',field->>'field_name','type',field->>'field_type','sortOrder',coalesce((field->>'sort_order')::integer,0),'options',options),
      'attachment',case when field->>'field_type'='file' then (select jsonb_build_object('id',file.id,'name',file.original_filename,'mimeType',file.mime_type,'sizeBytes',file.size_bytes)
        from form_submission_files file where file.id::text=submission.data->>(field->>'field_key') and file.form_submission_id=submission.id
          and file.tenant_id=submission.tenant_id and file.field_key=field->>'field_key' and file.removed_at is null) else null end));
  end loop;
  return result;
end $$;

create function get_fms_work_form_context(p_instance_id uuid,p_instance_stage_id uuid,p_offset integer default 0,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb:='[]'::jsonb; item record; fields jsonb; count integer:=0; page_size integer:=greatest(1,least(coalesce(p_limit,10),20)); next_cursor text;
begin
  perform assert_module_enabled('fms_builder');
  if not exists(select 1 from fms_instance_stages where id=p_instance_stage_id and fms_instance_id=p_instance_id)
    or not can_read_fms_work_context(p_instance_stage_id) then raise exception 'FMS work context is not available to your account' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid previous-form cursor' using errcode='22023'; end if;
  for item in select causal.*,stage.name,work.visit_number,submission.submitted_at,person.employee_name
    from fms_context_form_visits(p_instance_stage_id) causal join fms_instance_stages work on work.id=causal.visit_id
    join fms_stages stage on stage.id=work.fms_stage_id join form_submissions submission on submission.id=causal.submission_id
    left join user_profiles person on person.id=submission.submitted_by and person.tenant_id=submission.tenant_id
    order by causal.is_initial desc,submission.submitted_at desc nulls last,work.id offset p_offset limit page_size+1 loop
    count:=count+1; if count>page_size then next_cursor:=(p_offset+page_size)::text; exit; end if;
    fields:=fms_context_form_fields(item.visit_id);
    result:=result||jsonb_build_array(jsonb_build_object('id',item.visit_id,'stageName',item.name,'visitNumber',item.visit_number,
      'isInitial',coalesce(item.is_initial,false),'submittedAt',item.submitted_at,'submittedBy',item.employee_name,'fields',fields));
  end loop;
  return jsonb_build_object('forms',result,'nextCursor',next_cursor);
end $$;

-- The same exact causal projection gates private object signing and audited opens.
create or replace function can_read_fms_context_upload(p_path text) returns boolean
language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and module_enabled('fms_builder') and exists(
    select 1 from form_submission_files file join fms_instance_stages source on source.form_submission_id=file.form_submission_id
    join fms_instances instance on instance.id=source.fms_instance_id and instance.tenant_id=file.tenant_id
    join fms_instance_stages work on work.fms_instance_id=instance.id
    cross join lateral fms_context_form_visits(work.id) causal
    where file.storage_path=p_path and file.tenant_id=current_tenant_id() and file.removed_at is null and can_read_fms_work_context(work.id)
      and causal.submission_id=file.form_submission_id and exists(select 1 from jsonb_array_elements(fms_context_form_fields(causal.visit_id)) field where field#>>'{attachment,id}'=file.id::text)
  )
$$;
create or replace function get_fms_work_file_path(p_instance_id uuid,p_instance_stage_id uuid,p_file_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare path text;
begin
  perform assert_module_enabled('fms_builder');
  if not exists(select 1 from fms_instance_stages where id=p_instance_stage_id and fms_instance_id=p_instance_id)
    or not can_read_fms_work_context(p_instance_stage_id) then raise exception 'FMS work context is not available to your account' using errcode='42501'; end if;
  if not exists(select 1 from fms_context_form_visits(p_instance_stage_id) causal cross join lateral jsonb_array_elements(fms_context_form_fields(causal.visit_id)) field
    where field#>>'{attachment,id}'=p_file_id::text) then raise exception 'File is not part of this authorized work context' using errcode='42501'; end if;
  select storage_path into path from form_submission_files where id=p_file_id and tenant_id=current_tenant_id() and removed_at is null;
  if path is null then raise exception 'File is not available' using errcode='42501'; end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(current_tenant_id(),(current_profile()).id,'fms_context_file_accessed','fms_instance_stages',p_instance_stage_id,jsonb_build_object('file_id',p_file_id));
  return path;
end $$;
revoke all on function fms_context_reachable_sections(jsonb,jsonb,jsonb),fms_context_form_visits(uuid),fms_context_form_fields(uuid),get_fms_work_form_context(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function get_fms_work_form_context(uuid,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
