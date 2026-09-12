begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(28);

select has_column('public','v_all_tasks','fms_work_source','task feed identifies the FMS work source');
select has_column('public','v_all_tasks','fms_instance_id','task feed carries the runtime instance identity');
select has_column('public','v_all_tasks','fms_instance_stage_id','task feed carries the runtime stage identity');
select has_column('public','v_all_tasks','fms_starter_assignment_id','task feed carries the exact starter assignment identity');
select ok(exists(select 1 from unnest(coalesce((select reloptions from pg_class where oid='public.v_all_tasks'::regclass),'{}'::text[])) option where option like 'security_invoker=%'),'task feed remains security invoker');
select ok(not has_table_privilege('anon','public.v_all_tasks','SELECT'),'anonymous callers cannot read the task feed');
select ok(has_table_privilege('authenticated','public.v_all_tasks','SELECT'),'authenticated callers retain task feed access');
select ok((select pg_get_viewdef('public.v_all_tasks'::regclass) like '%''fms_starter''::text%'),'task feed includes starter assignments');
select ok((select pg_get_viewdef('public.v_all_tasks'::regclass) like '%starter.status = ''pending''%'),'task feed excludes closed starter assignments');
select ok((select pg_get_viewdef('public.v_all_tasks'::regclass) like '%''fms_stage''::text%'),'task feed distinguishes runtime stages');
select ok(not exists(select 1 from pg_trigger where tgrelid='public.fms_instance_stage_assignees'::regclass and tgname='trg_notify_fms_stage_assignment' and not tgisinternal),'the duplicate legacy FMS notification trigger is removed');
select ok((select pg_get_functiondef('queue_fms_starter_assignments(uuid,uuid)'::regprocedure) like '%source_module%' and pg_get_functiondef('queue_fms_starter_assignments(uuid,uuid)'::regprocedure) like '%/tasks/fms?starter=%'),'starter notifications identify the durable assignment and focused route');
select ok((select pg_get_functiondef('emit_fms_stage_assignment_event()'::regprocedure) like '%&stage=%' and pg_get_functiondef('emit_fms_stage_assignment_event()'::regprocedure) like '%&form=%'),'runtime notification events carry the exact stage and optional pinned form');
select trigger_is('public','fms_starter_assignments','fms_starter_notification_completion','public','close_fms_starter_assignment_notification','starter completion closes its notification');
select trigger_is('public','fms_instance_stages','fms_stage_notification_completion','public','close_fms_stage_assignment_notification','runtime completion closes its notification');
select is((select proconfig from pg_proc where pronamespace='public'::regnamespace and proname='close_fms_starter_assignment_notification'),array['search_path=public, extensions']::text[],'starter notification trigger pins its search path');
select is((select proconfig from pg_proc where pronamespace='public'::regnamespace and proname='close_fms_stage_assignment_notification'),array['search_path=public, extensions']::text[],'runtime notification trigger pins its search path');

-- Row-level contract: the view is security invoker, so these prove the feed
-- itself refuses work that does not belong to the caller.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_id,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),'{}','{}',now(),now() from (values
 ('a5951000-0000-4000-8000-000000000001'::uuid,'awc-assignee@example.invalid'),
 ('a5951000-0000-4000-8000-000000000002'::uuid,'awc-colleague@example.invalid'),
 ('a5951000-0000-4000-8000-000000000003'::uuid,'awc-other-tenant@example.invalid')) x(auth_id,email);

insert into tenants(id,name,slug) values
 ('15952000-0000-4000-8000-000000000001','AWC Tenant A','awc-a'),
 ('15952000-0000-4000-8000-000000000002','AWC Tenant B','awc-b');
insert into branches(id,tenant_id,name,code) values
 ('25952000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','AWC Branch A','AWCA'),
 ('25952000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000002','AWC Branch B','AWCB');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('35952000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000001','AWC Dept A','AWCDA'),
 ('35952000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000002','25952000-0000-4000-8000-000000000002','AWC Dept B','AWCDB');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select pid,aid,tid,bid,did,label,mobile,email,code,role::user_role,'active'::working_status,true from (values
 ('45952000-0000-4000-8000-000000000001'::uuid,'a5951000-0000-4000-8000-000000000001'::uuid,'15952000-0000-4000-8000-000000000001'::uuid,'25952000-0000-4000-8000-000000000001'::uuid,'35952000-0000-4000-8000-000000000001'::uuid,'AWC Assignee','0000009001','awc-assignee@example.invalid','AWC-1','staff'),
 ('45952000-0000-4000-8000-000000000002','a5951000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000001','35952000-0000-4000-8000-000000000001','AWC Colleague','0000009002','awc-colleague@example.invalid','AWC-2','staff'),
 ('45952000-0000-4000-8000-000000000003','a5951000-0000-4000-8000-000000000003','15952000-0000-4000-8000-000000000002','25952000-0000-4000-8000-000000000002','35952000-0000-4000-8000-000000000002','AWC Other Tenant','0000009003','awc-other-tenant@example.invalid','AWC-3','staff')
) x(pid,aid,tid,bid,did,label,mobile,email,code,role);

