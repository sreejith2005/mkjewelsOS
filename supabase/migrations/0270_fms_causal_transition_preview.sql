set search_path=public,extensions;

-- A read-only plan carries the same persisted cohort ancestry the activator
-- will merge when the final branch reaches a join. No placeholder visits are
-- inserted to obtain a preview.
create function fms_candidate_transition_plan(p_instance_id uuid,p_source_visit_id uuid,p_answers jsonb,p_outcome text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare i fms_instances; source fms_instance_stages; definition fms_stages; target fms_stages; cohort fms_execution_scopes;
  queue jsonb; item jsonb; result jsonb:='[]'; seen uuid[]:='{}'; path_ids uuid[]; next_id uuid; count integer:=0;
  needed integer; arrived integer; condition_met boolean; actual text; expected text;
begin
  select * into i from fms_instances where id=p_instance_id;
  select * into source from fms_instance_stages where id=p_source_visit_id and fms_instance_id=i.id;
  select * into definition from fms_stages where id=source.fms_stage_id;
  next_id:=fms_route_for_candidate(definition.id,i.context,p_answers,p_outcome);
  queue:=case when next_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',next_id,'answers',p_answers,'outcome',p_outcome,'path',to_jsonb(coalesce(source.execution_path,'{}')||source.id))) end;
  while jsonb_array_length(queue)>0 loop
    count:=count+1; if count>100 then raise exception 'Workflow preview reached its automatic-transition limit' using errcode='23514'; end if;
    item:=queue->0; queue:=queue-0;
    path_ids:=array(select jsonb_array_elements_text(item->'path')::uuid);
    select * into target from fms_stages where id=(item->>'id')::uuid and fms_flow_id=i.fms_flow_id;
    if target.id is null then raise exception 'Workflow route points outside its pinned definition' using errcode='23514'; end if;
    if target.id=any(seen) then continue; end if; seen:=array_append(seen,target.id);
    condition_met:=true;
    if target.planned_time_rule#>>'{conditional,field}'='status' then
      condition_met:=fms_status_condition_matches(target.planned_time_rule#>>'{conditional,operator}',lower(target.planned_time_rule#>>'{conditional,value}'),lower(i.context->>'status'));
    elsif nullif(target.planned_time_rule#>>'{conditional,decisionStageKey}','') is not null then
      expected:=lower(coalesce(target.planned_time_rule#>>'{conditional,outcome}',target.planned_time_rule#>>'{conditional,decisionOptionKey}'));
      if target.planned_time_rule#>>'{conditional,decisionStageKey}'=definition.stage_key then actual:=lower(p_outcome);
      else select lower(visit.outcome) into actual from fms_instance_stages visit join fms_stages stage on stage.id=visit.fms_stage_id where visit.id=any(path_ids) and stage.stage_key=target.planned_time_rule#>>'{conditional,decisionStageKey}' and visit.status='completed' order by visit.actual_datetime desc nulls last limit 1; end if;
      if actual is null then raise exception 'The earlier Yes or No decision has not been completed' using errcode='23514'; end if;
      condition_met:=actual=expected;
    end if;
    if not coalesce(condition_met,false) then
      if target.default_next_stage_id is not null then queue:=queue||jsonb_build_array(jsonb_build_object('id',target.default_next_stage_id,'answers','{}'::jsonb,'outcome',null,'path',to_jsonb(path_ids))); end if;
      continue;
    end if;
    if target.step_type not in ('branch','parallel_start','parallel_join','notification','end') then
      if target.planned_time_rule ? 'followUp' and (select count(*) from fms_instance_stages where fms_instance_id=i.id and fms_stage_id=target.id)>=(target.planned_time_rule#>>'{followUp,maxVisits}')::integer then continue; end if;
      result:=result||jsonb_build_array(jsonb_build_object('targetStageId',target.id,'path',to_jsonb(path_ids))); continue;
    end if;
    if target.step_type='end' then continue; end if;
    if target.step_type='parallel_join' then
      select * into cohort from fms_execution_scopes where id=source.parallel_scope_id and fms_instance_id=i.id;
      if cohort.id is not null then
        if target.join_rule='specific' then
          needed:=cardinality(target.join_required_stage_ids);
          select count(distinct visit.fms_stage_id) into arrived from fms_instance_stages visit where visit.fms_stage_id=any(target.join_required_stage_ids)
            and (visit.status='completed' or visit.id=source.id) and visit.id=any(path_ids||coalesce((select array_agg(path.id) from fms_join_arrivals arrival cross join lateral unnest(arrival.execution_path) path(id) where arrival.parallel_scope_id=cohort.id and arrival.join_stage_id=target.id),'{}'));
        else
          select cardinality(stage.parallel_target_stage_ids) into needed from fms_instance_stages split join fms_stages stage on stage.id=split.fms_stage_id where split.id=cohort.split_instance_stage_id;
          select count(distinct branch) into arrived from (select branch_stage_id branch from fms_join_arrivals where parallel_scope_id=cohort.id and join_stage_id=target.id union select source.parallel_branch_id) branches;
        end if;
        if not (case when target.join_rule='any' then arrived>0 else needed>0 and arrived=needed end) then continue; end if;
        select array_agg(ordered.id order by ordered.depth,ordered.id) into path_ids from (
          select path.id,min(path.depth) depth from (
            select value.id,value.depth from unnest(path_ids) with ordinality value(id,depth)
            union all select value.id,value.depth from fms_join_arrivals arrival cross join lateral unnest(arrival.execution_path) with ordinality value(id,depth) where arrival.parallel_scope_id=cohort.id and arrival.join_stage_id=target.id
          ) path group by path.id
        ) ordered;
      elsif target.join_rule<>'any' and exists(select 1 from fms_instance_stages other where other.fms_instance_id=i.id and other.id<>source.id and other.status in ('pending','in_progress','in_review','overdue')) then continue;
      end if;
    end if;
    if target.step_type='parallel_start' then
      queue:=queue||coalesce((select jsonb_agg(jsonb_build_object('id',id,'answers','{}'::jsonb,'outcome',null,'path',to_jsonb(path_ids))) from unnest(target.parallel_target_stage_ids) id),'[]');
    else
      next_id:=case when target.step_type='branch' then fms_route_for_candidate(target.id,i.context,item->'answers',item->>'outcome') else target.default_next_stage_id end;
      if next_id is not null then queue:=queue||jsonb_build_array(jsonb_build_object('id',next_id,'answers','{}'::jsonb,'outcome',null,'path',to_jsonb(path_ids))); end if;
    end if;
  end loop;
  return result;
end $$;
create or replace function fms_candidate_destinations(p_instance_id uuid,p_source_visit_id uuid,p_answers jsonb,p_outcome text)
returns uuid[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg((value->>'targetStageId')::uuid),'{}') from jsonb_array_elements(fms_candidate_transition_plan(p_instance_id,p_source_visit_id,p_answers,p_outcome))
$$;

do $$
declare f text; n text; marker text;
begin
  f:=pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid)'::regprocedure);
  n:=replace(f,'p_candidate_stage_id uuid)','p_candidate_stage_id uuid, p_candidate_path uuid[])');
  if n=f then raise exception 'Candidate assignment signature changed'; end if; f:=n;
  marker:='  select id into initial_id from fms_stages';
  n:=replace(f,marker,E'  if p_candidate_path is not null then prior.execution_path:=p_candidate_path; end if;\n'||marker);
  if n=f then raise exception 'Candidate ancestry marker changed'; end if; f:=n;
  n:=replace(f,'and work.completed_by is not null order by','and work.completed_by is not null and work.outcome is distinct from ''condition_skipped'' order by'); f:=n;
  n:=replace(f,$old$(select step_type from fms_stages where id=prior.fms_stage_id)='parallel_join' and chosen is not null$old$,
    $new$exists(select 1 from fms_instance_stages prior_choice where prior_choice.id=source_id and prior_choice.parallel_scope_id=source_work.parallel_scope_id and prior_choice.parallel_branch_id is not null and source_work.parallel_branch_id is not null and prior_choice.parallel_branch_id<>source_work.parallel_branch_id) and chosen is not null$new$);
  if n=f then raise exception 'Parallel source conflict marker changed'; end if; execute n;

  f:=pg_get_functiondef('preview_fms_work_transition(jsonb)'::regprocedure);
  n:=replace(f,'  starter fms_starter_assignments; flow fms_flows;', '  starter fms_starter_assignments; flow fms_flows; plan_item jsonb;');
  if n=f then raise exception 'Preview plan variable marker changed'; end if; f:=n;
  marker:='    for target in select * from fms_stages where id=any(fms_candidate_destinations(i.id,work.id,coalesce(answers,''{}''),case when p_request->>''kind''=''review'' then p_request->>''decision'' else p_request->>''outcome'' end)) order by sort_order,id loop';
  n:=replace(f,marker,$plan$    for plan_item in select value from jsonb_array_elements(fms_candidate_transition_plan(i.id,work.id,coalesce(answers,'{}'),case when p_request->>'kind'='review' then p_request->>'decision' else p_request->>'outcome' end)) loop
      select * into target from fms_stages where id=(plan_item->>'targetStageId')::uuid;$plan$);
  if n=f then raise exception 'Preview candidate loop marker changed'; end if; f:=n;
  n:=replace(f,'then answers else null end,definition.id);','then answers else null end,definition.id,array(select jsonb_array_elements_text(plan_item->''path'')::uuid));');
  if n=f then raise exception 'Preview merged ancestry marker changed'; end if; execute n;
end $$;
create or replace function resolve_fms_visit_assignment(p_instance_id uuid,p_target_stage_id uuid,p_source_visit_id uuid,p_handoff_user_id uuid,p_candidate_answers jsonb,p_candidate_stage_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin return resolve_fms_visit_assignment(p_instance_id,p_target_stage_id,p_source_visit_id,p_handoff_user_id,p_candidate_answers,p_candidate_stage_id,null); end $$;
revoke all on function fms_candidate_transition_plan(uuid,uuid,jsonb,text),resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[]) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
