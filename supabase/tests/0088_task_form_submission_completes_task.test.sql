begin;
select plan(9);

select has_function('public', 'submit_form_with_audit', array['uuid', 'jsonb', 'text', 'uuid'], 'task form submission remains a protected RPC');
select function_privs_are('public', 'submit_form_with_audit', array['uuid', 'jsonb', 'text', 'uuid'], 'authenticated', array['EXECUTE'], 'active authenticated callers can submit task forms');
select function_privs_are('public', 'submit_form_with_audit', array['uuid', 'jsonb', 'text', 'uuid'], 'anon', array[]::text[], 'anonymous callers cannot submit task forms');
select ok(position('for update' in lower(pg_get_functiondef('public.submit_form_with_audit(uuid,jsonb,text,uuid)'::regprocedure))) > 0, 'task-linked form submissions lock their task before delegated validation');
select ok(position('v_task.requires_form' in pg_get_functiondef('public.submit_form_locked_with_audit(uuid,jsonb,text,uuid)'::regprocedure)) > 0, 'the delegated task branch retains its required-form authorization guard');
select ok(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_task_from_required_form_submission' and p.prorettype='trigger'::regtype), 'a trigger function completes required-form tasks');
select ok(position('status = ''completed''' in pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_task_from_required_form_submission'))) > 0, 'a successful task form submission completes the linked task atomically');
select ok(position('task_form_submitted_and_completed' in pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_task_from_required_form_submission'))) > 0, 'automatic task completion creates an explicit audit record');
select ok(position('coverage_status = ''coverage_required''' in pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_task_from_required_form_submission'))) > 0, 'coverage-blocked tasks cannot be completed by a form submission');

select * from finish();
rollback;
