begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_index('public', 'task_instances', 'idx_task_instances_creator_effective_due', 'authored task feed has a creator and effective-deadline index');
select has_index('public', 'fms_instance_stages', 'idx_fms_instance_stages_effective_due', 'authored FMS feed can filter stage deadlines efficiently');
select ok(position('effective_due_datetime' in pg_get_viewdef('public.v_all_tasks'::regclass)) > 0, 'task feed exposes one effective deadline column for indexed filtering');

select * from finish();
rollback;
