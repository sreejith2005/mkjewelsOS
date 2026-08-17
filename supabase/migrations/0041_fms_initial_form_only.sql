-- The first ordered Form captures the workflow's initial details. Linking a
-- Form to every later executable step is optional; when linked, the existing
-- runtime completion gate still requires that exact Form submission.

create or replace function assert_fms_flow_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_flow fms_flows; v_count integer; v_reached integer;
begin
  select * into v_flow from fms_flows where id=p_flow_id for update;
  if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Draft workflow not found' using errcode='23514'; end if;
  select count(*) into v_count from fms_stages where fms_flow_id=p_flow_id;
  if v_count=0 then raise exception 'Workflow cannot be empty' using errcode='23514'; end if;
  if (select step_type from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1)<>'form' then raise exception 'The first workflow step must be a Form' using errcode='23514'; end if;
  if (select form_template_id from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1) is null then raise exception 'The initial Form step needs a published Form for the workflow details' using errcode='23514'; end if;
  if exists(select 1 from fms_stages where fms_flow_id=p_flow_id and step_type='end') then raise exception 'End nodes are no longer used; remove the End node and leave the final step unconnected' using errcode='23514'; end if;
  if not exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('branch','parallel_start','end') and s.default_next_stage_id is null and cardinality(s.parallel_target_stage_ids)=0) then raise exception 'Workflow needs at least one completion step with no outgoing connection' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and not is_valid_fms_due_date(s.planned_time_rule->>'dueDate')) then raise exception 'Every workflow step needs a valid completion due date' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and ((s.step_type='parallel_start' and cardinality(s.parallel_target_stage_ids)=0) or (s.step_type='parallel_join' and (s.join_rule is null or s.join_rule='specific' and cardinality(s.join_required_stage_ids)=0)) or (s.step_type='approval' and s.completion_rule<>'manager_approval') or (s.completion_rule='all_doers' and not s.allow_multiple_doers))) then raise exception 'A workflow step is incomplete or incompatible' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join form_templates f on f.id=s.form_template_id where s.fms_flow_id=p_flow_id and (f.tenant_id<>v_flow.tenant_id or f.lifecycle<>'published' or not f.is_active)) then raise exception 'Linked Forms must be exact active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_flows target on target.id=s.split_to_flow_id where s.fms_flow_id=p_flow_id and (target.tenant_id<>v_flow.tenant_id or target.status<>'published' or not target.is_active)) then raise exception 'Linked workflows must be active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.default_next_stage_id is not null and not exists(select 1 from fms_stages n where n.id=s.default_next_stage_id and n.fms_flow_id=p_flow_id)) then raise exception 'A next-step connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s cross join lateral unnest(s.parallel_target_stage_ids||coalesce(s.join_required_stage_ids,'{}')) target(id) where s.fms_flow_id=p_flow_id and not exists(select 1 from fms_stages n where n.id=target.id and n.fms_flow_id=p_flow_id)) then raise exception 'A parallel connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='branch' and ((select count(*) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>1 or exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and (r.next_stage_id is null or r.next_flow_id is not null)) or (select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>(select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id))) then raise exception 'Decision steps require ordered routes to workflow steps and one final fallback route' using errcode='23514'; end if;
  if exists(select 1 from fms_stage_assignees a join fms_stages s on s.id=a.fms_stage_id left join user_profiles primary_user on primary_user.id=a.user_profile_id left join user_profiles fallback_user on fallback_user.id=a.fallback_user_profile_id where s.fms_flow_id=p_flow_id and a.assignee_type='specific_user' and (primary_user.id is null or primary_user.tenant_id<>v_flow.tenant_id or primary_user.working_status='resigned' or (fallback_user.id is not null and (fallback_user.tenant_id<>v_flow.tenant_id or fallback_user.working_status='resigned' or fallback_user.department_id is distinct from primary_user.department_id)))) then raise exception 'Named assignees must be visible Users profiles in this tenant and fallback users must be in the primary user department' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('notification','branch','parallel_start','parallel_join','end') and not exists(select 1 from fms_stage_assignees a join user_profiles u on u.id=a.user_profile_id where a.fms_stage_id=s.id and a.assignee_type='specific_user' and u.tenant_id=v_flow.tenant_id and u.working_status<>'resigned')) then raise exception 'Every human step needs a named primary assignee from Users' using errcode='23514'; end if;
  with recursive walk(id,path,cycle) as (
    select id,array[id],false from fms_stages where fms_flow_id=p_flow_id and sort_order=(select min(sort_order) from fms_stages where fms_flow_id=p_flow_id)
    union all
    select edge.next_id,w.path||edge.next_id,edge.next_id=any(w.path) from walk w join fms_stages s on s.id=w.id cross join lateral (select s.default_next_stage_id next_id where s.default_next_stage_id is not null union select unnest(s.parallel_target_stage_ids) union select r.next_stage_id from fms_branch_rules r where r.fms_stage_id=s.id and r.next_stage_id is not null) edge where not w.cycle
  ) select count(distinct id),coalesce(bool_or(cycle),false)::integer into v_reached,v_count from walk;
  if v_reached<>(select count(*) from fms_stages where fms_flow_id=p_flow_id) then raise exception 'Workflow contains unreachable steps' using errcode='23514'; end if;
  if v_count=1 then raise exception 'Workflow contains an unsupported cycle' using errcode='23514'; end if;
end $$;

alter function assert_fms_flow_publishable(uuid) owner to postgres;
revoke all on function assert_fms_flow_publishable(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
