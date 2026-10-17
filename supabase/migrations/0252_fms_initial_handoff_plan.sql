set search_path=public,extensions;

-- Read the published binding once, before applying central absence coverage.
-- Both starting-form previews and real visits consume these same candidates.
create function fms_configured_assignment_candidates(p_stage_id uuid,p_tenant_id uuid,p_branch_id uuid,p_department_id uuid,p_mode text)
returns uuid[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(distinct candidate.id order by candidate.id),'{}') from (
    select rule.user_profile_id id from fms_stage_assignees rule where rule.fms_stage_id=p_stage_id and rule.assignee_type='specific_user'
    union select person.id from fms_stage_assignees rule join user_profiles person on person.user_role=rule.role_value
      where p_mode='hierarchy' and rule.fms_stage_id=p_stage_id and rule.assignee_type='role' and person.tenant_id=p_tenant_id
        and (p_branch_id is null or person.branch_id=p_branch_id) and (p_department_id is null or person.department_id=p_department_id)
    union select branch.manager_id from fms_stage_assignees rule join branches branch on branch.id=p_branch_id and branch.tenant_id=p_tenant_id
      where p_mode='hierarchy' and rule.fms_stage_id=p_stage_id and rule.assignee_type='manager'
    union select department.head_id from fms_stage_assignees rule join departments department on department.id=p_department_id and department.tenant_id=p_tenant_id
      where p_mode='hierarchy' and rule.fms_stage_id=p_stage_id and rule.assignee_type='department_head'
  ) candidate join user_profiles person on person.id=candidate.id and person.tenant_id=p_tenant_id
    and person.account_status='active' and person.working_status='active' and person.is_login_enabled
$$;

create function fms_assignment_coverage(p_stage_id uuid,p_tenant_id uuid,p_instance_id uuid,p_selected_ids uuid[],p_explicit boolean)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare target fms_stages; candidate uuid; coverage record; effective uuid[]:='{}'; target_date date;
begin
  select stage.* into target from fms_stages stage join fms_flows flow on flow.id=stage.fms_flow_id where stage.id=p_stage_id and flow.tenant_id=p_tenant_id;
  if target.id is null then raise exception 'Invalid FMS assignment destination' using errcode='23514'; end if;
  if cardinality(coalesce(p_selected_ids,'{}'))=0 then raise exception 'No eligible employee for step %. Select a handoff or configure a valid fallback.',target.name using errcode='23514'; end if;
  target_date:=(fms_stage_deadline_for_instance(target.planned_time_rule,p_tenant_id,p_instance_id) at time zone 'Asia/Kolkata')::date;
  foreach candidate in array p_selected_ids loop
    perform assert_fms_handoff_recipient(candidate,p_tenant_id,p_explicit);
    select * into coverage from resolve_task_coverage(candidate,coalesce(target_date,(now() at time zone 'Asia/Kolkata')::date));
    if coverage.effective_assignee_id is null then raise exception 'Employee for step % is unavailable and needs configured coverage',target.name using errcode='23514'; end if;
    perform assert_fms_handoff_recipient(coverage.effective_assignee_id,p_tenant_id,p_explicit);
    effective:=array_append(effective,coverage.effective_assignee_id);
  end loop;
  select array_agg(distinct id order by id) into effective from unnest(effective) id;
  if not target.allow_multiple_doers and cardinality(effective)>1 then raise exception 'Choose one eligible employee for step %',target.name using errcode='23514'; end if;
  return jsonb_build_object('selectedUserIds',to_jsonb(p_selected_ids),'effectiveUserIds',to_jsonb(effective));
end $$;

