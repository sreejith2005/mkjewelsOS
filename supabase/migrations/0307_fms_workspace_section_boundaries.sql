-- Use registered page identifiers so permission and maintenance checks are effective.
set search_path=public,extensions;
do $$
declare signature text; definition text; amended text;
begin
 foreach signature in array array[
  'fms_workspace_validate(jsonb,integer,integer)',
  'task_workspace_page(jsonb,integer,integer)',
  'task_feed_page(text,text,integer,integer)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  amended:=replace(definition,'assert_module_access(''tasks'')','assert_module_access(''checklist_tasks'')');
  amended:=replace(amended,'module_accessible(''fms'',false)','module_accessible(''fms_builder'',false)');
  if amended=definition then raise exception 'Review Tasks section guard in %',signature; end if;
  execute amended;
 end loop;
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'module_accessible(''fms'',false)','module_accessible(''fms_builder'',false)');
 if amended=definition then raise exception 'Review FMS section visibility guard'; end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
