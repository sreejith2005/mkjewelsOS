begin;
select plan(16);

-- Completion bookkeeping ------------------------------------------------------
select has_column('public', 'task_instances', 'completed_by', 'instances record who completed the work');
select has_column('public', 'task_instances', 'completion_mode', 'instances record own versus on-behalf completion');
select has_column('public', 'task_instances', 'completion_delay_minutes', 'instances record the delay against the effective deadline');
select has_column('public', 'task_instances', 'on_time_status', 'instances record the on time or delayed outcome');
select col_has_check('public', 'task_instances', array['completion_mode'], 'completion mode is constrained');
select col_has_check('public', 'task_instances', array['on_time_status'], 'on time status is constrained');

-- Weekly off is asked as its own question -------------------------------------
select has_function('public', 'is_user_week_off_on_date', array['uuid','date'], 'weekly off has a dedicated predicate');
select function_privs_are('public', 'is_user_week_off_on_date', array['uuid','date'], 'anon', array[]::text[], 'anonymous callers cannot probe weekly offs');
select ok(
  position('is_user_week_off_on_date' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'a weekly off produces no occurrence instead of moving work to a buddy');

-- Coverage bookkeeping restored to generation ---------------------------------
select ok(
  position('buddy_assignments' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'generation records the buddy assignment it resolved');
select ok(
  position('coverage_required' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'generation flags an occurrence nobody can cover');
select ok(
  position('task_coverage_required' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'generation notifies the manager when nobody can cover');

-- Completion and verification rules -------------------------------------------
select ok(
  position('on behalf of the doer' in pg_get_functiondef('public.update_task_with_audit(uuid,text,uuid,boolean,text)'::regprocedure)) > 0,
  'completing another user''s task demands a remark');
select ok(
  position('on_time_status' in pg_get_functiondef('public.update_task_with_audit(uuid,text,uuid,boolean,text)'::regprocedure)) > 0,
  'completion records whether the work landed on time');
select ok(
  position($$status='rejected'$$ in pg_get_functiondef('public.verify_recurring_task_with_audit(uuid,text,text)'::regprocedure)) > 0,
  'a rejected verification returns the occurrence to the doer');

-- Workspace filters -----------------------------------------------------------
select ok(
  position('schedule_kind' in pg_get_functiondef('public.get_recurring_todo_workspace(jsonb)'::regprocedure)) > 0
  and position('p_filter->>''priority''' in pg_get_functiondef('public.get_recurring_todo_workspace(jsonb)'::regprocedure)) > 0,
  'the workspace filters on the reference filter set, not only search and dates');

select * from finish();
rollback;
