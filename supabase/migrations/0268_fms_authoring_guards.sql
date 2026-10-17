set search_path=public,extensions;

alter function assert_fms_assignment_publishable(uuid) rename to assert_fms_assignment_publishable_before_display;
create function assert_fms_assignment_publishable(p_flow_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare flow fms_flows; stage fms_stages; source fms_stages; mapping jsonb; config jsonb; person uuid;
begin
  perform assert_fms_assignment_publishable_before_display(p_flow_id);
  select * into flow from fms_flows where id=p_flow_id;
  if flow.assignment_version<>2 then return; end if;
  if (select count(*) from fms_stages where fms_flow_id=flow.id)>200 then raise exception 'A workflow supports at most 200 steps' using errcode='23514'; end if;
  for stage in select * from fms_stages where fms_flow_id=flow.id loop
    config:=stage.planned_time_rule->'assignment';
    if config->>'mode'='manual_handoff' and not coalesce((config->>'allowHandoff')::boolean,false) then raise exception 'Manual handoff must allow employee selection for step %',stage.name using errcode='23514'; end if;
    if config->>'mode'='previous_form' and config->'fallbackRule' is null then
      for mapping in select value from jsonb_array_elements(config->'sources') loop
        select * into source from fms_stages where fms_flow_id=flow.id and stage_key=mapping->>'sourceStageKey';
        if source.step_type<>'form' and source.planned_time_rule->>'completionFormRequired' is distinct from 'true' then
          raise exception 'The assignment source form on step % must be required',source.name using errcode='23514';
        end if;
      end loop;
    end if;
    if config->>'mode' in ('fixed_employee','hierarchy') then
      for person in select user_profile_id from fms_stage_assignees where fms_stage_id=stage.id and assignee_type='specific_user' loop
        perform assert_fms_handoff_recipient(person,flow.tenant_id,true);
      end loop;
    end if;
    if config#>>'{fallbackRule,type}'='specific_user' then perform assert_fms_handoff_recipient((config#>>'{fallbackRule,userProfileId}')::uuid,flow.tenant_id,true); end if;
    if stage.planned_time_rule ? 'taskDisplay' then
      if jsonb_typeof(stage.planned_time_rule->'taskDisplay') is distinct from 'object'
        or jsonb_typeof(stage.planned_time_rule#>'{taskDisplay,fields}') is distinct from 'array'
        or jsonb_array_length(stage.planned_time_rule#>'{taskDisplay,fields}')>12 then raise exception 'Choose at most 12 work-information questions for step %',stage.name using errcode='23514'; end if;
      for mapping in select value from jsonb_array_elements(stage.planned_time_rule#>'{taskDisplay,fields}') loop
        select * into source from fms_stages where fms_flow_id=flow.id and stage_key=mapping->>'sourceStageKey';
        if source.id is null or source.id=stage.id or source.form_template_id is distinct from (mapping->>'formTemplateId')::uuid
          or not exists(select 1 from form_fields where form_template_id=source.form_template_id and field_key=mapping->>'fieldKey' and field_type not in ('section_header','divider')) then
          raise exception 'Work-information question for step % must belong to an exact source form version',stage.name using errcode='23514'; end if;
      end loop;
    end if;
  end loop;
end $$;

-- Route IDs are physical rows. Keep references stable through draft saves and
-- revisions by mapping their logical source step and route order.
create function fms_remap_assignment_routes(p_flow_id uuid,p_payload jsonb default null,p_source_flow_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare stage fms_stages; sources jsonb; source jsonb; old_rule uuid; new_rule uuid; source_key text; rule_order integer;
begin
  for stage in select * from fms_stages where fms_flow_id=p_flow_id and planned_time_rule#>'{assignment,sources}' is not null loop
    sources:='[]';
    for source in select value from jsonb_array_elements(stage.planned_time_rule#>'{assignment,sources}') loop
      old_rule:=nullif(source->>'routeRuleId','')::uuid;
      if old_rule is not null then
        source_key:=null; rule_order:=null; new_rule:=null;
        if p_payload is not null then
          select item->>'key',coalesce((rule->>'order')::integer,ordinality::integer-1) into source_key,rule_order
            from jsonb_array_elements(p_payload) item cross join lateral jsonb_array_elements(coalesce(item->'branchRules','[]')) with ordinality rules(rule,ordinality)
            where rule->>'id'=old_rule::text;
        elsif p_source_flow_id is not null then
          select definition.stage_key,rule.sort_order into source_key,rule_order from fms_branch_rules rule join fms_stages definition on definition.id=rule.fms_stage_id where rule.id=old_rule and definition.fms_flow_id=p_source_flow_id;
        end if;
        select rule.id into new_rule from fms_branch_rules rule join fms_stages definition on definition.id=rule.fms_stage_id where definition.fms_flow_id=p_flow_id and definition.stage_key=source_key and rule.sort_order=rule_order;
        if new_rule is null then raise exception 'An assignment route was removed. Choose its source again before saving.' using errcode='23514'; end if;
        source:=jsonb_set(source,'{routeRuleId}',to_jsonb(new_rule));
      end if;
      sources:=sources||jsonb_build_array(source);
    end loop;
    update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{assignment,sources}',sources) where id=stage.id;
  end loop;
end $$;

do $$
declare f text; n text; marker text;
begin
  f:=pg_get_functiondef('save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)'::regprocedure);
  marker:='  update fms_flows set assignment_version=v_version where id=v_id;';
  n:=replace(f,marker,marker||E'\n  perform fms_remap_assignment_routes(v_id,p_stages,null);');
  if n=f then raise exception 'Draft route remap marker changed'; end if; execute n;
  f:=pg_get_functiondef('create_fms_revision_with_audit(uuid)'::regprocedure);
  n:=replace(f,'  return v_id;',E'  perform fms_remap_assignment_routes(v_id,null,p_flow_id);\n  return v_id;');
  if n=f then raise exception 'Revision route remap marker changed'; end if; execute n;

  f:=pg_get_functiondef('activate_fms_stage_v2_internal(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid[],uuid)'::regprocedure);
  marker:=' v_assignment:=resolve_fms_visit_assignment';
  n:=replace(f,marker,$cap$
 if v_instance.assignment_version=2 and v_stage.step_type in ('form','task','approval')
   and v_stage.planned_time_rule ? 'followUp'
   and (select count(*) from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=p_stage_id)>=(v_stage.planned_time_rule#>>'{followUp,maxVisits}')::integer then
   update fms_instances set status='on_hold',updated_at=now() where id=p_instance_id;
   if v_stage.planned_time_rule#>>'{followUp,onLimit}'='escalate' then
     update fms_instance_stages set escalation_count=escalation_count+1 where id=p_previous_instance_stage_id;
   end if;
   insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_previous_instance_stage_id,(current_profile()).id,'follow_up_limit_reached',jsonb_build_object('target_stage_id',p_stage_id,'limit',v_stage.planned_time_rule->'followUp'));
   insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,(current_profile()).id,'fms_follow_up_limit_reached','fms_instances',p_instance_id,jsonb_build_object('target_stage_id',p_stage_id,'limit',v_stage.planned_time_rule->'followUp'));
   return null;
 end if;
 v_assignment:=resolve_fms_visit_assignment$cap$);
  if n=f then raise exception 'Follow-up activation marker changed'; end if; execute n;
end $$;
revoke all on function assert_fms_assignment_publishable(uuid),assert_fms_assignment_publishable_before_display(uuid),fms_remap_assignment_routes(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
