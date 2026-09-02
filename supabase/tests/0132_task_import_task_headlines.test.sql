begin;
select plan(11);

select has_function('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'headline-safe bulk import remains available');
select function_privs_are('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'authenticated',array['EXECUTE'],'authenticated import managers retain commit access');
select function_privs_are('public','task_import_repair_checklist_headline',array['uuid','text','uuid'],'authenticated',array[]::text[],'browser clients cannot call the repair helper');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13200000-0000-4000-8000-000000000001','authenticated','authenticated','admin-132@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('13210000-0000-4000-8000-000000000001','Import 132','import-132');
insert into public.branches(id,tenant_id,name,code) values('13220000-0000-4000-8000-000000000001','13210000-0000-4000-8000-000000000001','Import Branch 132','I132');
insert into public.departments(id,tenant_id,branch_id,name,code) values('13230000-0000-4000-8000-000000000001','13210000-0000-4000-8000-000000000001','13220000-0000-4000-8000-000000000001','Import Department 132','D132');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values('13240000-0000-4000-8000-000000000001','13200000-0000-4000-8000-000000000001','13210000-0000-4000-8000-000000000001','13220000-0000-4000-8000-000000000001','13230000-0000-4000-8000-000000000001','Import Admin 132','0000001321','admin-132@example.invalid','I132-1','admin','active','active',true);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('13210000-0000-4000-8000-000000000001','task_category','Import Category 132','import_category_132',1,'13240000-0000-4000-8000-000000000001');

create function pg_temp.import_row(p_title text) returns jsonb language sql as $$
select jsonb_build_object('source_row',2,'task_key','checklist-row','destination','recurring_todo','schedule_kind','daily','task_type','checklist','core_task_label','Opening group','title',p_title,'description','Unlock before opening','priority','medium','branch','I132','department','Import Department 132','category','Import Category 132','assignee_email','admin-132@example.invalid','assignee_profile_id','','assignee_name','Import Admin 132','verifier_label','','verifier_profile_id','','starts_on',(now() at time zone 'Asia/Kolkata')::date::text,'start_time','09:00','due_time','10:00','planned_at',(now() at time zone 'Asia/Kolkata')::date::text||' 09:00','due_at',(now() at time zone 'Asia/Kolkata')::date::text||' 10:00','recurrence_rule','FREQ=DAILY','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigned','checklist',jsonb_build_array(jsonb_build_object('item_text','Open shutters','required',true)))
$$;
grant execute on function pg_temp.import_row(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','13200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is((public.begin_task_bulk_import(repeat('e',64),'old-132.csv',1)->>'outcome'),'in_progress','legacy-shaped import batch starts');
select is((public.commit_task_bulk_import_chunk((select id from public.task_import_batches where import_hash=repeat('e',64)),jsonb_build_array(pg_temp.import_row('Opening group')))->>'created')::integer,1,'legacy-shaped checklist is created once');
select is((public.begin_task_bulk_import(repeat('f',64),'new-132.csv',1)->>'outcome'),'in_progress','new parser hash starts a separate retry batch');
select is((public.commit_task_bulk_import_chunk((select id from public.task_import_batches where import_hash=repeat('f',64)),jsonb_build_array(pg_temp.import_row('Open shutters')))->>'replayed')::integer,1,'TASK headline retries through the legacy fingerprint without duplication');
select is((select count(*)::integer from public.task_templates where tenant_id='13210000-0000-4000-8000-000000000001'),1,'cross-file retry creates no duplicate template');
select is((select title||'|'||core_task_label||'|'||description from public.task_templates where tenant_id='13210000-0000-4000-8000-000000000001'),'Open shutters|Opening group|Unlock before opening','template stores TASK as headline and retains core task and description');
select is((select title||'|'||core_task_label||'|'||description from public.task_instances where tenant_id='13210000-0000-4000-8000-000000000001'),'Open shutters|Opening group|Unlock before opening','generated task card stores TASK as headline and retains further details');
select ok(exists(select 1 from public.audit_logs where tenant_id='13210000-0000-4000-8000-000000000001' and action='task_bulk_import_headline_corrected' and module='task_templates'),'headline correction is audited');

select * from finish();
rollback;
