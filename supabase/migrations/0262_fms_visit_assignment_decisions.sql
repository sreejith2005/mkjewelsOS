set search_path=public,extensions;
create table fms_stage_assignment_intents(
  tenant_id uuid not null references tenants(id), fms_instance_id uuid not null references fms_instances(id) on delete cascade,
  source_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  target_stage_id uuid not null references fms_stages(id), source_submission_id uuid references form_submissions(id),
  selected_user_id uuid not null references user_profiles(id), actor_id uuid not null references user_profiles(id),
  assignment_method text not null, created_at timestamptz not null default now(),
  primary key(source_instance_stage_id,target_stage_id)
);
create table fms_stage_assignment_decisions(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  fms_instance_id uuid not null references fms_instances(id) on delete cascade,
  source_instance_stage_id uuid references fms_instance_stages(id) on delete cascade,
  target_stage_id uuid not null references fms_stages(id),
  target_instance_stage_id uuid not null unique references fms_instance_stages(id) on delete cascade,
  source_submission_id uuid references form_submissions(id), selected_user_ids uuid[] not null,
  effective_user_ids uuid[] not null, assignment_method text not null, actor_id uuid not null references user_profiles(id),
  execution_scope_id uuid, parallel_scope_id uuid, parallel_branch_id uuid, visit_number integer not null,
  created_at timestamptz not null default now()
);
create index fms_assignment_intents_instance on fms_stage_assignment_intents(fms_instance_id);
create index fms_assignment_intents_target on fms_stage_assignment_intents(target_stage_id);
create index fms_assignment_intents_submission on fms_stage_assignment_intents(source_submission_id);
create index fms_assignment_decisions_instance on fms_stage_assignment_decisions(fms_instance_id,created_at);
create index fms_assignment_decisions_source on fms_stage_assignment_decisions(source_instance_stage_id);
create index fms_assignment_decisions_target on fms_stage_assignment_decisions(target_stage_id);
create index fms_assignment_decisions_submission on fms_stage_assignment_decisions(source_submission_id);
alter table fms_stage_assignment_intents enable row level security;
alter table fms_stage_assignment_decisions enable row level security;
revoke all on fms_stage_assignment_intents,fms_stage_assignment_decisions from public,anon,authenticated,service_role;
grant select on fms_stage_assignment_intents,fms_stage_assignment_decisions to authenticated;
create policy fms_assignment_intents_read on fms_stage_assignment_intents for select to authenticated
  using(tenant_id=current_tenant_id() and can_read_fms_instance(fms_instance_id));
create policy fms_assignment_intents_module on fms_stage_assignment_intents as restrictive for select to authenticated using(module_accessible('fms_builder'));
create policy fms_assignment_decisions_read on fms_stage_assignment_decisions for select to authenticated
  using(tenant_id=current_tenant_id() and can_read_fms_instance(fms_instance_id));
create policy fms_assignment_decisions_module on fms_stage_assignment_decisions as restrictive for select to authenticated using(module_accessible('fms_builder'));

create function assert_fms_handoff_recipient(p_user_id uuid,p_tenant_id uuid,p_explicit boolean default true)
returns void language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  perform assert_direct_assignment_user(p_user_id,p_tenant_id,'FMS');
  if p_explicit then
    if a.id is null or a.tenant_id<>p_tenant_id or not current_profile_is_active()
      or (p_user_id<>a.id and not has_permission('tasks.assign_others'))
      or not task_assignment_user_in_scope(p_user_id) or not task_assignment_recipient_allowed(p_user_id) then
      raise exception 'Employee is outside your permitted FMS handoff scope' using errcode='42501';
    end if;
  end if;
end $$;

