begin;
select plan(14);

select has_function('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'checklist-safe bulk import remains available');
select function_privs_are('public','commit_task_bulk_import_chunk',array['uuid','jsonb'],'authenticated',array['EXECUTE'],'authenticated import managers retain commit access');
select function_privs_are('public','task_import_repair_checklist_evidence',array['uuid','uuid'],'authenticated',array[]::text[],'browser clients cannot call the evidence repair helper');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('14800000-0000-4000-8000-000000000001','authenticated','authenticated','admin-148@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('14810000-0000-4000-8000-000000000001','Import 148','import-148');
insert into public.branches(id,tenant_id,name,code) values('14820000-0000-4000-8000-000000000001','14810000-0000-4000-8000-000000000001','Import Branch 148','I148');
insert into public.departments(id,tenant_id,branch_id,name,code) values('14830000-0000-4000-8000-000000000001','14810000-0000-4000-8000-000000000001','14820000-0000-4000-8000-000000000001','Import Department 148','D148');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values('14840000-0000-4000-8000-000000000001','14800000-0000-4000-8000-000000000001','14810000-0000-4000-8000-000000000001','14820000-0000-4000-8000-000000000001','14830000-0000-4000-8000-000000000001','Import Admin 148','0000001481','admin-148@example.invalid','I148-1','admin','active','active',true);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('14810000-0000-4000-8000-000000000001','task_category','Import Category 148','import_category_148',1,'14840000-0000-4000-8000-000000000001');

create function pg_temp.import_row(p_source_row integer,p_task_key text,p_task_type text,p_destination text,p_schedule_kind text,p_title text) returns jsonb language sql as $$
select jsonb_build_object(
  'source_row',p_source_row,'task_key',p_task_key,'destination',p_destination,'schedule_kind',p_schedule_kind,
  'task_type',p_task_type,'core_task_label','Opening group','title',p_title,'description','Unlock before opening',
  'priority','medium','branch','I148','department','Import Department 148','category','Import Category 148',
  'assignee_email','admin-148@example.invalid','assignee_profile_id','','assignee_name','Import Admin 148',
  'verifier_label','','verifier_profile_id','','starts_on',(now() at time zone 'Asia/Kolkata')::date::text,
  'start_time','09:00','due_time','10:00','planned_at',(now() at time zone 'Asia/Kolkata')::date::text||' 09:00',
  'due_at',(now() at time zone 'Asia/Kolkata')::date::text||' 10:00',
  'recurrence_rule',case when p_schedule_kind='daily' then 'FREQ=DAILY' else null end,
  'requires_upload',true,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,
  'assignment_status','assigned','checklist',jsonb_build_array(jsonb_build_object('item_text',p_title,'required',true))
)
$$;
grant execute on function pg_temp.import_row(integer,text,text,text,text,text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','14800000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is((public.begin_task_bulk_import(repeat('8',64),'checklist-148.csv',2)->>'outcome'),'in_progress','mixed import batch starts');
select is((public.commit_task_bulk_import_chunk(
  (select id from public.task_import_batches where import_hash=repeat('8',64)),
  jsonb_build_array(
    pg_temp.import_row(2,'checklist-row','checklist','recurring_todo','daily','Open the showroom'),
    pg_temp.import_row(3,'task-row','delegation','tasks','one_time','Photograph the showroom')
  )
)->>'created')::integer,2,'checklist and task are imported');
select is((select requires_upload from public.task_templates where tenant_id='14810000-0000-4000-8000-000000000001' and task_type='checklist'),false,'imported checklist template is click-to-complete');
select is((select requires_upload from public.task_instances where tenant_id='14810000-0000-4000-8000-000000000001' and task_type='checklist'),false,'generated checklist occurrence is click-to-complete');
select is((select requires_upload from public.task_instances where tenant_id='14810000-0000-4000-8000-000000000001' and task_type='delegation'),true,'genuine imported task keeps its evidence requirement');
select ok(exists(select 1 from public.audit_logs where tenant_id='14810000-0000-4000-8000-000000000001' and action='task_bulk_import_checklist_evidence_corrected' and module='task_templates'),'template evidence correction is audited');
select ok(exists(select 1 from public.audit_logs where tenant_id='14810000-0000-4000-8000-000000000001' and action='task_bulk_import_checklist_evidence_corrected' and module='tasks'),'occurrence evidence correction is audited');

select is((public.begin_task_bulk_import(repeat('9',64),'checklist-retry-148.csv',2)->>'outcome'),'in_progress','cross-file retry batch starts');
select is((public.commit_task_bulk_import_chunk(
  (select id from public.task_import_batches where import_hash=repeat('9',64)),
  jsonb_build_array(
    pg_temp.import_row(2,'checklist-row','checklist','recurring_todo','daily','Open the showroom'),
    pg_temp.import_row(3,'task-row','delegation','tasks','one_time','Photograph the showroom')
  )
)->>'replayed')::integer,2,'raw evidence field remains fingerprint-compatible on retry');
select is((select count(*)::integer from public.task_templates where tenant_id='14810000-0000-4000-8000-000000000001'),1,'retry creates no duplicate checklist template');
select is((select count(*)::integer from public.task_instances where tenant_id='14810000-0000-4000-8000-000000000001'),2,'retry creates no duplicate occurrences or tasks');

select * from finish();
rollback;
