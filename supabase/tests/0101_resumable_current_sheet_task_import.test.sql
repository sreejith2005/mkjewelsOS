begin;
select plan(18);

select has_table('public','task_import_items','resumable imports persist metadata-only item outcomes');
select has_column('public','task_import_items','row_hash','items retain only a canonical row hash');
select hasnt_column('public','task_import_items','payload','raw row payloads are never staged');
select hasnt_column('public','task_import_items','raw_content','raw source content is never staged');
select has_function('public','list_task_import_identity_candidates',array[]::text[],'identity mapping has a scoped candidate RPC');
select has_function('public','begin_task_bulk_import',array['text','text','integer'],'imports begin with metadata only');
select has_function('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'chunks are committed resumably');
select has_function('public','cancel_task_bulk_import',array['uuid'],'incomplete imports can be cancelled');
select has_function('public','get_task_import_batch_status',array['uuid'],'import progress is queryable');
select function_privs_are('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'authenticated',array['EXECUTE'],'authenticated import managers may commit chunks');
select function_privs_are('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'anon',array[]::text[],'anonymous users cannot import');
select table_privs_are('public','task_import_items','authenticated',array['SELECT'],'clients can only read permitted item metadata');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('10100000-0000-4000-8000-000000000001','authenticated','authenticated','import-admin@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('10100000-0000-4000-8000-000000000002','authenticated','authenticated','import-doer@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('10110000-0000-4000-8000-000000000001','Import Test','import-test');
insert into public.branches(id,tenant_id,name,code) values('10120000-0000-4000-8000-000000000001','10110000-0000-4000-8000-000000000001','Import Branch','IMB');
insert into public.departments(id,tenant_id,branch_id,name,code) values('10130000-0000-4000-8000-000000000001','10110000-0000-4000-8000-000000000001','10120000-0000-4000-8000-000000000001','Import Department','IMD');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values('10140000-0000-4000-8000-000000000001','10100000-0000-4000-8000-000000000001','10110000-0000-4000-8000-000000000001','10120000-0000-4000-8000-000000000001','10130000-0000-4000-8000-000000000001','Import Admin','0000000101','import-admin@example.invalid','IMP-1','admin','active','active',true),
 ('10140000-0000-4000-8000-000000000002','10100000-0000-4000-8000-000000000002','10110000-0000-4000-8000-000000000001','10120000-0000-4000-8000-000000000001','10130000-0000-4000-8000-000000000001','Import Doer','0000000102','import-doer@example.invalid','IMP-2','doer','active','active',true);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('10110000-0000-4000-8000-000000000001','task_category','Import Category','import_category',1,'10140000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((public.begin_task_bulk_import(repeat('a',64),'current-sheet.csv',2)->>'outcome'),'in_progress','metadata-only batch starts');
select is((public.commit_task_bulk_import_chunk((select id from public.task_import_batches where import_hash=repeat('a',64)),jsonb_build_array(
  jsonb_build_object('source_row',2,'task_key','once','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Assigned by admin','description','','priority','medium','branch','IMB','department','Import Department','category','Import Category','assignee_email','import-doer@example.invalid','assignee_profile_id','','assignee_name','Import Doer','verifier_label','','verifier_profile_id','','starts_on','2026-08-25','start_time','09:00','due_time','10:00','planned_at','2026-08-25 09:00','due_at','2026-08-25 10:00','recurrence_rule','','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'checklist','[]'::jsonb),
  jsonb_build_object('source_row',3,'task_key','daily','destination','recurring_todo','schedule_kind','daily','task_type','checklist','core_task_label','Daily core','title','Daily core','description','','priority','medium','branch','IMB','department','Import Department','category','Import Category','assignee_email','import-doer@example.invalid','assignee_profile_id','','assignee_name','Import Doer','verifier_label','','verifier_profile_id','','starts_on','2026-08-25','start_time','09:00','due_time','10:00','planned_at','2026-08-25 09:00','due_at','2026-08-25 10:00','recurrence_rule','FREQ=DAILY','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'checklist',jsonb_build_array(jsonb_build_object('item_text','Do daily work','required',true)))
))->>'created')::integer,2,'one-time task and recurring schedule commit in one chunk');
reset role;
select is((select count(*)::integer from public.task_import_items where outcome='created'),2,'one metadata item is stored per created row');
select is((select count(*)::integer from public.task_instances where title in ('Assigned by admin','Daily core')),2,'one-time and initial recurring instances are created');
select ok(exists(select 1 from public.task_instances where title='Assigned by admin' and task_type='delegation' and due_datetime>planned_datetime),'one-time delegation retains an independent due deadline');
select ok(exists(select 1 from public.task_instances where title='Daily core' and task_type='checklist' and task_template_id is not null),'recurring checklist reaches the ordinary task instance feed');

select * from finish();
rollback;
