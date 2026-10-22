-- Global task search shares the same FMS naming projection. Resolve its stable
-- FMS module flag once, preserving exact instance/work and section authorization.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure);
 amended:=replace(definition,'module_accessible(''fms_builder'',false)','fms_module_enabled');
 amended:=replace(amended,'q text;','fms_module_enabled boolean; q text;');
 amended:=replace(amended,'perform assert_module_access(''checklist_tasks'');',
  'perform assert_module_access(''checklist_tasks'');
 fms_module_enabled:=module_accessible(''fms_builder'',false);');
 if amended=definition or position('fms_module_enabled boolean;' in amended)=0
  or position('fms_module_enabled:=module_accessible' in amended)=0 then
  raise exception 'Review global task search module snapshot';
 end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
