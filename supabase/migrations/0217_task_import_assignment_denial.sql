-- Initial legacy import creation resolves a doer and inserts work directly.
-- Guard the canonical resolved identity within its existing row transaction;
-- preserve self imports, unresolved work, row-level errors and retry behavior.
set search_path=public,extensions;
do $import_assignment$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.commit_task_bulk_import_chunk_v0104(uuid,jsonb)'::regprocedure);
  n:=replace(f,'      v_verifier:=null;',E'      if v_assignee is not null then\n        perform assert_task_assignment_rule(''specific_user'',v_assignee);\n      end if;\n      v_verifier:=null;');
  if n=f then raise exception 'Initial import assignment guard upgrade failed'; end if;
  execute n;
end $import_assignment$;
