-- Preserve FMS stage identities when saving a repaired draft.
set search_path = public, extensions;

create or replace function save_fms_flow_draft_with_audit(p_flow_id uuid,p_metadata jsonb,p_stages jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows; v_old jsonb; v_stage jsonb; v_stage_id uuid; v_rule jsonb; v_assignee jsonb; v_existing fms_stages; v_referenced boolean; v_order_offset integer;
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
    perform 1 from fms_stages where fms_flow_id=v_flow.id for update;
  end if;
  if not exists(select 1 from branches b where b.id=v_flow.branch_id and b.tenant_id=v_actor.tenant_id and b.is_active) and v_flow.branch_id is not null then raise exception 'Invalid active branch scope' using errcode='23514'; end if;
  if not exists(select 1 from departments d where d.id=v_flow.department_id and d.tenant_id=v_actor.tenant_id and (d.branch_id is null or d.branch_id=v_flow.branch_id) and d.is_active) and v_flow.department_id is not null then raise exception 'Invalid active department scope' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=v_flow.id and not exists(select 1 from jsonb_array_elements(p_stages) p where p->>'key'=s.stage_key)
      and (exists(select 1 from fms_instance_stages fis where fis.fms_stage_id=s.id)
        or exists(select 1 from fms_starter_assignments a where a.fms_stage_id=s.id))) then
    raise exception 'A stage used by existing FMS work cannot be removed; keep it or create a flow revision' using errcode='23514';
  end if;
  select greatest(coalesce(max(sort_order),0),coalesce((select max((stage->>'order')::integer) from jsonb_array_elements(p_stages) stage),0))
    - coalesce(min(sort_order),0) + 1 into v_order_offset from fms_stages where fms_flow_id=v_flow.id;
  update fms_stages set sort_order=sort_order+v_order_offset where fms_flow_id=v_flow.id;
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    select * into v_existing from fms_stages where fms_flow_id=v_flow.id and stage_key=v_stage->>'key';
    v_referenced := false;
    if v_existing.id is not null then
      v_stage_id := v_existing.id;
      select exists(select 1 from fms_instance_stages where fms_stage_id=v_stage_id) into v_referenced;
      if v_referenced and v_existing.form_template_id is not null
         and v_existing.form_template_id is distinct from nullif(v_stage->>'formTemplateId','')::uuid then
        raise exception 'A form on a stage used by existing FMS work cannot be replaced; create a flow revision' using errcode='23514';
      end if;
      if v_referenced and (
        v_existing.name is distinct from btrim(v_stage->>'name')
        or v_existing.method is distinct from nullif(btrim(v_stage->>'method'),'')
        or v_existing.step_type is distinct from (v_stage->>'type')::fms_step_type
        or v_existing.sort_order-v_order_offset is distinct from (v_stage->>'order')::integer
        or v_existing.is_required is distinct from coalesce((v_stage->>'required')::boolean,true)
        or v_existing.planned_time_rule is distinct from coalesce(v_stage->'sla','{}')
        or v_existing.completion_rule is distinct from coalesce((v_stage->>'completionRule')::fms_completion_rule,'any_doer')
        or v_existing.allow_multiple_doers is distinct from coalesce((v_stage->>'allowMultipleDoers')::boolean,false)
        or v_existing.requires_upload is distinct from coalesce((v_stage->>'requiresUpload')::boolean,false)
        or v_existing.requires_remark is distinct from coalesce((v_stage->>'requiresRemark')::boolean,false)
        or v_existing.checklist_definition is distinct from coalesce(v_stage->'checklist','[]')
        or v_existing.requires_next_doer_handoff is distinct from coalesce((v_stage->>'requiresNextDoerHandoff')::boolean,false)
        or v_existing.can_move_backward is distinct from coalesce((v_stage->>'canMoveBackward')::boolean,false)
        or v_existing.can_reject is distinct from coalesce((v_stage->>'canReject')::boolean,false)
        or v_existing.can_request_revision is distinct from coalesce((v_stage->>'canRequestRevision')::boolean,false)
        or v_existing.can_escalate is distinct from coalesce((v_stage->>'canEscalate')::boolean,false)
        or v_existing.join_rule is distinct from nullif(v_stage->>'joinRule','')::fms_join_rule
        or v_existing.notification_config is distinct from coalesce(v_stage->'notificationConfig','{}')
        or v_existing.split_to_flow_id is distinct from nullif(v_stage->>'splitToFlowId','')::uuid
        or v_existing.canvas_position is distinct from case when jsonb_typeof(v_stage->'position')='object' then v_stage->'position' else null end
        or (select count(*) from fms_stage_assignees a where a.fms_stage_id=v_stage_id) <> jsonb_array_length(coalesce(v_stage->'assigneeRules','[]'))
        or exists (
          select 1 from jsonb_array_elements(coalesce(v_stage->'assigneeRules','[]')) rule
          where not exists (
            select 1 from fms_stage_assignees a where a.fms_stage_id=v_stage_id
              and a.assignee_type::text is not distinct from rule->>'type'
              and a.user_profile_id is not distinct from nullif(rule->>'userProfileId','')::uuid
              and a.fallback_user_profile_id is not distinct from nullif(rule->>'fallbackUserProfileId','')::uuid
              and a.role_value::text is not distinct from nullif(rule->>'role','')
              and a.sort_order is not distinct from coalesce((rule->>'order')::integer,0)
              and a.allow_next_selection is not distinct from coalesce((rule->>'allowNextSelection')::boolean,false)
          )
        )
        or (select count(*) from fms_branch_rules r where r.fms_stage_id=v_stage_id) <> jsonb_array_length(coalesce(v_stage->'branchRules','[]'))
        or exists (
          select 1 from jsonb_array_elements(coalesce(v_stage->'branchRules','[]')) rule
          where not exists (
            select 1 from fms_branch_rules r where r.fms_stage_id=v_stage_id
              and r.source_type is not distinct from coalesce(rule->>'source','outcome')
              and r.source_key is not distinct from nullif(rule->>'sourceKey','')
              and r.condition_operator is not distinct from rule->>'operator'
              and r.condition_value is not distinct from case when rule ? 'value' then rule->'value' #>> '{}' else null end
              and r.next_stage_id is not distinct from (select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(rule->>'nextStageKey',''))
              and r.next_flow_id is not distinct from nullif(rule->>'nextFlowId','')::uuid
              and r.label is not distinct from nullif(btrim(rule->>'label'),'')
              and r.sort_order is not distinct from coalesce((rule->>'order')::integer,0)
          )
        )
      ) then
        raise exception 'A stage used by existing FMS work cannot be redefined; keep it or create a flow revision' using errcode='23514';
      end if;
      update fms_stages set name=btrim(v_stage->>'name'),method=nullif(btrim(v_stage->>'method'),''),step_type=(v_stage->>'type')::fms_step_type,sort_order=(v_stage->>'order')::integer,is_required=coalesce((v_stage->>'required')::boolean,true),planned_time_rule=coalesce(v_stage->'sla','{}'),completion_rule=coalesce((v_stage->>'completionRule')::fms_completion_rule,'any_doer'),allow_multiple_doers=coalesce((v_stage->>'allowMultipleDoers')::boolean,false),requires_upload=coalesce((v_stage->>'requiresUpload')::boolean,false),requires_remark=coalesce((v_stage->>'requiresRemark')::boolean,false),requires_checklist=jsonb_array_length(coalesce(v_stage->'checklist','[]'))>0,checklist_definition=coalesce(v_stage->'checklist','[]'),form_template_id=nullif(v_stage->>'formTemplateId','')::uuid,requires_next_doer_handoff=coalesce((v_stage->>'requiresNextDoerHandoff')::boolean,false),can_move_backward=coalesce((v_stage->>'canMoveBackward')::boolean,false),can_reject=coalesce((v_stage->>'canReject')::boolean,false),can_request_revision=coalesce((v_stage->>'canRequestRevision')::boolean,false),can_escalate=coalesce((v_stage->>'canEscalate')::boolean,false),join_rule=nullif(v_stage->>'joinRule','')::fms_join_rule,notification_config=coalesce(v_stage->'notificationConfig','{}'),split_to_flow_id=nullif(v_stage->>'splitToFlowId','')::uuid,canvas_position=case when jsonb_typeof(v_stage->'position')='object' then v_stage->'position' else null end where id=v_stage_id;
      if not v_referenced then
        delete from fms_stage_assignees where fms_stage_id=v_stage_id;
        delete from fms_branch_rules where fms_stage_id=v_stage_id;
      end if;
    else
    insert into fms_stages(fms_flow_id,stage_key,name,method,step_type,sort_order,is_required,planned_time_rule,completion_rule,allow_multiple_doers,requires_upload,requires_remark,requires_checklist,checklist_definition,form_template_id,requires_next_doer_handoff,can_move_backward,can_reject,can_request_revision,can_escalate,join_rule,notification_config,split_to_flow_id,canvas_position)
    values(v_flow.id,btrim(v_stage->>'key'),btrim(v_stage->>'name'),nullif(btrim(v_stage->>'method'),''),(v_stage->>'type')::fms_step_type,(v_stage->>'order')::integer,coalesce((v_stage->>'required')::boolean,true),coalesce(v_stage->'sla','{}'),coalesce((v_stage->>'completionRule')::fms_completion_rule,'any_doer'),coalesce((v_stage->>'allowMultipleDoers')::boolean,false),coalesce((v_stage->>'requiresUpload')::boolean,false),coalesce((v_stage->>'requiresRemark')::boolean,false),jsonb_array_length(coalesce(v_stage->'checklist','[]'))>0,coalesce(v_stage->'checklist','[]'),nullif(v_stage->>'formTemplateId','')::uuid,coalesce((v_stage->>'requiresNextDoerHandoff')::boolean,false),coalesce((v_stage->>'canMoveBackward')::boolean,false),coalesce((v_stage->>'canReject')::boolean,false),coalesce((v_stage->>'canRequestRevision')::boolean,false),coalesce((v_stage->>'canEscalate')::boolean,false),nullif(v_stage->>'joinRule','')::fms_join_rule,coalesce(v_stage->'notificationConfig','{}'),nullif(v_stage->>'splitToFlowId','')::uuid,case when jsonb_typeof(v_stage->'position')='object' then v_stage->'position' else null end)
    returning id into v_stage_id;
    end if;
    if not v_referenced then
    for v_assignee in select value from jsonb_array_elements(coalesce(v_stage->'assigneeRules','[]')) loop
      if nullif(v_assignee->>'fallbackUserProfileId','') is not null and not exists(select 1 from user_profiles p join user_profiles f on f.id=nullif(v_assignee->>'fallbackUserProfileId','')::uuid where p.id=nullif(v_assignee->>'userProfileId','')::uuid and p.tenant_id=v_actor.tenant_id and f.tenant_id=v_actor.tenant_id and p.department_id=f.department_id) then raise exception 'Fallback assignee must be in the primary assignee department' using errcode='23514'; end if;
      insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,fallback_user_profile_id,role_value,is_start_stage_entry_user,sort_order,allow_next_selection)
      values(v_stage_id,v_assignee->>'type',nullif(v_assignee->>'userProfileId','')::uuid,nullif(v_assignee->>'fallbackUserProfileId','')::uuid,nullif(v_assignee->>'role','')::user_role,(v_stage->>'order')::integer=0,coalesce((v_assignee->>'order')::integer,0),coalesce((v_assignee->>'allowNextSelection')::boolean,false));
    end loop;
    end if;
  end loop;
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    select id into v_stage_id from fms_stages where fms_flow_id=v_flow.id and stage_key=v_stage->>'key';
    if exists(select 1 from fms_instance_stages where fms_stage_id=v_stage_id) and (
      (select stage.default_next_stage_id from fms_stages stage where stage.id=v_stage_id) is distinct from
        (select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(v_stage->>'defaultNextStageKey',''))
      or coalesce((select stage.parallel_target_stage_ids from fms_stages stage where stage.id=v_stage_id),'{}') is distinct from
        coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'parallelTargetStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}')
      or coalesce((select stage.join_required_stage_ids from fms_stages stage where stage.id=v_stage_id),'{}') is distinct from
        coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'joinRequiredStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}')
    ) then raise exception 'Routing for a stage used by existing FMS work cannot be changed; create a flow revision' using errcode='23514'; end if;
    if not exists(select 1 from fms_instance_stages where fms_stage_id=v_stage_id) then
    update fms_stages set default_next_stage_id=(select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(v_stage->>'defaultNextStageKey','')),parallel_target_stage_ids=coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'parallelTargetStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}'),join_required_stage_ids=coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'joinRequiredStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}') where id=v_stage_id;
    for v_rule in select value from jsonb_array_elements(coalesce(v_stage->'branchRules','[]')) loop insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,next_flow_id,label,sort_order) values(v_stage_id,coalesce(v_rule->>'source','outcome'),nullif(v_rule->>'sourceKey',''),coalesce(nullif(v_rule->>'sourceKey',''),'outcome'),v_rule->>'operator',case when v_rule ? 'value' then v_rule->'value' #>> '{}' else null end,(select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(v_rule->>'nextStageKey','')),nullif(v_rule->>'nextFlowId','')::uuid,nullif(btrim(v_rule->>'label'),''),coalesce((v_rule->>'order')::integer,0)); end loop;
    end if;
  end loop;
  update fms_stages set default_next_stage_id=null where fms_flow_id=v_flow.id and not exists(select 1 from jsonb_array_elements(p_stages) p where p->>'key'=stage_key);
  delete from fms_branch_rules r using fms_stages s where r.fms_stage_id=s.id and s.fms_flow_id=v_flow.id and not exists(select 1 from jsonb_array_elements(p_stages) p where p->>'key'=s.stage_key);
  delete from fms_stages s where s.fms_flow_id=v_flow.id and not exists(select 1 from jsonb_array_elements(p_stages) p where p->>'key'=s.stage_key);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,case when p_flow_id is null then 'fms_flow_created' else 'fms_flow_draft_saved' end,'fms_flows',v_flow.id,v_old,jsonb_build_object('name',v_flow.name,'version',v_flow.version,'stage_count',jsonb_array_length(p_stages)));
  return v_flow.id;
