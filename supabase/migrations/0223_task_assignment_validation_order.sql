-- Preserve legacy payload/scope validation errors while applying the new
-- assignment authorization immediately before any durable task write.
set search_path=public,extensions;
do $ordering$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure);
  n:=replace(f,E'  perform assert_task_assignment_targets(p_doer_ids,p_watcher_ids);\n','');
  if n=f then raise exception 'Previous task assignment guard not found'; end if;
  f:=n;
  n:=replace(f,'  insert into task_instances (',E'  perform assert_task_assignment_targets(p_doer_ids,p_watcher_ids);\n  insert into task_instances (');
  if n=f then raise exception 'Task write boundary not found'; end if;
  execute n;
end $ordering$;
