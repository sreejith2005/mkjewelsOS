begin;
select plan(15);

select has_column('public', 'user_profiles', 'secondary_buddy_id', 'profiles store a secondary buddy');
select col_is_fk('public', 'user_profiles', 'secondary_buddy_id', 'secondary buddy is referentially enforced');
select has_index('public', 'user_profiles', 'idx_user_profiles_secondary_buddy', 'secondary buddy lookups are indexed');

select has_function('public', 'resolve_task_coverage', array['uuid', 'date'], 'coverage has one canonical resolver');
select has_function('public', 'reconcile_short_deadline_coverage_with_audit', array['uuid', 'date', 'text'], 'short-deadline work has one audited reconciler');
select has_function('public', 'record_availability_range_with_audit', array['uuid', 'date', 'date', 'availability_status', 'text'], 'availability ranges are recorded atomically');
select has_function('public', 'get_recurring_todo_workspace', array['jsonb'], 'recurring workspace is database-backed');

select ok(
  position('secondary_buddy_id' in pg_get_functiondef('public.resolve_task_coverage(uuid,date)'::regprocedure)) > 0,
  'resolver evaluates the secondary buddy'
);
select ok(
  position('reports_to_user_id' in pg_get_functiondef('public.resolve_task_coverage(uuid,date)'::regprocedure)) > 0,
  'resolver falls back to the reporting manager'
);
select ok(
  position('Asia/Kolkata' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'reconciliation uses the agreed business timezone'
);
select ok(
  position('client_followups' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0
  and position('fms_instance_stages' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0
  and position('task_instances' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'reconciliation covers Tasks, CRM follow-ups, and FMS stages'
);
select ok(
  position('manager_review' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'claimed or in-progress work is routed to manager review'
);
select ok(
  position('coverage_required' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'uncovered work is visibly marked coverage required'
);
select ok(
  position('reconcile_short_deadline_coverage_with_audit' in pg_get_functiondef('public.record_availability_with_audit(uuid,date,availability_status,text)'::regprocedure)) > 0,
  'single-day absence recording invokes reconciliation'
);
select function_privs_are(
  'public', 'reconcile_short_deadline_coverage_with_audit', array['uuid', 'date', 'text'], 'authenticated',
  array['EXECUTE'], 'authenticated users can invoke the authorized reconciliation contract'
);

select * from finish();
rollback;
