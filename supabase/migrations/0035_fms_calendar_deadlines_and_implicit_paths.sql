-- New workflow versions use an absolute calendar deadline for each step.
-- The first ordered Form is the implicit start and every reachable leaf is an implicit end.

create or replace function is_valid_fms_due_date(p_value text)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_date date;
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  v_date:=p_value::date;
  return to_char(v_date,'YYYY-MM-DD')=p_value;
exception when others then return false;
end $$;

create or replace function fms_stage_deadline(p_rule jsonb,p_tenant_id uuid)
returns timestamptz language sql stable security definer set search_path=public as $$
  select case
    when is_valid_fms_due_date(p_rule->>'dueDate') then
      ((p_rule->>'dueDate')::date + time '23:59:59.999999') at time zone coalesce((select timezone from tenants where id=p_tenant_id),'Asia/Kolkata')
    else now()+make_interval(mins=>greatest(0,coalesce((p_rule->>'minutes')::integer,0)))
  end
$$;

create or replace function assert_fms_flow_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_flow fms_flows; v_count integer; v_reached integer;
begin
  select * into v_flow from fms_flows where id=p_flow_id for update;
  if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Draft workflow not found' using errcode='23514'; end if;
  select count(*) into v_count from fms_stages where fms_flow_id=p_flow_id;
  if v_count=0 then raise exception 'Workflow cannot be empty' using errcode='23514'; end if;
  if (select step_type from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1)<>'form' then raise exception 'The first workflow step must be a Form' using errcode='23514'; end if;
  if exists(select 1 from fms_stages where fms_flow_id=p_flow_id and step_type='end') then raise exception 'End nodes are no longer used; remove the End node and leave the final step unconnected' using errcode='23514'; end if;
  if not exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('branch','parallel_start','end') and s.default_next_stage_id is null and cardinality(s.parallel_target_stage_ids)=0) then raise exception 'Workflow needs at least one completion step with no outgoing connection' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and not is_valid_fms_due_date(s.planned_time_rule->>'dueDate')) then raise exception 'Every workflow step needs a valid completion due date' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and ((s.step_type='form' and s.form_template_id is null) or (s.step_type='parallel_start' and cardinality(s.parallel_target_stage_ids)=0) or (s.step_type='parallel_join' and (s.join_rule is null or s.join_rule='specific' and cardinality(s.join_required_stage_ids)=0)) or (s.step_type='approval' and s.completion_rule<>'manager_approval') or (s.completion_rule='all_doers' and not s.allow_multiple_doers))) then raise exception 'A workflow step is incomplete or incompatible' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join form_templates f on f.id=s.form_template_id where s.fms_flow_id=p_flow_id and (f.tenant_id<>v_flow.tenant_id or f.lifecycle<>'published' or not f.is_active)) then raise exception 'Linked Forms must be exact active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_flows target on target.id=s.split_to_flow_id where s.fms_flow_id=p_flow_id and (target.tenant_id<>v_flow.tenant_id or target.status<>'published' or not target.is_active)) then raise exception 'Linked workflows must be active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.default_next_stage_id is not null and not exists(select 1 from fms_stages n where n.id=s.default_next_stage_id and n.fms_flow_id=p_flow_id)) then raise exception 'A next-step connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s cross join lateral unnest(s.parallel_target_stage_ids||coalesce(s.join_required_stage_ids,'{}')) target(id) where s.fms_flow_id=p_flow_id and not exists(select 1 from fms_stages n where n.id=target.id and n.fms_flow_id=p_flow_id)) then raise exception 'A parallel connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='branch' and ((select count(*) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>1 or exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and (r.next_stage_id is null or r.next_flow_id is not null)) or (select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>(select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id))) then raise exception 'Decision steps require ordered routes to workflow steps and one final fallback route' using errcode='23514'; end if;
  if exists(select 1 from fms_stage_assignees a join fms_stages s on s.id=a.fms_stage_id left join user_profiles primary_user on primary_user.id=a.user_profile_id left join user_profiles fallback_user on fallback_user.id=a.fallback_user_profile_id where s.fms_flow_id=p_flow_id and a.assignee_type='specific_user' and (primary_user.id is null or primary_user.tenant_id<>v_flow.tenant_id or (fallback_user.id is not null and (fallback_user.tenant_id<>v_flow.tenant_id or fallback_user.department_id is distinct from primary_user.department_id)))) then raise exception 'Named assignees must belong to this tenant and fallback users must be in the primary user department' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('notification','branch','parallel_start','parallel_join','end') and not exists(select 1 from fms_stage_assignees a where a.fms_stage_id=s.id and a.assignee_type='specific_user' and exists(select 1 from user_profiles u where u.id in (a.user_profile_id,a.fallback_user_profile_id) and u.tenant_id=v_flow.tenant_id and u.working_status not in ('inactive','resigned') and u.is_login_enabled))) then raise exception 'Every human step needs an active named primary or fallback assignee from Users' using errcode='23514'; end if;
  with recursive walk(id,path,cycle) as (
    select id,array[id],false from fms_stages where fms_flow_id=p_flow_id and sort_order=(select min(sort_order) from fms_stages where fms_flow_id=p_flow_id)
    union all
    select edge.next_id,w.path||edge.next_id,edge.next_id=any(w.path) from walk w join fms_stages s on s.id=w.id cross join lateral (select s.default_next_stage_id next_id where s.default_next_stage_id is not null union select unnest(s.parallel_target_stage_ids) union select r.next_stage_id from fms_branch_rules r where r.fms_stage_id=s.id and r.next_stage_id is not null) edge where not w.cycle
  ) select count(distinct id),coalesce(bool_or(cycle),false)::integer into v_reached,v_count from walk;
  if v_reached<>(select count(*) from fms_stages where fms_flow_id=p_flow_id) then raise exception 'Workflow contains unreachable steps' using errcode='23514'; end if;
  if v_count=1 then raise exception 'Workflow contains an unsupported cycle' using errcode='23514'; end if;
