begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_view('public', 'v_task_feed_scope', 'task feed has a lightweight authorization scope');
select has_column('public', 'v_task_feed_scope', 'effective_due_datetime', 'scope exposes the effective deadline');
select has_column('public', 'v_task_feed_scope', 'created_by', 'scope supports authored work discovery');
select has_column('public', 'v_task_feed_scope', 'assignee_id', 'scope supports assigned work discovery');
select ok(
  exists(select 1 from unnest(coalesce((select reloptions from pg_class where oid = 'public.v_task_feed_scope'::regclass), '{}'::text[])) option where option like 'security_invoker=%'),
  'scope evaluates the underlying RLS policies as the caller'
);
select ok(not has_table_privilege('anon', 'public.v_task_feed_scope', 'SELECT'), 'anonymous callers cannot read task scope');
select ok(has_table_privilege('authenticated', 'public.v_task_feed_scope', 'SELECT'), 'authenticated callers can read authorized task scope');
select ok(position('task_checklists' in pg_get_viewdef('public.v_task_feed_scope'::regclass)) = 0, 'scope avoids checklist aggregation');
select ok(position('task_templates' in pg_get_viewdef('public.v_task_feed_scope'::regclass)) = 0, 'scope avoids template joins');
select has_index('public', 'task_instances', 'idx_task_instances_creator_effective_due', 'authored scope keeps the effective-deadline index');
select has_index('public', 'fms_starter_assignments', 'idx_fms_starter_assignments_assigner_pending', 'authored starter scope has an assigner index');

select * from finish();
rollback;
