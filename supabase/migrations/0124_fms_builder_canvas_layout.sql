-- Durable canvas layout for the FMS builder.
--
-- Node coordinates were previously recomputed on every load, so a user's manual
-- arrangement was lost when they left the builder. `canvas_position` stores the
-- editor-only coordinates alongside the stage.
--
-- It is additive and never read by the runtime: routing, activation, and
-- completion ignore this column entirely. A stage with a null position falls
-- back to the deterministic computed layout, so every existing flow renders
-- exactly as it does today and no data needs migrating.
set search_path = public, extensions;

alter table fms_stages add column if not exists canvas_position jsonb;
alter table fms_stages drop constraint if exists fms_stages_canvas_position_check;
alter table fms_stages add constraint fms_stages_canvas_position_check check (
  canvas_position is null or (
    jsonb_typeof(canvas_position) = 'object'
    and jsonb_typeof(canvas_position->'x') = 'number'
    and jsonb_typeof(canvas_position->'y') = 'number'
    and (canvas_position->>'x')::numeric between 0 and 100000
    and (canvas_position->>'y')::numeric between 0 and 100000
  )
) not valid;
alter table fms_stages validate constraint fms_stages_canvas_position_check;

-- Replaces 0032's definition; the only change is persisting `position`.
create or replace function save_fms_flow_draft_with_audit(p_flow_id uuid,p_metadata jsonb,p_stages jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows; v_old jsonb; v_stage jsonb; v_stage_id uuid; v_rule jsonb; v_assignee jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_metadata)<>'object' or jsonb_typeof(p_stages)<>'array' or pg_column_size(p_metadata)+pg_column_size(p_stages)>262144 or jsonb_array_length(p_stages)>200 then raise exception 'Invalid FMS draft payload' using errcode='22023'; end if;
  if coalesce(p_metadata->>'trigger_type','manual')<>'manual' then raise exception 'Only manual triggers are supported' using errcode='0A000'; end if;
  if p_flow_id is null then
    insert into fms_flows(tenant_id,branch_id,department_id,name,description,status,trigger_type,is_active,version,family_id,scope_type,created_by,updated_by)
    values(v_actor.tenant_id,nullif(p_metadata->>'branch_id','')::uuid,nullif(p_metadata->>'department_id','')::uuid,btrim(p_metadata->>'name'),nullif(btrim(p_metadata->>'description'),''),'draft','manual',coalesce((p_metadata->>'is_active')::boolean,true),1,extensions.uuid_generate_v4(),coalesce(p_metadata->>'scope_type','tenant'),v_actor.id,v_actor.id)
    returning * into v_flow;
  else
    select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
    if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Only a tenant draft can be saved' using errcode='23514'; end if;
    v_old=to_jsonb(v_flow);
    update fms_flows set name=btrim(p_metadata->>'name'),description=nullif(btrim(p_metadata->>'description'),''),branch_id=nullif(p_metadata->>'branch_id','')::uuid,department_id=nullif(p_metadata->>'department_id','')::uuid,scope_type=coalesce(p_metadata->>'scope_type','tenant'),is_active=coalesce((p_metadata->>'is_active')::boolean,true),updated_by=v_actor.id,updated_at=now() where id=v_flow.id returning * into v_flow;
    delete from fms_stages where fms_flow_id=v_flow.id;
  end if;
  if not exists(select 1 from branches b where b.id=v_flow.branch_id and b.tenant_id=v_actor.tenant_id and b.is_active) and v_flow.branch_id is not null then raise exception 'Invalid active branch scope' using errcode='23514'; end if;
  if not exists(select 1 from departments d where d.id=v_flow.department_id and d.tenant_id=v_actor.tenant_id and (d.branch_id is null or d.branch_id=v_flow.branch_id) and d.is_active) and v_flow.department_id is not null then raise exception 'Invalid active department scope' using errcode='23514'; end if;
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    insert into fms_stages(fms_flow_id,stage_key,name,method,step_type,sort_order,is_required,planned_time_rule,completion_rule,allow_multiple_doers,requires_upload,requires_remark,requires_checklist,checklist_definition,form_template_id,requires_next_doer_handoff,can_move_backward,can_reject,can_request_revision,can_escalate,join_rule,notification_config,split_to_flow_id,canvas_position)
    values(v_flow.id,btrim(v_stage->>'key'),btrim(v_stage->>'name'),nullif(btrim(v_stage->>'method'),''),(v_stage->>'type')::fms_step_type,(v_stage->>'order')::integer,coalesce((v_stage->>'required')::boolean,true),coalesce(v_stage->'sla','{}'),coalesce((v_stage->>'completionRule')::fms_completion_rule,'any_doer'),coalesce((v_stage->>'allowMultipleDoers')::boolean,false),coalesce((v_stage->>'requiresUpload')::boolean,false),coalesce((v_stage->>'requiresRemark')::boolean,false),jsonb_array_length(coalesce(v_stage->'checklist','[]'))>0,coalesce(v_stage->'checklist','[]'),nullif(v_stage->>'formTemplateId','')::uuid,coalesce((v_stage->>'requiresNextDoerHandoff')::boolean,false),coalesce((v_stage->>'canMoveBackward')::boolean,false),coalesce((v_stage->>'canReject')::boolean,false),coalesce((v_stage->>'canRequestRevision')::boolean,false),coalesce((v_stage->>'canEscalate')::boolean,false),nullif(v_stage->>'joinRule','')::fms_join_rule,coalesce(v_stage->'notificationConfig','{}'),nullif(v_stage->>'splitToFlowId','')::uuid,case when jsonb_typeof(v_stage->'position')='object' then v_stage->'position' else null end)
    returning id into v_stage_id;
    for v_assignee in select value from jsonb_array_elements(coalesce(v_stage->'assigneeRules','[]')) loop
      if nullif(v_assignee->>'fallbackUserProfileId','') is not null and not exists(select 1 from user_profiles p join user_profiles f on f.id=nullif(v_assignee->>'fallbackUserProfileId','')::uuid where p.id=nullif(v_assignee->>'userProfileId','')::uuid and p.tenant_id=v_actor.tenant_id and f.tenant_id=v_actor.tenant_id and p.department_id=f.department_id) then raise exception 'Fallback assignee must be in the primary assignee department' using errcode='23514'; end if;
      insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,fallback_user_profile_id,role_value,is_start_stage_entry_user,sort_order,allow_next_selection)
      values(v_stage_id,v_assignee->>'type',nullif(v_assignee->>'userProfileId','')::uuid,nullif(v_assignee->>'fallbackUserProfileId','')::uuid,nullif(v_assignee->>'role','')::user_role,(v_stage->>'order')::integer=0,coalesce((v_assignee->>'order')::integer,0),coalesce((v_assignee->>'allowNextSelection')::boolean,false));
    end loop;
  end loop;
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    select id into v_stage_id from fms_stages where fms_flow_id=v_flow.id and stage_key=v_stage->>'key';
    update fms_stages set default_next_stage_id=(select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(v_stage->>'defaultNextStageKey','')),parallel_target_stage_ids=coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'parallelTargetStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}'),join_required_stage_ids=coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'joinRequiredStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}') where id=v_stage_id;
    for v_rule in select value from jsonb_array_elements(coalesce(v_stage->'branchRules','[]')) loop insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,next_flow_id,label,sort_order) values(v_stage_id,coalesce(v_rule->>'source','outcome'),nullif(v_rule->>'sourceKey',''),coalesce(nullif(v_rule->>'sourceKey',''),'outcome'),v_rule->>'operator',case when v_rule ? 'value' then v_rule->'value' #>> '{}' else null end,(select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(v_rule->>'nextStageKey','')),nullif(v_rule->>'nextFlowId','')::uuid,nullif(btrim(v_rule->>'label'),''),coalesce((v_rule->>'order')::integer,0)); end loop;
  end loop;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,case when p_flow_id is null then 'fms_flow_created' else 'fms_flow_draft_saved' end,'fms_flows',v_flow.id,v_old,jsonb_build_object('name',v_flow.name,'version',v_flow.version,'stage_count',jsonb_array_length(p_stages)));
  return v_flow.id;