-- Returns a decision, without persisting or changing any work. The activator
-- records it only after the target visit has actually been created.
create function resolve_fms_visit_assignment(p_instance_id uuid,p_target_stage_id uuid,p_source_visit_id uuid,p_handoff_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare i fms_instances; target fms_stages; prior fms_instance_stages; source_work fms_instance_stages;
  source_definition fms_stages; submission form_submissions; source jsonb; field form_fields; c jsonb;
  chosen uuid; source_id uuid; submission_id uuid; method text; chosen_ids uuid[]; effective_ids uuid[]:='{}';
  candidate uuid; covered record; target_date date; fallback jsonb; intent fms_stage_assignment_intents;
  depth bigint; best_depth bigint:=-1; reached text[]; initial_id uuid; explicit_choice boolean:=false;
begin
  select * into i from fms_instances where id=p_instance_id;
  select * into target from fms_stages where id=p_target_stage_id;
  if i.id is null or target.id is null or target.fms_flow_id<>i.fms_flow_id then raise exception 'Invalid FMS assignment destination' using errcode='23514'; end if;
  if i.assignment_version<>2 or target.step_type in ('branch','parallel_start','parallel_join','notification','end') then
    chosen_ids:=resolve_fms_stage_assignees(target.id,i.id,p_handoff_user_id);
    return jsonb_build_object('selectedUserIds',to_jsonb(chosen_ids),
      'effectiveUserIds',to_jsonb(chosen_ids),'assignmentMethod','legacy');
  end if;
  select * into prior from fms_instance_stages where id=p_source_visit_id and fms_instance_id=i.id;
  if p_source_visit_id is not null and prior.id is null then raise exception 'Assignment source belongs to another workflow' using errcode='42501'; end if;
  select id into initial_id from fms_stages where fms_flow_id=i.fms_flow_id order by sort_order,id limit 1;
  c:=target.planned_time_rule->'assignment'; fallback:=c->'fallbackRule';
  if target.id=initial_id and prior.id is null then chosen:=i.started_by; method:='initial_submitter';
  else
    if c is null then raise exception 'Choose an assignment strategy for step %',target.name using errcode='23514'; end if;
    -- Only the current causal path may supply a pending choice.
    select pending.* into intent from unnest(coalesce(prior.execution_path,'{}')||coalesce(array[prior.id],'{}')) with ordinality path(id,depth)
      join fms_stage_assignment_intents pending on pending.source_instance_stage_id=path.id
      where pending.target_stage_id=target.id and pending.fms_instance_id=i.id
      order by path.depth desc limit 1;
    if c->>'mode'='fixed_employee' then
      chosen_ids:=resolve_fms_stage_assignees_before_form_user(target.id,i.id,null); method:='fixed_employee';
      if coalesce(p_handoff_user_id,intent.selected_user_id) is not null and not coalesce(p_handoff_user_id,intent.selected_user_id)=any(chosen_ids) then raise exception 'Step % is locked to its published fixed employee',target.name using errcode='23514'; end if;
    elsif p_handoff_user_id is not null or intent.selected_user_id is not null then
      if not coalesce((c->>'allowHandoff')::boolean,false) then raise exception 'Manual handoff is disabled for step %',target.name using errcode='42501'; end if;
      chosen:=coalesce(p_handoff_user_id,intent.selected_user_id); method:='manual_handoff'; explicit_choice:=true;
      source_id:=coalesce(intent.source_instance_stage_id,prior.id); submission_id:=intent.source_submission_id;
    elsif c->>'mode'='previous_form' then
      for source in select value from jsonb_array_elements(coalesce(c->'sources','[]')) loop
        select work.* into source_work
          from unnest(coalesce(prior.execution_path,'{}')||coalesce(array[prior.id],'{}')) with ordinality path(id,depth)
          join fms_instance_stages work on work.id=path.id and work.fms_instance_id=i.id
          join fms_stages definition on definition.id=work.fms_stage_id
          where definition.stage_key=source->>'sourceStageKey' and definition.form_template_id=(source->>'formTemplateId')::uuid
            and (nullif(source->>'routeRuleId','') is null or work.branch_rule_id::text=source->>'routeRuleId')
          order by path.depth desc limit 1;
        if source_work.id is null then continue; end if;
        select max(path.depth) into depth from unnest(coalesce(prior.execution_path,'{}')||array[prior.id]) with ordinality path(id,depth) where path.id=source_work.id;
        select * into source_definition from fms_stages where id=source_work.fms_stage_id;
        select * into submission from form_submissions where id=source_work.form_submission_id and tenant_id=i.tenant_id and status='submitted' and form_template_id=source_definition.form_template_id;
        select * into field from form_fields where form_template_id=source_definition.form_template_id and field_key=source->>'fieldKey' and field_type='user_dropdown';
        if submission.id is null or field.id is null or not field.is_shown or not form_condition_matches(field.conditional_logic,submission.data) then continue; end if;
        reached:=form_reachable_sections(submission.form_template_id,submission.data);
        if reached is not null and not form_field_section_key(field.group_name,(select coalesce(sections,'[]') from form_templates where id=submission.form_template_id))=any(reached) then continue; end if;
        if nullif(submission.data->>field.field_key,'') is null then continue; end if;
        if (select step_type from fms_stages where id=prior.fms_stage_id)='parallel_join' and chosen is not null and chosen<>(submission.data->>field.field_key)::uuid then raise exception 'Conflicting branch employees for step %. Choose one explicit source mapping.',target.name using errcode='23514'; end if;
        if depth>best_depth then
          chosen:=(submission.data->>field.field_key)::uuid; best_depth:=depth;
          source_id:=source_work.id; submission_id:=submission.id; method:='previous_form'; explicit_choice:=true;
        end if;
      end loop;
    elsif c->>'mode'='hierarchy' then
      if exists(select 1 from fms_stage_assignees where fms_stage_id=target.id and assignee_type in ('previous_step_doer','reporter')) then raise exception 'Choose Previous Stage Employee or an explicit reporter fallback for step %',target.name using errcode='23514'; end if;
      chosen_ids:=resolve_fms_stage_assignees_before_form_user(target.id,i.id,null); method:='hierarchy';
    elsif c->>'mode'='previous_stage_employee' then
      -- A structural predecessor has no doer: follow its causal path to the
      -- nearest completed human action rather than an unrelated branch.
      select work.* into source_work from unnest(coalesce(prior.execution_path,'{}')||coalesce(array[prior.id],'{}')) with ordinality path(id,depth)
        join fms_instance_stages work on work.id=path.id and work.fms_instance_id=i.id
        join fms_stages definition on definition.id=work.fms_stage_id
        where definition.step_type not in ('branch','parallel_start','parallel_join','notification','end') and work.completed_by is not null order by path.depth desc limit 1;
      chosen:=source_work.completed_by; source_id:=source_work.id; method:='previous_stage_employee';
    end if;
  end if;
  if chosen is not null then
    -- Invalid UUIDs/forged scope never fall through to a configured default.
    begin perform assert_fms_handoff_recipient(chosen,i.tenant_id,explicit_choice);
    exception when foreign_key_violation then
      if fallback is null then raise; end if; chosen:=null;
    end;
  end if;
  if chosen is null and cardinality(coalesce(chosen_ids,'{}'))=0 and fallback is not null then
    chosen:=case fallback->>'type' when 'specific_user' then (fallback->>'userProfileId')::uuid when 'reporter' then i.started_by when 'previous_step_doer' then prior.completed_by end;
    method:='configured_fallback'; explicit_choice:=false;
  end if;
  if chosen is not null then chosen_ids:=array[chosen]; end if;
  if cardinality(coalesce(chosen_ids,'{}'))=0 then raise exception 'No eligible employee for step %. Select a handoff or configure a valid fallback.',target.name using errcode='23514'; end if;
  target_date:=(fms_stage_deadline_for_instance(target.planned_time_rule,i.tenant_id,i.id) at time zone 'Asia/Kolkata')::date;
  foreach candidate in array chosen_ids loop
    perform assert_fms_handoff_recipient(candidate,i.tenant_id,explicit_choice);
    select * into covered from resolve_task_coverage(candidate,coalesce(target_date,(now() at time zone 'Asia/Kolkata')::date));
    if covered.effective_assignee_id is null then raise exception 'Employee for step % is unavailable and needs configured coverage',target.name using errcode='23514'; end if;
    perform assert_fms_handoff_recipient(covered.effective_assignee_id,i.tenant_id,explicit_choice);
    effective_ids:=array_append(effective_ids,covered.effective_assignee_id);
  end loop;
  if not target.allow_multiple_doers and cardinality(effective_ids)>1 then raise exception 'Choose one eligible employee for step %',target.name using errcode='23514'; end if;
  return jsonb_build_object('selectedUserIds',to_jsonb(chosen_ids),'effectiveUserIds',to_jsonb(effective_ids),
    'sourceVisitId',coalesce(source_id,prior.id),'sourceSubmissionId',submission_id,
    'actorId',coalesce(intent.actor_id,(current_profile()).id,i.started_by),'assignmentMethod',method);
end $$;

create function record_fms_visit_assignment(p_visit_id uuid,p_resolution jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare work fms_instance_stages; i fms_instances;
begin
  select * into work from fms_instance_stages where id=p_visit_id;
  select * into i from fms_instances where id=work.fms_instance_id;
  if i.assignment_version<>2 or p_resolution->>'assignmentMethod'='legacy' then return; end if;
  insert into fms_stage_assignment_decisions(tenant_id,fms_instance_id,source_instance_stage_id,target_stage_id,target_instance_stage_id,
    source_submission_id,selected_user_ids,effective_user_ids,assignment_method,actor_id,execution_scope_id,parallel_scope_id,parallel_branch_id,visit_number)
  values(i.tenant_id,i.id,(p_resolution->>'sourceVisitId')::uuid,work.fms_stage_id,work.id,(p_resolution->>'sourceSubmissionId')::uuid,
    array(select jsonb_array_elements_text(p_resolution->'selectedUserIds')::uuid),work.assigned_to,p_resolution->>'assignmentMethod',
    (p_resolution->>'actorId')::uuid,work.execution_scope_id,work.parallel_scope_id,work.parallel_branch_id,work.visit_number)
    on conflict(target_instance_stage_id) do nothing;
  if found then
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
    values(i.tenant_id,(p_resolution->>'actorId')::uuid,'fms_visit_employee_resolved','fms_instance_stages',work.id,p_resolution);
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(work.id,(p_resolution->>'actorId')::uuid,'assignment_resolved',p_resolution);
  end if;
end $$;

-- Keep the existing execution engine, join implementation and visit identity.
do $$
declare f text; n text; marker text;
begin
  f:=pg_get_functiondef('activate_fms_stage_v2_internal(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid[],uuid)'::regprocedure);
  n:=replace(f,'declare v_instance fms_instances;','declare v_assignment jsonb; v_instance fms_instances;');
  if n=f then raise exception 'Activation declaration changed'; end if; f:=n;
  n:=replace(f,'v_ids=resolve_fms_stage_assignees(p_stage_id,p_instance_id,p_selected_user);',
    'v_assignment:=resolve_fms_visit_assignment(p_instance_id,p_stage_id,p_previous_instance_stage_id,p_selected_user); v_ids:=array(select jsonb_array_elements_text(v_assignment->''effectiveUserIds'')::uuid);');
  if n=f then raise exception 'Activation resolver changed'; end if; f:=n;
  marker:='v_ids,fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),p_previous_instance_stage_id,v_revision_of,v_pass,v_path,v_parallel,v_branch) returning * into v_instance_stage;';
  n:=replace(f,marker,marker||' perform record_fms_visit_assignment(v_instance_stage.id,v_assignment);');
  if n=f then raise exception 'Activation insertion changed'; end if;
  execute n;
end $$;
revoke all on function assert_fms_handoff_recipient(uuid,uuid,boolean),resolve_fms_visit_assignment(uuid,uuid,uuid,uuid),record_fms_visit_assignment(uuid,jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
