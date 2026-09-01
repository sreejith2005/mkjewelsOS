begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

-- Synthetic fixtures only. No production rows or personal information.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_id,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from (values
 ('a1190000-0000-0000-0000-000000000001'::uuid,'p119-admin@example.invalid'),
 ('a1190000-0000-0000-0000-000000000002'::uuid,'p119-staff@example.invalid'),
 ('a1190000-0000-0000-0000-000000000003'::uuid,'p119-other-staff@example.invalid')
) fixture(auth_id,email);

insert into tenants(id,name,slug) values ('11190000-0000-0000-0000-000000000001','File Upload Tenant','file-upload-tenant');
insert into branches(id,tenant_id,name,code) values ('21190000-0000-0000-0000-000000000001','11190000-0000-0000-0000-000000000001','File Upload Branch','FUB1');
insert into departments(id,tenant_id,branch_id,name,code) values ('31190000-0000-0000-0000-000000000001','11190000-0000-0000-0000-000000000001','21190000-0000-0000-0000-000000000001','File Upload Dept','FUD1');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
values
 ('41190000-0000-0000-0000-000000000001','a1190000-0000-0000-0000-000000000001','11190000-0000-0000-0000-000000000001','21190000-0000-0000-0000-000000000001','31190000-0000-0000-0000-000000000001','File Upload Admin','9100000001','p119-admin@example.invalid','FU-1','admin','active',true),
 ('41190000-0000-0000-0000-000000000002','a1190000-0000-0000-0000-000000000002','11190000-0000-0000-0000-000000000001','21190000-0000-0000-0000-000000000001','31190000-0000-0000-0000-000000000001','File Upload Staff','9100000002','p119-staff@example.invalid','FU-2','staff','active',true),
 ('41190000-0000-0000-0000-000000000003','a1190000-0000-0000-0000-000000000003','11190000-0000-0000-0000-000000000001','21190000-0000-0000-0000-000000000001','31190000-0000-0000-0000-000000000001','File Upload Other Staff','9100000003','p119-other-staff@example.invalid','FU-3','staff','active',true);

-- Schema, ownership, grants and bucket privacy.
select has_table('public','form_submission_files','file upload metadata table exists');
select is((select public from storage.buckets where id='form-uploads'),false,'form-uploads bucket is private');
select is((select relrowsecurity from pg_class where oid='form_submission_files'::regclass),true,'form_submission_files has RLS enabled');
select ok(not has_table_privilege('authenticated','form_submission_files','INSERT,UPDATE,DELETE'),'authenticated cannot directly mutate upload metadata');
select ok(not has_table_privilege('anon','form_submission_files','SELECT,INSERT,UPDATE,DELETE'),'anon has no upload metadata privileges');
select function_owner_is('public','register_form_upload',array['uuid','text','text','text','text','bigint'],'postgres','register RPC owner is postgres');
select is((select prosecdef from pg_proc where oid='register_form_upload(uuid,text,text,text,text,bigint)'::regprocedure),true,'register RPC is security definer');
select ok(has_function_privilege('authenticated','register_form_upload(uuid,text,text,text,text,bigint)','EXECUTE'),'authenticated can execute register RPC');
select ok(not has_function_privilege('anon','register_form_upload(uuid,text,text,text,text,bigint)','EXECUTE'),'anon cannot execute register RPC');
select ok(has_function_privilege('authenticated','get_form_upload_path(uuid)','EXECUTE'),'authenticated can execute path lookup RPC');

-- A form with a file field can now be published (the deferred block is gone).
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000001',true);
select lives_ok($$select save_form_draft_with_audit(null,'{"name":"File Upload Form","permissions":{"roles":["staff"]}}',
  '[{"key":"proof","label":"Proof of purchase","type":"file","required":true},{"key":"note","label":"Note","type":"text"}]'::jsonb)$$,
  'admin drafts a form with a required file field');
select lives_ok($$select publish_form_with_audit((select id from form_templates where name='File Upload Form'))$$,'form with a file field publishes');
reset role;

