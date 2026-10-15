set search_path=public,extensions;

create function can_read_fms_work_context(p_instance_stage_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and exists(
    select 1 from fms_instance_stages work join fms_instances i on i.id=work.fms_instance_id cross join current_profile() actor
    where work.id=p_instance_stage_id and i.tenant_id=actor.tenant_id and (
      actor.id=any(work.assigned_to) or has_permission('tasks.view_all')
      or has_permission('tasks.manage_team') and i.branch_id=actor.branch_id
    )
  )
$$;

create function get_fms_assigned_work_context(p_instance_id uuid,p_instance_stage_id uuid,p_cursor text default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare work fms_instance_stages; i fms_instances; stage fms_stages; flow fms_flows;
  display jsonb; mappings jsonb; mapping jsonb; source_work fms_instance_stages; source_stage fms_stages;
  submission form_submissions; snapshot jsonb; field jsonb; received jsonb:='[]'; journey jsonb;
  form_name text; form_version integer; answer jsonb; options jsonb; initial_stage_id uuid;
  effective_limit integer:=greatest(1,least(coalesce(p_limit,20),50)); last_cursor text;
begin
  perform assert_module_enabled('fms_builder');
  select * into work from fms_instance_stages where id=p_instance_stage_id and fms_instance_id=p_instance_id;
  if work.id is null or not can_read_fms_work_context(work.id) then raise exception 'FMS work context is not available to your account' using errcode='42501'; end if;
  select * into i from fms_instances where id=work.fms_instance_id;
  select * into stage from fms_stages where id=work.fms_stage_id;
  select * into flow from fms_flows where id=i.fms_flow_id;
  select id into initial_stage_id from fms_stages where fms_flow_id=i.fms_flow_id order by sort_order,id limit 1;
  display:=coalesce(stage.planned_time_rule->'taskDisplay','{}');
  mappings:=coalesce(display->'fields','[]');
  if jsonb_typeof(mappings)<>'array' then raise exception 'Invalid task display field configuration' using errcode='23514'; end if;
  -- Legacy automatic display never expands existing submission-read authority.
  if jsonb_array_length(mappings)=0 then
    select coalesce(jsonb_agg(jsonb_build_object('sourceStageKey',source.stage_key,'formTemplateId',source.form_template_id,'fieldKey',visible.field_key)),'[]') into mappings
    from (select definition.stage_key,definition.form_template_id,prior.form_submission_id
      from unnest(work.execution_path) with ordinality path(id,depth)
      join fms_instance_stages prior on prior.id=path.id and prior.fms_instance_id=i.id
      join fms_stages definition on definition.id=prior.fms_stage_id
      where prior.id<>work.id and prior.form_submission_id is not null and can_read_form_submission(prior.form_submission_id)
      order by path.depth desc limit 1) source
    cross join lateral (select field_key from form_fields where form_template_id=source.form_template_id and is_shown and field_type not in ('file','section_header','divider') order by sort_order limit 6) visible;
  end if;
  for mapping in select value from jsonb_array_elements(mappings) limit 12 loop
    select * into source_stage from fms_stages where fms_flow_id=i.fms_flow_id and stage_key=mapping->>'sourceStageKey' and form_template_id=(mapping->>'formTemplateId')::uuid;
    if source_stage.id is null then continue; end if;
    select prior.* into source_work from unnest(work.execution_path) with ordinality path(id,depth)
      join fms_instance_stages prior on prior.id=path.id and prior.fms_instance_id=i.id
      where prior.fms_stage_id=source_stage.id and prior.id<>work.id and prior.form_submission_id is not null order by path.depth desc limit 1;
    select * into submission from form_submissions where id=source_work.form_submission_id and tenant_id=i.tenant_id and status='submitted';
    -- Original starter context may survive a return path that resets its visit
    -- ancestry. Bind it to this instance's starter and the exact form identity.
    if submission.id is null and source_stage.id=initial_stage_id then
      select candidate.* into submission from form_submissions candidate
        join fms_instance_stages initial on initial.form_submission_id=candidate.id and initial.fms_instance_id=i.id and initial.fms_stage_id=initial_stage_id
        where candidate.id=nullif(i.context->>'form_submission_id','')::uuid and candidate.tenant_id=i.tenant_id
          and candidate.submitted_by=i.started_by and candidate.status='submitted' order by initial.visit_number limit 1;
    end if;
    if submission.id is null or not (submission.data ? (mapping->>'fieldKey')) then continue; end if;
    if i.assignment_version=1 and not can_read_form_submission(submission.id) then continue; end if;
    snapshot:=submission.template_snapshot;
    select value into field from jsonb_array_elements(coalesce(snapshot->'fields','[]')) where value->>'field_key'=mapping->>'fieldKey';
    if field is null then select to_jsonb(f) into field from form_fields f where form_template_id=source_stage.form_template_id and field_key=mapping->>'fieldKey'; end if;
    if field is null or field->>'field_type' in ('section_header','divider') then continue; end if;
    form_name:=coalesce(snapshot#>>'{template,name}',(select name from form_templates where id=source_stage.form_template_id),'Historical form');
    form_version:=coalesce((snapshot#>>'{template,version}')::integer,(select version from form_templates where id=source_stage.form_template_id),1);
    answer:=submission.data->(mapping->>'fieldKey');
    if field->>'field_type'='file' then answer:='"Attachment provided"'; end if;
    options:=case when jsonb_typeof(field->'options')='array' then field->'options' else '[]'::jsonb end;
    received:=received||jsonb_build_array(jsonb_build_object('sourceStageKey',source_stage.stage_key,'submissionId',submission.id,
      'formTemplateId',source_stage.form_template_id,'formName',form_name,'formVersion',form_version,
      'field',jsonb_build_object('key',field->>'field_key','label',field->>'field_name','type',field->>'field_type','sortOrder',coalesce((field->>'sort_order')::integer,0),'options',options),
      'value',answer,'userName',case when field->>'field_type'='user_dropdown' then
        (select employee_name from user_profiles where id=(answer#>>'{}')::uuid and tenant_id=i.tenant_id) else null end));
  end loop;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.id),'[]') into journey from (
    select prior.id,definition.name as "stageName",prior.status,
      (select employee_name from user_profiles where id=prior.completed_by and tenant_id=i.tenant_id) as "employeeName",
      prior.visit_number as "visitNumber",prior.actual_datetime as "completedAt"
    from fms_instance_stages prior join fms_stages definition on definition.id=prior.fms_stage_id
    where prior.fms_instance_id=i.id and prior.id=any(work.execution_path) and (p_cursor is null or prior.id>p_cursor::uuid)
    order by prior.id limit effective_limit
  ) item;
  if jsonb_array_length(journey)=effective_limit then last_cursor:=journey->-1->>'id'; end if;
  return jsonb_build_object('workflowName',flow.name,'stageName',stage.name,'reference',i.reference_number,
    'instructions',coalesce(display->>'instructions',stage.method,''),'expectedResult',coalesce(display->>'expectedResult','Complete this step and record the outcome.'),
    'dueAt',work.planned_datetime,'assignedNames',coalesce((select jsonb_agg(employee_name order by employee_name) from user_profiles where tenant_id=i.tenant_id and id=any(work.assigned_to)),'[]'),
    'titleTemplate',coalesce(display->>'titleTemplate',''),'shortDescription',coalesce(display->>'shortDescription',''),'dueLabel',coalesce(display->>'dueLabel','Due'),
    'receivedFields',received,'journey',journey,'nextCursor',last_cursor);
end $$;
revoke all on function can_read_fms_work_context(uuid),get_fms_assigned_work_context(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function get_fms_assigned_work_context(uuid,uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
