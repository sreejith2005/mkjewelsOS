set search_path=public,extensions;

-- 0347 (2026-10-26 owner request)
-- 1. Otherwise is optional on a step with conditional routes. An answer that
--    matches no route, on a step without an Otherwise destination, finishes
--    that path exactly like "Complete workflow here": the run completes when no
--    other work is open. It no longer puts the run on hold (0142) or, on the
--    first form, refuses the submission (0260).
-- 2. "Assigned To from the previous form" reads only the section the source
--    step answers (0345), and an answered single User question in that section
--    chooses the next employee whatever it is called. A named Assigned To
--    question still wins; with neither, the previous employee keeps the work.
--
-- The live bodies were themselves text-patched by later migrations, so each one
-- is amended from pg_get_functiondef. Every replacement must match exactly once,
-- otherwise the migration stops instead of silently doing nothing.

create function pg_temp.fms_0347_amend(p_function regprocedure,p_old text,p_new text)
returns void language plpgsql as $$
declare definition text; occurrences integer;
begin
  definition:=replace(pg_get_functiondef(p_function),E'\r','');
  occurrences:=(length(definition)-length(replace(definition,p_old,'')))/greatest(length(p_old),1);
  if occurrences<>1 then raise exception '0347: expected one match in %, found %',p_function,occurrences; end if;
  execute replace(definition,p_old,p_new);
end $$;

-- Publish: no Otherwise requirement; a routed step without one is a completion point.
do $$
declare definition text; amended text;
begin
  definition:=replace(pg_get_functiondef('assert_fms_flow_publishable_before_assignment(uuid)'::regprocedure),E'\r','');
  amended:=regexp_replace(definition,'\n[^\n]*Every routed step needs an Otherwise destination[^\n]*','');
  amended:=regexp_replace(amended,'\n[^\n]*needs an Otherwise destination for answers that match no route[^\n]*','');
  if amended=definition or position('Otherwise destination' in amended)>0 then raise exception '0347: Otherwise publish check not found'; end if;
  execute amended;
end $$;

select pg_temp.fms_0347_amend('assert_fms_flow_publishable_before_assignment(uuid)'::regprocedure,
  'and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id)) then raise exception ''Workflow needs at least one completion step',
  'and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator=''default'')) then raise exception ''Workflow needs at least one completion step');

select pg_temp.fms_0347_amend('assert_fms_flow_publishable_before_assignment(uuid)'::regprocedure,
  'select s.id from fms_stages s where s.fms_flow_id=p_flow_id and not exists(select 1 from edges e where e.source=s.id)',
  'select s.id from fms_stages s where s.fms_flow_id=p_flow_id and (not exists(select 1 from edges e where e.source=s.id)
      or (s.step_type<>''branch'' and s.default_next_stage_id is null and cardinality(s.parallel_target_stage_ids)=0
        and exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id)
        and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator=''default'')))');

