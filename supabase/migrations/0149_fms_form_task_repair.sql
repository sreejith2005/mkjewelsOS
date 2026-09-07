-- Preserve the established FMS form and stage-completion contracts while
-- allowing a submitted form to stand on stages with further requirements.
set search_path = public, extensions;

create or replace function submit_fms_form_and_progress_with_audit(
  p_form_template_id uuid,
  p_answers jsonb,
  p_linked_module text,
  p_linked_record_id uuid,
  p_idempotency_key uuid,
  p_outcome text default null,
  p_remark text default null,
  p_checklist jsonb default '{}'::jsonb,
  p_next_assignee_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor user_profiles; v_existing fms_workflow_mutation_keys; v_submission_id uuid; v_started record; v_response jsonb;
  v_instance_stage fms_instance_stages; v_stage fms_stages; v_auto_complete boolean;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'An active profile is required to submit workflow work' using errcode='42501'; end if;
  if p_linked_module not in ('fms_stage','fms_entry') then raise exception 'Workflow submission must target an FMS stage or entry form' using errcode='22023'; end if;
  if p_idempotency_key is null then raise exception 'A workflow submission key is required' using errcode='22023'; end if;
  insert into fms_workflow_mutation_keys(tenant_id,actor_id,mutation_key,linked_module,linked_record_id)
  values(v_actor.tenant_id,v_actor.id,p_idempotency_key,p_linked_module,p_linked_record_id) on conflict (tenant_id,actor_id,mutation_key) do nothing;
  select * into v_existing from fms_workflow_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and mutation_key=p_idempotency_key for update;
  if v_existing.completed_at is not null then return v_existing.response; end if;
  if v_existing.linked_module<>p_linked_module or v_existing.linked_record_id<>p_linked_record_id then raise exception 'Workflow submission key cannot be reused for another target' using errcode='23514'; end if;
  if p_linked_module='fms_stage' then
    select * into v_instance_stage from fms_instance_stages where id=p_linked_record_id for update;
    select * into v_stage from fms_stages where id=v_instance_stage.fms_stage_id for share;
    v_submission_id:=submit_form_with_audit(p_form_template_id,p_answers,'fms_stage',p_linked_record_id);
    v_auto_complete := not coalesce(v_stage.requires_upload,false)
      and not coalesce(v_stage.requires_remark,false)
      and not coalesce(v_stage.requires_checklist,false)
      and not coalesce(v_stage.requires_next_doer_handoff,false)
      and v_stage.step_type<>'approval'
      and v_stage.completion_rule='any_doer'
      and not coalesce(v_stage.allow_multiple_doers,false);
    if v_auto_complete then
      perform complete_fms_stage_with_audit(p_linked_record_id,p_outcome,p_remark,coalesce(p_checklist,'{}'::jsonb),p_next_assignee_id);
    end if;
    v_response:=jsonb_build_object('submission_id',v_submission_id,'instance_stage_id',p_linked_record_id,'progressed',v_auto_complete);
  else
    v_submission_id:=submit_form_with_audit(p_form_template_id,p_answers,null,null);
    select * into v_started from start_fms_from_form_submission_with_audit(v_submission_id);
    v_response:=jsonb_build_object('submission_id',v_submission_id,'instance_id',v_started.instance_id,'reference_number',v_started.reference_number,'progressed',v_started.instance_id is not null);
  end if;
  update fms_workflow_mutation_keys set response=v_response,completed_at=now() where id=v_existing.id;
  return v_response;
end $$;

alter function submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid) owner to postgres;
revoke all on function submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid) from public,anon,service_role;
grant execute on function submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid) to authenticated;
notify pgrst, 'reload schema';