end $$;

-- The edit warning describes actual named connections, not just form counts.
create function form_usage_impact(p_template_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_form form_templates; v_deletion jsonb;
begin
  perform assert_module_enabled('forms_library');
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or not can_manage_form_template(p_template_id) then
    raise exception 'Form usage access denied' using errcode='42501';
  end if;
  select * into v_form from form_templates where id=p_template_id and tenant_id=v_actor.tenant_id;
  if v_form.id is null then raise exception 'Form usage access denied' using errcode='42501'; end if;
  v_deletion := form_deletion_impact(p_template_id);
  return jsonb_build_object(
    'form',v_deletion->'form',
    'flows',v_deletion->'flows',
    'submissions',v_deletion->'submissions',
    'taskTemplates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'active',t.is_active) order by t.title,t.id)
      from task_templates t where t.tenant_id=v_actor.tenant_id and t.form_template_id=p_template_id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'status',t.status) order by t.title,t.id)
      from task_instances t where t.tenant_id=v_actor.tenant_id and t.form_template_id=p_template_id and t.status not in ('completed','rejected')),'[]'::jsonb),
    'starterAssignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'flowName',f.name,'status',a.status) order by f.name,a.id)
      from fms_starter_assignments a join fms_flows f on f.id=a.fms_flow_id
      where a.tenant_id=v_actor.tenant_id and a.form_template_id=p_template_id and a.status='pending'),'[]'::jsonb)
  );
