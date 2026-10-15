-- Running a schedule manually is another human-initiated assignment. Existing
-- automatic materialization and historical schedules keep their contracts.
set search_path=public,extensions;
do $manual_run$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.run_recurring_todo_template_now_with_audit(uuid,date)'::regprocedure);
  n:=replace(f,'  v_task_id:=create_recurring_todo_instance',
    $guard$  if not has_permission('tasks.assign_others') and exists(
    select 1 from unnest(v_assignees) assigned(id) where id is distinct from v_actor.id
  ) then
    raise exception 'Assigning tasks to other users is denied' using errcode='42501';
  end if;
  v_task_id:=create_recurring_todo_instance$guard$);
  if n=f then raise exception 'Manual recurring assignment guard upgrade failed'; end if;
  execute n;
end $manual_run$;