-- Completion: an unmatched route without Otherwise finishes this path.
do $$
declare definition text; head integer; tail integer; amended text;
begin
  definition:=replace(pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure),E'\r','');
  head:=position(' -- A routed step that matched nothing and has no fallback must never look finished.' in definition);
  tail:=position(' if v_next is not null then perform public.activate_fms_stage_internal(' in definition);
  if head=0 or tail<=head or position('''on_hold''' in substr(definition,head,tail-head))=0 then raise exception '0347: unmatched-route hold block not found'; end if;
  amended:=substr(definition,1,head-1)
    ||E' -- No route matched and the step has no Otherwise destination: this path ends here (0347).\n'
    ||E' if v_next is null and v_routed then\n'
    ||E'   insert into public.fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,''route_unmatched'',jsonb_build_object(''stage_id'',v_stage.id,''outcome'',left(coalesce(p_outcome,''''),500),''result'',''path_completed''));\n'
    ||E' end if;\n'
    ||substr(definition,tail);
  execute amended;
end $$;

-- First form: no match without Otherwise completes the run instead of refusing it.
select pg_temp.fms_0347_amend('progress_fms_initial_form_internal(uuid)'::regprocedure,
  '    raise exception ''No route matched the initial form. Add an Otherwise destination and publish the workflow.'' using errcode=''23514'';',
  '    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(v_work.id,v_instance.started_by,''route_unmatched'',jsonb_build_object(''stage_id'',v_stage.id,''result'',''path_completed''));');

-- Assigned To from the previous form, limited to the section that step answers.
create or replace function fms_form_chain_choice(p_source_stage_id uuid,p_answers jsonb,p_previous_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare source fms_stages; question form_fields; scoped uuid[]; questions uuid[]; reached text[]; chosen uuid; section_key text; sections jsonb;
begin
  select * into source from fms_stages where id=p_source_stage_id;
  section_key:=nullif(btrim(coalesce(source.planned_time_rule->>'formSectionKey','')),'');
  select coalesce(template.sections,'[]') into sections from form_templates template where template.id=source.form_template_id;
  -- Only questions the source step's doer answers can choose the next employee.
  select array_agg(field.id order by field.sort_order,field.id) into scoped from form_fields field
    where field.form_template_id=source.form_template_id and field.field_type='user_dropdown'
      and (section_key is null or form_field_section_key(field.group_name,coalesce(sections,'[]'))=section_key);
  select array_agg(field.id order by field.sort_order,field.id) into questions from form_fields field
    where field.id=any(coalesce(scoped,'{}'))
      and (field.field_key=source.planned_time_rule->>'assignmentFieldKey'
        or regexp_replace(lower(field.field_key),'[^a-z0-9]','','g') in ('assignedto','assignto')
        or regexp_replace(lower(field.field_name),'[^a-z0-9]','','g') in ('assignedto','assignto'));
  if cardinality(questions)>1 then raise exception 'Form for step % has multiple employee questions. Name the assignment question Assigned To or select an advanced source.',source.name using errcode='23514'; end if;
  if cardinality(questions)=1 then
    select * into question from form_fields where id=questions[1];
    reached:=case when section_key is not null then array[section_key] else form_reachable_sections(source.form_template_id,coalesce(p_answers,'{}')) end;
    if not question.is_shown or not form_condition_matches(question.conditional_logic,coalesce(p_answers,'{}'))
      or (reached is not null and not form_field_section_key(question.group_name,coalesce(sections,'[]'))=any(reached))
      or nullif(p_answers->>question.field_key,'') is null then
      raise exception 'Choose Assigned To in the form for step %, or configure an advanced assignment rule for conditional forms.',source.name using errcode='23514';
    end if;
    chosen:=(p_answers->>question.field_key)::uuid;
    return jsonb_build_object('selectedUserIds',jsonb_build_array(chosen),'explicit',true,'assignmentMethod','previous_form');
  end if;
  -- The only employee question in the section, when answered, hands the work over whatever it is called.
  if cardinality(scoped)=1 then
    select * into question from form_fields where id=scoped[1];
    reached:=case when section_key is not null then array[section_key] else form_reachable_sections(source.form_template_id,coalesce(p_answers,'{}')) end;
    if question.is_shown and form_condition_matches(question.conditional_logic,coalesce(p_answers,'{}'))
      and (reached is null or form_field_section_key(question.group_name,coalesce(sections,'[]'))=any(reached))
      and nullif(p_answers->>question.field_key,'') is not null then
      chosen:=(p_answers->>question.field_key)::uuid;
      return jsonb_build_object('selectedUserIds',jsonb_build_array(chosen),'explicit',true,'assignmentMethod','previous_form');
    end if;
  end if;
  if cardinality(coalesce(p_previous_ids,'{}'))<>1 then raise exception 'Step % needs one previous assigned employee. Configure an advanced assignment rule for multiple doers.',source.name using errcode='23514'; end if;
  return jsonb_build_object('selectedUserIds',to_jsonb(p_previous_ids),'explicit',false,'assignmentMethod','previous_stage_employee');
end $$;

alter function fms_form_chain_choice(uuid,jsonb,uuid[]) owner to postgres;
revoke all on function fms_form_chain_choice(uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;
