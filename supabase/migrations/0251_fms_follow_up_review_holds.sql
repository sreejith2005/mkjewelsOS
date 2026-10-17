set search_path=public,extensions;

-- Keep the source visit actionable after a configured limit. An administrator
-- can resume the instance and the employee can choose its configured exit;
-- neither a completed source nor an invented successor is left stranded.
create function hold_fms_follow_up_for_review(p_instance_id uuid,p_visit_id uuid,p_outcome text) returns void
language plpgsql security definer set search_path=public as $$
declare instance fms_instances; work fms_instance_stages; target fms_stages; item jsonb; plan jsonb; capped boolean:=false;
begin
  select * into work from fms_instance_stages where id=p_visit_id and fms_instance_id=p_instance_id for update;
  select * into instance from fms_instances where id=p_instance_id for update;
  if not can_read_fms_work_context(work.id) or instance.tenant_id<>current_tenant_id() then raise exception 'Follow-up review is outside your work scope' using errcode='42501'; end if;
  plan:=fms_candidate_transition_plan(instance.id,work.id,coalesce((select data from form_submissions where id=work.form_submission_id),'{}'),p_outcome);
  for item in select value from jsonb_array_elements(plan) where value->>'limitReached'='true' loop
    capped:=true;
    select * into target from fms_stages where id=(item->>'targetStageId')::uuid and fms_flow_id=instance.fms_flow_id;
    if target.planned_time_rule#>>'{followUp,onLimit}'='escalate' then update fms_instance_stages set escalation_count=escalation_count+1 where id=work.id; end if;
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(work.id,(current_profile()).id,'follow_up_review_required',jsonb_build_object('target_stage_id',target.id,'limit',target.planned_time_rule->'followUp'));
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(instance.tenant_id,(current_profile()).id,'fms_follow_up_review_required','fms_instances',instance.id,jsonb_build_object('source_visit_id',work.id,'target_stage_id',target.id,'limit',target.planned_time_rule->'followUp'));
  end loop;
  if not capped then raise exception 'No configured follow-up limit was reached' using errcode='23514'; end if;
  update fms_instances set status='on_hold',updated_at=now() where id=instance.id;
end $$;

do $$
declare f text; n text; marker text;
begin
  f:=replace(pg_get_functiondef('fms_candidate_transition_plan(uuid,uuid,jsonb,text)'::regprocedure), E'\r', '');
  marker:='then continue; end if;'||E'\n      result:=result||jsonb_build_array';
  n:=replace(f,marker,$limit$then
        result:=result||jsonb_build_array(jsonb_build_object('targetStageId',target.id,'path',to_jsonb(path_ids),'limitReached',true)); continue;
      end if;
      result:=result||jsonb_build_array$limit$);
  if n=f then raise exception 'Follow-up preview limit marker changed'; end if; execute n;

  f:=replace(pg_get_functiondef('preview_fms_work_transition(jsonb)'::regprocedure), E'\r', '');
  marker:='      select * into target from fms_stages where id=(plan_item->>''targetStageId'')::uuid;';
  n:=replace(f,marker,$limit$      if plan_item->>'limitReached'='true' then
        if jsonb_array_length(requirements)=0 then requirements:=requirements||'"Configured follow-up limit reached; manager review is required."'::jsonb; end if;
        continue;
      end if;
$limit$||marker);
  if n=f then raise exception 'Follow-up preview requirement marker changed'; end if; execute n;

  f:=replace(pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure), E'\r', '');
  marker:='      if jsonb_array_length((preview->''requirements'')-''Other assigned employees must complete their work'')=0 then';
  n:=replace(f,marker,$limit$      if preview->'requirements' ? 'Configured follow-up limit reached; manager review is required.' then
        perform hold_fms_follow_up_for_review(i.id,work.id,p_request->>'outcome');
      elsif jsonb_array_length((preview->'requirements')-'Other assigned employees must complete their work')=0 then$limit$);
  if n=f then raise exception 'Follow-up confirmed form marker changed'; end if; execute n;

  f:=replace(pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure), E'\r', '');
  marker:=' if not v_actor.id=any(v_instance_stage.assigned_to) then';
  n:=replace(f,marker,$limit$ if v_instance.assignment_version=2 and (v_stage.completion_rule<>'all_doers' or not exists(
    select 1 from fms_instance_stage_assignees where fms_instance_stage_id=v_instance_stage.id and is_active and user_profile_id<>v_actor.id and status<>'completed'))
    and exists(select 1 from jsonb_array_elements(fms_candidate_transition_plan(v_instance.id,v_instance_stage.id,coalesce((select data from form_submissions where id=v_instance_stage.form_submission_id),'{}'),p_outcome)) item where item->>'limitReached'='true') then
   perform hold_fms_follow_up_for_review(v_instance.id,v_instance_stage.id,p_outcome); return;
 end if;
$limit$||marker);
  if n=f then raise exception 'Follow-up direct completion marker changed'; end if; execute n;
end $$;
create or replace function fms_candidate_destinations(p_instance_id uuid,p_source_visit_id uuid,p_answers jsonb,p_outcome text)
returns uuid[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg((value->>'targetStageId')::uuid),'{}') from jsonb_array_elements(fms_candidate_transition_plan(p_instance_id,p_source_visit_id,p_answers,p_outcome)) where coalesce(value->>'limitReached','false')<>'true'
$$;
revoke all on function hold_fms_follow_up_for_review(uuid,uuid,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
