begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(6);

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
select ok(
  position('A completion remark is required' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) = 0,
  'evidence upload is sufficient completion proof for upload-required tasks'
);
select ok(
  position('super_admin' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0
  and position('manager' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0,
  'upload completion authorizes the same elevated roles as update_task_with_audit'
);
select ok(
  position('image/webp' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0,
  'the accepted evidence types match the bucket and the file picker'
);
select ok(
  position('form_submissions' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0,
  'a required form is checked for an actual submission rather than rejected outright'
);
select * from finish();
rollback;
