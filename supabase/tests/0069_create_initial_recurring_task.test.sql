begin;
select plan(2);

select ok(
  position('initial_planned_datetime' in pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure)) > 0,
  'new recurring schedules may request their first planned task instance'
);
select ok(
  position('recurring_task_initial_instance_created' in pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure)) > 0,
  'the first recurring task instance is audited when its schedule is saved'
);

select * from finish();
rollback;