end $$;

create or replace function activate_fms_stage_internal(p_instance_id uuid,p_stage_id uuid,p_previous_instance_stage_id uuid,p_selected_user uuid default null,p_guard integer default 0)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_instance fms_instances; v_stage fms_stages; v_instance_stage fms_instance_stages; v_ids uuid[]; v_item jsonb; v_rule fms_branch_rules; v_actual jsonb; v_target uuid; v_actor uuid; v_ready boolean; v_required integer; v_completed integer; v_revision_of uuid; v_activated_next boolean:=false;
begin
 if p_guard>100 then raise exception 'Automatic FMS transition limit exceeded' using errcode='54001'; end if;
 select * into v_instance from fms_instances where id=p_instance_id for update; select * into v_stage from fms_stages where id=p_stage_id;
 if v_instance.status not in ('active','overdue') or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Instance or stage is not activatable' using errcode='23514'; end if;
 if v_stage.step_type='parallel_join' then
   if v_stage.join_rule='specific' then select cardinality(v_stage.join_required_stage_ids),count(*) into v_required,v_completed from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=any(v_stage.join_required_stage_ids) and status='completed';
   else select count(*),count(*) filter(where s.status='completed') into v_required,v_completed from fms_stages d join fms_instance_stages s on s.fms_stage_id=d.id and s.fms_instance_id=p_instance_id where v_stage.id=any(d.parallel_target_stage_ids) or d.default_next_stage_id=v_stage.id; end if;
   v_ready=case v_stage.join_rule when 'any' then v_completed>0 else v_required>0 and v_completed=v_required end; if not v_ready then return null; end if;
 end if;
 select * into v_instance_stage from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=p_stage_id order by created_at desc,id desc limit 1;
 if v_instance_stage.id is not null and v_instance_stage.status<>'blocked' then return v_instance_stage.id; end if;
 if v_instance_stage.status='blocked' then v_revision_of=v_instance_stage.id; end if;
 v_ids=resolve_fms_stage_assignees(p_stage_id,p_instance_id,p_selected_user);
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,previous_instance_stage_id,revision_of_id)
 values(p_instance_id,p_stage_id,(case when v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then 'in_progress' else case when v_stage.step_type='approval' then 'in_review' else 'in_progress' end end)::task_status,v_ids,fms_stage_deadline(v_stage.planned_time_rule,v_instance.tenant_id),now(),p_previous_instance_stage_id,v_revision_of) returning * into v_instance_stage;
 foreach v_actor in array v_ids loop insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values(v_instance.tenant_id,v_instance_stage.id,v_actor,v_instance.started_by); end loop;
 for v_item in select value from jsonb_array_elements(v_stage.checklist_definition) loop insert into fms_instance_checklist_items(tenant_id,fms_instance_stage_id,item_key,label,is_required,sort_order) values(v_instance.tenant_id,v_instance_stage.id,v_item->>'key',v_item->>'label',coalesce((v_item->>'required')::boolean,true),coalesce((v_item->>'sortOrder')::integer,0)); end loop;
 insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'activated',jsonb_build_object('guard',p_guard));
 if v_stage.step_type='notification' then
   foreach v_actor in array case when cardinality(v_ids)>0 then v_ids else array[v_instance.started_by] end loop insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status) values(v_instance.tenant_id,v_actor,'fms_stage_notification',coalesce(nullif(v_stage.notification_config->>'title',''),v_stage.name),coalesce(nullif(v_stage.notification_config->>'message',''),coalesce(v_stage.method,'FMS stage notification')),'/tasks?view=fms&instance='||p_instance_id,'in_app','delivered'); end loop;
 elsif v_stage.step_type='branch' then
   for v_rule in select * from fms_branch_rules where fms_stage_id=v_stage.id order by sort_order loop
     if v_rule.source_type='outcome' then select to_jsonb(outcome) into v_actual from fms_instance_stages where id=p_previous_instance_stage_id; elsif v_rule.source_type='context' then v_actual=v_instance.context->v_rule.source_key; else select fs.data->v_rule.source_key into v_actual from form_submissions fs join fms_instance_stages prior on prior.form_submission_id=fs.id where prior.id=p_previous_instance_stage_id; end if;
     if fms_rule_matches(v_rule.condition_operator,v_rule.condition_value,v_actual) then v_target=v_rule.next_stage_id; update fms_instance_stages set branch_rule_id=v_rule.id where id=v_instance_stage.id; exit; end if;
   end loop;
   if v_target is null then raise exception 'No deterministic decision route matched' using errcode='23514'; end if;
 elsif v_stage.step_type='parallel_start' then foreach v_target in array v_stage.parallel_target_stage_ids loop perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); v_activated_next=true; end loop;
 elsif v_stage.step_type='end' then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
 if v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then
   update fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_instance.started_by where id=v_instance_stage.id;
   insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,case when v_stage.step_type='branch' then 'branch_taken' else 'automatic_completed' end,'{}');
   if v_stage.step_type='branch' and v_target is not null then perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); v_activated_next=true;
   elsif v_stage.step_type in ('notification','parallel_join') and v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); v_activated_next=true; end if;
   if not v_activated_next and v_stage.step_type<>'end' and not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
 end if;
 return v_instance_stage.id;
end $$;

alter function is_valid_fms_due_date(text) owner to postgres;
alter function fms_stage_deadline(jsonb,uuid) owner to postgres;
alter function assert_fms_flow_publishable(uuid) owner to postgres;
alter function activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer) owner to postgres;
revoke all on function is_valid_fms_due_date(text),fms_stage_deadline(jsonb,uuid),assert_fms_flow_publishable(uuid),activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
