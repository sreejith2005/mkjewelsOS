begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(14);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('25900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'video-259-'||n||'@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,2) n;
insert into tenants(id,name,slug) values('25910000-0000-4000-8000-000000000001','Video 259','video-259');
insert into branches(id,tenant_id,name,code) values
 ('25920000-0000-4000-8000-000000000001','25910000-0000-4000-8000-000000000001','Video Branch','V259');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('25930000-0000-4000-8000-000000000001','25910000-0000-4000-8000-000000000001','25920000-0000-4000-8000-000000000001','Video Department','D259');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
select ('25940000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('25900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '25910000-0000-4000-8000-000000000001','25920000-0000-4000-8000-000000000001','25930000-0000-4000-8000-000000000001',
 'Video staff '||n,'000000259'||n,'video-259-'||n||'@example.invalid','V259-'||n,'staff','active','active',true from generate_series(1,2) n;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,due_datetime,requires_upload,created_by)
select ('25950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'25910000-0000-4000-8000-000000000001',
 '25920000-0000-4000-8000-000000000001','25930000-0000-4000-8000-000000000001','delegation','Video task '||n,'pending',
 now()+interval '1 hour',now()+interval '2 hours',true,'25940000-0000-4000-8000-000000000001' from generate_series(1,2) n;
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active)
select ('25950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'25940000-0000-4000-8000-000000000001','doer',true from generate_series(1,2) n;

-- Storage records the type and size the browser sent; the contracts trust only that.
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('task-attachments','25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/clip.mp4',
  '25900000-0000-4000-8000-000000000001','{"mimetype":"video/mp4","size":31457280}'),
 ('task-attachments','25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/iphone.mov',
  '25900000-0000-4000-8000-000000000001','{"mimetype":"video/quicktime","size":1048576}'),
 ('task-attachments','25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/huge.mp4',
  '25900000-0000-4000-8000-000000000001','{"mimetype":"video/mp4","size":52428801}'),
 ('task-attachments','25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/big.pdf',
  '25900000-0000-4000-8000-000000000001','{"mimetype":"application/pdf","size":20971520}'),
 ('task-attachments','25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/anim.gif',
  '25900000-0000-4000-8000-000000000001','{"mimetype":"image/gif","size":1024}'),
 ('task-attachments','25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000002/proof.mp4',
  '25900000-0000-4000-8000-000000000001','{"mimetype":"video/mp4","size":20971520}');

select is((select file_size_limit from storage.buckets where id='task-attachments'),52428800::bigint,
  'the task attachment bucket admits a 50 MB video');
select ok((select allowed_mime_types @> array['video/mp4','video/quicktime','video/webm','video/3gpp']
  and allowed_mime_types @> array['image/jpeg','image/png','image/webp','application/pdf']
  from storage.buckets where id='task-attachments'),'the bucket keeps image/PDF types and accepts videos');
select function_privs_are('public','add_task_attachment_with_audit',array['uuid','text'],'anon',array[]::text[],
  'anon still cannot register task evidence');

set local role authenticated;
select set_config('request.jwt.claim.sub','25900000-0000-4000-8000-000000000001',true);
select lives_ok($$select add_task_attachment_with_audit('25950000-0000-4000-8000-000000000001',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/clip.mp4')$$,
  'the doer registers a 30 MB MP4 as evidence');
select lives_ok($$select add_task_attachment_with_audit('25950000-0000-4000-8000-000000000001',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/iphone.mov')$$,
  'an iPhone QuickTime clip is accepted');
select throws_ok($$select add_task_attachment_with_audit('25950000-0000-4000-8000-000000000001',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/huge.mp4')$$,
  '22023','Invalid task attachment metadata','a video over 50 MB is refused');
select throws_ok($$select add_task_attachment_with_audit('25950000-0000-4000-8000-000000000001',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/big.pdf')$$,
  '22023','Invalid task attachment metadata','a PDF keeps its 10 MB limit');
select throws_ok($$select add_task_attachment_with_audit('25950000-0000-4000-8000-000000000001',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000001/anim.gif')$$,
  '22023','Invalid task attachment metadata','unlisted types remain refused');
select is((select mime_type from task_attachments where file_url like '%/clip.mp4'),'video/mp4',
  'the registered video records its MIME type for the evidence views');

-- A colleague who is not on the task still cannot attach to it.
select set_config('request.jwt.claim.sub','25900000-0000-4000-8000-000000000002',true);
select throws_ok($$select add_task_attachment_with_audit('25950000-0000-4000-8000-000000000002',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000002/proof.mp4')$$,
  '42501',null,'a non-participant cannot register video evidence');
select throws_ok($$select complete_uploaded_task_with_audit('25950000-0000-4000-8000-000000000002',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000002/proof.mp4')$$,
  '42501',null,'a non-participant cannot complete with video evidence');

-- The one-shot Upload button records the video and completes the task together.
select set_config('request.jwt.claim.sub','25900000-0000-4000-8000-000000000001',true);
select lives_ok($$select complete_uploaded_task_with_audit('25950000-0000-4000-8000-000000000002',
  '25910000-0000-4000-8000-000000000001/25950000-0000-4000-8000-000000000002/proof.mp4')$$,
  'the doer completes a task with a video');
reset role;
select is((select status::text from task_instances where id='25950000-0000-4000-8000-000000000002'),'completed',
  'the task is completed by its video evidence');
select is((select count(*)::integer from task_attachments where task_instance_id='25950000-0000-4000-8000-000000000002' and mime_type='video/mp4'),1,
  'the completing video is recorded as the task attachment');

select * from finish();
rollback;
