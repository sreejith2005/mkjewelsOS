set search_path=public,extensions;

create function fms_assignment_destination(p_stage_id uuid,p_tenant_id uuid,p_resolution jsonb,p_issue text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare target fms_stages; config jsonb;
begin
  select stage.* into target from fms_stages stage join fms_flows flow on flow.id=stage.fms_flow_id where stage.id=p_stage_id and flow.tenant_id=p_tenant_id;
  if target.id is null then raise exception 'Invalid FMS assignment destination' using errcode='23514'; end if;
  config:=target.planned_time_rule->'assignment';
  return jsonb_build_object('targetStageId',target.id,'stageName',target.name,'formTemplateId',target.form_template_id,
    'selectedUserId',p_resolution#>>'{selectedUserIds,0}','effectiveUserId',p_resolution#>>'{effectiveUserIds,0}',
    'employeeName',(select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=p_tenant_id and id in(select jsonb_array_elements_text(p_resolution->'effectiveUserIds')::uuid)),
    'selectedEmployeeName',(select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=p_tenant_id and id in(select jsonb_array_elements_text(p_resolution->'selectedUserIds')::uuid)),
    'assignmentMethod',coalesce(p_resolution->>'assignmentMethod','manual_handoff'),'locked',coalesce(config->>'mode'='fixed_employee',false),
    'allowHandoff',coalesce((config->>'allowHandoff')::boolean,false) and coalesce(config->>'mode'<>'fixed_employee',true),'issue',p_issue);
end $$;

do $$
declare f text; n text; first_pos integer; last_pos integer; marker text;
begin
  f:=replace(pg_get_functiondef('preview_fms_work_transition_before_start(jsonb)'::regprocedure), E'\r', '');
  first_pos:=strpos(f,'      destinations:=destinations||jsonb_build_array(jsonb_build_object(''targetStageId''');
  marker:='''issue'',resolution->>''issue''));';
  last_pos:=first_pos+strpos(substring(f from first_pos),marker)+length(marker)-1;
  if first_pos=0 or last_pos<=first_pos then raise exception 'Stage destination descriptor marker changed'; end if;
  n:=substring(f from 1 for first_pos-1)||'      destinations:=destinations||jsonb_build_array(fms_assignment_destination(target.id,i.tenant_id,resolution,resolution->>''issue''));'||substring(f from last_pos);
  -- More than one configured candidate is a normal chooser state when the
  -- author explicitly permits handoff; it is never an arbitrary first user.
  n:=replace(n,'sqlerrm not like ''No eligible employee for step %''', 'sqlerrm not like ''No eligible employee for step %'' and sqlerrm not like ''Choose one eligible employee for step %''');
  execute n;
  f:=replace(pg_get_functiondef('fms_initial_assignment_preview(uuid,uuid,jsonb,uuid)'::regprocedure), E'\r', '');
  first_pos:=strpos(f,'  return jsonb_build_object(''targetStageId''');
  if first_pos=0 then raise exception 'Initial destination descriptor marker changed'; end if;
  n:=substring(f from 1 for first_pos-1)||E'  return fms_assignment_destination(target.id,flow.tenant_id,resolution||jsonb_build_object(''assignmentMethod'',method),issue);\nend $function$;';
  -- pg_get_functiondef uses this fixed delimiter for these PL/pgSQL bodies.
  if strpos(f,'AS $function$')=0 then raise exception 'Initial preview function delimiter changed'; end if;
  execute n;
end $$;