end $$;

revoke all on function form_usage_impact(uuid) from public,anon,authenticated,service_role;
grant execute on function form_usage_impact(uuid) to authenticated;

-- Publishing a same-family successor is the one safe reason to retire a
-- pinned published form: exact task/FMS assignments continue to address it.
create or replace function prevent_active_fms_form_archive()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('jewelos.publishing_form_revision',true)='on' then return new; end if;
  if old.lifecycle='published' and new.lifecycle='archived' and exists(
    select 1 from fms_stages d join fms_instance_stages s on s.fms_stage_id=d.id
    join fms_instances i on i.id=s.fms_instance_id
    where d.form_template_id=old.id and i.status in ('active','overdue','on_hold')
      and s.status in ('pending','in_progress','in_review','overdue')
  ) then raise exception 'Form version is pinned by an active FMS stage' using errcode='23514'; end if;
  return new;
end $$;

create or replace function publish_form_with_audit(p_template_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old form_templates; v_new form_templates; v_previous form_templates;
begin
  perform assert_module_enabled('forms_library');
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or not has_permission('forms.manage') then
    raise exception 'Only active form authors can publish forms' using errcode='42501';
  end if;
  select * into v_old from form_templates where id=p_template_id for update;
  if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle<>'draft' then
    raise exception 'Publishable draft not found' using errcode='42501';
  end if;
  perform assert_form_publishable(v_old.id);
  select * into v_previous from form_templates
    where tenant_id=v_old.tenant_id and family_id=v_old.family_id and lifecycle='published' for update;
  if v_previous.id is not null then
    perform set_config('jewelos.publishing_form_revision','on',true);
    update form_templates set lifecycle='archived',is_active=false,archived_by=v_actor.id,
      archived_at=now(),updated_by=v_actor.id,updated_at=now() where id=v_previous.id;
    perform set_config('jewelos.publishing_form_revision','off',true);
  end if;
  update form_templates set lifecycle='published',is_active=true,published_by=v_actor.id,
    published_at=now(),archived_by=null,archived_at=null,updated_by=v_actor.id,updated_at=now()
    where id=v_old.id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'form_published','forms',v_new.id,to_jsonb(v_old),to_jsonb(v_new));
  return v_new.id;
