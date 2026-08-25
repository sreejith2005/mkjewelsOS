begin;
select plan(11);

select has_column('public', 'task_templates', 'core_task_label', 'templates retain the source core task');
select has_column('public', 'task_templates', 'due_time', 'templates retain the daily due time');
select has_column('public', 'task_templates', 'verifier_user_profile_id', 'templates retain the designated verifier');
select has_column('public', 'task_instances', 'core_task_label', 'instances retain the source core task');
select has_column('public', 'task_instances', 'due_datetime', 'instances have an independent due deadline');
select has_column('public', 'task_instances', 'verifier_user_profile_id', 'instances retain the designated verifier');
select has_function('public', 'task_effective_due_datetime', array['public.task_instances'], 'effective task deadline is centralized');
select has_function('public', 'verify_recurring_task_with_audit', array['uuid','text','text'], 'verification stays behind an audited RPC');
select function_privs_are('public', 'get_recurring_todo_workspace', array['jsonb'], 'anon', array[]::text[], 'anonymous users cannot load schedules');
select function_privs_are('public', 'get_recurring_todo_workspace', array['jsonb'], 'authenticated', array['EXECUTE'], 'authenticated admin callers use the protected workspace RPC');
select ok(position('task_effective_due_datetime' in pg_get_functiondef('public.detect_scheduled_notification_events(integer,timestamp with time zone)'::regprocedure))>0,'overdue notification detection uses the effective due deadline');

select * from finish();
rollback;
