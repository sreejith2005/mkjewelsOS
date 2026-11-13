-- 0404: a skipped recurring task is recorded once per template and day.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

select has_index('public', 'audit_logs', 'audit_logs_recurring_skip_once_idx',
  'the skip record has a uniqueness index');
select ok(
  position('do nothing' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'generation ignores a repeated skip');
select ok(
  position('is_user_week_off_on_date' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'the weekly-off rule is still in generation');

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0404 test', 'skip-once-0404') returning id into t;
  insert into fx values ('tenant', t), ('template_a', gen_random_uuid()), ('template_b', gen_random_uuid());
end $$;

-- The statement the generator now runs, three times for one template and day.
do $$
declare i integer;
begin
  for i in 1..3 loop
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
    values((select id from fx where label='tenant'),null,'recurring_task_skipped','tasks',(select id from fx where label='template_a'),
      jsonb_build_object('scheduled_date',date '2026-11-13','reason','weekly_off_or_out_of_scope'))
    on conflict (record_id, (new_value->>'scheduled_date'))
      where action = 'recurring_task_skipped' and module = 'tasks' do nothing;
  end loop;
end $$;

select is((select count(*)::int from audit_logs where action='recurring_task_skipped'
  and record_id=(select id from fx where label='template_a')), 1,
  'three runs for one template and day leave one skip row');

-- Another day and another template are separate facts.
insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
values((select id from fx where label='tenant'),null,'recurring_task_skipped','tasks',(select id from fx where label='template_a'),
  jsonb_build_object('scheduled_date',date '2026-11-14','reason','weekly_off_or_out_of_scope')),
 ((select id from fx where label='tenant'),null,'recurring_task_skipped','tasks',(select id from fx where label='template_b'),
  jsonb_build_object('scheduled_date',date '2026-11-13','reason','weekly_off_or_out_of_scope'));
select is((select count(*)::int from audit_logs where action='recurring_task_skipped'
  and record_id in (select id from fx where label like 'template_%')), 3,
  'another day and another template are recorded separately');

-- Other audit actions for the same record and day are not restricted.
insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
select (select id from fx where label='tenant'),null,'recurring_task_generated','tasks',(select id from fx where label='template_a'),
  jsonb_build_object('scheduled_date',date '2026-11-13') from generate_series(1,2);
select is((select count(*)::int from audit_logs where action='recurring_task_generated'
  and record_id=(select id from fx where label='template_a')), 2,
  'other audit actions are not deduplicated');

select * from finish();
rollback;
