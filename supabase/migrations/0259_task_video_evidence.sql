-- Task proof may be a video. Employees record a short clip (MP4 from Android,
-- QuickTime from iPhone, WebM/3GPP from older browsers and phones) as evidence
-- for a task. Images and PDFs keep their 10 MB limit; a video may be up to
-- 50 MB. The bucket, both registration contracts and the imported-task proof
-- guard must agree, or an accepted upload would be refused one layer later.
--
-- Only the type list and size bound change. The functions are upgraded in place
-- (the same technique as 0238) so every earlier hardening layered onto them is
-- preserved verbatim. The size rule avoids CASE: PL/pgSQL ends an IF condition
-- at the first THEN, including one inside a CASE expression. The recurring
-- image-completion path stays image-only by design: its contract is "upload
-- an image to complete".
set search_path=public,extensions;

update storage.buckets
   set file_size_limit=52428800,
       allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf',
         'video/mp4','video/quicktime','video/webm','video/3gpp']
 where id='task-attachments';

do $task_video_evidence$
declare
  v_old_types constant text:='(''image/jpeg'',''image/png'',''image/webp'',''application/pdf'')';
  v_new_types constant text:='(''image/jpeg'',''image/png'',''image/webp'',''application/pdf'',''video/mp4'',''video/quicktime'',''video/webm'',''video/3gpp'')';
  f text; n text;
begin
  f:=pg_get_functiondef('public.add_task_attachment_with_audit(uuid,text)'::regprocedure);
  n:=replace(f,'v_mime not in '||v_old_types,'v_mime not in '||v_new_types);
  n:=replace(n,'v_size not between 1 and 10485760',
    'v_size<1 or v_size>52428800 or (v_size>10485760 and v_mime not like ''video/%'')');
  if n=f or position('52428800' in n)=0 or position('video/mp4' in n)=0 then
    raise exception 'Task video evidence upgrade failed: add_task_attachment_with_audit'; end if;
  execute n;

  f:=pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure);
  n:=replace(f,'coalesce(v_object.metadata->>''mimetype'','''') not in '||v_old_types,
    'coalesce(v_object.metadata->>''mimetype'','''') not in '||v_new_types);
  n:=replace(n,'coalesce((v_object.metadata->>''size'')::bigint,0) not between 1 and 10485760',
    '(coalesce((v_object.metadata->>''size'')::bigint,0) not between 1 and 52428800 or (coalesce((v_object.metadata->>''size'')::bigint,0)>10485760 and coalesce(v_object.metadata->>''mimetype'','''') not like ''video/%''))');
  if n=f or position('52428800' in n)=0 or position('video/mp4' in n)=0 then
    raise exception 'Task video evidence upgrade failed: complete_uploaded_task_with_audit'; end if;
  execute n;

  -- A completed imported task needs real proof; a registered video counts.
  f:=pg_get_functiondef('public.guard_task_lifecycle_and_import_proof()'::regprocedure);
  n:=replace(f,'coalesce(o.metadata->>''mimetype'','''') in '||v_old_types,
    'coalesce(o.metadata->>''mimetype'','''') in '||v_new_types);
  n:=replace(n,'coalesce((o.metadata->>''size'')::bigint,0) between 1 and 10485760',
    '(coalesce((o.metadata->>''size'')::bigint,0) between 1 and 10485760 or (coalesce(o.metadata->>''mimetype'','''') like ''video/%'' and coalesce((o.metadata->>''size'')::bigint,0) between 1 and 52428800))');
  if n=f or position('52428800' in n)=0 or position('video/mp4' in n)=0 then
    raise exception 'Task video evidence upgrade failed: guard_task_lifecycle_and_import_proof'; end if;
  execute n;
end $task_video_evidence$;

notify pgrst,'reload schema';
