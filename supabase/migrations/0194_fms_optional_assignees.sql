-- The initial Form submitter is the fallback for unnamed later steps.

-- Explicit stage assignees and existing form-selected defaults retain priority.

create or replace function fms_assignment_user_from_submission(p_stage_id uuid, p_submission_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_submission form_submissions; v_field form_fields; v_key text; v_user_id uuid;
begin
  select * into v_stage from fms_stages where id=p_stage_id;
  if v_stage.id is null then return null; end if;
  v_key:=nullif(v_stage.planned_time_rule->>'assignmentFieldKey','');
  if v_key is null and v_stage.form_template_id is not null then
    select field_key into v_key
    from form_fields where form_template_id=v_stage.form_template_id and field_type='user_dropdown'
      and is_required and is_shown and conditional_logic is null and rule_definition is null
      and (field_key='assigned_to' or lower(btrim(field_name))='assigned to')
    order by case when field_key='assigned_to' then 0 else 1 end,sort_order,field_key limit 1;
  end if;
  if v_key is null then return null; end if;
  select * into v_field from form_fields where form_template_id=v_stage.form_template_id and field_key=v_key;
  if v_field.id is null or v_field.field_type<>'user_dropdown' or not v_field.is_required
     or not v_field.is_shown or v_field.conditional_logic is not null or v_field.rule_definition is not null then
    raise exception 'FMS step % needs a required, always visible User question',v_stage.name using errcode='23514';
  end if;
  select * into v_submission from form_submissions where id=p_submission_id;
  if v_submission.id is null or v_submission.form_template_id<>v_stage.form_template_id
     or v_submission.status<>'submitted' or jsonb_typeof(v_submission.data->v_key)<>'string' then
    raise exception 'FMS step % has no valid assigned user answer',v_stage.name using errcode='23514';
  end if;
  begin v_user_id:=(v_submission.data->>v_key)::uuid;
  exception when invalid_text_representation then
    raise exception 'FMS step % has no valid assigned user answer',v_stage.name using errcode='23514';
  end;
  perform assert_direct_assignment_user(v_user_id,v_submission.tenant_id,'FMS');
  return v_user_id;
end $$;

create or replace function resolve_fms_stage_assignees(p_stage_id uuid,p_instance_id uuid,p_selected_user uuid default null)
returns uuid[] language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_instance fms_instances; v_selected uuid;
begin
  select * into v_stage from fms_stages where id=p_stage_id;
  select * into v_instance from fms_instances where id=p_instance_id;
  if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then
    raise exception 'Invalid FMS stage activation' using errcode='23514';
  end if;
  if v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then
    return resolve_fms_stage_assignees_before_form_user(p_stage_id,p_instance_id,null);
  end if;
  if exists(select 1 from fms_stage_assignees where fms_stage_id=p_stage_id) then
    return resolve_fms_stage_assignees_before_form_user(p_stage_id,p_instance_id,null);
  end if;
  if p_selected_user is not null then
    v_selected:=p_selected_user;
  elsif v_stage.id=(select id from fms_stages where fms_flow_id=v_instance.fms_flow_id order by sort_order,id limit 1) then
    v_selected:=v_instance.started_by;
  elsif nullif(v_instance.context->>'_fms_assignment_user_id','') is not null then
    v_selected:=(v_instance.context->>'_fms_assignment_user_id')::uuid;
  else
    v_selected:=v_instance.started_by;
  end if;
  return resolve_fms_stage_assignees_before_form_user(p_stage_id,p_instance_id,v_selected);
end $$;

create or replace function assert_fms_flow_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_flow fms_flows;
  v_count bigint;
  v_reached bigint;
begin
  select * into v_flow from fms_flows where id=p_flow_id;
  if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Draft workflow not found' using errcode='23514'; end if;
  select count(*) into v_count from fms_stages where fms_flow_id=p_flow_id;
  if v_count=0 then raise exception 'Workflow cannot be empty' using errcode='23514'; end if;
  if (select step_type from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1)<>'form' then raise exception 'The first workflow step must be a Form' using errcode='23514'; end if;
  if (select form_template_id from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1) is null then raise exception 'The initial Form step needs a published Form for the workflow details' using errcode='23514'; end if;
  if exists(select 1 from fms_stages where fms_flow_id=p_flow_id and step_type='end') then raise exception 'End nodes are no longer used; remove the End node and leave the final step unconnected' using errcode='23514'; end if;
  if not exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('branch','parallel_start','end') and s.default_next_stage_id is null and cardinality(s.parallel_target_stage_ids)=0 and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id)) then raise exception 'Workflow needs at least one completion step with no outgoing connection' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('notification','branch','parallel_start','parallel_join','end') and not is_valid_fms_timing_rule(s.planned_time_rule)) then raise exception 'Every workflow step needs a valid timing rule' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.planned_time_rule->>'decisionMode'='yes_no' and (s.step_type in ('notification','branch','parallel_start','parallel_join','end') or s.id=(select first_stage.id from fms_stages first_stage where first_stage.fms_flow_id=p_flow_id order by first_stage.sort_order,first_stage.id limit 1))) then raise exception 'Yes or No decisions are only available on human steps after the initial Form' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.planned_time_rule ? 'conditional' and not exists(select 1 from fms_stages decision where decision.fms_flow_id=s.fms_flow_id and decision.stage_key=s.planned_time_rule#>>'{conditional,decisionStageKey}' and decision.sort_order<s.sort_order and decision.planned_time_rule->>'decisionMode'='yes_no')) then raise exception 'Conditional steps must reference an earlier Yes or No decision' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and ((s.step_type='parallel_start' and cardinality(s.parallel_target_stage_ids)=0) or (s.step_type='parallel_join' and (s.join_rule is null or s.join_rule='specific' and cardinality(s.join_required_stage_ids)=0)) or (s.step_type='approval' and s.completion_rule<>'manager_approval') or (s.completion_rule='all_doers' and not s.allow_multiple_doers))) then raise exception 'A workflow step is incomplete or incompatible' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join form_templates f on f.id=s.form_template_id where s.fms_flow_id=p_flow_id and (f.tenant_id<>v_flow.tenant_id or f.lifecycle<>'published' or not f.is_active)) then raise exception 'Linked Forms must be exact active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.form_template_id is not null and not exists(select 1 from form_templates f where f.id=s.form_template_id)) then raise exception 'A step links a Form that no longer exists' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_flows target on target.id=s.split_to_flow_id where s.fms_flow_id=p_flow_id and (target.tenant_id<>v_flow.tenant_id or target.status<>'published' or not target.is_active)) then raise exception 'Linked workflows must be active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.default_next_stage_id is not null and not exists(select 1 from fms_stages n where n.id=s.default_next_stage_id and n.fms_flow_id=p_flow_id)) then raise exception 'A next-step connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s cross join lateral unnest(s.parallel_target_stage_ids||coalesce(s.join_required_stage_ids,'{}')) target(id) where s.fms_flow_id=p_flow_id and not exists(select 1 from fms_stages n where n.id=target.id and n.fms_flow_id=p_flow_id)) then raise exception 'A parallel connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='branch' and ((select count(*) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>1 or exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and (r.next_stage_id is null or r.next_flow_id is not null)) or (select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>(select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id))) then raise exception 'Decision steps require ordered routes to workflow steps and one final fallback route' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and (r.next_stage_id is null or r.next_flow_id is not null or not exists(select 1 from fms_stages n where n.id=r.next_stage_id and n.fms_flow_id=p_flow_id))) then raise exception 'Every conditional route needs a destination step inside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and (select count(*) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')>1) then raise exception 'A step can define only one fallback route' using errcode='23514'; end if;
  -- Every routed step needs an Otherwise destination, so an unmatched answer can never strand an instance.
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and s.default_next_stage_id is null and exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id) and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default' and r.next_stage_id is not null)) then raise exception 'A step with conditional routes needs an Otherwise destination for answers that match no route' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer' and s.form_template_id is null) then raise exception 'A step that routes on a form answer needs a linked Form' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer' and not exists(select 1 from form_fields f where f.form_template_id=s.form_template_id and f.field_key=r.source_key)) then raise exception 'A conditional route uses a question that is no longer in the linked Form' using errcode='23514'; end if;
  -- A route may only match an option the linked question still offers.
  if exists(
    select 1 from fms_stages s
    join fms_branch_rules r on r.fms_stage_id=s.id
    join form_fields f on f.form_template_id=s.form_template_id and f.field_key=r.source_key
    cross join lateral (select form_field_option_values(f.options,f.dropdown_master_type,v_flow.tenant_id) as offered) options
    where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer'
      and r.condition_operator in ('equals','not_equals','in')
      and jsonb_array_length(options.offered)>0
      and not (options.offered @> fms_route_expected_values(r.condition_operator,r.condition_value))
  ) then raise exception 'A conditional route matches an answer that the linked question no longer offers' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.condition_operator not in ('default','not_empty') and nullif(btrim(coalesce(r.condition_value,'')),'') is null) then raise exception 'A conditional route needs the answer it should match' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='outcome' and r.condition_operator<>'default' and coalesce(s.planned_time_rule->>'decisionMode','normal') not in ('yes_no','decision')) then raise exception 'A route on a step outcome requires that step to be a Decision step' using errcode='23514'; end if;
  if exists(select 1 from fms_stage_assignees a join fms_stages s on s.id=a.fms_stage_id left join user_profiles primary_user on primary_user.id=a.user_profile_id left join user_profiles fallback_user on fallback_user.id=a.fallback_user_profile_id where s.fms_flow_id=p_flow_id and a.assignee_type='specific_user' and (primary_user.id is null or primary_user.tenant_id<>v_flow.tenant_id or primary_user.working_status='resigned' or (fallback_user.id is not null and (fallback_user.tenant_id<>v_flow.tenant_id or fallback_user.working_status='resigned' or fallback_user.department_id is distinct from primary_user.department_id)))) then raise exception 'Named assignees must be visible Users profiles in this tenant and fallback users must be in the primary user department' using errcode='23514'; end if;
  if exists(
    select 1 from fms_stages s
    left join form_fields field on field.form_template_id=s.form_template_id
      and field.field_key=s.planned_time_rule->>'assignmentFieldKey'
    where s.fms_flow_id=p_flow_id and nullif(s.planned_time_rule->>'assignmentFieldKey','') is not null
      and (s.step_type not in ('form','task','approval') or field.id is null or field.field_type<>'user_dropdown'
        or not field.is_required or not field.is_shown or field.conditional_logic is not null
        or field.rule_definition is not null)
  ) then raise exception 'A linked Form assignment source must be a required, always visible User question' using errcode='23514'; end if;
  with recursive walk(id,path,cycle) as (select id,array[id],false from fms_stages where fms_flow_id=p_flow_id and sort_order=(select min(sort_order) from fms_stages where fms_flow_id=p_flow_id) union all select edge.next_id,w.path||edge.next_id,edge.next_id=any(w.path) from walk w join fms_stages s on s.id=w.id cross join lateral (select s.default_next_stage_id next_id where s.default_next_stage_id is not null union select unnest(s.parallel_target_stage_ids) union select r.next_stage_id from fms_branch_rules r where r.fms_stage_id=s.id and r.next_stage_id is not null) edge where not w.cycle) select count(distinct id),coalesce(bool_or(cycle),false)::integer into v_reached,v_count from walk;
  if v_reached<>(select count(*) from fms_stages where fms_flow_id=p_flow_id) then raise exception 'Workflow contains unreachable steps' using errcode='23514'; end if;
  if v_count=1 then raise exception 'Workflow contains an unsupported cycle' using errcode='23514'; end if;
end $$;

notify pgrst,'reload schema';
