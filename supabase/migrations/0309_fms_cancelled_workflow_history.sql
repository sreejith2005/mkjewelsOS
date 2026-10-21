-- Completing a later cancellation path does not erase earlier completed work.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'i.status<>''cancelled''',
  '(i.status<>''cancelled'' or w.status=''completed'')');
 if amended=definition then raise exception 'Review completed FMS cancellation history'; end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
