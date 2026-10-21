-- A legacy form without a naming default needs no historical field projection
-- for that candidate. Preserve the same causal/visibility checks when a key exists.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_record_name_candidate(uuid,text,jsonb)'::regprocedure);
 amended:=replace(definition,'v_fields:=fms_context_form_fields(v_source.visit_id);','');
 amended:=replace(amended,
  'v_selected:=case when p_kind=''explicit'' then p_source->>''fieldKey'' else v_snapshot#>>''{template,record_name_field_key}'' end;',
  'v_selected:=case when p_kind=''explicit'' then p_source->>''fieldKey'' else v_snapshot#>>''{template,record_name_field_key}'' end;
    if nullif(btrim(v_selected),'''') is null then continue; end if;');
 amended:=replace(amended,'select fms_record_field_value(answer) into v_name',
  'v_fields:=fms_context_form_fields(v_source.visit_id);
    select fms_record_field_value(answer) into v_name');
 if amended=definition or position('if nullif(btrim(v_selected)' in amended)=0 then
  raise exception 'Review deferred FMS naming projection';
 end if;
 execute amended;
end $$;
