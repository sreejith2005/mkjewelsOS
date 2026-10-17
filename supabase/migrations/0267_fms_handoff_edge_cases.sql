set search_path=public,extensions;

create function fms_request_digest(p_payload text) returns text
language sql immutable strict set search_path=public,extensions as $$
  select encode(extensions.digest(p_payload,'sha256'),'hex')
$$;
revoke all on function fms_request_digest(text) from public,anon,authenticated,service_role;

create or replace function preview_fms_work_transition(p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); work fms_instance_stages; i fms_instances; definition fms_stages;
  answers jsonb:='{}'; result jsonb; destinations jsonb:='[]'; target fms_stages; resolution jsonb;
  selected_id uuid; effective_id uuid; requirements jsonb:='[]'; normalized jsonb:=p_request;
  starter fms_starter_assignments; flow fms_flows;
begin
  perform assert_module_enabled('fms_builder');
  if a.id is null or not current_profile_is_active() then raise exception 'An active profile is required to submit workflow work' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or pg_column_size(p_request)>131072 or coalesce(p_request->>'kind','') not in ('stage_form','complete','review','starter_form','flow_form') then raise exception 'Invalid workflow transition request' using errcode='22023'; end if;
  if p_request->>'kind' in ('starter_form','flow_form') then
    if p_request->>'kind'='starter_form' then
      select * into starter from fms_starter_assignments where id=(p_request->>'starterAssignmentId')::uuid and tenant_id=a.tenant_id and user_profile_id=a.id and status='pending';
      select * into flow from fms_flows where id=starter.fms_flow_id and tenant_id=a.tenant_id and status='published' and is_active;
      if starter.id is null or flow.id is null then raise exception 'FMS starter assignment is not available' using errcode='42501'; end if;
      result:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_entry',starter.id);
    else
      select * into flow from fms_flows where id=(p_request->>'flowId')::uuid and tenant_id=a.tenant_id and status='published' and is_active;
      if flow.id is null or not can_start_fms_flow(flow.id,coalesce(flow.branch_id,a.branch_id),coalesce(flow.department_id,a.department_id)) then raise exception 'FMS starting form is not available' using errcode='42501'; end if;
      if (select form_template_id from fms_stages where fms_flow_id=flow.id order by sort_order,id limit 1) is distinct from (p_request->>'formTemplateId')::uuid then raise exception 'Starting form does not match the exact published workflow' using errcode='23514'; end if;
      result:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers',null,null);
    end if;
    normalized:=jsonb_set(p_request,'{answers}',result->'answers');
    return jsonb_build_object('fingerprint',fms_request_digest((normalized||jsonb_build_object('_flow',flow.id,'_version',flow.version))::text),
      'currentStageName',flow.name,'wouldDefer',false,'requirements','[]'::jsonb,'destinations','[]'::jsonb);
  end if;
  work:=assert_fms_work_actor((p_request->>'instanceStageId')::uuid);
  select * into i from fms_instances where id=work.fms_instance_id;
  select * into definition from fms_stages where id=work.fms_stage_id;
  if p_request->>'kind'='stage_form' then
    result:=fms_validate_candidate_form((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_stage',work.id);
    answers:=result->'answers'; normalized:=jsonb_set(p_request,'{answers}',answers);
  else
    select coalesce(data,'{}') into answers from form_submissions where id=work.form_submission_id;
  end if;
  if definition.requires_upload and not exists(select 1 from fms_evidence where fms_instance_stage_id=work.id and removed_at is null) then requirements:=requirements||'"Required evidence is missing"'::jsonb; end if;
  if definition.requires_remark and nullif(btrim(p_request->>'remark'),'') is null then requirements:=requirements||'"A completion remark is required"'::jsonb; end if;
  if exists(select 1 from fms_instance_checklist_items where fms_instance_stage_id=work.id and is_required and not is_completed and not coalesce((p_request#>>array['checklist',item_key])::boolean,false)) then requirements:=requirements||'"Required checklist items remain"'::jsonb; end if;
  if definition.step_type='approval' and p_request->>'kind'<>'review' then requirements:=requirements||'"Manager approval is required"'::jsonb; end if;
  if definition.completion_rule='all_doers' and exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id=work.id and is_active and user_profile_id<>a.id and status<>'completed') then requirements:=requirements||'"Other assigned employees must complete their work"'::jsonb; end if;
  if coalesce(definition.planned_time_rule->>'decisionMode','normal') in ('yes_no','decision') and nullif(btrim(p_request->>'outcome'),'') is null and p_request->>'kind'<>'review' then
    requirements:=requirements||'"Choose the decision outcome"'::jsonb;
  end if;
  if not (requirements ? 'Choose the decision outcome') then
    for target in select * from fms_stages where id=any(fms_candidate_destinations(i.id,work.id,coalesce(answers,'{}'),case when p_request->>'kind'='review' then p_request->>'decision' else p_request->>'outcome' end)) order by sort_order,id loop
      begin
        resolution:=resolve_fms_visit_assignment(i.id,target.id,work.id,case when i.assignment_version=1 then nullif(p_request->>'nextAssigneeId','')::uuid else null end,case when p_request->>'kind'='stage_form' then answers else null end,definition.id);
      exception when check_violation or foreign_key_violation then
        -- Scope/protected-account failures (42501) always propagate. Only a
        -- missing/unavailable owner may be resolved by an authorized handoff.
        if i.assignment_version<>2 or target.planned_time_rule#>>'{assignment,mode}'='fixed_employee'
          or not coalesce((target.planned_time_rule#>>'{assignment,allowHandoff}')::boolean,false)
          or (sqlerrm not like 'No eligible employee for step %' and sqlerrm not like 'Employee for step % is unavailable%' and sqlerrm not like '%not an active%') then raise; end if;
        resolution:=jsonb_build_object('selectedUserIds','[]'::jsonb,'effectiveUserIds','[]'::jsonb,'assignmentMethod','manual_handoff','issue','Select an eligible employee before confirming.');
      end;
      selected_id:=(resolution#>>'{selectedUserIds,0}')::uuid; effective_id:=(resolution#>>'{effectiveUserIds,0}')::uuid;
      destinations:=destinations||jsonb_build_array(jsonb_build_object('targetStageId',target.id,'stageName',target.name,'formTemplateId',target.form_template_id,
        'selectedUserId',selected_id,'effectiveUserId',effective_id,'employeeName',(select employee_name from user_profiles where id=effective_id),
        'assignmentMethod',resolution->>'assignmentMethod','locked',coalesce(target.planned_time_rule#>>'{assignment,mode}'='fixed_employee',false),
        'allowHandoff',coalesce((target.planned_time_rule#>>'{assignment,allowHandoff}')::boolean,false) and coalesce(target.planned_time_rule#>>'{assignment,mode}'<>'fixed_employee',true),'issue',resolution->>'issue'));
    end loop;
  end if;
  return jsonb_build_object('fingerprint',fms_request_digest(jsonb_build_object('request',normalized,'status',work.status,'assignees',work.assigned_to,'destinations',destinations,'requirements',requirements)::text),
    'currentStageName',definition.name,'wouldDefer',jsonb_array_length(requirements)>0,'requirements',requirements,'destinations',destinations);
end $$;

-- Amend existing execution contracts without replacing their route/join engine.
do $$
declare f text; n text; marker text;
begin
  f:=pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure);
  n:=replace(f,'hash:=md5(', 'hash:=fms_request_digest(');
  if n=f then raise exception 'Transition digest marker changed'; end if; f:=n;
  marker:='    select * into definition from fms_stages where id=work.fms_stage_id;';
  n:=replace(f,marker,marker||$insert$
    next_user:=case when i.assignment_version=1 then nullif(p_request->>'nextAssigneeId','')::uuid else null end;
    if next_user is not null then perform assert_fms_handoff_recipient(next_user,a.tenant_id,true); end if;
$insert$);
  if n=f then raise exception 'Transition legacy owner marker changed'; end if; f:=n;
  n:=replace(f,$old$jsonb_array_length(preview->'requirements')=0$old$,$new$jsonb_array_length((preview->'requirements')-'Other assigned employees must complete their work')=0$new$);
  if n=f then raise exception 'Transition multi-doer marker changed'; end if; f:=n;
  n:=replace(f,$old$coalesce(p_request->'checklist','{}'),null)$old$,$new$coalesce(p_request->'checklist','{}'),next_user)$new$);
  if n=f then raise exception 'Transition completion marker changed'; end if; f:=n;
  n:=replace(f,$old$p_request->>'decision',p_request->>'remark',null)$old$,$new$p_request->>'decision',p_request->>'remark',next_user)$new$);
  if n=f then raise exception 'Transition review marker changed'; end if;
  execute n;

  f:=pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure);
  n:=replace(f,'if v_stage.requires_next_doer_handoff and p_next_assignee_id is null then',
    'if v_instance.assignment_version=1 and v_stage.requires_next_doer_handoff and p_next_assignee_id is null then');
  if n=f then raise exception 'Legacy scalar handoff marker changed'; end if; execute n;

  f:=pg_get_functiondef('fms_instance_initial_assignment_from_form()'::regprocedure);
  marker:=E'  if (select assignment_version from public.fms_flows where id=new.fms_flow_id)=2 then\n    new.context:=coalesce(new.context,''{}''::jsonb)-''_fms_assignment_user_id''; return new;\n  end if;\n';
  n:=replace(f,marker,'');
  if n=f then raise exception 'Initial identity guard marker changed'; end if; f:=n;
  marker:='  v_user_id:=fms_assignment_user_from_submission(v_stage.id,v_submission.id);';
  n:=replace(f,marker,E'  if (select assignment_version from fms_flows where id=new.fms_flow_id)=2 then return new; end if;\n'||marker);
  if n=f then raise exception 'Initial user extraction marker changed'; end if; execute n;

  f:=pg_get_functiondef('get_fms_assigned_work_context(uuid,uuid,text,integer)'::regprocedure);
  n:=replace(f,'order by item.id','order by item."createdAt",item.id');
  n:=replace(n,'select prior.id,definition.name','select prior.id,prior.created_at as "createdAt",definition.name');
  n:=replace(n,'(p_cursor is null or prior.id>p_cursor::uuid)',
    '(p_cursor is null or (prior.created_at,prior.id)>(select cursor.created_at,cursor.id from fms_instance_stages cursor where cursor.id=p_cursor::uuid and cursor.fms_instance_id=i.id and cursor.id=any(work.execution_path)))');
  n:=replace(n,'order by prior.id limit effective_limit','order by prior.created_at,prior.id limit effective_limit');
  if n=f then raise exception 'Work journey pagination marker changed'; end if; execute n;

  f:=pg_get_functiondef('submit_form_and_start_fms_idempotent(uuid,jsonb,uuid,uuid)'::regprocedure);
  n:=replace(f,'md5(', 'fms_request_digest(');
  if n=f then raise exception 'Starter digest marker changed'; end if; execute n;
end $$;
notify pgrst,'reload schema';
