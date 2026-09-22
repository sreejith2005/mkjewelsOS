begin;
select plan(6);

select has_function('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'audited task import RPC remains available');
select function_privs_are('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'authenticated',array['EXECUTE'],'authenticated import managers retain RPC access');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('16600000-0000-4000-8000-000000000001','authenticated','authenticated','admin-166@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('16610000-0000-4000-8000-000000000001','Import 166','import-166');
insert into public.branches(id,tenant_id,name,code) values('16620000-0000-4000-8000-000000000001','16610000-0000-4000-8000-000000000001','Import Branch 166','I166');
insert into public.departments(id,tenant_id,branch_id,name,code) values('16630000-0000-4000-8000-000000000001','16610000-0000-4000-8000-000000000001','16620000-0000-4000-8000-000000000001','Import Department 166','D166');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values('16640000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001','16610000-0000-4000-8000-000000000001','16620000-0000-4000-8000-000000000001','16630000-0000-4000-8000-000000000001','Import Admin 166','0000001661','admin-166@example.invalid','I166-1','admin','active','active',true);
insert into public.dropdown_masters(id,tenant_id,master_type,label,value,sort_order,created_by)
values('16650000-0000-4000-8000-000000000001','16610000-0000-4000-8000-000000000001','task_category','Import Category 166','import_category_166',1,'16640000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','16600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((public.begin_task_bulk_import(repeat('6',64),'optional-category.csv',2)->>'outcome'),'in_progress','admin starts optional-category batch');

select is(
  (public.commit_task_bulk_import_chunk(
    (select id from public.task_import_batches where import_hash=repeat('6',64)),
    jsonb_build_array(
      jsonb_build_object('source_row',2,'task_key','blank-category','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Synthetic blank category','description','','priority','medium','branch','I166','department','Import Department 166','category','','assignee_email','','assignee_profile_id','','assignee_name','','verifier_label','','verifier_profile_id','','starts_on','2026-09-22','start_time','09:00','due_time','10:00','planned_at','2026-09-22 09:00','due_at','2026-09-22 10:00','recurrence_rule','','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',true,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb),
      jsonb_build_object('source_row',3,'task_key','named-category','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Synthetic named category','description','','priority','medium','branch','I166','department','Import Department 166','category','Import Category 166','assignee_email','','assignee_profile_id','','assignee_name','','verifier_label','','verifier_profile_id','','starts_on','2026-09-22','start_time','11:00','due_time','12:00','planned_at','2026-09-22 11:00','due_at','2026-09-22 12:00','recurrence_rule','','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',true,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb)
    )
  )->>'created')::integer,
  2,
  'blank and named categories both import'
);

select is((select category_id from public.task_instances where title='Synthetic blank category'),null::uuid,'blank KRA remains uncategorized');
select is((select category_id from public.task_instances where title='Synthetic named category'),'16650000-0000-4000-8000-000000000001'::uuid,'matching KRA retains its category');

select * from finish();
rollback;
