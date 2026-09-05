-- Existing assignments must use the same deadline order as the task feed:
-- revised date, then due date, then planned date. Otherwise work planned
-- earlier but due on an absence date is skipped during reconciliation.
set search_path=public,extensions;

do $coverage$
declare v_definition text;
begin
  select pg_get_functiondef('public.reconcile_all_assignment_coverage_with_audit(uuid,date,text)'::regprocedure)
    into v_definition;
  v_definition := replace(
    v_definition,
    '(coalesce(ti.revised_datetime,ti.planned_datetime) at time zone ''Asia/Kolkata'')::date=p_date',
    '(coalesce(ti.revised_datetime,ti.due_datetime,ti.planned_datetime) at time zone ''Asia/Kolkata'')::date=p_date'
  );
  if position('coalesce(ti.revised_datetime,ti.due_datetime,ti.planned_datetime)' in v_definition) = 0 then
    raise exception 'Task coverage reconciliation deadline contract could not be upgraded';
  end if;
  execute v_definition;
end $coverage$;

notify pgrst,'reload schema';
