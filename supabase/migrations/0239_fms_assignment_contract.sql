-- Assignment semantics are versioned independently from loop execution.
set search_path=public,extensions;
alter table fms_flows add column assignment_version integer not null default 1 check(assignment_version in (1,2));
alter table fms_instances add column assignment_version integer not null default 1 check(assignment_version in (1,2));

create function fms_pin_assignment_version() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='fms_instances' then
    if tg_op='INSERT' then
      select assignment_version into new.assignment_version from fms_flows where id=new.fms_flow_id;
    elsif new.assignment_version<>old.assignment_version then
      raise exception 'A running workflow cannot change its assignment contract' using errcode='23514';
    end if;
  elsif tg_op='UPDATE' and old.status<>'draft' and new.assignment_version<>old.assignment_version then
    raise exception 'Revise the workflow before upgrading its assignment contract' using errcode='23514';
  end if;
  return new;
end $$;
create trigger fms_pin_flow_assignment before update on fms_flows for each row execute function fms_pin_assignment_version();
create trigger fms_pin_instance_assignment before insert or update on fms_instances for each row execute function fms_pin_assignment_version();

alter function save_fms_flow_draft_with_audit(uuid,jsonb,jsonb) rename to save_fms_flow_draft_before_assignment;
create function save_fms_flow_draft_with_audit(p_flow_id uuid,p_metadata jsonb,p_stages jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_version integer; v_old integer;
begin
  perform assert_module_enabled('fms_builder');
  if not current_profile_is_active() or not has_permission('fms.manage') then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  select assignment_version into v_old from fms_flows where id=p_flow_id and tenant_id=current_tenant_id();
  v_version:=coalesce((p_metadata->>'assignment_version')::integer,v_old,2);
  if v_version not in (1,2) or v_old=2 and v_version=1 then raise exception 'Invalid assignment contract version' using errcode='23514'; end if;
  v_id:=save_fms_flow_draft_before_assignment(p_flow_id,p_metadata,p_stages);
  update fms_flows set assignment_version=v_version where id=v_id;
  if v_old is distinct from v_version then
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(current_tenant_id(),(current_profile()).id,'fms_assignment_contract_selected','fms_flows',v_id,
      jsonb_build_object('assignment_version',v_old),jsonb_build_object('assignment_version',v_version));
  end if;
  return v_id;
end $$;

alter function create_fms_revision_with_audit(uuid) rename to create_fms_revision_before_assignment;
create function create_fms_revision_with_audit(p_flow_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform assert_module_enabled('fms_builder');
  v_id:=create_fms_revision_before_assignment(p_flow_id);
  update fms_flows target set assignment_version=source.assignment_version
    from fms_flows source where target.id=v_id and source.id=p_flow_id;
  return v_id;
end $$;

create function assert_fms_assignment_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare f fms_flows; s fms_stages; c jsonb; source jsonb; source_stage fms_stages; field form_fields; fallback jsonb;
begin
  select * into f from fms_flows where id=p_flow_id;
  if f.assignment_version<>2 then return; end if;
  for s in select * from fms_stages where fms_flow_id=f.id order by sort_order,id loop
    if s.planned_time_rule->>'completionFormRequired'='true' and s.form_template_id is null then raise exception 'Step % needs its required completion form',s.name using errcode='23514'; end if;
    if s.step_type in ('branch','notification','parallel_start','parallel_join','end') or s.id=(select id from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1) then continue; end if;
    c:=s.planned_time_rule->'assignment'; fallback:=c->'fallbackRule';
    if c is null or jsonb_typeof(c)<>'object' or coalesce(c->>'mode','') not in ('previous_form','fixed_employee','hierarchy','previous_stage_employee','manual_handoff','configured_fallback') then
      raise exception 'Choose an assignment strategy for step %',s.name using errcode='23514';
    end if;
    if jsonb_typeof(c->'sources') is distinct from 'array' or jsonb_typeof(c->'allowHandoff') is distinct from 'boolean' then raise exception 'Invalid assignment configuration for step %',s.name using errcode='23514'; end if;
    if c->>'mode'='fixed_employee' and not exists(select 1 from fms_stage_assignees where fms_stage_id=s.id and assignee_type='specific_user') then raise exception 'Choose the fixed employee for step %',s.name using errcode='23514'; end if;
    if c->>'mode'='hierarchy' and not exists(select 1 from fms_stage_assignees where fms_stage_id=s.id) then raise exception 'Choose a hierarchy rule for step %',s.name using errcode='23514'; end if;
    if fallback is not null and (jsonb_typeof(fallback)<>'object' or coalesce(fallback->>'type','') not in ('specific_user','reporter','previous_step_doer')) then raise exception 'Invalid explicit assignment fallback for step %',s.name using errcode='23514'; end if;
    if fallback->>'type'='specific_user' then perform assert_direct_assignment_user((fallback->>'userProfileId')::uuid,f.tenant_id,'FMS'); end if;
    if c->>'mode'='configured_fallback' and fallback is null then raise exception 'Configure a fallback for step %',s.name using errcode='23514'; end if;
    if c->>'mode'='previous_form' and jsonb_array_length(c->'sources')=0 and fallback is null then raise exception 'Choose a source User question for step %',s.name using errcode='23514'; end if;
    for source in select value from jsonb_array_elements(c->'sources') loop
      select * into source_stage from fms_stages where fms_flow_id=f.id and stage_key=source->>'sourceStageKey';
      select * into field from form_fields where form_template_id=source_stage.form_template_id and field_key=source->>'fieldKey';
      if source_stage.id is null or source_stage.form_template_id is distinct from (source->>'formTemplateId')::uuid or field.id is null or field.field_type<>'user_dropdown' then raise exception 'Assignment source for step % is not a User question in the pinned form',s.name using errcode='23514'; end if;
      if (not field.is_required or not field.is_shown or field.conditional_logic is not null or field.rule_definition is not null) and fallback is null then raise exception 'Conditional assignment for step % needs an explicit fallback',s.name using errcode='23514'; end if;
    end loop;
    if s.planned_time_rule ? 'followUp' and (coalesce((s.planned_time_rule#>>'{followUp,maxVisits}')::integer,0)<1 or coalesce(s.planned_time_rule#>>'{followUp,onLimit}','') not in ('hold','escalate')) then raise exception 'Invalid follow-up limit for step %',s.name using errcode='23514'; end if;
  end loop;
end $$;
alter function assert_fms_flow_publishable(uuid) rename to assert_fms_flow_publishable_before_assignment;
create function assert_fms_flow_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform assert_fms_flow_publishable_before_assignment(p_flow_id);
  perform assert_fms_assignment_publishable(p_flow_id);
end $$;

-- The legacy global-default triggers remain exactly as before for version 1.
do $$
declare f text; n text;
begin
  f:=pg_get_functiondef('fms_instance_initial_assignment_from_form()'::regprocedure);
  n:=replace(f,E'begin\n',E'begin\n  if (select assignment_version from public.fms_flows where id=new.fms_flow_id)=2 then\n    new.context:=coalesce(new.context,''{}''::jsonb)-''_fms_assignment_user_id''; return new;\n  end if;\n');
  if n=f then raise exception 'Initial assignment trigger changed'; end if; execute n;
  f:=pg_get_functiondef('fms_update_assignment_from_stage_form()'::regprocedure);
  n:=replace(f,E'begin\n',E'begin\n  if new.linked_module=''fms_stage'' and exists(select 1 from public.fms_instance_stages work join public.fms_instances instance on instance.id=work.fms_instance_id where work.id=new.linked_record_id and instance.assignment_version=2) then return new; end if;\n');
  if n=f then raise exception 'Form assignment trigger changed'; end if; execute n;
end $$;

create function fms_require_configured_completion_form() returns trigger language plpgsql security definer set search_path=public as $$
declare s fms_stages;
begin
  if new.status<>'completed' or old.status='completed' or not exists(select 1 from fms_instances where id=new.fms_instance_id and assignment_version=2) then return new; end if;
  select * into s from fms_stages where id=new.fms_stage_id;
  if s.planned_time_rule->>'completionFormRequired'='true' and not exists(select 1 from form_submissions where id=new.form_submission_id and form_template_id=s.form_template_id and linked_module='fms_stage' and linked_record_id=new.id and status='submitted') then raise exception 'Submit the required completion form for step %',s.name using errcode='23514'; end if;
  return new;
end $$;
create trigger fms_require_configured_completion_form before update of status on fms_instance_stages for each row execute function fms_require_configured_completion_form();

revoke all on function fms_pin_assignment_version(),save_fms_flow_draft_before_assignment(uuid,jsonb,jsonb),create_fms_revision_before_assignment(uuid),assert_fms_flow_publishable_before_assignment(uuid),assert_fms_assignment_publishable(uuid),assert_fms_flow_publishable(uuid),fms_require_configured_completion_form() from public,anon,authenticated,service_role;
revoke all on function save_fms_flow_draft_with_audit(uuid,jsonb,jsonb),create_fms_revision_with_audit(uuid) from public,anon,authenticated,service_role;
grant execute on function save_fms_flow_draft_with_audit(uuid,jsonb,jsonb),create_fms_revision_with_audit(uuid) to authenticated;
notify pgrst,'reload schema';
