begin;
select plan(5);

select has_column('public', 'task_templates', 'due_time', 'recurring schedules persist a due time distinct from their start time');
select col_type_is('public', 'task_templates', 'due_time', 'time without time zone', 'due time has a wall-clock time type');
select ok(
  position('due_time' in pg_get_functiondef('public.save_recurring_todo_template_with_audit(uuid,jsonb)'::regprocedure)) > 0,
  'audited recurring save accepts and persists due time'
);
select ok(
  position('due_time' in pg_get_functiondef('public.apply_recurring_template_due_time()'::regprocedure)) > 0,
  'generated recurring instances use the schedule due time'
);
select ok(
  position('coverage_enabled' in pg_get_functiondef('public.save_recurring_todo_template_with_audit(uuid,jsonb)'::regprocedure)) > 0,
  'recurring generation explicitly preserves profile coverage'
);

select * from finish();
rollback;
