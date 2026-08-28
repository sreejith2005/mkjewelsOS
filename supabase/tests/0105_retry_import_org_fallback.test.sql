begin;
select plan(10);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('10500000-0000-4000-8000-000000000001','authenticated','authenticated','admin-105@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('10500000-0000-4000-8000-000000000002','authenticated','authenticated','doer-105@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('10510000-0000-4000-8000-000000000001','Import 105','import-105');
insert into public.branches(id,tenant_id,name,code) values
 ('10520000-0000-4000-8000-000000000001','10510000-0000-4000-8000-000000000001','Import Branch 105','I105'),
 ('10520000-0000-4000-8000-000000000002','10510000-0000-4000-8000-000000000001','Target Branch 105','T105');
insert into public.departments(id,tenant_id,branch_id,name,code) values
 ('10530000-0000-4000-8000-000000000001','10510000-0000-4000-8000-000000000001',null,'Fallback Department 105','F105'),
 ('10530000-0000-4000-8000-000000000002','10510000-0000-4000-8000-000000000001',null,'Target Department 105','T105');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values
 ('10540000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000001','10510000-0000-4000-8000-000000000001','10520000-0000-4000-8000-000000000001','10530000-0000-4000-8000-000000000001','Import Admin 105','0000001051','admin-105@example.invalid','I105-1','admin','active','active',true),
 ('10540000-0000-4000-8000-000000000002','10500000-0000-4000-8000-000000000002','10510000-0000-4000-8000-000000000001','10520000-0000-4000-8000-000000000002','10530000-0000-4000-8000-000000000002','Import Doer 105','0000001052','doer-105@example.invalid','I105-2','doer','active','active',true);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('10510000-0000-4000-8000-000000000001','task_category','Import Category 105','import_category_105',1,'10540000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','10500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((public.begin_task_bulk_import(repeat('5',64),'retry-org.csv',2)->>'outcome'),'in_progress','admin starts retryable batch');

reset role;
insert into public.task_import_items(tenant_id,batch_id,source_row,row_hash,destination,outcome,error_code)
select '10510000-0000-4000-8000-000000000001',id,3,repeat('e',64),'recurring_todo','rejected','23503'
from public.task_import_batches where import_hash=repeat('5',64);
update public.task_import_batches set rejected_count=1,error_count=1,outcome='partial' where import_hash=repeat('5',64);
set local role authenticated;
select set_config('request.jwt.claim.sub','10500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

create temporary table result_105 as
select public.commit_task_bulk_import_chunk(
  (select id from public.task_import_batches where import_hash=repeat('5',64)),
  jsonb_build_array(
    jsonb_build_object('source_row',2,'task_key','assigned-wrong-org','destination','recurring_todo','schedule_kind','daily','task_type','checklist','core_task_label','Assigned wrong org','title',repeat('L',250),'description','','priority','medium','branch','Wrong branch label','department','Wrong designation label','category','','assignee_email','','assignee_profile_id','','assignee_name','Import Doer 105','verifier_label','','verifier_profile_id','','starts_on','2026-08-27','start_time','09:00','due_time','10:00','planned_at','2026-08-27 09:00','due_at','2026-08-27 10:00','recurrence_rule','FREQ=DAILY','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigned','checklist','[]'::jsonb),
    jsonb_build_object('source_row',3,'task_key','unassigned-designation','destination','recurring_todo','schedule_kind','daily','task_type','checklist','core_task_label','Unassigned designation','title','Unassigned designation','description','','priority','medium','branch','Import Branch 105','department','Unknown designation label','category','','assignee_email','','assignee_profile_id','','assignee_name','','verifier_label','','verifier_profile_id','','starts_on','2026-08-27','start_time','09:00','due_time','10:00','planned_at','2026-08-27 09:00','due_at','2026-08-27 10:00','recurrence_rule','FREQ=DAILY','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb)
  )
) value;

select is(((select value from result_105)->>'created')::integer,2,'mismatched organizational labels do not reject valid rows');
select is(((select value from result_105)->>'rejected')::integer,0,'retry has no rejected rows');
select is(((select value from result_105)->>'assigning_left_count')::integer,1,'the import reports the exact number of records still needing an assignee');
select ok(exists(select 1 from public.task_templates where length(title)=250 and branch_id='10520000-0000-4000-8000-000000000002' and department_id='10530000-0000-4000-8000-000000000002'),'matched assignee supplies authoritative scope and long task wording is preserved');
select ok(exists(select 1 from public.task_templates where title='Unassigned designation' and assignment_status='assigning_left' and branch_id='10520000-0000-4000-8000-000000000001' and department_id='10530000-0000-4000-8000-000000000001'),'unassigned row uses deterministic tenant fallback scope');
select is((select outcome from public.task_import_items where batch_id=(select id from public.task_import_batches where import_hash=repeat('5',64)) and source_row=3),'created','a previously rejected source row is retried instead of skipped');
select is((select outcome from public.task_import_batches where import_hash=repeat('5',64)),'completed','successful retry clears the partial batch state');
select is(public.assign_imported_task_with_audit('template',(select id from public.task_templates where title='Unassigned designation'),'10540000-0000-4000-8000-000000000002')->>'assignment_status','assigned','later assignment still resolves the queued schedule');
select ok(exists(select 1 from public.task_templates where title='Unassigned designation' and branch_id='10520000-0000-4000-8000-000000000002' and department_id='10530000-0000-4000-8000-000000000002'),'later assignment replaces fallback scope with the selected employee scope');

select * from finish();
rollback;
