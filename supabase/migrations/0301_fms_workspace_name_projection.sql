-- Resolve a local verification finding without rewriting the earlier migration.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_work_record_name(uuid)'::regprocedure);
 amended:=replace(definition,'context jsonb; item jsonb;','context jsonb; template_field jsonb;');
 amended:=replace(amended,'for item in select * from jsonb_array_elements(context->''receivedFields'') loop','for template_field in select * from jsonb_array_elements(context->''receivedFields'') loop');
 amended:=replace(amended,'value:=fms_record_field_value(item);','value:=fms_record_field_value(template_field);');
 amended:=replace(amended,'(item->>''sourceStageKey'')','(template_field->>''sourceStageKey'')');
 amended:=replace(amended,'(item#>>''{field,key}'')','(template_field#>>''{field,key}'')');
 if amended=definition then raise exception 'Review record naming local variable correction'; end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
