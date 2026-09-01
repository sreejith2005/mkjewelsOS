-- Stage-level conditional routing.
--
-- `fms_branch_rules` has always existed and has always been persisted by the
-- draft-save contract for every stage, but only `branch` stages evaluated them
-- at run time. This migration lets an ordinary step carry its own ordered
-- routes so one step can lead to several next steps, chosen from the answers in
-- the step's own linked Form, the decision outcome the doer selected, or the
-- instance context.
--
-- The change is strictly additive:
--   * a stage with no rows in `fms_branch_rules` behaves exactly as before and
--     moves to `default_next_stage_id`;
--   * when no rule matches, the stage still falls back to
--     `default_next_stage_id`, so a partially configured flow cannot strand an
--     instance in a state it could not previously reach;
--   * `branch` stages keep their existing `activate_fms_stage_internal` path,
--     which stays untouched here.
-- No data is rewritten and no column is dropped or renamed.
set search_path = public, extensions;

/**
 * Resolves the first matching route for a completed stage.
 * Returns null when the stage has no routes or none of them match.
 */
create or replace function fms_stage_route_target(p_stage_id uuid, p_instance_id uuid, p_instance_stage_id uuid, p_outcome text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_rule fms_branch_rules;
  v_answers jsonb;
  v_context jsonb;
  v_actual jsonb;
begin
  if not exists(select 1 from fms_branch_rules where fms_stage_id = p_stage_id) then return null; end if;
  select coalesce(submission.data, '{}'::jsonb) into v_answers
  from fms_instance_stages instance_stage
  left join form_submissions submission on submission.id = instance_stage.form_submission_id
  where instance_stage.id = p_instance_stage_id;
  if v_answers is null or v_answers = '{}'::jsonb then
    select coalesce(submission.data, '{}'::jsonb) into v_answers
    from form_submissions submission
    where submission.linked_module = 'fms_stage' and submission.linked_record_id = p_instance_stage_id
    order by submission.submitted_at desc nulls last
    limit 1;
  end if;
  select coalesce(context, '{}'::jsonb) into v_context from fms_instances where id = p_instance_id;
  for v_rule in select * from fms_branch_rules where fms_stage_id = p_stage_id order by sort_order, id loop
    if v_rule.source_type = 'outcome' then v_actual := to_jsonb(nullif(btrim(coalesce(p_outcome, '')), ''));
    elsif v_rule.source_type = 'context' then v_actual := coalesce(v_context, '{}'::jsonb) -> v_rule.source_key;
    else v_actual := coalesce(v_answers, '{}'::jsonb) -> v_rule.source_key;
    end if;
    if fms_rule_matches(v_rule.condition_operator, v_rule.condition_value, v_actual) then return v_rule.next_stage_id; end if;
  end loop;
  return null;
end $$;

alter function fms_stage_route_target(uuid, uuid, uuid, text) owner to postgres;
revoke all on function fms_stage_route_target(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

-- Replaces 0115's definition. The only behavioural difference is the routing
-- lookup on the line that previously read `v_next = v_stage.default_next_stage_id`.
create or replace function public.complete_fms_stage_with_audit(p_instance_stage_id uuid,p_outcome text default null,p_remark text default null,p_checklist jsonb default '{}',p_next_assignee_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor public.user_profiles; v_instance_stage public.fms_instance_stages; v_instance public.fms_instances; v_stage public.fms_stages; v_item record; v_satisfied boolean; v_next uuid; v_child uuid; v_decision_options jsonb; v_decision_outcome text;
begin
 select * into v_actor from public.current_profile(); select * into v_instance_stage from public.fms_instance_stages where id=p_instance_stage_id for update; select * into v_instance from public.fms_instances where id=v_instance_stage.fms_instance_id for update; select * into v_stage from public.fms_stages where id=v_instance_stage.fms_stage_id;
 if v_actor.id is null or not public.current_profile_is_active() or v_instance.status not in ('active','overdue') or v_instance_stage.status not in ('pending','in_progress','in_review','overdue') then raise exception 'Stage is not actionable' using errcode='23514'; end if;
 if not (v_actor.id=any(v_instance_stage.assigned_to) or (v_actor.user_role in ('super_admin','admin')) or (v_actor.user_role='manager' and v_instance.branch_id=v_actor.branch_id)) then raise exception 'Stage completion denied' using errcode='42501'; end if;
 if v_stage.step_type='approval' and v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Approval requires manager or administrator authority' using errcode='42501'; end if;
 if jsonb_typeof(p_checklist)<>'object' then raise exception 'Checklist payload must be an object' using errcode='22023'; end if;
 for v_item in select * from public.fms_instance_checklist_items where fms_instance_stage_id=p_instance_stage_id for update loop
   if coalesce((p_checklist->>v_item.item_key)::boolean,false) then update public.fms_instance_checklist_items set is_completed=true,completed_by=v_actor.id,completed_at=now() where id=v_item.id; end if;
 end loop;
 if v_stage.requires_remark and nullif(btrim(p_remark),'') is null then raise exception 'A completion remark is required' using errcode='23514'; end if;
 if v_stage.requires_upload and not exists(select 1 from public.fms_evidence where fms_instance_stage_id=p_instance_stage_id and removed_at is null) then raise exception 'Required evidence upload is missing' using errcode='23514'; end if;
 if exists(select 1 from public.fms_instance_checklist_items where fms_instance_stage_id=p_instance_stage_id and is_required and not is_completed) then raise exception 'Required checklist items are incomplete' using errcode='23514'; end if;
 if v_stage.id=(select first_stage.id from public.fms_stages first_stage where first_stage.fms_flow_id=v_stage.fms_flow_id order by first_stage.sort_order,first_stage.id limit 1)
    and v_stage.form_template_id is not null
    and not exists(select 1 from public.form_submissions where form_template_id=v_stage.form_template_id and linked_module='fms_stage' and linked_record_id=p_instance_stage_id)
 then raise exception 'The initial details form submission is required' using errcode='23514'; end if;
 if v_stage.requires_next_doer_handoff and p_next_assignee_id is null then raise exception 'Next-stage assignee selection is required' using errcode='23514'; end if;
 if coalesce(v_stage.planned_time_rule->>'decisionMode','normal') in ('yes_no','decision') then
   v_decision_outcome:=lower(nullif(btrim(p_outcome),''));
   if v_decision_outcome is null then raise exception 'A decision outcome is required' using errcode='23514'; end if;
   v_decision_options:=v_stage.planned_time_rule->'decisionOptions';
   if jsonb_typeof(v_decision_options)='array' then
     if not exists(select 1 from jsonb_array_elements(v_decision_options) option where lower(option->>'key')=v_decision_outcome) then raise exception 'Decision outcome is not configured for this step' using errcode='23514'; end if;
   elsif v_decision_outcome not in ('yes','no') then raise exception 'Legacy decision outcome is invalid' using errcode='23514'; end if;
 end if;
 if not v_actor.id=any(v_instance_stage.assigned_to) then
   insert into public.fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by,status,claimed_at,completed_at,outcome,remark)
   values(v_instance.tenant_id,p_instance_stage_id,v_actor.id,v_actor.id,'completed',now(),now(),left(p_outcome,500),left(p_remark,4000));
   update public.fms_instance_stages set assigned_to=array_append(assigned_to,v_actor.id) where id=p_instance_stage_id;
 else
   update public.fms_instance_stage_assignees set status='completed',completed_at=now(),outcome=left(p_outcome,500),remark=left(p_remark,4000) where fms_instance_stage_id=p_instance_stage_id and user_profile_id=v_actor.id and is_active;
 end if;
 select case v_stage.completion_rule when 'all_doers' then count(*)>0 and bool_and(status='completed') when 'any_doer' then bool_or(status='completed') else v_actor.user_role in ('super_admin','admin','manager') end into v_satisfied from public.fms_instance_stage_assignees where fms_instance_stage_id=p_instance_stage_id and is_active;
 insert into public.fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'actor_completed',jsonb_build_object('outcome',left(coalesce(p_outcome,''),500),'remark',left(coalesce(p_remark,''),4000)));
 if not v_satisfied then return; end if;
 update public.fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_actor.id,remark=nullif(btrim(p_remark),''),outcome=nullif(btrim(p_outcome),'') where id=p_instance_stage_id;
 if v_stage.split_to_flow_id is not null and not exists(select 1 from public.fms_instances where parent_instance_id=v_instance.id and fms_flow_id=v_stage.split_to_flow_id) then
   select started.instance_id into v_child from public.start_fms_instance_with_audit(v_stage.split_to_flow_id,v_instance.title,v_instance.priority,v_instance.context,v_instance.branch_id,v_instance.department_id,p_next_assignee_id) started;
   update public.fms_instances set parent_instance_id=v_instance.id where id=v_child;
 end if;
 -- Ordered routes first, then the historical single successor as the fallback.
 v_next=public.fms_stage_route_target(v_stage.id,v_instance.id,p_instance_stage_id,p_outcome);
 if v_next is not null then
   insert into public.fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'route_taken',jsonb_build_object('next_stage_id',v_next));
 else
   v_next=v_stage.default_next_stage_id;
 end if;
 if v_next is not null then perform public.activate_fms_stage_internal(v_instance.id,v_next,p_instance_stage_id,p_next_assignee_id,0); end if;
 if v_next is null and v_stage.step_type<>'end' and not exists(select 1 from public.fms_instance_stages where fms_instance_id=v_instance.id and status in ('pending','in_progress','in_review','overdue')) then update public.fms_instances set status='completed',completed_at=now(),updated_at=now() where id=v_instance.id; end if;
 insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_actor.id,'fms_stage_completed','fms_instance_stages',p_instance_stage_id,jsonb_build_object('outcome',left(coalesce(p_outcome,''),500),'next_stage_id',v_next));
