set search_path=public,extensions;
alter table fms_workflow_mutation_keys add column request_hash text;

-- Extract the existing complete Forms validator once, and make final submission
-- use it too. Preview does not insert a throwaway submission or roll back writes.
do $$
declare f text; validator text; n text; insertion integer; validation_start integer;
begin
  f:=pg_get_functiondef('submit_form_locked_with_audit(uuid,jsonb,text,uuid)'::regprocedure);
  insertion:=position('  insert into form_submissions(' in f);
  validation_start:=position('  v_reachable := form_reachable_sections(' in f);
  if insertion=0 or validation_start=0 then raise exception 'Review Forms validation extraction markers'; end if;
  validator:=left(f,insertion-1)||E'  return jsonb_build_object(''answers'',v_normalized,''fileIds'',to_jsonb(v_file_ids));\nend;\n$function$';
  validator:=replace(validator,'FUNCTION public.submit_form_locked_with_audit(','FUNCTION public.fms_validate_candidate_form(');
  validator:=replace(validator,'RETURNS uuid','RETURNS jsonb');
  validator:=replace(replace(validator,' for update',''),' for share','');
  execute validator;
  n:=left(f,validation_start-1)||E'  v_validation:=fms_validate_candidate_form(p_form_template_id,p_answers,p_linked_module,p_linked_record_id);\n  v_normalized:=v_validation->''answers'';\n  v_file_ids:=array(select jsonb_array_elements_text(v_validation->''fileIds'')::uuid);\n'||substring(f from insertion);
  n:=replace(n,'  v_actor user_profiles;', '  v_validation jsonb; v_actor user_profiles;');
  if n=f then raise exception 'Forms validation integration changed'; end if;
  execute n;
end $$;

-- One assignment algorithm for both unsaved candidate answers and actual saved
-- submissions. The four-argument contract remains the activator's entry point.
do $$
declare f text; n text; marker text;
begin
  f:=pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid)'::regprocedure);
  n:=replace(f,'p_handoff_user_id uuid DEFAULT NULL::uuid)', 'p_handoff_user_id uuid, p_candidate_answers jsonb, p_candidate_stage_id uuid)');
  if n=f then raise exception 'Assignment signature changed'; end if; f:=n;
  marker:='select * into submission from form_submissions where id=source_work.form_submission_id and tenant_id=i.tenant_id and status=''submitted'' and form_template_id=source_definition.form_template_id;';
  n:=replace(f,marker,marker||' if p_candidate_answers is not null and source_work.fms_stage_id=p_candidate_stage_id then submission.id:=null; submission.form_template_id:=source_definition.form_template_id; submission.data:=p_candidate_answers; end if;');
  if n=f then raise exception 'Assignment form source changed'; end if; f:=n;
  n:=replace(f,'if submission.id is null or field.id is null', 'if (submission.id is null and not coalesce(p_candidate_answers is not null and source_work.fms_stage_id=p_candidate_stage_id,false)) or field.id is null');
  if n=f then raise exception 'Assignment candidate guard changed'; end if;
  execute n;
end $$;
create or replace function resolve_fms_visit_assignment(p_instance_id uuid,p_target_stage_id uuid,p_source_visit_id uuid,p_handoff_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin return resolve_fms_visit_assignment(p_instance_id,p_target_stage_id,p_source_visit_id,p_handoff_user_id,null,null); end $$;

create function assert_fms_work_actor(p_instance_stage_id uuid)
returns fms_instance_stages language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); work fms_instance_stages; i fms_instances;
begin
  perform assert_module_enabled('fms_builder');
  select * into work from fms_instance_stages where id=p_instance_stage_id;
  select * into i from fms_instances where id=work.fms_instance_id;
  if a.id is null or not current_profile_is_active() or i.id is null or i.tenant_id<>a.tenant_id
    or not (a.id=any(work.assigned_to) or has_permission('tasks.view_all') or has_permission('tasks.manage_team') and i.branch_id=a.branch_id) then
    raise exception 'FMS work is not available to your account' using errcode='42501';
  end if;
  if work.status not in ('pending','in_progress','in_review','overdue') or i.status not in ('active','overdue') then raise exception 'FMS work is no longer actionable' using errcode='23514'; end if;
  return work;
end $$;

create function fms_route_for_candidate(p_stage_id uuid,p_context jsonb,p_answers jsonb,p_outcome text)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare rule fms_branch_rules; actual jsonb;
begin
  for rule in select * from fms_branch_rules where fms_stage_id=p_stage_id order by sort_order,id loop
    actual:=case rule.source_type when 'outcome' then to_jsonb(nullif(btrim(coalesce(p_outcome,'')),'')) when 'context' then p_context->rule.source_key else p_answers->rule.source_key end;
    if fms_rule_matches(rule.condition_operator,rule.condition_value,actual) then return rule.next_stage_id; end if;
  end loop;
  return (select default_next_stage_id from fms_stages where id=p_stage_id);
