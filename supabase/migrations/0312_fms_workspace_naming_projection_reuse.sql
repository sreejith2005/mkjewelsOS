-- Reuse the exact authorized causal snapshot projection across naming fallbacks.
-- These helpers remain private; only the workspace's checked assignment relation
-- may bypass the outer per-record guard it has already applied.
set search_path=public,extensions;

create function fms_record_name_from_sources(p_sources jsonb,p_kind text,p_source jsonb default null)
returns text language plpgsql immutable set search_path=public as $$
declare source jsonb; selected text; name text;
begin
 for source in select value from jsonb_array_elements(p_sources)
  where case when p_kind='explicit' then value->>'stageKey'=p_source->>'sourceStageKey'
    and value->>'formId'=p_source->>'formTemplateId' else (value->>'initial')::boolean end
  order by (value->>'initial')::boolean desc,(value->>'visitNumber')::integer desc,value->>'visitId' loop
  if p_kind in ('explicit','default') then
   selected:=case when p_kind='explicit' then p_source->>'fieldKey' else source->>'defaultKey' end;
   if nullif(btrim(selected),'') is null then continue; end if;
   select fms_record_field_value(answer) into name from jsonb_array_elements(source->'fields') answer
    where answer#>>'{field,key}'=selected and fms_record_field_eligible(jsonb_build_object('field_key',answer#>>'{field,key}',
      'field_name',answer#>>'{field,label}','field_type',answer#>>'{field,type}','is_shown',true)) limit 1;
  elsif p_kind='automatic' then
   select fms_record_field_value(answer) into name from jsonb_array_elements(source->'fields') answer
    where answer#>>'{field,type}' in ('text','number') and fms_record_field_value(answer) is not null
      and concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}') !~* '(password|secret|token|credential|private|remarks?|notes?|email|phone|mobile)'
      and replace(lower(concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}')),'_',' ') ~ '\m(customer|client|lead|enquiry|inquiry|record|order) (name|number|no|reference|ref|id)\M'
    order by case when replace(lower(concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}')),'_',' ') ~ '\m(customer|client) name\M' then 0
     when replace(lower(concat_ws(' ',answer#>>'{field,key}',answer#>>'{field,label}')),'_',' ') ~ '\m(lead|enquiry|inquiry|record) name\M' then 1 else 2 end,
     (answer#>>'{field,sortOrder}')::integer,answer#>>'{field,key}' limit 1;
  end if;
  if name is not null then return name; end if;
 end loop;
 return null;
end $$;

create function fms_record_name_sources(p_work_id uuid,p_explicit_sources jsonb default '[]') returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('visitId',causal.visit_id,'initial',causal.is_initial,
  'stageKey',definition.stage_key,'formId',definition.form_template_id,'visitNumber',visit.visit_number,
  'defaultKey',submission.template_snapshot#>>'{template,record_name_field_key}',
  'fields',fms_context_form_fields(causal.visit_id))),'[]'::jsonb)
 from fms_context_form_visits(p_work_id) causal join fms_instance_stages visit on visit.id=causal.visit_id
 join fms_stages definition on definition.id=visit.fms_stage_id join form_submissions submission on submission.id=causal.submission_id
 where causal.is_initial or p_explicit_sources is null or exists(
  select 1 from jsonb_array_elements(p_explicit_sources) source
  where source->>'sourceStageKey'=definition.stage_key and source->>'formTemplateId'=definition.form_template_id::text);
$$;

do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_work_record_name(uuid)'::regprocedure);
 amended:=replace(definition,'FUNCTION public.fms_work_record_name(', 'FUNCTION public.fms_work_record_name_authorized(');
 amended:=replace(amended,'if not can_read_fms_work_context(p_work_id) then return null; end if;','');
 amended:=replace(amended,'v_stage_naming jsonb;', 'v_sources jsonb; v_stage_naming jsonb;');
 amended:=replace(amended,'if v_stage_naming->>''mode''=''field'' then',
  'v_sources:=fms_record_name_sources(p_work_id,jsonb_build_array(v_stage_naming->''source'',v_initial_naming->''source''));
 if v_stage_naming->>''mode''=''field'' then');
 -- Other causal forms are projected only if legacy interpolation is actually
 -- reached. Default/automatic names do not expand an entire loop's fields.
 amended:=replace(amended,'if v_template is not null then',
  'if v_template is not null then v_sources:=fms_record_name_sources(p_work_id,null);');
 amended:=replace(amended,'fms_record_name_candidate(p_work_id,','fms_record_name_from_sources(v_sources,');
 amended:=replace(amended,
  'from fms_context_form_visits(v_work.id) causal
    cross join lateral jsonb_array_elements(fms_context_form_fields(causal.visit_id)) visible(field)',
  'from jsonb_array_elements(v_sources) source
    cross join lateral jsonb_array_elements(source->''fields'') visible(field)');
 if amended=definition or position('fms_record_name_candidate(' in amended)>0
  or position('fms_context_form_visits(v_work.id)' in amended)>0
  or position('FUNCTION public.fms_work_record_name_authorized(' in amended)=0
  or position('v_sources jsonb;' in amended)=0 then raise exception 'Review single-pass FMS naming projection'; end if;
 execute amended;
end $$;

-- Keep this existing private helper compatible, with one shared implementation
-- of candidate precedence/eligibility rather than a second set of naming rules.
create or replace function fms_record_name_candidate(p_work_id uuid,p_kind text,p_source jsonb default null)
returns text language plpgsql stable security definer set search_path=public as $$
begin
 if not can_read_fms_work_context(p_work_id) then return null; end if;
 return fms_record_name_from_sources(fms_record_name_sources(p_work_id,
  case when p_kind='explicit' then jsonb_build_array(p_source) else '[]'::jsonb end),p_kind,p_source);
end $$;

create or replace function fms_work_record_name(p_work_id uuid) returns text
language plpgsql stable security definer set search_path=public as $$
begin
 if not can_read_fms_work_context(p_work_id) then return null; end if;
 return fms_work_record_name_authorized(p_work_id);
end $$;

do $$
declare target regprocedure; definition text; amended text;
begin
 foreach target in array array['fms_workspace_rows(jsonb)'::regprocedure,
  'get_fms_task_stage_page(uuid,uuid,uuid,boolean,jsonb,integer,integer)'::regprocedure] loop
  definition:=pg_get_functiondef(target);
  amended:=replace(definition,'fms_work_record_name(id)','fms_work_record_name_authorized(id)');
  if target='fms_workspace_rows(jsonb)'::regprocedure then
   amended:=replace(amended,'work as (','work as materialized (');
   if position('work as materialized (' in amended)=0 then raise exception 'Review materialized authorized FMS rows'; end if;
  end if;
  if amended=definition then raise exception 'Review checked FMS naming consumer %',target; end if;
  execute amended;
 end loop;
end $$;

revoke all on function fms_record_name_from_sources(jsonb,text,jsonb),fms_record_name_sources(uuid,jsonb),fms_work_record_name_authorized(uuid)
 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
