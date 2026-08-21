begin;
select plan(10);

select has_function('public','validate_task_bulk_import',array['jsonb','text'],'validation RPC exists');
select has_function('public','import_task_bulk_with_audit',array['jsonb','text','text'],'atomic import RPC exists');
select has_table('public','task_import_batches','batch metadata table exists');
select policies_are('public','task_import_batches',array['task_import_batches_select'],'batch history has one deliberate read policy');
select ok(has_table_privilege('authenticated','task_import_batches','SELECT'),'authenticated callers may read RLS-scoped batch summaries');
select ok(not has_function_privilege('anon','validate_task_bulk_import(jsonb,text)','EXECUTE'),'anonymous callers cannot validate imports');
select ok(not has_function_privilege('anon','import_task_bulk_with_audit(jsonb,text,text)','EXECUTE'),'anonymous callers cannot import tasks');
select ok((select pg_get_functiondef('validate_task_bulk_import(jsonb,text)'::regprocedure) like '%task_bulk_import_validation%'),'validation delegates to the server-side authorization helper');
select ok((select pg_get_functiondef('import_task_bulk_with_audit(jsonb,text,text)'::regprocedure) like '%task_bulk_import_validation%'),'import revalidates inside its transaction');
select ok((select pg_get_functiondef('import_task_bulk_with_audit(jsonb,text,text)'::regprocedure) like '%task_bulk_imported%'),'successful imports create an audit event');

select * from finish();
rollback;