-- The second overload previews explicit choices, including central coverage.
-- The final mutation requires this exact fingerprint rather than silently
-- assigning a newly chosen employee's buddy after the user has confirmed.
create function preview_fms_work_transition(p_request jsonb,p_handoffs jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare base jsonb; choice jsonb; destination jsonb; replacement jsonb; destinations jsonb; work fms_instance_stages; instance fms_instances;
  definition fms_stages; flow_id uuid; candidate jsonb; answers jsonb; plan jsonb; resolution jsonb;
begin
  if jsonb_typeof(p_handoffs) is distinct from 'array' or jsonb_array_length(p_handoffs)>200
    or jsonb_array_length(p_handoffs)<>(select count(distinct value->>'targetStageId') from jsonb_array_elements(p_handoffs)) then raise exception 'Invalid workflow handoff choices' using errcode='22023'; end if;
  base:=preview_fms_work_transition(p_request);
  if jsonb_array_length(p_handoffs)=0 then return base; end if;
  destinations:=base->'destinations';
  if p_request->>'kind' in ('starter_form','flow_form') then
    if p_request->>'kind'='starter_form' then
      select fms_flow_id into flow_id from fms_starter_assignments where id=(p_request->>'starterAssignmentId')::uuid;
      candidate:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_entry',(p_request->>'starterAssignmentId')::uuid);
    else
      flow_id:=(p_request->>'flowId')::uuid;
      candidate:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers',null,null);
    end if;
    answers:=candidate->'answers';
  else
    work:=assert_fms_work_actor((p_request->>'instanceStageId')::uuid);
    select * into instance from fms_instances where id=work.fms_instance_id;
    select * into definition from fms_stages where id=work.fms_stage_id;
    if p_request->>'kind'='stage_form' then
      candidate:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_stage',work.id); answers:=candidate->'answers';
    else select coalesce(data,'{}') into answers from form_submissions where id=work.form_submission_id;
    end if;
  end if;
  for choice in select value from jsonb_array_elements(p_handoffs) loop
    select value into destination from jsonb_array_elements(destinations) where value->>'targetStageId'=choice->>'targetStageId';
    if destination is null or not coalesce((destination->>'allowHandoff')::boolean,false) then raise exception 'The handoff destination is not available for replacement' using errcode='23514'; end if;
    perform assert_fms_handoff_recipient((choice->>'userProfileId')::uuid,current_tenant_id(),true);
    if p_request->>'kind' in ('starter_form','flow_form') then
      replacement:=fms_initial_assignment_preview(flow_id,(choice->>'targetStageId')::uuid,answers,(choice->>'userProfileId')::uuid);
    else
      select value into plan from jsonb_array_elements(fms_candidate_transition_plan(instance.id,work.id,coalesce(answers,'{}'),case when p_request->>'kind'='review' then p_request->>'decision' else p_request->>'outcome' end)) where value->>'targetStageId'=choice->>'targetStageId' and coalesce(value->>'limitReached','false')<>'true';
      if plan is null then raise exception 'Handoff route changed. Review the preview again.' using errcode='23514'; end if;
      resolution:=resolve_fms_visit_assignment(instance.id,(choice->>'targetStageId')::uuid,work.id,(choice->>'userProfileId')::uuid,
        case when p_request->>'kind'='stage_form' then answers else null end,definition.id,array(select jsonb_array_elements_text(plan->'path')::uuid));
      replacement:=fms_assignment_destination((choice->>'targetStageId')::uuid,instance.tenant_id,resolution,null);
    end if;
    select jsonb_agg(case when value->>'targetStageId'=choice->>'targetStageId' then replacement else value end order by ordinality) into destinations from jsonb_array_elements(destinations) with ordinality;
  end loop;
  return base||jsonb_build_object('destinations',destinations,'fingerprint',fms_request_digest(jsonb_build_object('base',base->>'fingerprint','handoffs',p_handoffs,'destinations',destinations)::text));
end $$;
do $$
declare f text; n text;
begin
  f:=replace(pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure), E'\r', '');
  n:=replace(f,'preview:=preview_fms_work_transition(p_request);','preview:=preview_fms_work_transition(p_request,p_handoffs);');
  if n=f then raise exception 'Confirmed choice preview marker changed'; end if; f:=n;
  n:=replace(f,$old$'employeeName',(select employee_name from user_profiles where id=next.assigned_to[1]),$old$,
    $new$'employeeName',(select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=i.tenant_id and id=any(next.assigned_to)),
    'selectedEmployeeName',(select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=i.tenant_id and id=any(coalesce(decision.selected_user_ids,next.assigned_to))),$new$);
  if n=f then raise exception 'Actual assignment name descriptor changed'; end if; f:=n;
  n:=replace(f,'''referenceNumber'',i.reference_number,', '''referenceNumber'',i.reference_number,''workflowName'',(select name from fms_flows where id=i.fms_flow_id),');
  if n=f then raise exception 'Workflow confirmation name marker changed'; end if; execute n;
end $$;
revoke all on function fms_assignment_destination(uuid,uuid,jsonb,text),preview_fms_work_transition(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function preview_fms_work_transition(jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