end $$;

create function fms_candidate_destinations(p_instance_id uuid,p_source_visit_id uuid,p_answers jsonb,p_outcome text)
returns uuid[] language plpgsql stable security definer set search_path=public as $$
declare i fms_instances; source fms_instance_stages; definition fms_stages; target fms_stages;
  queue jsonb; item jsonb; ids uuid[]:='{}'; seen uuid[]:='{}'; next_id uuid; count integer:=0;
begin
  select * into i from fms_instances where id=p_instance_id;
  select * into source from fms_instance_stages where id=p_source_visit_id and fms_instance_id=i.id;
  select * into definition from fms_stages where id=source.fms_stage_id;
  next_id:=fms_route_for_candidate(definition.id,i.context,p_answers,p_outcome);
  queue:=case when next_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',next_id,'answers',p_answers,'outcome',p_outcome)) end;
  while jsonb_array_length(queue)>0 loop
    count:=count+1; if count>100 then raise exception 'Workflow preview reached its automatic-transition limit' using errcode='23514'; end if;
    item:=queue->0; queue:=queue-0;
    select * into target from fms_stages where id=(item->>'id')::uuid and fms_flow_id=i.fms_flow_id;
    if target.id is null then raise exception 'Workflow route points outside its pinned definition' using errcode='23514'; end if;
    if target.id=any(seen) then continue; end if; seen:=array_append(seen,target.id);
    if target.step_type not in ('branch','parallel_start','parallel_join','notification','end') then
      ids:=array_append(ids,target.id); continue;
    end if;
    if target.step_type='end' then continue; end if;
    -- A waiting join creates no successor work. Its last branch will obtain a
    -- fresh preview when it becomes able to release the join.
    if target.step_type='parallel_join' and target.join_rule<>'any' and exists(
      select 1 from fms_instance_stages other where other.fms_instance_id=i.id
        and other.id<>source.id and other.parallel_scope_id is not distinct from source.parallel_scope_id
        and other.status in ('pending','in_progress','in_review','overdue')) then continue; end if;
    if target.step_type='parallel_start' then
      queue:=queue||coalesce((select jsonb_agg(jsonb_build_object('id',id,'answers','{}'::jsonb,'outcome',null)) from unnest(target.parallel_target_stage_ids) id),'[]');
    else
      next_id:=case when target.step_type='branch' then fms_route_for_candidate(target.id,i.context,item->'answers',item->>'outcome') else target.default_next_stage_id end;
      if next_id is not null then queue:=queue||jsonb_build_array(jsonb_build_object('id',next_id,'answers','{}'::jsonb,'outcome',null)); end if;
    end if;
  end loop;
  return ids;
end $$;