end $$;

alter function public.complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) owner to postgres;
revoke all on function public.complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) to authenticated;

-- Publish-time validation for the new routes. Existing flows carry no rules on
-- ordinary stages, so none of these checks can newly fail for historical data.
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
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer' and s.form_template_id is null) then raise exception 'A step that routes on a form answer needs a linked Form' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer' and not exists(select 1 from form_fields f where f.form_template_id=s.form_template_id and f.field_key=r.source_key)) then raise exception 'A conditional route uses a question that is no longer in the linked Form' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.condition_operator not in ('default','not_empty') and nullif(btrim(coalesce(r.condition_value,'')),'') is null) then raise exception 'A conditional route needs the answer it should match' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='outcome' and r.condition_operator<>'default' and coalesce(s.planned_time_rule->>'decisionMode','normal') not in ('yes_no','decision')) then raise exception 'A route on a step outcome requires that step to be a Decision step' using errcode='23514'; end if;
  if exists(select 1 from fms_stage_assignees a join fms_stages s on s.id=a.fms_stage_id left join user_profiles primary_user on primary_user.id=a.user_profile_id left join user_profiles fallback_user on fallback_user.id=a.fallback_user_profile_id where s.fms_flow_id=p_flow_id and a.assignee_type='specific_user' and (primary_user.id is null or primary_user.tenant_id<>v_flow.tenant_id or primary_user.working_status='resigned' or (fallback_user.id is not null and (fallback_user.tenant_id<>v_flow.tenant_id or fallback_user.working_status='resigned' or fallback_user.department_id is distinct from primary_user.department_id)))) then raise exception 'Named assignees must be visible Users profiles in this tenant and fallback users must be in the primary user department' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('notification','branch','parallel_start','parallel_join','end') and not exists(select 1 from fms_stage_assignees a join user_profiles u on u.id=a.user_profile_id where a.fms_stage_id=s.id and a.assignee_type='specific_user' and u.tenant_id=v_flow.tenant_id and u.working_status<>'resigned')) then raise exception 'Every human step needs a named primary assignee from Users' using errcode='23514'; end if;
  with recursive walk(id,path,cycle) as (select id,array[id],false from fms_stages where fms_flow_id=p_flow_id and sort_order=(select min(sort_order) from fms_stages where fms_flow_id=p_flow_id) union all select edge.next_id,w.path||edge.next_id,edge.next_id=any(w.path) from walk w join fms_stages s on s.id=w.id cross join lateral (select s.default_next_stage_id next_id where s.default_next_stage_id is not null union select unnest(s.parallel_target_stage_ids) union select r.next_stage_id from fms_branch_rules r where r.fms_stage_id=s.id and r.next_stage_id is not null) edge where not w.cycle) select count(distinct id),coalesce(bool_or(cycle),false)::integer into v_reached,v_count from walk;
  if v_reached<>(select count(*) from fms_stages where fms_flow_id=p_flow_id) then raise exception 'Workflow contains unreachable steps' using errcode='23514'; end if;
  if v_count=1 then raise exception 'Workflow contains an unsupported cycle' using errcode='23514'; end if;
end $$;

alter function assert_fms_flow_publishable(uuid) owner to postgres;
revoke all on function assert_fms_flow_publishable(uuid) from public,anon,authenticated,service_role;
grant execute on function assert_fms_flow_publishable(uuid) to authenticated;

notify pgrst, 'reload schema';
