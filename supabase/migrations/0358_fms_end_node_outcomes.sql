-- Explicit FMS End Nodes with classified terminal outcomes.
--
-- An End Node (fms_stages.step_type='end', settings in planned_time_rule->'terminal')
-- is an automatic terminal destination. When the engine activates one, it closes
-- the whole instance in the same transaction: open sibling work is stopped (kept,
-- never marked completed), one immutable fms_instance_outcomes row is written, and
-- the instance becomes completed. No task, form, handoff or notification is created.
-- Workflows that finish implicitly (no outgoing route) keep their behaviour and
-- have no outcome row; reports classify them as "unspecified".
set search_path=public,extensions;

create table fms_instance_outcomes(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  fms_instance_id uuid not null references fms_instances(id) on delete cascade,
  fms_flow_id uuid not null references fms_flows(id),
  flow_family_id uuid not null,
  flow_version integer not null,
  end_stage_id uuid not null references fms_stages(id),
  end_stage_key text not null,
  end_stage_name text not null,
  outcome text not null check (outcome in ('won','lost','do_not_contact','other')),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  end_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  source_instance_stage_id uuid references fms_instance_stages(id) on delete cascade,
  source_stage_id uuid references fms_stages(id),
  branch_rule_id uuid,
  route_label text,
  source_question_key text,
  source_value jsonb,
  source_submission_id uuid,
  finalized_by uuid references user_profiles(id),
  final_status text not null default 'completed' check (final_status='completed'),
  provenance text not null default 'end_node' check (provenance='end_node'),
  stopped_visit_count integer not null default 0 check (stopped_visit_count>=0),
  branch_id uuid,
  department_id uuid,
  instance_started_at timestamptz not null,
  closed_at timestamptz not null default now(),
  -- One terminal outcome per instance: a retry or a second End Node can never add another.
  constraint fms_instance_outcomes_one_per_instance unique(fms_instance_id)
);
create index fms_instance_outcomes_family on fms_instance_outcomes(tenant_id,flow_family_id,outcome);
create index fms_instance_outcomes_end_stage on fms_instance_outcomes(tenant_id,end_stage_id);
create index fms_instance_outcomes_closed on fms_instance_outcomes(tenant_id,closed_at);
create index fms_instances_report_cohort on fms_instances(tenant_id,flow_family_id,started_at);

alter table fms_instance_outcomes enable row level security;
revoke all on fms_instance_outcomes from public,anon,authenticated,service_role;
grant select on fms_instance_outcomes to authenticated;
create policy fms_instance_outcomes_select on fms_instance_outcomes for select to authenticated
  using(tenant_id=current_tenant_id() and can_read_fms_instance(fms_instance_id));

-- The terminal record is history: it is written once by the engine and never edited.
create function guard_fms_instance_outcome_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  raise exception 'A workflow outcome is permanent and cannot be changed' using errcode='42501';
end $$;
create trigger fms_instance_outcome_immutable before update on fms_instance_outcomes
  for each row execute function guard_fms_instance_outcome_immutable();

-- End Node settings, read the same way by the publisher, the engine and reports.
create function fms_end_node_outcome(p_rule jsonb) returns text
language sql immutable set search_path=public as $$
  select case when p_rule#>>'{terminal,outcome}' in ('won','lost','do_not_contact','other') then p_rule#>>'{terminal,outcome}' end
$$;

/*
 * Close an instance at an End Node. Runs inside the engine transaction that
 * activated the End Node, with the instance row already locked. Idempotent: a
 * second call for the same instance returns without writing anything.
 */
