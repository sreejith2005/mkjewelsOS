begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(21);

-- Attachment metadata is now recorded, so oversight can report the real file.
select has_column('public','task_attachments','original_filename','attachments record the uploaded filename');
select has_column('public','task_attachments','mime_type','attachments record the uploaded MIME type');
select has_column('public','task_attachments','size_bytes','attachments record the uploaded size');
select has_index('public','task_attachments','idx_task_attachments_task','task_instance_id','attachment lookups by task are indexed');

-- Contract surface and authorization.
select has_function('public','get_task_evidence_workspace',array['jsonb'],'evidence workspace RPC exists');
select has_function('public','get_task_attachment_path',array['uuid'],'attachment path resolution RPC exists');
select is((select prosecdef from pg_proc where oid='public.get_task_evidence_workspace(jsonb)'::regprocedure),true,'evidence workspace is security definer');
select is((select prosecdef from pg_proc where oid='public.get_task_attachment_path(uuid)'::regprocedure),true,'attachment path resolution is security definer');
select function_privs_are('public','get_task_evidence_workspace',array['jsonb'],'authenticated',array['EXECUTE'],'authenticated receives the protected workspace grant');
select function_privs_are('public','get_task_attachment_path',array['uuid'],'authenticated',array['EXECUTE'],'authenticated receives the protected path grant');
select function_privs_are('public','get_task_evidence_workspace',array['jsonb'],'anon',array[]::text[],'anon cannot reach the evidence workspace');
select function_privs_are('public','get_task_attachment_path',array['uuid'],'anon',array[]::text[],'anon cannot resolve an attachment path');

-- The workspace is limited to oversight roles and refuses an unbounded range.
select ok(position($$not in ('super_admin','admin','manager','hr')$$ in pg_get_functiondef('public.get_task_evidence_workspace(jsonb)'::regprocedure))>0,'only oversight roles reach the evidence workspace');
select ok(position('Date range is invalid' in pg_get_functiondef('public.get_task_evidence_workspace(jsonb)'::regprocedure))>0,'the workspace bounds its date range');
select ok(position('Branch is not authorized' in pg_get_functiondef('public.get_task_evidence_workspace(jsonb)'::regprocedure))>0,'a manager cannot widen scope past its own branch');

-- Registration must now prove the caller uploaded the object it names.
select ok(position('Uploaded object is not owned by the caller' in pg_get_functiondef('public.add_task_attachment_with_audit(uuid,text)'::regprocedure))>0,'attachment registration verifies Storage object ownership');
select ok(position('Invalid task attachment metadata' in pg_get_functiondef('public.add_task_attachment_with_audit(uuid,text)'::regprocedure))>0,'attachment registration validates path, MIME type, and size');

-- Every attachment-writing contract records the Storage-derived metadata.
select ok(position('task_attachment_display_name' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure))>0,'atomic upload completion records the display filename');
select ok(position('size_bytes' in pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure))>0,'recurring image completion records the uploaded size');

-- The section maintenance contract knows the new route.
select ok((default_section_availability() ? 'task_evidence'),'section availability covers the task evidence route');

-- The bucket must accept every type the registration contract permits.
select is((select allowed_mime_types from storage.buckets where id='task-attachments'),
  array['image/jpeg','image/png','image/webp','application/pdf'],
  'the task attachment bucket accepts every permitted evidence type');

select * from finish();
rollback;
