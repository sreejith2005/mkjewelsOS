begin;
select plan(29);

select has_column('public', 'user_profiles', 'secondary_buddy_id', 'profiles store a secondary buddy');
select col_is_fk('public', 'user_profiles', 'secondary_buddy_id', 'secondary buddy is referentially enforced');
select has_index('public', 'user_profiles', 'idx_user_profiles_secondary_buddy', 'secondary buddy lookups are indexed');

select has_function('public', 'resolve_task_coverage', array['uuid', 'date'], 'coverage has one canonical resolver');
select has_function('public', 'reconcile_short_deadline_coverage_with_audit', array['uuid', 'date', 'text'], 'short-deadline work has one audited reconciler');
select has_function('public', 'record_availability_range_with_audit', array['uuid', 'date', 'date', 'availability_status', 'text'], 'availability ranges are recorded atomically');
select has_function('public', 'get_recurring_todo_workspace', array['jsonb'], 'recurring workspace is database-backed');
select has_function('public', 'create_recurring_todo_instance', array['uuid', 'date', 'uuid[]'], 'recurring generation uses the central contract');
select has_function('public', 'resolve_fms_stage_assignees', array['uuid', 'uuid', 'uuid'], 'FMS activation has one assignment resolver');
select has_column('public', 'task_templates', 'verification_required', 'recurring schedules can require verification');
select has_column('public', 'task_templates', 'followup_enabled', 'recurring schedules can enable follow-up');
select has_column('public', 'task_instances', 'verification_status', 'recurring instances persist verification state');
select has_column('public', 'task_instances', 'followup_count', 'recurring instances persist follow-up activity');
select has_function('public', 'save_recurring_todo_template_with_audit', array['uuid', 'jsonb'], 'recurring schedules have an audited save contract');
select has_function('public', 'verify_recurring_task_with_audit', array['uuid', 'text', 'text'], 'verification decisions are audited');
select has_function('public', 'send_recurring_followup_with_audit', array['uuid', 'text'], 'task follow-ups are audited');
select has_function('public', 'delete_recurring_todo_template_with_audit', array['uuid'], 'template deletion is dependency-safe and audited');
select has_function('public', 'configure_invited_profile_coverage_with_audit', array['uuid', 'uuid', 'uuid', 'uuid'], 'new users can receive their full coverage profile atomically');
select ok(position('secondary_buddy_id' in pg_get_functiondef('public.configure_invited_profile_coverage_with_audit(uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'new-user coverage configuration persists the secondary buddy');

select ok(
  position('secondary_buddy_id' in pg_get_functiondef('public.resolve_task_coverage(uuid,date)'::regprocedure)) > 0,
  'resolver evaluates the secondary buddy'
);
select ok(
  position('resolve_task_coverage' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'recurring generation delegates availability and buddy order to the canonical resolver'
);
select ok(
  position('resolve_task_coverage' in pg_get_functiondef('public.resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('fallback_user_profile_id' in pg_get_functiondef('public.resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure)) = 0,
  'FMS activation uses profile coverage and ignores the retired per-stage fallback'
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
