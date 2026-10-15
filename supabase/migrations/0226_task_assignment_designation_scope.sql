-- Preserve the existing company scope of an active Process Coordinator even
-- when the same actor also has Manager role/dashboard authority.
set search_path=public,extensions;

do $designation_scope$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.task_assignment_scope()'::regprocedure);
  f:=replace(f,E'\r\n',E'\n');
  n:=replace(f,E'  if a.user_role=''manager'' then return ''branch''; end if;\n','');
  if n=f then raise exception 'Manager scope boundary not found'; end if;
  f:=n;
  n:=replace(f,'  return ''department'';',E'  if a.user_role=''manager'' then return ''branch''; end if;\n  return ''department'';');
  if n=f then raise exception 'Department scope boundary not found'; end if;
  execute n;

  -- The original creation contract independently checks Manager branch scope.
  -- Use the same resolved scope so designation authority works for writes too.
  f:=pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure);
  n:=replace(f,'if v_actor.user_role = ''manager'' then','if task_assignment_scope() = ''branch'' then');
  if n=f then raise exception 'Task creation branch scope boundary not found'; end if;
  f:=n;
  n:=replace(f,'v_actor.user_role <> ''manager'' or up.branch_id = v_actor.branch_id','task_assignment_scope() <> ''branch'' or up.branch_id = v_actor.branch_id');
  if n=f then raise exception 'Task watcher branch scope boundary not found'; end if;
  execute n;
end $designation_scope$;