do $$
declare f text; n text; first_pos integer; last_pos integer;
begin
  f:=replace(pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[])'::regprocedure), E'\r', '');
  n:=replace(f,'resolve_fms_stage_assignees_before_form_user(target.id,i.id,null)', 'fms_configured_assignment_candidates(target.id,i.tenant_id,i.branch_id,i.department_id,c->>''mode'')');
  if n=f then raise exception 'Configured assignment binding marker changed'; end if; f:=n;
  n:=replace(f,'candidate uuid; covered record; target_date date;', 'coverage jsonb;');
  if n=f then raise exception 'Assignment coverage variables changed'; end if; f:=n;
  first_pos:=strpos(f,'  target_date:=(');
  last_pos:=first_pos+strpos(substring(f from first_pos),'  return jsonb_build_object(''selectedUserIds''')-1;
  if first_pos=0 or last_pos<=first_pos then raise exception 'Assignment coverage body changed'; end if;
  n:=substring(f from 1 for first_pos-1)||E'  coverage:=fms_assignment_coverage(target.id,i.tenant_id,i.id,chosen_ids,explicit_choice);\n  effective_ids:=array(select jsonb_array_elements_text(coverage->''effectiveUserIds'')::uuid);\n'||substring(f from last_pos);
  execute n;

  -- Reuse the read planner with a typed planning context. Starting previews
  -- have no instance/visit ID and create no placeholder database records.
  f:=replace(pg_get_functiondef('fms_candidate_transition_plan(uuid,uuid,jsonb,text)'::regprocedure), E'\r', '');
  n:=replace(f,'FUNCTION public.fms_candidate_transition_plan(p_instance_id uuid, p_source_visit_id uuid, p_answers jsonb, p_outcome text)',
    'FUNCTION public.fms_transition_plan_for_context(p_instance public.fms_instances, p_source public.fms_instance_stages, p_answers jsonb, p_outcome text)');
  if n=f then raise exception 'Planning context signature changed'; end if; f:=n;
  n:=replace(f,'  select * into i from fms_instances where id=p_instance_id;','  i:=p_instance;');
  if n=f then raise exception 'Planning instance context changed'; end if; f:=n;
  n:=replace(f,'  select * into source from fms_instance_stages where id=p_source_visit_id and fms_instance_id=i.id;','  source:=p_source;');
  if n=f then raise exception 'Planning source context changed'; end if;
  n:=replace(n,'coalesce(source.execution_path,''{}'')||source.id','array_remove(coalesce(source.execution_path,''{}'')||source.id,null)');
  execute n;
