-- Dynamic FMS decision options, optional deadlines, and durable context defaults.

alter table public.fms_flows add column if not exists module_context text;
alter table public.fms_flows add constraint fms_flows_module_context_length check (module_context is null or length(module_context) between 1 and 64) not valid;
alter table public.fms_flows validate constraint fms_flows_module_context_length;

create table if not exists public.fms_context_assignee_defaults (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id),
  module_context text not null check (length(module_context) between 1 and 64),
  user_profile_id uuid not null references public.user_profiles(id),
  created_by uuid not null references public.user_profiles(id),
  updated_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, module_context)
);
alter table public.fms_context_assignee_defaults enable row level security;
create policy fms_context_assignee_defaults_select on public.fms_context_assignee_defaults for select to authenticated using (tenant_id=current_tenant_id());

create or replace function public.save_fms_context_assignee_default_with_audit(p_module_context text,p_user_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor public.user_profiles; v_old jsonb; v_new jsonb; v_saved public.fms_context_assignee_defaults; v_context text:=lower(nullif(btrim(p_module_context),''));
begin
  select * into v_actor from public.current_profile();
  if v_actor.id is null or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'FMS default assignment management is not permitted' using errcode='42501'; end if;
  if v_context is null or v_context !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'Invalid FMS module context' using errcode='22023'; end if;
  if not exists(select 1 from public.user_profiles u where u.id=p_user_profile_id and u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.is_login_enabled) then raise exception 'Select an active Users profile in this tenant' using errcode='23514'; end if;
  select to_jsonb(d) into v_old from public.fms_context_assignee_defaults d where d.tenant_id=v_actor.tenant_id and d.module_context=v_context for update;
  insert into public.fms_context_assignee_defaults(tenant_id,module_context,user_profile_id,created_by,updated_by)
  values(v_actor.tenant_id,v_context,p_user_profile_id,v_actor.id,v_actor.id)
  on conflict(tenant_id,module_context) do update set user_profile_id=excluded.user_profile_id,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_saved;
  v_new:=to_jsonb(v_saved);
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_context_default_assignee_saved','fms_context_assignee_defaults',(v_new->>'id')::uuid,v_old,v_new);
end $$;

revoke all on function public.save_fms_context_assignee_default_with_audit(text,uuid) from public,anon;
grant execute on function public.save_fms_context_assignee_default_with_audit(text,uuid) to authenticated;

create or replace function public.set_fms_flow_context_with_audit(p_flow_id uuid,p_module_context text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor public.user_profiles; v_flow public.fms_flows; v_context text:=nullif(lower(btrim(coalesce(p_module_context,''))), '');
begin
  select * into v_actor from public.current_profile();
  if v_actor.id is null or not public.can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  if v_context is not null and v_context !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'Invalid FMS module context' using errcode='22023'; end if;
  select * into v_flow from public.fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id and status='draft' for update;
  if v_flow.id is null then raise exception 'Draft workflow not found' using errcode='23514'; end if;
  update public.fms_flows set module_context=v_context,updated_by=v_actor.id,updated_at=now() where id=v_flow.id;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'fms_flow_context_saved','fms_flows',v_flow.id,jsonb_build_object('module_context',v_flow.module_context),jsonb_build_object('module_context',v_context));
end $$;
revoke all on function public.set_fms_flow_context_with_audit(uuid,text) from public,anon;
grant execute on function public.set_fms_flow_context_with_audit(uuid,text) to authenticated;

create or replace function public.is_valid_fms_timing_rule(p_rule jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_method text:=coalesce(nullif(p_rule->>'timingMethod',''),'completion_date'); v_number numeric; v_options jsonb; v_key text;
begin
  if jsonb_typeof(p_rule) <> 'object' then return false; end if;
  if coalesce(p_rule->>'decisionMode','normal') not in ('normal','yes_no','decision') then return false; end if;
  if p_rule->>'decisionMode' in ('decision','yes_no') and p_rule ? 'decisionOptions' then
    v_options:=p_rule->'decisionOptions';
    if jsonb_typeof(v_options)<>'array' or jsonb_array_length(v_options)<2 then return false; end if;
    if exists(select 1 from jsonb_array_elements(v_options) item where coalesce(item->>'key','') !~ '^[a-z][a-z0-9_]{0,63}$' or nullif(btrim(item->>'label'),'') is null) then return false; end if;
    if (select count(*) from jsonb_array_elements(v_options) item)<>(select count(distinct item->>'key') from jsonb_array_elements(v_options) item) then return false; end if;
  end if;
  if p_rule ? 'conditional' then
    if jsonb_typeof(p_rule->'conditional')<>'object' then return false; end if;
    if p_rule#>>'{conditional,field}'='status' then
      if coalesce(p_rule#>>'{conditional,operator}','') not in ('equals','not_equals','greater_than','less_than','greater_than_or_equal','less_than_or_equal','contains','not_contains') or nullif(btrim(p_rule#>>'{conditional,value}'),'') is null then return false; end if;
    else
      if coalesce(p_rule#>>'{conditional,decisionStageKey}','') !~ '^[a-z][a-z0-9_]{0,63}$' then return false; end if;
      v_key:=coalesce(nullif(p_rule#>>'{conditional,decisionOptionKey}',''),nullif(p_rule#>>'{conditional,outcome}',''));
      if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,63}$' then return false; end if;
    end if;
  end if;
  if coalesce((p_rule->>'deadlineEnabled')::boolean,true)=false then return true; end if;
  if v_method='completion_date' then return public.is_valid_fms_due_date(p_rule->>'dueDate'); end if;
  if v_method='tat_hours' then v_number:=coalesce(nullif(p_rule->>'tatMinutes','')::numeric,nullif(p_rule->>'tatHours','')::numeric*60); return v_number>0 and v_number<=525600; end if;
  if v_method='days_before_date' then v_number:=(p_rule->>'daysBefore')::numeric; return public.is_valid_fms_due_date(p_rule->>'futureDate') and v_number=trunc(v_number) and v_number between 0 and 3650; end if;
  if v_method='specific_time' then return public.is_valid_fms_due_date(p_rule->>'dueDate') and coalesce(p_rule->>'clockTime','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'; end if;
  return false;
exception when others then return false;
end $$;

create or replace function public.fms_stage_deadline_for_instance(p_rule jsonb,p_tenant_id uuid,p_instance_id uuid)
returns timestamptz language plpgsql stable security definer set search_path=public as $$
declare v_method text:=coalesce(nullif(p_rule->>'timingMethod',''),'completion_date'); v_timezone text; v_base timestamptz; v_minutes numeric;
begin
  if coalesce((p_rule->>'deadlineEnabled')::boolean,true)=false then return null; end if;
  select coalesce(timezone,'Asia/Kolkata') into v_timezone from public.tenants where id=p_tenant_id;
  if v_method='tat_hours' then
    if nullif(p_rule->>'triggerStageKey','') is not null then select s.actual_datetime into v_base from public.fms_instance_stages s join public.fms_stages d on d.id=s.fms_stage_id where s.fms_instance_id=p_instance_id and d.stage_key=p_rule->>'triggerStageKey' and s.status='completed' order by s.actual_datetime desc nulls last limit 1; end if;
    v_minutes:=coalesce(nullif(p_rule->>'tatMinutes','')::numeric,nullif(p_rule->>'tatHours','')::numeric*60);
    return coalesce(v_base,now())+make_interval(secs=>round(v_minutes*60)::integer);
  elsif v_method='days_before_date' then return (((p_rule->>'futureDate')::date-(p_rule->>'daysBefore')::integer)+time '23:59:59.999999') at time zone v_timezone;
  elsif v_method='specific_time' then return ((p_rule->>'dueDate')::date+(p_rule->>'clockTime')::time) at time zone v_timezone; end if;
  return ((p_rule->>'dueDate')::date+time '23:59:59.999999') at time zone v_timezone;
end $$;

create or replace function public.assert_fms_dynamic_stage_condition()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_condition jsonb:=new.planned_time_rule->'conditional'; v_decision jsonb; v_key text;
begin
  if v_condition is null then return new; end if;
  if v_condition->>'field'='status' then return new; end if;
  select planned_time_rule into v_decision from public.fms_stages where fms_flow_id=new.fms_flow_id and stage_key=v_condition->>'decisionStageKey';
  if v_decision is null or v_decision->>'decisionMode' not in ('yes_no','decision') then raise exception 'Conditional step must reference an earlier Decision Step' using errcode='23514'; end if;
  v_key:=coalesce(nullif(v_condition->>'decisionOptionKey',''),nullif(v_condition->>'outcome',''));
  if v_decision ? 'decisionOptions' then
    if not exists(select 1 from jsonb_array_elements(v_decision->'decisionOptions') item where item->>'key'=v_key) then raise exception 'Conditional step references a removed decision option' using errcode='23514'; end if;
  elsif v_key not in ('yes','no') then raise exception 'Legacy decision condition must use its existing option key' using errcode='23514'; end if;
  return new;
end $$;

drop trigger if exists fms_dynamic_stage_condition_guard on public.fms_stages;
create constraint trigger fms_dynamic_stage_condition_guard after insert or update of planned_time_rule on public.fms_stages deferrable initially deferred for each row execute function public.assert_fms_dynamic_stage_condition();

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
 v_next=v_stage.default_next_stage_id; if v_next is not null then perform public.activate_fms_stage_internal(v_instance.id,v_next,p_instance_stage_id,p_next_assignee_id,0); end if;
 if v_next is null and v_stage.step_type<>'end' and not exists(select 1 from public.fms_instance_stages where fms_instance_id=v_instance.id and status in ('pending','in_progress','in_review','overdue')) then update public.fms_instances set status='completed',completed_at=now(),updated_at=now() where id=v_instance.id; end if;
 insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_actor.id,'fms_stage_completed','fms_instance_stages',p_instance_stage_id,jsonb_build_object('outcome',left(coalesce(p_outcome,''),500)));
end $$;

alter function public.complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) owner to postgres;
revoke all on function public.complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) to authenticated;

notify pgrst, 'reload schema';
