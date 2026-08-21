-- Permit a general workflow Status condition alongside the existing Yes/No decision condition.
-- The runtime update is deliberately server-side: a crafted browser payload cannot make a
-- conditional stage run when the persisted instance context does not match.

create or replace function is_valid_fms_timing_rule(p_rule jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_method text:=coalesce(nullif(p_rule->>'timingMethod',''),'completion_date'); v_number numeric; v_condition jsonb:=p_rule->'conditional';
begin
  if coalesce(p_rule->>'decisionMode','normal') not in ('normal','yes_no') then return false; end if;
  if v_condition is not null and (
    jsonb_typeof(v_condition)<>'object' or (
      coalesce(v_condition->>'field','')='status'
      and coalesce(v_condition->>'operator','')='equals'
      and nullif(btrim(v_condition->>'value'),'') is not null
    ) is not true and (
      coalesce(v_condition->>'decisionStageKey','') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(v_condition->>'outcome','') not in ('yes','no')
    )
  ) then return false; end if;
  if v_method='completion_date' then return is_valid_fms_due_date(p_rule->>'dueDate'); end if;
  if v_method='tat_hours' then v_number:=(p_rule->>'tatHours')::numeric; return v_number>0 and v_number<=8760; end if;
  if v_method='days_before_date' then v_number:=(p_rule->>'daysBefore')::numeric; return is_valid_fms_due_date(p_rule->>'futureDate') and v_number=trunc(v_number) and v_number between 0 and 3650; end if;
  if v_method='specific_time' then return is_valid_fms_due_date(p_rule->>'dueDate') and coalesce(p_rule->>'clockTime','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'; end if;
  return false;
exception when others then return false;
end $$;

/* Superseded by the deterministic forward repair in 0082.  This historical
   pg_get_functiondef text rewrite is retained only as documentation because
   PostgreSQL normalizes function source and cannot safely support it. */
/* do $$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)'::regprocedure) into v_definition;
  v_old := $old$
 v_condition_key:=v_stage.planned_time_rule#>>'{conditional,decisionStageKey}'; v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,outcome}');
 if nullif(v_condition_key,'') is not null then
   select lower(instance_stage.outcome) into v_condition_actual from fms_instance_stages instance_stage join fms_stages definition on definition.id=instance_stage.fms_stage_id where instance_stage.fms_instance_id=p_instance_id and definition.stage_key=v_condition_key and instance_stage.status='completed' order by instance_stage.actual_datetime desc nulls last limit 1;
   if v_condition_actual is null then raise exception 'The earlier Yes or No decision has not been completed' using errcode='23514'; end if;
   if v_condition_actual<>v_condition_expected then
     insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime,completed_by,previous_instance_stage_id,revision_of_id,outcome) values(p_instance_id,p_stage_id,'completed','{}',fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),now(),v_instance.started_by,p_previous_instance_stage_id,v_revision_of,'condition_skipped') returning * into v_instance_stage;
     insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'condition_skipped',jsonb_build_object('decisionStageKey',v_condition_key,'expected',v_condition_expected,'actual',v_condition_actual));
     if v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); elsif not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
     return v_instance_stage.id;
   end if;
 end if;$old$;
  v_new := $new$
 if v_stage.planned_time_rule#>>'{conditional,field}'='status' then
   v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,value}');
   v_condition_actual:=lower(v_instance.context->>'status');
   if coalesce(v_condition_actual,'')<>v_condition_expected then
     insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime,completed_by,previous_instance_stage_id,revision_of_id,outcome) values(p_instance_id,p_stage_id,'completed','{}',fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),now(),v_instance.started_by,p_previous_instance_stage_id,v_revision_of,'condition_skipped') returning * into v_instance_stage;
     insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'condition_skipped',jsonb_build_object('field','status','expected',v_condition_expected,'actual',v_condition_actual));
     if v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); elsif not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
     return v_instance_stage.id;
   end if;
 else
   v_condition_key:=v_stage.planned_time_rule#>>'{conditional,decisionStageKey}'; v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,outcome}');
   if nullif(v_condition_key,'') is not null then
     select lower(instance_stage.outcome) into v_condition_actual from fms_instance_stages instance_stage join fms_stages definition on definition.id=instance_stage.fms_stage_id where instance_stage.fms_instance_id=p_instance_id and definition.stage_key=v_condition_key and instance_stage.status='completed' order by instance_stage.actual_datetime desc nulls last limit 1;
     if v_condition_actual is null then raise exception 'The earlier Yes or No decision has not been completed' using errcode='23514'; end if;
     if v_condition_actual<>v_condition_expected then
       insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime,completed_by,previous_instance_stage_id,revision_of_id,outcome) values(p_instance_id,p_stage_id,'completed','{}',fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),now(),v_instance.started_by,p_previous_instance_stage_id,v_revision_of,'condition_skipped') returning * into v_instance_stage;
       insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'condition_skipped',jsonb_build_object('decisionStageKey',v_condition_key,'expected',v_condition_expected,'actual',v_condition_actual));
       if v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); elsif not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
       return v_instance_stage.id;
     end if;
   end if;
 end if;$new$;
  if position(v_old in v_definition)=0 then raise exception 'FMS conditional runtime patch could not locate the existing condition block'; end if;
  execute replace(v_definition,v_old,v_new);
end $$; */