end $$;
create or replace function fms_candidate_transition_plan(p_instance_id uuid,p_source_visit_id uuid,p_answers jsonb,p_outcome text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare instance fms_instances; source fms_instance_stages;
begin
  select * into instance from fms_instances where id=p_instance_id;
  select * into source from fms_instance_stages where id=p_source_visit_id and fms_instance_id=instance.id;
  return fms_transition_plan_for_context(instance,source,p_answers,p_outcome);
end $$;

create function fms_initial_assignment_preview(p_flow_id uuid,p_target_id uuid,p_answers jsonb,p_handoff_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); flow fms_flows; target fms_stages; initial fms_stages; config jsonb; mapping jsonb;
  chosen uuid; selected uuid[]:='{}'; resolution jsonb; method text; explicit boolean:=false; issue text; field form_fields; reached text[];
begin
  select * into flow from fms_flows where id=p_flow_id and tenant_id=actor.tenant_id;
  select * into target from fms_stages where id=p_target_id and fms_flow_id=flow.id;
  select * into initial from fms_stages where fms_flow_id=flow.id order by sort_order,id limit 1;
  if target.id is null or flow.assignment_version<>2 then raise exception 'Invalid initial assignment preview' using errcode='23514'; end if;
  config:=target.planned_time_rule->'assignment'; method:=config->>'mode';
  if p_handoff_user_id is not null then
    if method='fixed_employee' or not coalesce((config->>'allowHandoff')::boolean,false) then raise exception 'This step does not allow a manual handoff' using errcode='42501'; end if;
    chosen:=p_handoff_user_id; explicit:=true; method:='manual_handoff';
  elsif method in ('fixed_employee','hierarchy') then
    selected:=fms_configured_assignment_candidates(target.id,flow.tenant_id,coalesce(flow.branch_id,actor.branch_id),coalesce(flow.department_id,actor.department_id),method);
  elsif method='previous_stage_employee' then chosen:=actor.id;
  elsif method='previous_form' then
    for mapping in select value from jsonb_array_elements(coalesce(config->'sources','[]')) loop
      if mapping->>'sourceStageKey'<>initial.stage_key or mapping->>'formTemplateId'<>initial.form_template_id::text then continue; end if;
      if nullif(mapping->>'routeRuleId','') is not null and not exists(
        select 1 from fms_branch_rules rule where rule.id=(mapping->>'routeRuleId')::uuid and rule.fms_stage_id=initial.id
          and fms_rule_matches(rule.condition_operator,rule.condition_value,case rule.source_type when 'outcome' then null when 'context' then null else p_answers->rule.source_key end)
      ) then continue; end if;
      select * into field from form_fields where form_template_id=initial.form_template_id and field_key=mapping->>'fieldKey' and field_type='user_dropdown';
      if field.id is null or not field.is_shown or not form_condition_matches(field.conditional_logic,p_answers) or nullif(p_answers->>field.field_key,'') is null then continue; end if;
      reached:=form_reachable_sections(initial.form_template_id,p_answers);
      if reached is not null and not form_field_section_key(field.group_name,(select coalesce(sections,'[]') from form_templates where id=initial.form_template_id))=any(reached) then continue; end if;
      chosen:=(p_answers->>field.field_key)::uuid; explicit:=true; exit;
    end loop;
  end if;
  if chosen is null and cardinality(selected)=0 and config->'fallbackRule' is not null then
    chosen:=case config#>>'{fallbackRule,type}' when 'specific_user' then (config#>>'{fallbackRule,userProfileId}')::uuid when 'reporter' then actor.id when 'previous_step_doer' then actor.id end;
    method:='configured_fallback'; explicit:=false;
  end if;
  if chosen is not null then selected:=array[chosen]; end if;
  begin resolution:=fms_assignment_coverage(target.id,flow.tenant_id,null,selected,explicit);
  exception when check_violation or foreign_key_violation then
    if p_handoff_user_id is not null or config->>'mode'='fixed_employee' or not coalesce((config->>'allowHandoff')::boolean,false) then raise; end if;
    resolution:=jsonb_build_object('selectedUserIds','[]'::jsonb,'effectiveUserIds','[]'::jsonb); issue:='Select an eligible employee before starting this work.';
  end;
  return jsonb_build_object('targetStageId',target.id,'stageName',target.name,'formTemplateId',target.form_template_id,
    'selectedUserId',resolution#>>'{selectedUserIds,0}','effectiveUserId',resolution#>>'{effectiveUserIds,0}',
    'employeeName',(select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=flow.tenant_id and id in(select jsonb_array_elements_text(resolution->'effectiveUserIds')::uuid)),
    'selectedEmployeeName',(select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=flow.tenant_id and id in(select jsonb_array_elements_text(resolution->'selectedUserIds')::uuid)),
    'assignmentMethod',method,'locked',coalesce(config->>'mode'='fixed_employee',false),
    'allowHandoff',coalesce((config->>'allowHandoff')::boolean,false) and coalesce(config->>'mode'<>'fixed_employee',true),'issue',issue);
end $$;

alter function preview_fms_work_transition(jsonb) rename to preview_fms_work_transition_before_start;
create function preview_fms_work_transition(p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare base jsonb; flow fms_flows; initial fms_stages; instance fms_instances; source fms_instance_stages; candidate jsonb; item jsonb; destinations jsonb:='[]';
begin
  base:=preview_fms_work_transition_before_start(p_request);
  if p_request->>'kind' not in ('starter_form','flow_form') then return base; end if;
  if p_request->>'kind'='starter_form' then
    select definition.* into flow from fms_starter_assignments starter join fms_flows definition on definition.id=starter.fms_flow_id where starter.id=(p_request->>'starterAssignmentId')::uuid;
    candidate:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_entry',(p_request->>'starterAssignmentId')::uuid);
  else
    select * into flow from fms_flows where id=(p_request->>'flowId')::uuid;
    candidate:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers',null,null);
  end if;
  if flow.assignment_version<>2 then return base; end if;
  select * into initial from fms_stages where fms_flow_id=flow.id order by sort_order,id limit 1;
  instance.fms_flow_id:=flow.id; instance.tenant_id:=flow.tenant_id; instance.assignment_version:=2;
  instance.branch_id:=coalesce(flow.branch_id,(current_profile()).branch_id); instance.department_id:=coalesce(flow.department_id,(current_profile()).department_id);
  instance.started_by:=(current_profile()).id; instance.context:=jsonb_build_object('form_template_id',initial.form_template_id); instance.status:='active';
  source.fms_stage_id:=initial.id; source.status:='completed'; source.completed_by:=instance.started_by; source.execution_path:='{}';
  for item in select value from jsonb_array_elements(fms_transition_plan_for_context(instance,source,candidate->'answers',null)) loop
    destinations:=destinations||jsonb_build_array(fms_initial_assignment_preview(flow.id,(item->>'targetStageId')::uuid,candidate->'answers',null));
  end loop;
  return base||jsonb_build_object('currentStageName',initial.name,'destinations',destinations,'fingerprint',fms_request_digest(jsonb_build_object('base',base->>'fingerprint','destinations',destinations)::text));
end $$;

create function apply_fms_initial_handoffs(p_instance_id uuid,p_initial_visit_id uuid,p_handoffs jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); instance fms_instances; source fms_instance_stages; target fms_stages; choice jsonb; allowed uuid[];
begin
  if jsonb_typeof(p_handoffs) is distinct from 'array' then raise exception 'Invalid starting handoffs' using errcode='22023'; end if;
  if jsonb_array_length(p_handoffs)=0 then return; end if;
  select * into instance from fms_instances where id=p_instance_id and tenant_id=actor.tenant_id and started_by=actor.id;
  select * into source from fms_instance_stages where id=p_initial_visit_id and fms_instance_id=instance.id and completed_by=actor.id;
  if instance.id is null or source.id is null then raise exception 'Starting handoff is outside your workflow scope' using errcode='42501'; end if;
  allowed:=fms_candidate_destinations(instance.id,source.id,coalesce((select data from form_submissions where id=source.form_submission_id),'{}'),null);
  for choice in select value from jsonb_array_elements(p_handoffs) loop
    select * into target from fms_stages where id=(choice->>'targetStageId')::uuid and fms_flow_id=instance.fms_flow_id;
    if not target.id=any(allowed) or target.planned_time_rule#>>'{assignment,mode}'='fixed_employee' or not coalesce((target.planned_time_rule#>>'{assignment,allowHandoff}')::boolean,false) then raise exception 'Starting handoff does not match the confirmed route' using errcode='23514'; end if;
    perform assert_fms_handoff_recipient((choice->>'userProfileId')::uuid,instance.tenant_id,true);
    insert into fms_stage_assignment_intents(tenant_id,fms_instance_id,source_instance_stage_id,target_stage_id,selected_user_id,actor_id,assignment_method,source_submission_id)
      values(instance.tenant_id,instance.id,source.id,target.id,(choice->>'userProfileId')::uuid,actor.id,'manual_handoff',source.form_submission_id);
  end loop;
end $$;

do $$
declare f text; n text; marker text;
begin
  f:=replace(pg_get_functiondef('start_fms_from_exact_form_submission(uuid,uuid)'::regprocedure), E'\r', '');
  n:=replace(f,'p_flow_id uuid)','p_flow_id uuid, p_start_handoffs jsonb)');
  if n=f then raise exception 'Confirmed exact start signature changed'; end if; f:=n;
  marker:='perform progress_fms_initial_form_internal(v_initial_instance_stage.id);';
  n:=replace(f,marker,'perform apply_fms_initial_handoffs(v_instance.id,v_initial_instance_stage.id,p_start_handoffs); '||marker);
  if n=f then raise exception 'Confirmed exact initial visit changed'; end if; execute n;

  marker:='perform progress_fms_initial_form_internal(v_initial_runtime.id);';
  f:=replace(pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure), E'\r', '');
  n:=replace(f,'FUNCTION public.submit_fms_form_and_progress_with_audit(', 'FUNCTION public.submit_fms_start_form_confirmed(');
  if n=f then raise exception 'Confirmed assigned start signature changed'; end if; f:=n;
  n:=replace(f,'p_next_assignee_id uuid DEFAULT NULL::uuid)', 'p_next_assignee_id uuid DEFAULT NULL::uuid, p_start_handoffs jsonb DEFAULT ''[]''::jsonb)');
  if n=f then raise exception 'Confirmed assigned start arguments changed'; end if; f:=n;
  n:=replace(f,marker,'perform apply_fms_initial_handoffs(v_instance.id,v_initial_runtime.id,p_start_handoffs); '||marker);
  if n=f then raise exception 'Confirmed assigned initial visit changed'; end if;
  n:=replace(n,E'begin\n',E'begin\n  if p_linked_module<>''fms_entry'' then raise exception ''An exact starting assignment is required'' using errcode=''23514''; end if;\n');
  execute n;

  f:=replace(pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure), E'\r', '');
  marker:='    insert into fms_stage_assignment_intents(tenant_id,fms_instance_id,source_instance_stage_id,target_stage_id,selected_user_id,actor_id,assignment_method)';
  n:=replace(f,marker,E'    if module=''fms_stage'' then\n'||marker);
  if n=f then raise exception 'Initial intent deferral marker changed'; end if; f:=n;
  marker:='on conflict(source_instance_stage_id,target_stage_id) do update set selected_user_id=excluded.selected_user_id,actor_id=excluded.actor_id;';
  n:=replace(f,marker,marker||E'\n    end if;');
  if n=f then raise exception 'Initial intent completion marker changed'; end if; f:=n;
  n:=replace(f,$old$raw:=submit_fms_form_and_progress_with_audit((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_entry',target_id,p_idempotency_key);$old$,
    $new$raw:=submit_fms_start_form_confirmed((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_entry',target_id,p_idempotency_key,null,null,'{}',null,p_handoffs);$new$);
  if n=f then raise exception 'Confirmed assigned start dispatch changed'; end if; f:=n;
  n:=replace(f,'start_fms_from_exact_form_submission(submission_id,(p_request->>''flowId'')::uuid)', 'start_fms_from_exact_form_submission(submission_id,(p_request->>''flowId'')::uuid,p_handoffs)');
  if n=f then raise exception 'Confirmed exact start dispatch changed'; end if; execute n;
end $$;
revoke all on function fms_configured_assignment_candidates(uuid,uuid,uuid,uuid,text),fms_assignment_coverage(uuid,uuid,uuid,uuid[],boolean),fms_transition_plan_for_context(fms_instances,fms_instance_stages,jsonb,text),fms_initial_assignment_preview(uuid,uuid,jsonb,uuid),apply_fms_initial_handoffs(uuid,uuid,jsonb),start_fms_from_exact_form_submission(uuid,uuid,jsonb),submit_fms_start_form_confirmed(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid,jsonb),preview_fms_work_transition_before_start(jsonb),preview_fms_work_transition(jsonb) from public,anon,authenticated,service_role;
grant execute on function preview_fms_work_transition(jsonb) to authenticated;
notify pgrst,'reload schema';