end $$;

create or replace function can_access_form_template(p_template_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and exists (
    select 1 from form_templates ft
    where ft.id=p_template_id and ft.tenant_id=current_tenant_id() and (
      (ft.lifecycle='published' and ft.is_active
        and current_role_level() in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
        and (current_role_level() in ('super_admin','admin') or (ft.permissions->'roles') ? current_role_level()::text))
      or (ft.lifecycle='draft' and has_permission('forms.manage'))
      or (ft.lifecycle='archived' and can_manage_form_template(ft.id))
      or exists(select 1 from form_submissions fs where fs.form_template_id=ft.id and can_read_form_submission(fs.id))
      or (ft.published_at is not null and ft.lifecycle in ('published','archived') and exists (
        select 1 from task_instances ti join task_assignees ta on ta.task_instance_id=ti.id
        where ti.tenant_id=ft.tenant_id and ti.form_template_id=ft.id and ti.requires_form
          and ta.user_profile_id=(current_profile()).id and ta.is_active
      ))
      or (ft.published_at is not null and ft.lifecycle in ('published','archived') and exists (
        select 1 from fms_starter_assignments a where a.tenant_id=ft.tenant_id
          and a.form_template_id=ft.id and a.user_profile_id=(current_profile()).id and a.status='pending'
      ))
      or (ft.published_at is not null and ft.lifecycle in ('published','archived') and exists (
        select 1 from fms_stages stage
          join fms_instance_stages work on work.fms_stage_id=stage.id
          join fms_instances instance on instance.id=work.fms_instance_id
        where instance.tenant_id=ft.tenant_id and stage.form_template_id=ft.id
          and work.status in ('pending','in_progress','in_review','overdue')
          and instance.status in ('active','overdue','on_hold')
          and ((current_profile()).id=any(work.assigned_to) or exists (
            select 1 from fms_instance_stage_assignees assignee
            where assignee.fms_instance_stage_id=work.id and assignee.user_profile_id=(current_profile()).id and assignee.is_active))
      ))
    )
  );
$$;

-- Patch the installed submission implementation so the later file-field and
-- checkbox contracts remain intact. A starter submission carries its exact
-- assignment ID instead of impersonating a standalone Forms Library fill.
do $migration$
declare v_definition text; v_updated text;
begin
  select pg_get_functiondef('submit_form_locked_with_audit(uuid,jsonb,text,uuid)'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    'v_stage fms_stages;',
    'v_stage fms_stages; v_starter fms_starter_assignments;');
  v_updated := replace(v_updated,
    'elsif p_linked_module in (''checklist_task'',''delegation_task'') then',
    $branch$elsif p_linked_module='fms_entry' then
    select * into v_starter from fms_starter_assignments where id=p_linked_record_id for update;
    if v_starter.id is null or v_starter.tenant_id<>v_actor.tenant_id
       or v_starter.user_profile_id<>v_actor.id or v_starter.status<>'pending'
       or v_starter.form_template_id<>v_template.id
       or v_template.published_at is null or v_template.lifecycle not in ('published','archived')
       or not exists(select 1 from fms_flows flow where flow.id=v_starter.fms_flow_id
                     and flow.tenant_id=v_actor.tenant_id and flow.status='published' and flow.is_active) then
      raise exception 'FMS starter assignment does not require this exact available form' using errcode='42501';
    end if;
  elsif p_linked_module in ('checklist_task','delegation_task') then$branch$);
  if v_updated=v_definition or position('v_starter fms_starter_assignments' in v_updated)=0
     or position('FMS starter assignment does not require' in v_updated)=0 then
    raise exception 'Starter form submission contract patch did not match';
  end if;
  execute v_updated;

  select pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    'submit_form_with_audit(p_form_template_id,p_answers,null,null)',
    'submit_form_with_audit(p_form_template_id,p_answers,''fms_entry'',p_linked_record_id)');
  if v_updated=v_definition then raise exception 'Exact starter submission call patch did not match'; end if;
  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';