create function preview_fms_work_transition(p_request jsonb)
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
    return jsonb_build_object('fingerprint',md5((normalized||jsonb_build_object('_flow',flow.id,'_version',flow.version))::text),
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
  if p_request->>'kind'<>'review' or p_request->>'decision'='approved' then
    for target in select * from fms_stages where id=any(fms_candidate_destinations(i.id,work.id,coalesce(answers,'{}'),p_request->>'outcome')) order by sort_order,id loop
      resolution:=resolve_fms_visit_assignment(i.id,target.id,work.id,null,case when p_request->>'kind'='stage_form' then answers else null end,definition.id);
      selected_id:=(resolution#>>'{selectedUserIds,0}')::uuid; effective_id:=(resolution#>>'{effectiveUserIds,0}')::uuid;
      destinations:=destinations||jsonb_build_array(jsonb_build_object('targetStageId',target.id,'stageName',target.name,'formTemplateId',target.form_template_id,
        'selectedUserId',selected_id,'effectiveUserId',effective_id,'employeeName',(select employee_name from user_profiles where id=effective_id),
        'assignmentMethod',resolution->>'assignmentMethod','locked',target.planned_time_rule#>>'{assignment,mode}'='fixed_employee',
        'allowHandoff',coalesce((target.planned_time_rule#>>'{assignment,allowHandoff}')::boolean,false) and target.planned_time_rule#>>'{assignment,mode}'<>'fixed_employee','issue',null));
    end loop;
  end if;
  return jsonb_build_object('fingerprint',md5(jsonb_build_object('request',normalized,'status',work.status,'assignees',work.assigned_to,'destinations',destinations,'requirements',requirements)::text),
    'currentStageName',definition.name,'wouldDefer',jsonb_array_length(requirements)>0,'requirements',requirements,'destinations',destinations);
end $$;

create function transition_fms_work_with_audit(p_request jsonb,p_idempotency_key uuid,p_handoffs jsonb,p_preview_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); existing fms_workflow_mutation_keys; hash text; target_id uuid; module text;
  preview jsonb; choice jsonb; destination jsonb; work fms_instance_stages; i fms_instances; definition fms_stages;
  submission_id uuid; raw jsonb; actual jsonb; own_targets jsonb; state text; next_user uuid;
begin
  perform assert_module_enabled('fms_builder');
  if a.id is null or not current_profile_is_active() then raise exception 'An active profile is required to submit workflow work' using errcode='42501'; end if;
  if p_idempotency_key is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_handoffs) is distinct from 'array' or jsonb_array_length(p_handoffs)>200 or pg_column_size(p_request)+pg_column_size(p_handoffs)>262144 then raise exception 'Invalid confirmed workflow request' using errcode='22023'; end if;
  target_id:=coalesce(nullif(p_request->>'instanceStageId','')::uuid,nullif(p_request->>'starterAssignmentId','')::uuid,nullif(p_request->>'flowId','')::uuid);
  module:=case when p_request->>'kind' in ('stage_form','complete','review') then 'fms_stage' else 'fms_entry' end;
  if target_id is null then raise exception 'An exact workflow work identity is required' using errcode='22023'; end if;
  hash:=md5(jsonb_build_object('request',p_request,'handoffs',p_handoffs)::text);
  insert into fms_workflow_mutation_keys(tenant_id,actor_id,mutation_key,linked_module,linked_record_id,request_hash)
    values(a.tenant_id,a.id,p_idempotency_key,module,target_id,hash) on conflict(tenant_id,actor_id,mutation_key) do nothing;
  select * into existing from fms_workflow_mutation_keys where tenant_id=a.tenant_id and actor_id=a.id and mutation_key=p_idempotency_key for update;
  if existing.linked_module<>module or existing.linked_record_id<>target_id or existing.request_hash is distinct from hash then raise exception 'Workflow submission key cannot be reused for a different request' using errcode='23514'; end if;
  if existing.completed_at is not null then return existing.response; end if;
  if module='fms_stage' then
    -- Use the same visit -> instance lock order as the existing completion RPC.
    select * into work from fms_instance_stages where id=target_id for update;
    select * into i from fms_instances where id=work.fms_instance_id for update;
  end if;
  preview:=preview_fms_work_transition(p_request);
  if preview->>'fingerprint' is distinct from p_preview_fingerprint then raise exception 'Workflow handoff changed. Review the current preview and confirm again.' using errcode='23514'; end if;
  if jsonb_array_length(p_handoffs)<>(select count(distinct value->>'targetStageId') from jsonb_array_elements(p_handoffs)) then raise exception 'Each destination can have only one handoff' using errcode='23514'; end if;
  for choice in select value from jsonb_array_elements(p_handoffs) loop
    select value into destination from jsonb_array_elements(preview->'destinations') where value->>'targetStageId'=choice->>'targetStageId';
    if destination is null or not coalesce((destination->>'allowHandoff')::boolean,false) then raise exception 'The handoff destination is not available for replacement' using errcode='23514'; end if;
    perform assert_fms_handoff_recipient((choice->>'userProfileId')::uuid,a.tenant_id,true);
    insert into fms_stage_assignment_intents(tenant_id,fms_instance_id,source_instance_stage_id,target_stage_id,selected_user_id,actor_id,assignment_method)
    values(a.tenant_id,i.id,work.id,(choice->>'targetStageId')::uuid,(choice->>'userProfileId')::uuid,a.id,'manual_handoff')
    on conflict(source_instance_stage_id,target_stage_id) do update set selected_user_id=excluded.selected_user_id,actor_id=excluded.actor_id;
  end loop;
  if module='fms_stage' then
    select * into definition from fms_stages where id=work.fms_stage_id;
    if p_request->>'kind'='stage_form' then
      submission_id:=submit_form_with_audit((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_stage',work.id);
      update fms_stage_assignment_intents set source_submission_id=submission_id where source_instance_stage_id=work.id;
      if jsonb_array_length(preview->'requirements')=0 then perform complete_fms_stage_with_audit(work.id,p_request->>'outcome',p_request->>'remark',coalesce(p_request->'checklist','{}'),null); end if;
    elsif p_request->>'kind'='complete' then
      perform complete_fms_stage_with_audit(work.id,p_request->>'outcome',p_request->>'remark',coalesce(p_request->'checklist','{}'),null);
    else
      perform review_fms_stage_with_audit(work.id,p_request->>'decision',p_request->>'remark',null);
    end if;
  elsif p_request->>'kind'='starter_form' then
    raw:=submit_fms_form_and_progress_with_audit((p_request->>'formTemplateId')::uuid,p_request->'answers','fms_entry',target_id,p_idempotency_key);
    submission_id:=(raw->>'submission_id')::uuid;
    select * into i from fms_instances where id=(raw->>'instance_id')::uuid;
    select * into work from fms_instance_stages where fms_instance_id=i.id and form_submission_id=submission_id;
  else
    raise exception 'Use the exact workflow starter assignment for this form' using errcode='23514';
  end if;
  select * into work from fms_instance_stages where id=work.id;
  select * into i from fms_instances where id=work.fms_instance_id;
  select coalesce(jsonb_agg(jsonb_build_object('targetStageId',stage.id,'stageName',stage.name,'formTemplateId',stage.form_template_id,
    'selectedUserId',decision.selected_user_ids[1],'effectiveUserId',next.assigned_to[1],
    'employeeName',(select employee_name from user_profiles where id=next.assigned_to[1]),'assignmentMethod',coalesce(decision.assignment_method,'legacy'),
    'locked',coalesce(stage.planned_time_rule#>>'{assignment,mode}'='fixed_employee',false),'allowHandoff',false,'issue',null) order by next.created_at,next.id),'[]') into actual
    from fms_instance_stages next join fms_stages stage on stage.id=next.fms_stage_id
    left join fms_stage_assignment_decisions decision on decision.target_instance_stage_id=next.id
    where next.fms_instance_id=i.id and work.id=any(next.execution_path) and next.id<>work.id
      and next.status in ('pending','in_progress','in_review','overdue');
  select coalesce(jsonb_agg(jsonb_build_object('kind',case when stage.form_template_id is null then 'stage' else 'stage_form' end,'instanceId',i.id,'instanceStageId',next.id,'formTemplateId',stage.form_template_id)),'[]') into own_targets
    from fms_instance_stages next join fms_stages stage on stage.id=next.fms_stage_id where next.fms_instance_id=i.id and a.id=any(next.assigned_to) and next.status in ('pending','in_progress','in_review','overdue');
  state:=case when i.status='completed' then 'workflow_completed' when work.status='completed' and jsonb_array_length(actual)>0 then 'successors_activated'
    when work.status='completed' or definition.completion_rule='all_doers' then 'awaiting_other_doers' when definition.step_type='approval' then 'awaiting_approval' else 'form_saved_pending_completion' end;
  raw:=jsonb_build_object('state',state,'submissionId',coalesce(submission_id,work.form_submission_id),'instanceId',i.id,'sourceInstanceStageId',work.id,'referenceNumber',i.reference_number,'destinations',actual,'ownWorkTargets',own_targets);
  update fms_workflow_mutation_keys set response=raw,completed_at=now() where id=existing.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'fms_work_handoff_confirmed','fms_instance_stages',work.id,jsonb_build_object('state',state,'destinations',actual,'mutation_key',p_idempotency_key));
  return raw;
end $$;

create function list_fms_handoff_recipients(p_request jsonb,p_target_stage_id uuid,p_query text default '',p_cursor uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare preview jsonb; a user_profiles:=current_profile(); people jsonb;
begin
  preview:=preview_fms_work_transition(p_request);
  if not exists(select 1 from jsonb_array_elements(preview->'destinations') destination where destination->>'targetStageId'=p_target_stage_id::text and (destination->>'allowHandoff')::boolean) then raise exception 'This destination does not allow replacement' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(person)),'[]') into people from (
    select u.id,u.employee_name,u.branch_id,u.department_id,designation.label as designation,b.name as branch,d.name as department
    from user_profiles u left join branches b on b.id=u.branch_id left join departments d on d.id=u.department_id
    left join dropdown_masters designation on designation.id=u.designation_id
    where u.tenant_id=a.tenant_id and u.account_status='active' and u.working_status='active' and u.is_login_enabled
      and (u.id=a.id or has_permission('tasks.assign_others')) and task_assignment_user_in_scope(u.id) and task_assignment_recipient_allowed(u.id)
      and (p_cursor is null or u.id>p_cursor) and position(lower(left(coalesce(p_query,''),100)) in lower(u.employee_name))>0
    order by u.id limit greatest(1,least(coalesce(p_limit,50),100))
  ) person;
  return jsonb_build_object('people',people,'nextCursor',case when jsonb_array_length(people)=greatest(1,least(coalesce(p_limit,50),100)) then people->-1->>'id' else null end);
end $$;

revoke all on function fms_validate_candidate_form(uuid,jsonb,text,uuid),resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid),assert_fms_work_actor(uuid),fms_route_for_candidate(uuid,jsonb,jsonb,text),fms_candidate_destinations(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function preview_fms_work_transition(jsonb),transition_fms_work_with_audit(jsonb,uuid,jsonb,text),list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function preview_fms_work_transition(jsonb),transition_fms_work_with_audit(jsonb,uuid,jsonb,text),list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