end $$;

-- Replaces 0030's definition; the only change is carrying `canvas_position` forward.
create or replace function create_fms_revision_with_audit(p_flow_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_source fms_flows; v_new_id uuid; v_stage fms_stages; v_new_stage uuid; v_old_ids uuid[]:='{}'::uuid[]; v_new_ids uuid[]:='{}'::uuid[];
begin
 select * into v_actor from current_profile(); if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
 select * into v_source from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id and status in ('published','archived') for share; if v_source.id is null then raise exception 'Published flow version not found' using errcode='23514'; end if;
 if exists(select 1 from fms_flows where tenant_id=v_source.tenant_id and family_id=v_source.family_id and status='draft') then raise exception 'This flow family already has a draft revision' using errcode='23505'; end if;
 insert into fms_flows(tenant_id,branch_id,department_id,name,description,status,trigger_type,is_active,version,family_id,scope_type,created_by,updated_by) values(v_source.tenant_id,v_source.branch_id,v_source.department_id,v_source.name,v_source.description,'draft','manual',true,(select max(version)+1 from fms_flows where tenant_id=v_source.tenant_id and family_id=v_source.family_id),v_source.family_id,v_source.scope_type,v_actor.id,v_actor.id) returning id into v_new_id;
 for v_stage in select * from fms_stages where fms_flow_id=v_source.id order by sort_order loop insert into fms_stages(fms_flow_id,stage_key,name,method,step_type,sort_order,is_required,planned_time_rule,completion_rule,allow_multiple_doers,requires_upload,requires_remark,requires_checklist,checklist_definition,form_template_id,requires_next_doer_handoff,can_move_backward,can_reject,can_request_revision,can_escalate,is_parallel_group,parallel_group_key,join_rule,notification_config,split_to_flow_id,canvas_position) values(v_new_id,v_stage.stage_key,v_stage.name,v_stage.method,v_stage.step_type,v_stage.sort_order,v_stage.is_required,v_stage.planned_time_rule,v_stage.completion_rule,v_stage.allow_multiple_doers,v_stage.requires_upload,v_stage.requires_remark,v_stage.requires_checklist,v_stage.checklist_definition,v_stage.form_template_id,v_stage.requires_next_doer_handoff,v_stage.can_move_backward,v_stage.can_reject,v_stage.can_request_revision,v_stage.can_escalate,v_stage.is_parallel_group,v_stage.parallel_group_key,v_stage.join_rule,v_stage.notification_config,v_stage.split_to_flow_id,v_stage.canvas_position) returning id into v_new_stage; v_old_ids=array_append(v_old_ids,v_stage.id); v_new_ids=array_append(v_new_ids,v_new_stage); end loop;
 update fms_stages n set default_next_stage_id=case when o.default_next_stage_id is null then null else v_new_ids[array_position(v_old_ids,o.default_next_stage_id)] end,parallel_target_stage_ids=coalesce((select array_agg(v_new_ids[array_position(v_old_ids,x.id)] order by x.ordinality) from unnest(o.parallel_target_stage_ids) with ordinality x(id,ordinality)),'{}'::uuid[]),join_required_stage_ids=coalesce((select array_agg(v_new_ids[array_position(v_old_ids,x.id)] order by x.ordinality) from unnest(o.join_required_stage_ids) with ordinality x(id,ordinality)),'{}'::uuid[]) from fms_stages o where o.id=any(v_old_ids) and n.id=v_new_ids[array_position(v_old_ids,o.id)];
 insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,fallback_user_profile_id,role_value,is_start_stage_entry_user,sort_order,allow_next_selection) select v_new_ids[array_position(v_old_ids,a.fms_stage_id)],a.assignee_type,a.user_profile_id,a.fallback_user_profile_id,a.role_value,a.is_start_stage_entry_user,a.sort_order,a.allow_next_selection from fms_stage_assignees a where a.fms_stage_id=any(v_old_ids);
 insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,next_flow_id,label,sort_order) select v_new_ids[array_position(v_old_ids,r.fms_stage_id)],r.source_type,r.source_key,r.condition_field,r.condition_operator,r.condition_value,case when r.next_stage_id is null then null else v_new_ids[array_position(v_old_ids,r.next_stage_id)] end,r.next_flow_id,r.label,r.sort_order from fms_branch_rules r where r.fms_stage_id=any(v_old_ids);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'fms_flow_revision_created','fms_flows',v_new_id,jsonb_build_object('source_flow_id',v_source.id,'version',v_source.version),jsonb_build_object('version',v_source.version+1)); return v_new_id;
end $$;

alter function save_fms_flow_draft_with_audit(uuid,jsonb,jsonb) owner to postgres;
alter function create_fms_revision_with_audit(uuid) owner to postgres;
revoke all on function save_fms_flow_draft_with_audit(uuid,jsonb,jsonb),create_fms_revision_with_audit(uuid) from public,anon,service_role;
grant execute on function save_fms_flow_draft_with_audit(uuid,jsonb,jsonb),create_fms_revision_with_audit(uuid) to authenticated;

notify pgrst, 'reload schema';