create function fms_finalize_terminal_internal(p_instance_id uuid,p_end_visit_id uuid,p_source_visit_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_instance fms_instances; v_end fms_instance_stages; v_stage fms_stages; v_flow fms_flows; v_source fms_instance_stages;
  v_rule fms_branch_rules; v_outcome text; v_reason text; v_actor uuid; v_value jsonb; v_stopped integer:=0; v_visit record;
begin
  select * into v_instance from fms_instances where id=p_instance_id for update;
  select * into v_end from fms_instance_stages where id=p_end_visit_id and fms_instance_id=p_instance_id;
  select * into v_stage from fms_stages where id=v_end.fms_stage_id;
  if v_instance.id is null or v_end.id is null or v_stage.step_type<>'end' then raise exception 'End Node activation is invalid' using errcode='23514'; end if;
  if exists(select 1 from fms_instance_outcomes where fms_instance_id=p_instance_id) then return; end if;
  v_outcome:=fms_end_node_outcome(v_stage.planned_time_rule);
  -- A legacy End stage without settings keeps its historical behaviour: it only completes the instance.
  if v_outcome is null then
    update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id and status in ('active','overdue');
    return;
  end if;
  v_reason:=nullif(lower(btrim(v_stage.planned_time_rule#>>'{terminal,reasonCode}')),'');
  if v_reason is not null and v_reason !~ '^[a-z][a-z0-9_]{0,63}$' then v_reason:=null; end if;
  v_actor:=coalesce((current_profile()).id,v_instance.started_by);
  select * into v_flow from fms_flows where id=v_instance.fms_flow_id;
  select * into v_source from fms_instance_stages where id=p_source_visit_id and fms_instance_id=p_instance_id;
  if v_source.branch_rule_id is not null then select * into v_rule from fms_branch_rules where id=v_source.branch_rule_id; end if;
  -- Provenance is the configured question and the answer actually saved on the source visit.
  if v_rule.source_type='form_answer' and v_rule.source_key is not null then
    select data->v_rule.source_key into v_value from form_submissions where id=v_source.form_submission_id;
  elsif v_rule.source_type='outcome' then v_value:=to_jsonb(v_source.outcome);
  elsif v_rule.source_type='context' then v_value:=v_instance.context->v_rule.source_key;
  end if;

  -- Global End Node: every other open visit stops. It keeps its history and is not marked completed.
  for v_visit in select s.id,s.status::text previous_status,s.assigned_to from fms_instance_stages s
    where s.fms_instance_id=p_instance_id and s.id<>p_end_visit_id and s.status in ('pending','in_progress','in_review','overdue') for update loop
    update fms_instance_stages set status='blocked',outcome=coalesce(outcome,'workflow_closed'),updated_at=now() where id=v_visit.id;
    update fms_instance_stage_assignees set status='cancelled',is_active=false where fms_instance_stage_id=v_visit.id and is_active;
    update notifications set is_read=true,read_at=coalesce(read_at,now())
      where tenant_id=v_instance.tenant_id and event_type='fms_stage_assigned' and source_module='fms' and source_record_id=v_visit.id and not is_read;
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(v_visit.id,v_actor,'stopped_by_end_node',jsonb_build_object('status',v_visit.previous_status,'reason','The workflow reached '||v_stage.name,'end_stage_id',v_stage.id));
    v_stopped:=v_stopped+1;
  end loop;

  insert into fms_instance_outcomes(tenant_id,fms_instance_id,fms_flow_id,flow_family_id,flow_version,end_stage_id,end_stage_key,end_stage_name,outcome,reason_code,
    end_instance_stage_id,source_instance_stage_id,source_stage_id,branch_rule_id,route_label,source_question_key,source_value,source_submission_id,finalized_by,
    stopped_visit_count,branch_id,department_id,instance_started_at)
  values(v_instance.tenant_id,v_instance.id,v_instance.fms_flow_id,coalesce(v_flow.family_id,v_flow.id),v_instance.flow_version,v_stage.id,v_stage.stage_key,v_stage.name,v_outcome,v_reason,
    v_end.id,v_source.id,v_source.fms_stage_id,v_rule.id,nullif(left(btrim(coalesce(v_rule.label,'')),200),''),case when v_rule.source_type in ('form_answer','context') then v_rule.source_key end,v_value,v_source.form_submission_id,(current_profile()).id,
    v_stopped,v_instance.branch_id,v_instance.department_id,coalesce(v_instance.started_at,v_instance.created_at,now()));

  update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id and status in ('active','overdue');
  insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
  values(v_end.id,v_actor,'workflow_ended',jsonb_build_object('outcome',v_outcome,'reason',v_reason,'stopped',v_stopped));
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_instance.tenant_id,v_actor,'fms_instance_terminal_outcome','fms_instances',v_instance.id,jsonb_build_object(
    'end_stage_id',v_stage.id,'end_stage_key',v_stage.stage_key,'outcome',v_outcome,'reason_code',v_reason,'source_instance_stage_id',v_source.id,
    'branch_rule_id',v_rule.id,'stopped_visit_count',v_stopped,'flow_version',v_instance.flow_version));
end $$;

-- The engine: an End Node gets no assignee, closes the instance through the
-- finalizer, and a token arriving after a terminal outcome is dropped quietly.
do $$
declare definition text; amended text;
begin
  definition:=replace(pg_get_functiondef('activate_fms_stage_v2_internal(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid[],uuid)'::regprocedure),E'\r','');
  amended:=replace(definition,
    ' if v_instance.status not in (''active'',''overdue'') or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception ''Instance or stage is not activatable'' using errcode=''23514''; end if;',
    ' if v_instance.status=''completed'' and exists(select 1 from fms_instance_outcomes where fms_instance_id=p_instance_id) then return null; end if;'||E'\n'||
    ' if v_instance.status not in (''active'',''overdue'') or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception ''Instance or stage is not activatable'' using errcode=''23514''; end if;');
  amended:=replace(amended,
    ' v_assignment:=resolve_fms_visit_assignment(p_instance_id,p_stage_id,p_previous_instance_stage_id,p_selected_user);',
    ' v_assignment:=case when v_stage.step_type=''end'' then jsonb_build_object(''assignmentMethod'',''legacy'',''effectiveUserIds'',''[]''::jsonb) else resolve_fms_visit_assignment(p_instance_id,p_stage_id,p_previous_instance_stage_id,p_selected_user) end;');
  amended:=replace(amended,
    ' elsif v_stage.step_type=''end'' then update fms_instances set status=''completed'',completed_at=now(),updated_at=now() where id=p_instance_id and status in (''active'',''overdue''); end if;',
    ' elsif v_stage.step_type=''end'' then perform fms_finalize_terminal_internal(p_instance_id,v_instance_stage.id,p_previous_instance_stage_id); end if;');
  if amended=definition or position('fms_finalize_terminal_internal' in amended)=0 or position('step_type=''end'' then jsonb_build_object' in amended)=0
    or position('exists(select 1 from fms_instance_outcomes' in amended)=0 then
    raise exception 'Review End Node patch against the current FMS activation';
  end if;
  execute amended;
end $$;

-- Publishing: End Nodes are allowed again, validated, and count as completion points.
do $$
declare definition text; amended text;
begin
  definition:=replace(pg_get_functiondef('assert_fms_flow_publishable_before_assignment(uuid)'::regprocedure),E'\r','');
  amended:=replace(definition,
    '  if exists(select 1 from fms_stages where fms_flow_id=p_flow_id and step_type=''end'') then raise exception ''End nodes are no longer used; remove the End node and leave the final step unconnected'' using errcode=''23514''; end if;',
    '  perform assert_fms_end_nodes_publishable(p_flow_id);');
  amended:=replace(amended,
    's.step_type not in (''branch'',''parallel_start'',''end'') and s.default_next_stage_id is null',
    's.step_type not in (''branch'',''parallel_start'') and s.default_next_stage_id is null');
  if amended=definition or position('assert_fms_end_nodes_publishable' in amended)=0 or position('''parallel_start'',''end'') and s.default_next_stage_id' in amended)>0 then
    raise exception 'Review End Node publish patch against the current FMS publisher';
  end if;
  execute amended;
end $$;

create function assert_fms_end_nodes_publishable(p_flow_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='end'
      and s.id=(select first_stage.id from fms_stages first_stage where first_stage.fms_flow_id=p_flow_id order by first_stage.sort_order,first_stage.id limit 1)) then
    raise exception 'A workflow cannot start with an End Node' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='end'
      and (s.default_next_stage_id is not null or cardinality(s.parallel_target_stage_ids)>0 or s.split_to_flow_id is not null
        or exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id))) then
    raise exception 'An End Node finishes the workflow, so it cannot lead to another step' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='end'
      and (s.form_template_id is not null or s.requires_upload or s.requires_remark or jsonb_array_length(coalesce(s.checklist_definition,'[]'))>0
        or s.requires_next_doer_handoff or coalesce(s.planned_time_rule->>'decisionMode','normal') in ('yes_no','decision')
        or nullif(s.planned_time_rule->>'assignmentFieldKey','') is not null or s.planned_time_rule ? 'followUp'
        or jsonb_array_length(coalesce(s.planned_time_rule#>'{assignment,sources}','[]'))>0
        or exists(select 1 from fms_stage_assignees a where a.fms_stage_id=s.id))) then
    raise exception 'An End Node runs automatically, so it cannot have an assignee, form, evidence, remark, checklist or decision' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='end' and fms_end_node_outcome(s.planned_time_rule) is null) then
    raise exception 'Every End Node needs an End type: won, lost, do_not_contact or other' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='end'
      and nullif(s.planned_time_rule#>>'{terminal,reasonCode}','') is not null and s.planned_time_rule#>>'{terminal,reasonCode}' !~ '^[a-z][a-z0-9_]{0,63}$') then
    raise exception 'An End Node closure reason code must use lowercase letters, numbers and underscores' using errcode='23514'; end if;
end $$;

-- An End Node visit never notifies anyone; the instance completion event already does.
do $$
declare definition text; amended text;
begin
  definition:=replace(pg_get_functiondef('emit_fms_stage_completion_event()'::regprocedure),E'\r','');
  amended:=replace(definition,'begin if old.status is distinct from new.status and new.status=''completed'' then',
    'begin if old.status is distinct from new.status and new.status=''completed'' and not exists(select 1 from fms_stages end_node where end_node.id=new.fms_stage_id and end_node.step_type=''end'') then');
  if amended=definition then raise exception 'Review End Node notification patch'; end if;
  execute amended;
end $$;

-- Work stopped by an End Node is history, never open or waiting work.
do $$
declare definition text; amended text;
begin
  definition:=replace(pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure),E'\r','');
  amended:=replace(definition,'and w.outcome is distinct from ''condition_skipped''','and coalesce(w.outcome,'''') not in (''condition_skipped'',''workflow_closed'')');
  if amended=definition then raise exception 'Review FMS workspace End Node patch'; end if;
  execute amended;
end $$;

-- Work preview: an End Node is never a destination to assign (the planner skips
-- it). The preview names the End Node the answer reaches, so the client can submit
-- without a handoff confirmation.
alter function preview_fms_work_transition(jsonb) rename to preview_fms_work_transition_before_end_nodes;
create function preview_fms_work_transition(p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare base jsonb; work fms_instance_stages; i fms_instances; source_stage uuid; context jsonb:='{}'; answers jsonb; outcome text; next_id uuid; target fms_stages;
begin
  base:=preview_fms_work_transition_before_end_nodes(p_request);
  -- The route planner never lists End Nodes. Resolve the matched route the same way to name the End Node reached.
  if p_request->>'kind' in ('stage_form','complete','review') then
    select * into work from fms_instance_stages where id=nullif(p_request->>'instanceStageId','')::uuid;
    select * into i from fms_instances where id=work.fms_instance_id;
    source_stage:=work.fms_stage_id; context:=coalesce(i.context,'{}');
    answers:=case when p_request->>'kind'='stage_form' then p_request->'answers' else (select data from form_submissions where id=work.form_submission_id) end;
    outcome:=case when p_request->>'kind'='review' then p_request->>'decision' else nullif(p_request->>'outcome','') end;
  elsif p_request->>'kind' in ('starter_form','flow_form') then
    select s.id into source_stage from fms_stages s where s.fms_flow_id=coalesce(
      (select starter.fms_flow_id from fms_starter_assignments starter where starter.id=nullif(p_request->>'starterAssignmentId','')::uuid),
      nullif(p_request->>'flowId','')::uuid) order by s.sort_order,s.id limit 1;
    answers:=p_request->'answers';
  end if;
  if source_stage is not null and jsonb_typeof(coalesce(answers,'{}'))='object' then
    next_id:=fms_route_for_candidate(source_stage,context,coalesce(answers,'{}'),outcome);
    select * into target from fms_stages where id=next_id and step_type='end';
  end if;
  return base||jsonb_build_object('terminal',case when target.id is null then null else
    jsonb_build_object('stageId',target.id,'stageName',target.name,'outcome',coalesce(fms_end_node_outcome(target.planned_time_rule),'unspecified')) end);
end $$;
revoke all on function preview_fms_work_transition_before_end_nodes(jsonb) from public,anon,authenticated,service_role;
revoke all on function preview_fms_work_transition(jsonb) from public,anon,service_role;
grant execute on function preview_fms_work_transition(jsonb) to authenticated;

-- The committed work result names the End Node the instance reached.
create function fms_instance_terminal_json(p_instance_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('stageName',o.end_stage_name,'outcome',o.outcome,'reasonCode',o.reason_code,'closedAt',o.closed_at)
  from fms_instance_outcomes o where o.fms_instance_id=p_instance_id
$$;
do $$
declare definition text; amended text;
begin
  definition:=replace(pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure),E'\r','');
  amended:=replace(definition,'''destinations'',actual,''ownWorkTargets'',own_targets);','''destinations'',actual,''ownWorkTargets'',own_targets,''terminal'',fms_instance_terminal_json(i.id));');
  if amended=definition then raise exception 'Review FMS work result End Node patch'; end if;
  execute amended;
end $$;

-- Tenant retirement inventories every tenant table.
do $$
declare definition text; amended text;
begin
  definition:=pg_get_functiondef('production_demo_data_retirement_manifest(uuid)'::regprocedure);
  amended:=replace(definition,$m$'export_logs','fms_execution_scopes','fms_flows'$m$,$r$'export_logs','fms_execution_scopes','fms_flows','fms_instance_outcomes'$r$);
  amended:=replace(amended,$m$'fms_evidence', (select count(*) from public.fms_evidence where tenant_id = p_tenant_id),$m$,
    $r$'fms_evidence', (select count(*) from public.fms_evidence where tenant_id = p_tenant_id),
      'fms_instance_outcomes', (select count(*) from public.fms_instance_outcomes where tenant_id=p_tenant_id),$r$);
  if amended=definition or position('public.fms_instance_outcomes' in amended)=0 then raise exception 'Review retirement inventory for FMS outcomes'; end if;
  execute amended;
end $$;

revoke all on function guard_fms_instance_outcome_immutable(),fms_end_node_outcome(jsonb),fms_finalize_terminal_internal(uuid,uuid,uuid),
  assert_fms_end_nodes_publishable(uuid),fms_instance_terminal_json(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
