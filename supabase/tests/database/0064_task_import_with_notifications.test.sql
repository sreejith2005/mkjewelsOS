begin;
select plan(2);

select has_table('public', 'task_import_batches', 'task import batches are persisted without source files');
select has_function(
  'public',
  'import_delegation_tasks_with_audit',
  array['jsonb', 'text'],
  'authorized task import RPC exists'
);

select * from finish();
rollback;
