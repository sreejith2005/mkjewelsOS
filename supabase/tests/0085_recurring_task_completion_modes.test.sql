begin;
select plan(5);

select has_column('public', 'task_templates', 'buddy_assignment_allowed', 'recurring schedules store whether buddy reassignment is allowed');
select has_column('public', 'task_instances', 'buddy_assignment_allowed', 'recurring instances retain the buddy reassignment decision');
select has_function('public', 'complete_recurring_task_with_image_with_audit', array['uuid', 'text'], 'image task completion has a protected RPC');
select function_privs_are('public', 'complete_recurring_task_with_image_with_audit', array['uuid', 'text'], 'authenticated', array['EXECUTE'], 'authenticated callers can complete their image-evidence tasks');
select function_privs_are('public', 'complete_recurring_task_with_image_with_audit', array['uuid', 'text'], 'anon', array[]::text[], 'anonymous callers cannot complete image-evidence tasks');

select * from finish();
rollback;
