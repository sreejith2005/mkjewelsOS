set search_path=public,extensions;

-- Private shared choice logic for initial previews, candidate previews and
-- persisted execution. The caller still applies recipient policy and coverage.
create function fms_form_chain_choice(p_source_stage_id uuid,p_answers jsonb,p_previous_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare source fms_stages; question form_fields; questions uuid[]; reached text[]; chosen uuid;
begin
  select * into source from fms_stages where id=p_source_stage_id;
  select array_agg(field.id order by field.sort_order,field.id) into questions from form_fields field
    where field.form_template_id=source.form_template_id and field.field_type='user_dropdown'
      and (field.field_key=source.planned_time_rule->>'assignmentFieldKey'
        or regexp_replace(lower(field.field_key),'[^a-z0-9]','','g') in ('assignedto','assignto')
        or regexp_replace(lower(field.field_name),'[^a-z0-9]','','g') in ('assignedto','assignto'));
  if cardinality(questions)>1 then raise exception 'Form for step % has multiple employee questions. Name the assignment question Assigned To or select an advanced source.',source.name using errcode='23514'; end if;
  if cardinality(questions)=1 then
    select * into question from form_fields where id=questions[1];
    reached:=form_reachable_sections(source.form_template_id,coalesce(p_answers,'{}'));
    if not question.is_shown or not form_condition_matches(question.conditional_logic,coalesce(p_answers,'{}'))
      or (reached is not null and not form_field_section_key(question.group_name,(select coalesce(sections,'[]') from form_templates where id=source.form_template_id))=any(reached))
      or nullif(p_answers->>question.field_key,'') is null then
      raise exception 'Choose Assigned To in the form for step %, or configure an advanced assignment rule for conditional forms.',source.name using errcode='23514';
    end if;
    chosen:=(p_answers->>question.field_key)::uuid;
    return jsonb_build_object('selectedUserIds',jsonb_build_array(chosen),'explicit',true,'assignmentMethod','previous_form');
  end if;
  if cardinality(coalesce(p_previous_ids,'{}'))<>1 then raise exception 'Step % needs one previous assigned employee. Configure an advanced assignment rule for multiple doers.',source.name using errcode='23514'; end if;
  return jsonb_build_object('selectedUserIds',to_jsonb(p_previous_ids),'explicit',false,'assignmentMethod','previous_stage_employee');
end $$;

do $$
declare definition text; patched text; marker text;
begin
  definition:=replace(pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[],text)'::regprocedure),E'\r','');
  marker:='    elsif c->>''mode''=''previous_form'' then';
  patched:=replace(definition,marker,$body$    elsif c->>'mode'='previous_form' and coalesce((c->>'followFormAssignee')::boolean,false) then
      select work.* into source_work from unnest(coalesce(prior.execution_path,'{}')||coalesce(array[prior.id],'{}')) with ordinality path(id,depth)
        join fms_instance_stages work on work.id=path.id and work.fms_instance_id=i.id
        join fms_stages step on step.id=work.fms_stage_id
        where step.step_type in ('form','task','approval') and work.outcome is distinct from 'condition_skipped'
          and (work.status='completed' or work.id=prior.id) order by path.depth desc limit 1;
      if source_work.parallel_scope_id is not null and exists(
        with recursive source_scopes(scope_id,branch_id,depth) as (
          select source_work.parallel_scope_id,source_work.parallel_branch_id,0
          union all select scope.parent_scope_id,scope.parent_branch_id,lineage.depth+1
          from source_scopes lineage join fms_execution_scopes scope on scope.id=lineage.scope_id
          where scope.parent_scope_id is not null and lineage.depth<100
        ), sibling_scopes(scope_id,branch_id,depth) as (
          select sibling.parallel_scope_id,sibling.parallel_branch_id,0
          from unnest(coalesce(prior.execution_path,'{}')||coalesce(array[prior.id],'{}')) path(id)
          join fms_instance_stages sibling on sibling.id=path.id and sibling.fms_instance_id=i.id
          join fms_stages step on step.id=sibling.fms_stage_id
          where sibling.parallel_scope_id is not null and sibling.parallel_branch_id is not null
            and step.step_type in ('form','task','approval') and sibling.outcome is distinct from 'condition_skipped'
            and (sibling.status='completed' or sibling.id=prior.id)
          union all select scope.parent_scope_id,scope.parent_branch_id,lineage.depth+1
          from sibling_scopes lineage join fms_execution_scopes scope on scope.id=lineage.scope_id
          where scope.parent_scope_id is not null and lineage.depth<100
        ) select 1 from source_scopes own join sibling_scopes other on other.scope_id=own.scope_id
          where other.branch_id is distinct from own.branch_id
      ) then raise exception 'Simple assignment after a parallel join needs an explicit advanced assignment rule for step %.',target.name using errcode='23514'; end if;
      select * into submission from form_submissions where id=source_work.form_submission_id and tenant_id=i.tenant_id and status='submitted';
      if p_candidate_answers is not null and source_work.fms_stage_id=p_candidate_stage_id then submission.data:=p_candidate_answers; submission.id:=null; end if;
      coverage:=fms_form_chain_choice(source_work.fms_stage_id,coalesce(submission.data,'{}'),source_work.assigned_to);
      chosen_ids:=array(select jsonb_array_elements_text(coverage->'selectedUserIds')::uuid);
      explicit_choice:=(coverage->>'explicit')::boolean; method:=coverage->>'assignmentMethod';
      source_id:=source_work.id; submission_id:=submission.id;
    elsif c->>'mode'='previous_form' then$body$);
  if patched=definition then raise exception 'Form-chain runtime marker changed'; end if; execute patched;

  definition:=replace(pg_get_functiondef('fms_initial_assignment_preview(uuid,uuid,jsonb,uuid)'::regprocedure),E'\r','');
  marker:='  elsif method=''previous_form'' then';
  patched:=replace(definition,marker,$body$  elsif method='previous_form' and coalesce((config->>'followFormAssignee')::boolean,false) then
    resolution:=fms_form_chain_choice(initial.id,p_answers,array[actor.id]);
    selected:=array(select jsonb_array_elements_text(resolution->'selectedUserIds')::uuid);
    explicit:=(resolution->>'explicit')::boolean; method:=resolution->>'assignmentMethod';
  elsif method='previous_form' then$body$);
  if patched=definition then raise exception 'Form-chain initial preview marker changed'; end if; execute patched;

  definition:=replace(pg_get_functiondef('assert_fms_assignment_publishable_before_display(uuid)'::regprocedure),E'\r','');
  patched:=replace(definition,'for source in select value from jsonb_array_elements(c->''sources'') loop',
    'for source in select value from jsonb_array_elements(case when c->>''mode''=''previous_form'' and coalesce((c->>''followFormAssignee'')::boolean,false) then ''[]''::jsonb else c->''sources'' end) loop');
  if patched=definition then raise exception 'Form-chain publication marker changed'; end if; execute patched;
end $$;
revoke all on function fms_form_chain_choice(uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
