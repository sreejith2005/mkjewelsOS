set search_path=public,extensions;

-- One ordered matcher serves persisted execution and unsaved previews.
create function fms_matched_route_for_answers(p_stage_id uuid,p_context jsonb,p_answers jsonb,p_outcome text)
returns table(rule_id uuid,next_stage_id uuid) language plpgsql stable security definer set search_path=public as $$
declare rule fms_branch_rules; actual jsonb;
begin
  for rule in select * from fms_branch_rules where fms_stage_id=p_stage_id order by sort_order,id loop
    actual:=case rule.source_type when 'outcome' then to_jsonb(nullif(btrim(coalesce(p_outcome,'')),'')) when 'context' then coalesce(p_context,'{}')->rule.source_key else coalesce(p_answers,'{}')->rule.source_key end;
    if fms_rule_matches(rule.condition_operator,rule.condition_value,actual) then
      rule_id:=rule.id; next_stage_id:=rule.next_stage_id; return next; return;
    end if;
  end loop;
end $$;

create or replace function fms_stage_matched_route(p_stage_id uuid,p_instance_id uuid,p_instance_stage_id uuid,p_outcome text)
returns table(rule_id uuid,next_stage_id uuid) language plpgsql stable security definer set search_path=public as $$
declare answers jsonb; context jsonb;
begin
  select coalesce(submission.data,'{}') into answers from fms_instance_stages work left join form_submissions submission on submission.id=work.form_submission_id where work.id=p_instance_stage_id;
  if answers is null or answers='{}'::jsonb then
    select coalesce(submission.data,'{}') into answers from form_submissions submission where submission.linked_module='fms_stage' and submission.linked_record_id=p_instance_stage_id order by submitted_at desc nulls last limit 1;
  end if;
  select instance.context into context from fms_instances instance where instance.id=p_instance_id;
  return query select * from fms_matched_route_for_answers(p_stage_id,context,answers,p_outcome);
end $$;

create or replace function fms_route_for_candidate(p_stage_id uuid,p_context jsonb,p_answers jsonb,p_outcome text)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare route record;
begin
  select * into route from fms_matched_route_for_answers(p_stage_id,p_context,p_answers,p_outcome);
  if found then return route.next_stage_id; end if;
  return (select default_next_stage_id from fms_stages where id=p_stage_id);
end $$;

do $$
declare f text; n text; name text; marker text; plan_name text;
begin
  f:=replace(pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[])'::regprocedure),E'\r','');
  n:=replace(f,'p_candidate_path uuid[])','p_candidate_path uuid[], p_candidate_outcome text)');
  if n=f then raise exception 'Candidate route resolver signature changed'; end if; f:=n;
  marker:='work.branch_rule_id::text=source->>''routeRuleId''';
  n:=replace(f,marker,$patch$(case when work.fms_stage_id=p_candidate_stage_id then
              (select matched.rule_id from fms_matched_route_for_answers(work.fms_stage_id,i.context,coalesce(p_candidate_answers,(select data from form_submissions where id=work.form_submission_id),'{}'),p_candidate_outcome) matched)
              else work.branch_rule_id end)::text=source->>'routeRuleId'$patch$);
  if n=f then raise exception 'Candidate source route marker changed'; end if; execute n;

  foreach name in array array['preview_fms_work_transition_before_start(jsonb)','preview_fms_work_transition(jsonb,jsonb)'] loop
    f:=replace(pg_get_functiondef(name::regprocedure),E'\r',''); n:=f;
    foreach plan_name in array array['plan_item','plan'] loop
      marker:='definition.id,array(select jsonb_array_elements_text('||plan_name||'->''path'')::uuid))';
      n:=replace(n,marker,'definition.id,array(select jsonb_array_elements_text('||plan_name||'->''path'')::uuid),case when p_request->>''kind''=''review'' then p_request->>''decision'' else p_request->>''outcome'' end)');
    end loop;
    if n=f then raise exception 'Candidate route preview call changed: %',name; end if; execute n;
  end loop;

  f:=replace(pg_get_functiondef('fms_initial_assignment_preview(uuid,uuid,jsonb,uuid)'::regprocedure),E'\r','');
  marker:='where rule.id=(mapping->>''routeRuleId'')::uuid and rule.fms_stage_id=initial.id';
  n:=replace(f,marker,marker||' and rule.id=(select matched.rule_id from fms_matched_route_for_answers(initial.id,''{}'',p_answers,null) matched)');
  if n=f then raise exception 'Initial ordered source route marker changed'; end if; execute n;

  f:=replace(pg_get_functiondef('assert_fms_assignment_publishable_before_display(uuid)'::regprocedure),E'\r','');
  marker:='      if (not field.is_required';
  n:=replace(f,marker,$patch$      if nullif(source->>'routeRuleId','') is not null and not exists(select 1 from fms_branch_rules route where route.id=(source->>'routeRuleId')::uuid and route.fms_stage_id=source_stage.id) then
        raise exception 'Assignment route for step % must belong to its exact source step',s.name using errcode='23514';
      end if;
$patch$||marker);
  if n=f then raise exception 'Assignment source route publication marker changed'; end if; execute n;
end $$;

-- Existing private callers keep their signature; actual visits already have
-- their persisted branch decision and need no candidate outcome.
create or replace function resolve_fms_visit_assignment(p_instance_id uuid,p_target_stage_id uuid,p_source_visit_id uuid,p_handoff_user_id uuid,p_candidate_answers jsonb,p_candidate_stage_id uuid,p_candidate_path uuid[])
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  return resolve_fms_visit_assignment(p_instance_id,p_target_stage_id,p_source_visit_id,p_handoff_user_id,p_candidate_answers,p_candidate_stage_id,p_candidate_path,null);
end $$;
revoke all on function fms_matched_route_for_answers(uuid,jsonb,jsonb,text),resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[],text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