insert into form_templates(id,tenant_id,name,created_by) values
 ('65952000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','AWC Starter Form','45952000-0000-4000-8000-000000000001');
insert into fms_flows(id,tenant_id,name,created_by) values
 ('75952000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','AWC Flow','45952000-0000-4000-8000-000000000001'),
 ('75952000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000001','AWC Flow Done','45952000-0000-4000-8000-000000000001'),
 ('75952000-0000-4000-8000-000000000003','15952000-0000-4000-8000-000000000001','AWC Flow Colleague','45952000-0000-4000-8000-000000000001');
-- Stage definitions are immutable once published, so author them first.
insert into fms_stages(id,fms_flow_id,name,sort_order,form_template_id) values
 ('85952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000001','AWC Starter Stage',1,'65952000-0000-4000-8000-000000000001');
-- Starters are only ever queued for a published, active flow, and `flow_select`
-- shows a non-admin nothing else, so the fixture must publish them.
update fms_flows set status='published', is_active=true, branch_id=null
where id in ('75952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000002','75952000-0000-4000-8000-000000000003');

-- One pending assignment for the caller, one already completed, one belonging
-- to a colleague in the same tenant.
insert into fms_starter_assignments(id,tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status,completed_at,completed_by) values
 ('15951000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000001','85952000-0000-4000-8000-000000000001','65952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000001','pending',null,null),
 ('15951000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000002','85952000-0000-4000-8000-000000000001','65952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000001','completed',now(),'45952000-0000-4000-8000-000000000001'),
 ('15951000-0000-4000-8000-000000000003','15952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000003','85952000-0000-4000-8000-000000000001','65952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000002','pending',null,null);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000001',true);

select is(
  (select count(*)::integer from public.v_all_tasks
   where id='15951000-0000-4000-8000-000000000001' and fms_work_source='fms_starter'),
  1,'pending starter assignment is visible to its assignee');
select is(
  (select fms_starter_assignment_id from public.v_all_tasks where id='15951000-0000-4000-8000-000000000001'),
  '15951000-0000-4000-8000-000000000001'::uuid,'the starter row carries its own durable assignment identity');
select is(
  (select form_template_id from public.v_all_tasks where id='15951000-0000-4000-8000-000000000001'),
  '65952000-0000-4000-8000-000000000001'::uuid,'the starter row pins the exact form to open');
select ok(
  (select requires_form and status='pending' and task_type='fms'
   from public.v_all_tasks where id='15951000-0000-4000-8000-000000000001'),
  'the starter row is actionable FMS work requiring its form');
select ok(
  not exists(select 1 from public.v_all_tasks where id='15951000-0000-4000-8000-000000000002'),
  'completed starter assignment is absent');
select ok(
  not exists(select 1 from public.v_all_tasks where id='15951000-0000-4000-8000-000000000003'),
  'another users starter assignment stays invisible');

reset role;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000003',true);
set local role authenticated;
select ok(
  not exists(select 1 from public.v_all_tasks where id='15951000-0000-4000-8000-000000000001'),
  'a different tenant cannot see the starter assignment');
reset role;


-- Completion closes only the notification for the work that was completed, and
-- keeps it in history rather than deleting it.
insert into notifications(id,tenant_id,user_profile_id,event_type,title,message,source_module,source_record_id,is_read) values
 ('95952000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000001','fms_starter_assigned','Starter assigned','Complete the starting form','fms','15951000-0000-4000-8000-000000000001',false),
 ('95952000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000002','fms_starter_assigned','Starter assigned','Complete the starting form','fms','15951000-0000-4000-8000-000000000003',false);

update fms_starter_assignments
set status='completed', completed_at=now(), completed_by='45952000-0000-4000-8000-000000000001'
where id='15951000-0000-4000-8000-000000000001';

select ok(
  (select is_read from notifications where id='95952000-0000-4000-8000-000000000001'),
  'completing a starter assignment marks its own notification read');
select ok(
  (select read_at is not null from notifications where id='95952000-0000-4000-8000-000000000001'),
  'the closed notification records when it was read');
select ok(
  exists(select 1 from notifications where id='95952000-0000-4000-8000-000000000001'),
  'the closed notification is preserved as history rather than deleted');
select ok(
  (select not is_read from notifications where id='95952000-0000-4000-8000-000000000002'),
  'another recipients notification for different work stays unread');


select * from finish();
rollback;