-- Uploading before submission: staff owns the storage object, then registers it.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000002',true);
insert into storage.objects(bucket_id,name,owner,owner_id) values(
  'form-uploads',
  '11190000-0000-0000-0000-000000000001/'||(select id from form_templates where name='File Upload Form' and lifecycle='published')::text||'/synthetic.pdf',
  'a1190000-0000-0000-0000-000000000002','a1190000-0000-0000-0000-000000000002');
select throws_ok(format(
  'select register_form_upload(%L,%L,%L,%L,%L,%L)',
  (select id from form_templates where name='File Upload Form' and lifecycle='published'),'note',
  '11190000-0000-0000-0000-000000000001/'||(select id from form_templates where name='File Upload Form' and lifecycle='published')::text||'/synthetic.pdf',
  'synthetic.pdf','application/pdf',1024),'22023',null,'registering against a non-file field is rejected');
select is(
  register_form_upload(
    (select id from form_templates where name='File Upload Form' and lifecycle='published'),'proof',
    '11190000-0000-0000-0000-000000000001/'||(select id from form_templates where name='File Upload Form' and lifecycle='published')::text||'/synthetic.pdf',
    'synthetic.pdf','application/pdf',1024
  ) is not null,true,'staff registers the uploaded object');
select is((select count(*)::int from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002'),1,'upload metadata row is created');

select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000003',true);
select throws_ok($$select get_form_upload_path((select id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002'))$$,'42501',null,'a different staff member cannot resolve an unlinked upload path before submission');
reset role;
select is((select count(*)::int from audit_logs where action='form_file_uploaded'),1,'upload is audited transactionally');

-- Submitting the form links the upload; the same upload can never be reused.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000002',true);
select throws_ok(format(
  'select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='File Upload Form' and lifecycle='published'),
  jsonb_build_object('proof','00000000-0000-0000-0000-000000000000','note','x')
), '23503', null, 'submitting an unknown upload id is rejected');
select lives_ok(format(
  'select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='File Upload Form' and lifecycle='published'),
  jsonb_build_object('proof',(select id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002')::text,'note','ok')
), 'staff submits the form with the registered upload');
reset role;

select is((select data->>'proof' from form_submissions where submitted_by='41190000-0000-0000-0000-000000000002'),
  (select id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002')::text,'the submission answer stores the upload id');
select is((select form_submission_id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002'),
  (select id from form_submissions where submitted_by='41190000-0000-0000-0000-000000000002'),'the upload is linked to the exact submission it was submitted in');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000002',true);
select throws_ok(format(
  'select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='File Upload Form' and lifecycle='published'),
  jsonb_build_object('proof',(select id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002')::text,'note','again')
), '23503', null, 'an already-linked upload cannot be submitted a second time');

-- Once linked, whoever can read the submission can resolve the file path; an outsider cannot.
select is(get_form_upload_path((select id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002')),
  '11190000-0000-0000-0000-000000000001/'||(select id from form_templates where name='File Upload Form' and lifecycle='published')::text||'/synthetic.pdf',
  'the uploader can resolve the path once linked to their own submission');
select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000001',true);
select is(get_form_upload_path((select id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002')) is not null,true,
  'an admin who can read the submission can resolve the path too');
select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000003',true);
select throws_ok($$select get_form_upload_path((select id from form_submission_files where uploaded_by='41190000-0000-0000-0000-000000000002'))$$,'42501',null,'an uninvolved staff member cannot resolve the linked path');
reset role;

-- Required file fields are still enforced.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1190000-0000-0000-0000-000000000002',true);
select throws_ok(format(
  'select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='File Upload Form' and lifecycle='published'),
  jsonb_build_object('note','missing proof')
), '23514', null, 'a required file field cannot be skipped');
reset role;

set local role anon;
select throws_ok($$select register_form_upload(null,null,null,null,null,null)$$,'42501',null,'anon cannot execute the register RPC');
select throws_ok($$select get_form_upload_path(null)$$,'42501',null,'anon cannot execute the path lookup RPC');
reset role;

select * from finish();
rollback;
