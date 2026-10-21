-- A missing stage override must inherit the original record, never an arbitrary
-- answer on a later form. Exact causal source and historical field visibility
-- remain the only name inputs.
set search_path=public,extensions;
create function fms_record_name_candidate(p_work_id uuid,p_kind text,p_source jsonb default null)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_source record; v_fields jsonb; v_snapshot jsonb; v_selected text; v_name text;
begin
 if not can_read_fms_work_context(p_work_id) then return null; end if;
 for v_source in select causal.*,definition.stage_key,visit.visit_number from fms_context_form_visits(p_work_id) causal
  join fms_instance_stages visit on visit.id=causal.visit_id join fms_stages definition on definition.id=visit.fms_stage_id
  where case when p_kind='explicit' then definition.stage_key=p_source->>'sourceStageKey'
    and definition.form_template_id::text=p_source->>'formTemplateId' else causal.is_initial end
  order by causal.is_initial desc,visit.visit_number desc,visit.id loop
   v_fields:=fms_context_form_fields(v_source.visit_id);
   if p_kind in ('explicit','default') then
    select template_snapshot into v_snapshot from form_submissions where id=v_source.submission_id;
    v_selected:=case when p_kind='explicit' then p_source->>'fieldKey' else v_snapshot#>>'{template,record_name_field_key}' end;
    select fms_record_field_value(answer) into v_name from jsonb_array_elements(v_fields) answer
     where answer#>>'{field,key}'=v_selected and fms_record_field_eligible(jsonb_build_object('field_key',answer#>>'{field,key}',
       'field_name',answer#>>'{field,label}','field_type',answer#>>'{field,type}','is_shown',true)) limit 1;
   elsif p_kind='automatic' then
    select fms_record_field_value(answer) into v_name from jsonb_array_elements(v_fields) answer
     where answer#>>'{field,type}' in ('text','number') and fms_record_field_value(answer) is not null
       and concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}') !~* '(password|secret|token|credential|private|remarks?|notes?|email|phone|mobile)'
       and replace(lower(concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}')),'_',' ') ~ '\m(customer|client|lead|enquiry|inquiry|record|order) (name|number|no|reference|ref|id)\M'
     order by case when replace(lower(concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}')),'_',' ') ~ '\m(customer|client) name\M' then 0
      when replace(lower(concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}')),'_',' ') ~ '\m(lead|enquiry|inquiry|record) name\M' then 1 else 2 end,
      (answer#>>'{field,sortOrder}')::integer,answer#>>'{field,key}' limit 1;
   end if;
   if v_name is not null then return v_name; end if;
 end loop;
 return null;
end $$;
create or replace function fms_work_record_name(p_work_id uuid) returns text
language plpgsql stable security definer set search_path=public as $$
declare v_work fms_instance_stages; v_instance fms_instances; v_stage fms_stages; v_initial fms_stages;
 v_stage_naming jsonb; v_initial_naming jsonb; v_name text; v_context jsonb; v_template text; v_field jsonb; v_value text; v_reference text;
begin
 if not can_read_fms_work_context(p_work_id) then return null; end if;
 select * into v_work from fms_instance_stages where id=p_work_id;
 select * into v_instance from fms_instances where id=v_work.fms_instance_id;
 select * into v_stage from fms_stages where id=v_work.fms_stage_id;
 select * into v_initial from fms_stages where fms_flow_id=v_instance.fms_flow_id order by sort_order,id limit 1;
 v_stage_naming:=v_stage.planned_time_rule#>'{taskDisplay,recordNaming}';
 v_initial_naming:=v_initial.planned_time_rule#>'{taskDisplay,recordNaming}';
 if v_stage_naming->>'mode'='field' then
  v_name:=fms_record_name_candidate(p_work_id,'explicit',v_stage_naming->'source');
 elsif v_stage_naming->>'mode'='form_default' then
  v_name:=fms_record_name_candidate(p_work_id,'default');
 elsif v_stage_naming->>'mode'='automatic' then
  v_name:=coalesce(fms_record_name_candidate(p_work_id,'default'),fms_record_name_candidate(p_work_id,'automatic'));
 end if;
 if v_name is not null then return v_name; end if;
 if v_initial_naming->>'mode'='field' then v_name:=fms_record_name_candidate(p_work_id,'explicit',v_initial_naming->'source'); end if;
 if v_name is not null then return v_name; end if;
 v_name:=fms_record_name_candidate(p_work_id,'default'); if v_name is not null then return v_name; end if;
 v_template:=nullif(v_stage.planned_time_rule#>>'{taskDisplay,titleTemplate}','');
 if v_template is not null then
  v_context:=fms_work_context_before_record_name(v_instance.id,v_work.id,null,1); v_reference:=v_instance.reference_number;
  -- Intersect the configured context with the same exact visible historical
  -- fields as previous-form display; hidden and skipped answers cannot name work.
  for v_field in select safe.field from jsonb_array_elements(v_context->'receivedFields') configured
   join lateral (select visible.field from fms_context_form_visits(v_work.id) causal
    cross join lateral jsonb_array_elements(fms_context_form_fields(causal.visit_id)) visible(field)
    where visible.field->>'submissionId'=configured->>'submissionId' and visible.field#>>'{field,key}'=configured#>>'{field,key}' limit 1) safe on true loop
   v_value:=fms_record_field_value(v_field);
   if v_value is not null then
    if v_context->>'referenceKey'=(v_field->>'sourceStageKey')||'.'||(v_field#>>'{field,key}') then v_reference:=v_value; end if;
    v_template:=replace(v_template,'{'||(v_field->>'sourceStageKey')||'.'||(v_field#>>'{field,key}')||'}',v_value);
   end if;
  end loop;
  v_name:=fms_normalize_record_name(replace(replace(replace(left(v_template,500),'{workflow}',v_context->>'workflowName'),'{stage}',v_stage.name),'{reference}',v_reference));
  if v_name is not null then return v_name; end if;
 end if;
 return coalesce(fms_record_name_candidate(p_work_id,'automatic'),v_instance.reference_number,'Assigned work');
end $$;
revoke all on function fms_record_name_candidate(uuid,text,jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
