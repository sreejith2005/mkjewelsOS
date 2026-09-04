begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(2);

select has_function(
  'public',
  'complete_uploaded_task_with_audit',
  array['uuid','text'],
  'normal upload-required tasks have one completion RPC'
);
select function_privs_are(
  'public',
  'complete_uploaded_task_with_audit',
  array['uuid','text'],
  'authenticated',
  array['EXECUTE'],
  'an authenticated active doer may use the protected completion RPC'
);
select * from finish();
rollback;
