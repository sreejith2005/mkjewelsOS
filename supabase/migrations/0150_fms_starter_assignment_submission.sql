-- A Home starter link identifies one durable assignment.  Do not fall back to
-- the legacy form-only workflow lookup, which is necessarily ambiguous when a
-- published form is intentionally shared by multiple flows.
set search_path = public, extensions;

create or replace function submit_fms_form_and_progress_with_audit(
  p_form_template_id uuid, p_answers jsonb, p_linked_module text,
  p_linked_record_id uuid, p_idempotency_key uuid, p_outcome text default null,
  p_remark text default null, p_checklist jsonb default '{}'::jsonb,
  p_next_assignee_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor user_profiles; v_existing fms_workflow_mutation_keys; v_submission_id uuid; v_response jsonb;
  v_instance_stage fms_instance_stages; v_stage fms_stages; v_auto_complete boolean;
  v_starter fms_starter_assignments; v_flow fms_flows; v_instance fms_instances; v_initial_runtime fms_instance_stages; v_ref text;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'An active profile is required to submit workflow work' using errcode='42501'; end if;
  if p_linked_module not in ('fms_stage','fms_entry') or p_linked_record_id is null then raise exception 'Workflow submission must target an FMS stage or entry form' using errcode='22023'; end if;
  if p_idempotency_key is null then raise exception 'A workflow submission key is required' using errcode='22023'; end if;
  insert into fms_workflow_mutation_keys(tenant_id,actor_id,mutation_key,linked_module,linked_record_id) values(v_actor.tenant_id,v_actor.id,p_idempotency_key,p_linked_module,p_linked_record_id) on conflict (tenant_id,actor_id,mutation_key) do nothing;
  select * into v_existing from fms_workflow_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and mutation_key=p_idempotency_key for update;
  if v_existing.completed_at is not null then return v_existing.response; end if;
  if v_existing.linked_module<>p_linked_module or v_existing.linked_record_id<>p_linked_record_id then raise exception 'Workflow submission key cannot be reused for another target' using errcode='23514'; end if;
  if p_linked_module='fms_stage' then
    select * into v_instance_stage from fms_instance_stages where id=p_linked_record_id for update;
    select * into v_stage from fms_stages where id=v_instance_stage.fms_stage_id for share;
    v_submission_id:=submit_form_with_audit(p_form_template_id,p_answers,'fms_stage',p_linked_record_id);
    v_auto_complete:=not coalesce(v_stage.requires_upload,false) and not coalesce(v_stage.requires_remark,false) and not coalesce(v_stage.requires_checklist,false) and not coalesce(v_stage.requires_next_doer_handoff,false) and v_stage.step_type<>'approval' and v_stage.completion_rule='any_doer' and not coalesce(v_stage.allow_multiple_doers,false);
    if v_auto_complete then perform complete_fms_stage_with_audit(p_linked_record_id,p_outcome,p_remark,coalesce(p_checklist,'{}'::jsonb),p_next_assignee_id); end if;
    v_response:=jsonb_build_object('submission_id',v_submission_id,'instance_stage_id',p_linked_record_id,'progressed',v_auto_complete);
  else
    select * into v_starter from fms_starter_assignments where id=p_linked_record_id and tenant_id=v_actor.tenant_id and user_profile_id=v_actor.id and status='pending' for update;
    if v_starter.id is null or v_starter.form_template_id<>p_form_template_id then raise exception 'FMS starter assignment is not available for this exact form' using errcode='42501'; end if;
    select * into v_flow from fms_flows where id=v_starter.fms_flow_id and tenant_id=v_actor.tenant_id and status='published' and is_active for update;
    if v_flow.id is null then raise exception 'FMS starter workflow is no longer active' using errcode='23514'; end if;
    v_submission_id:=submit_form_with_audit(p_form_template_id,p_answers,null,null);
    v_ref:='FMS-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('fms_reference_sequence')::text,8,'0');
    insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by) values(v_actor.tenant_id,coalesce(v_flow.branch_id,v_actor.branch_id),coalesce(v_flow.department_id,v_actor.department_id),v_flow.id,v_flow.family_id,v_flow.version,v_ref,left(v_flow.name||' · Form submission',200),'active','medium',jsonb_build_object('form_submission_id',v_submission_id,'form_template_id',p_form_template_id,'starter_assignment_id',v_starter.id),v_actor.id) returning * into v_instance;
    update fms_flows set usage_count=usage_count+1 where id=v_flow.id;
    insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime,completed_by,form_submission_id) values(v_instance.id,v_starter.fms_stage_id,'completed',array[v_actor.id],fms_stage_deadline_for_instance((select planned_time_rule from fms_stages where id=v_starter.fms_stage_id),v_instance.tenant_id,v_instance.id),now(),now(),v_actor.id,v_submission_id) returning * into v_initial_runtime;
    update fms_starter_assignments set status='completed',completed_at=now(),completed_by=v_actor.id where id=v_starter.id;
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_initial_runtime.id,v_actor.id,'form_trigger_submitted',jsonb_build_object('form_submission_id',v_submission_id,'form_template_id',p_form_template_id,'starter_assignment_id',v_starter.id));
    if (select default_next_stage_id from fms_stages where id=v_starter.fms_stage_id) is not null then perform activate_fms_stage_internal(v_instance.id,(select default_next_stage_id from fms_stages where id=v_starter.fms_stage_id),v_initial_runtime.id,null,0); else update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=v_instance.id; end if;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'fms_instance_started_from_form','fms_instances',v_instance.id,jsonb_build_object('flow_id',v_flow.id,'reference_number',v_ref,'form_submission_id',v_submission_id,'starter_assignment_id',v_starter.id));
    v_response:=jsonb_build_object('submission_id',v_submission_id,'instance_id',v_instance.id,'reference_number',v_ref,'progressed',true);
  end if;
  update fms_workflow_mutation_keys set response=v_response,completed_at=now() where id=v_existing.id;
  return v_response;
end $$;

alter function submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid) owner to postgres;
revoke all on function submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid) from public,anon,service_role;
grant execute on function submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid) to authenticated;
notify pgrst, 'reload schema';
