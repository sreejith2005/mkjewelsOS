begin;
select plan(22);

select has_column('public','v_all_tasks','scheduled_date','feed exposes the instance schedule date');
select has_column('public','v_all_tasks','assignment_status','feed exposes durable assignment state');
select has_column('public','v_all_tasks','buddy_assignment_allowed','feed exposes the buddy rule');
select has_column('public','v_all_tasks','verification_status','feed exposes verification state');
select has_column('public','v_all_tasks','branch_name','feed exposes the authorized branch name');
select has_column('public','v_all_tasks','department_name','feed exposes the authorized department name');
select has_column('public','v_all_tasks','schedule_kind','feed exposes the template schedule kind');
select has_column('public','v_all_tasks','starts_on','feed exposes the template start date');
select has_column('public','v_all_tasks','planned_time','feed exposes the template planned time');
select has_column('public','v_all_tasks','due_time','feed exposes the template due time');
select has_column('public','v_all_tasks','is_active','feed exposes the template active state');
select has_column('public','v_all_tasks','verification_required','feed exposes the template verification rule');
select ok(exists(select 1 from unnest(coalesce((select reloptions from pg_class where oid='public.v_all_tasks'::regclass),'{}'::text[])) option where option like 'security_invoker=%'),'the unified feed remains a security-invoker view');
select ok(not has_table_privilege('anon','public.v_all_tasks','SELECT'),'anonymous callers have no feed grant');
select ok(has_table_privilege('authenticated','public.v_all_tasks','SELECT'),'authenticated callers retain read access');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('13100000-0000-4000-8000-000000000001','authenticated','authenticated','doer-131@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('13100000-0000-4000-8000-000000000002','authenticated','authenticated','manager-131@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('13100000-0000-4000-8000-000000000003','authenticated','authenticated','other-131@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values
 ('13110000-0000-4000-8000-000000000001','Task Feed 131 A','task-feed-131-a'),
 ('13110000-0000-4000-8000-000000000002','Task Feed 131 B','task-feed-131-b');
insert into public.branches(id,tenant_id,name,code) values
 ('13120000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001','Pune Camp 131','P131'),
 ('13120000-0000-4000-8000-000000000002','13110000-0000-4000-8000-000000000002','Other Branch 131','O131');
insert into public.departments(id,tenant_id,branch_id,name,code) values
 ('13130000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','Retail Operations 131','R131'),
 ('13130000-0000-4000-8000-000000000002','13110000-0000-4000-8000-000000000002','13120000-0000-4000-8000-000000000002','Other Department 131','D131');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values
 ('13140000-0000-4000-8000-000000000001','13100000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13130000-0000-4000-8000-000000000001','Task Doer 131','0000001311','doer-131@example.invalid','TF131-1','doer','active','active',true),
 ('13140000-0000-4000-8000-000000000002','13100000-0000-4000-8000-000000000002','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13130000-0000-4000-8000-000000000001','Task Manager 131','0000001312','manager-131@example.invalid','TF131-2','manager','active','active',true),
 ('13140000-0000-4000-8000-000000000003','13100000-0000-4000-8000-000000000003','13110000-0000-4000-8000-000000000002','13120000-0000-4000-8000-000000000002','13130000-0000-4000-8000-000000000002','Other Doer 131','0000001313','other-131@example.invalid','TF131-3','doer','active','active',true);

insert into public.task_templates(id,tenant_id,branch_id,department_id,title,description,task_type,recurrence_rule,planned_time,due_time,priority,default_assignee_type,default_assignee_user_id,checklist_items,requires_upload,is_active,schedule_kind,starts_on,verification_required,verifier_user_profile_id,buddy_assignment_allowed,core_task_label,created_by,updated_by,assignment_status)
values('13150000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13130000-0000-4000-8000-000000000001','Daily opening 131','Open the showroom','checklist','FREQ=DAILY','09:00','10:00','high','specific_user','13140000-0000-4000-8000-000000000001','[]',true,true,'daily','2026-09-01',true,'13140000-0000-4000-8000-000000000002',false,'Showroom opening','13140000-0000-4000-8000-000000000002','13140000-0000-4000-8000-000000000002','assigned');

insert into public.task_instances(id,tenant_id,branch_id,department_id,task_template_id,task_type,title,description,priority,status,planned_datetime,scheduled_date,due_datetime,source,created_by,buddy_assignment_allowed,assignment_status)
values
 ('13160000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13130000-0000-4000-8000-000000000001','13150000-0000-4000-8000-000000000001','checklist','Daily opening 131','Open the showroom','high','pending','2026-09-02 09:00 Asia/Kolkata','2026-09-02','2026-09-02 10:00 Asia/Kolkata','bulk_import','13140000-0000-4000-8000-000000000002',false,'assigned'),
 ('13160000-0000-4000-8000-000000000002','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13130000-0000-4000-8000-000000000001',null,'delegation','One time 131',null,'medium','pending','2026-09-02 11:00 Asia/Kolkata',null,'2026-09-02 12:00 Asia/Kolkata','manual','13140000-0000-4000-8000-000000000002',true,'assigned'),
 ('13160000-0000-4000-8000-000000000003','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13130000-0000-4000-8000-000000000001',null,'delegation','Manager only 131',null,'medium','pending','2026-09-02 13:00 Asia/Kolkata',null,'2026-09-02 14:00 Asia/Kolkata','manual','13140000-0000-4000-8000-000000000002',true,'assigned'),
 ('13160000-0000-4000-8000-000000000004','13110000-0000-4000-8000-000000000002','13120000-0000-4000-8000-000000000002','13130000-0000-4000-8000-000000000002',null,'delegation','Cross tenant 131',null,'medium','pending','2026-09-02 15:00 Asia/Kolkata',null,'2026-09-02 16:00 Asia/Kolkata','manual','13140000-0000-4000-8000-000000000003',true,'assigned');
insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_active)
values
 ('13160000-0000-4000-8000-000000000001','13140000-0000-4000-8000-000000000001','doer',true),
 ('13160000-0000-4000-8000-000000000002','13140000-0000-4000-8000-000000000001','doer',true),
 ('13160000-0000-4000-8000-000000000003','13140000-0000-4000-8000-000000000002','doer',true),
 ('13160000-0000-4000-8000-000000000004','13140000-0000-4000-8000-000000000003','doer',true);

insert into public.fms_flows(id,tenant_id,branch_id,department_id,name,status,created_by)
values('13170000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13130000-0000-4000-8000-000000000001','Synthetic flow 131','draft','13140000-0000-4000-8000-000000000002');
insert into public.fms_stages(id,fms_flow_id,name,method,sort_order)
values('13171000-0000-4000-8000-000000000001','13170000-0000-4000-8000-000000000001','Inspect order 131','Inspect safely',1);
update public.fms_flows set status='published',published_by='13140000-0000-4000-8000-000000000002' where id='13170000-0000-4000-8000-000000000001';
insert into public.fms_instances(id,tenant_id,branch_id,fms_flow_id,reference_number,title,status,started_by)
values('13172000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001','13120000-0000-4000-8000-000000000001','13170000-0000-4000-8000-000000000001','FMS-131','Synthetic FMS 131','active','13140000-0000-4000-8000-000000000002');
insert into public.fms_instance_stages(id,fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime)
values('13173000-0000-4000-8000-000000000001','13172000-0000-4000-8000-000000000001','13171000-0000-4000-8000-000000000001','pending',array['13140000-0000-4000-8000-000000000001'::uuid],'2026-09-02 17:00 Asia/Kolkata');

set local role authenticated;
select set_config('request.jwt.claim.sub','13100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is((select count(*)::integer from public.v_all_tasks),3,'ordinary assignee sees only two assigned tasks and the assigned FMS stage');
select is(
  (select jsonb_build_object('schedule_kind',schedule_kind,'starts_on',starts_on,'planned_time',planned_time,'due_time',due_time,'is_active',is_active,'verification_required',verification_required,'verification_status',verification_status,'buddy_assignment_allowed',buddy_assignment_allowed,'assignment_status',assignment_status) from public.v_all_tasks where id='13160000-0000-4000-8000-000000000001'),
  jsonb_build_object('schedule_kind','daily','starts_on','2026-09-01'::date,'planned_time','09:00'::time,'due_time','10:00'::time,'is_active',true,'verification_required',true,'verification_status','pending','buddy_assignment_allowed',false,'assignment_status','assigned'),
  'recurring instance includes its instance rules and authorized template context'
);
select is((select branch_name||'|'||department_name from public.v_all_tasks where id='13160000-0000-4000-8000-000000000001'),'Pune Camp 131|Retail Operations 131','organization names match the task scope');
select ok((select schedule_kind is null and starts_on is null and planned_time is null and due_time is null and is_active is null and verification_required is null from public.v_all_tasks where id='13160000-0000-4000-8000-000000000002'),'one-time task returns safe null template context');
select ok(not exists(select 1 from public.v_all_tasks where id in ('13160000-0000-4000-8000-000000000003','13160000-0000-4000-8000-000000000004')),'unrelated and cross-tenant task rows remain invisible');
select ok((select schedule_kind is null and starts_on is null and planned_time is null and due_time is null and is_active is null and verification_required is null from public.v_all_tasks where id='13173000-0000-4000-8000-000000000001'),'FMS rows remain queryable without invented schedule context');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
select throws_ok('select * from public.v_all_tasks','42501',null,'anonymous feed access is denied');

select * from finish();
rollback;
