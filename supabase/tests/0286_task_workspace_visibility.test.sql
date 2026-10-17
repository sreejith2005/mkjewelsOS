begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(17);
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
insert into branches(id,tenant_id,name,code) values
 ('25952000-0000-4000-8000-000000000003','15952000-0000-4000-8000-000000000001','Other branch','AWCX');
update fms_flows set scope_type='branch',branch_id='25952000-0000-4000-8000-000000000003'
where id='75952000-0000-4000-8000-000000000001';
-- Starters are only ever queued for a published, active flow, and `flow_select`
-- shows a non-admin nothing else, so the fixture must publish them.
update fms_flows set status='published', is_active=true
where id in ('75952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000002','75952000-0000-4000-8000-000000000003');

-- One pending assignment for the caller, one already completed, one belonging
-- to a colleague in the same tenant.
insert into fms_starter_assignments(id,tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status,completed_at,completed_by) values
 ('15951000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000001','85952000-0000-4000-8000-000000000001','65952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000001','pending',null,null),
 ('15951000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000002','85952000-0000-4000-8000-000000000001','65952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000001','completed',now(),'45952000-0000-4000-8000-000000000001'),
 ('15951000-0000-4000-8000-000000000003','15952000-0000-4000-8000-000000000001','75952000-0000-4000-8000-000000000003','85952000-0000-4000-8000-000000000001','65952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000002','pending',null,null);


insert into fms_instances(id,tenant_id,branch_id,fms_flow_id,reference_number,title,started_by) values
 ('96952000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000003',
  '75952000-0000-4000-8000-000000000001','TASK-FMS-TEST','Synthetic assigned runtime','45952000-0000-4000-8000-000000000001');
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime) values
 ('97952000-0000-4000-8000-000000000001','96952000-0000-4000-8000-000000000001','85952000-0000-4000-8000-000000000001',
  'in_progress',array['45952000-0000-4000-8000-000000000001']::uuid[],now()-interval '1 day'),
 ('97952000-0000-4000-8000-000000000002','96952000-0000-4000-8000-000000000001','85952000-0000-4000-8000-000000000001',
  'pending','{}',null);
update fms_starter_assignments set created_at=now()-interval '1 day';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from v_all_tasks where id='97952000-0000-4000-8000-000000000001'),1,
  'cross-branch assigned runtime definition is readable');
reset role;
-- Persisted assigned work must survive archival of the definition version.
update fms_flows set status='archived',is_active=false
where id='75952000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from v_all_tasks where id='15951000-0000-4000-8000-000000000001'),1,
  'assigned archived-version starter remains hydratable');
select is((select count(*)::integer from fms_stages where id='85952000-0000-4000-8000-000000000001'),1,
  'assigned employee can read the pinned work definition');
select is((task_feed_page('mine','overdue')->>'total')::integer,2,'page count includes the persisted starter');
select is((select count(*)::integer from v_all_tasks where id in
  (select jsonb_array_elements_text(task_feed_page('mine','overdue')->'ids')::uuid)),2,
  'counted starter has a visible card');
select is((select count(*)::integer from v_all_tasks where id='97952000-0000-4000-8000-000000000001'),1,
  'archived runtime version remains hydratable');
select throws_ok($$select task_feed_page('all','pending')$$,'42501','All tasks access denied','ordinary user cannot access admin counts');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from fms_flows where id='75952000-0000-4000-8000-000000000001'),0,
  'unrelated colleague cannot read the archived definition');
select is((select count(*)::integer from v_all_tasks where id='15951000-0000-4000-8000-000000000001'),0,
  'unrelated colleague cannot read the assignment');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from fms_flows where id='75952000-0000-4000-8000-000000000001'),0,
  'cross-tenant definition read denied');
reset role;
update user_profiles set is_login_enabled=false where id='45952000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from fms_flows where id='75952000-0000-4000-8000-000000000001'),0,
  'inactive assignee cannot read the definition');
reset role;
update user_profiles set is_login_enabled=true where id='45952000-0000-4000-8000-000000000001';
update user_profiles set user_role='admin' where id='45952000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000002',true);
select ok(not (task_feed_page('all','pending')->'ids' ? '97952000-0000-4000-8000-000000000002'),
 'unassigned runtime placeholders do not inflate counts');
select is((select count(*)::integer from v_all_tasks where id='97952000-0000-4000-8000-000000000001'),1,
 'administrator retains runtime visibility');
reset role;
set local role anon;
select throws_ok($$select * from v_all_tasks$$,'42501',null,'anonymous feed read denied');
select throws_ok($$select task_feed_page('mine','pending')$$,'42501',null,'anonymous page access denied');
reset role;
select ok(not has_function_privilege('service_role','task_feed_page(text,text,integer,integer)','EXECUTE'),
 'service role does not gain an actor page grant');
select ok(not has_table_privilege('anon','fms_flows','SELECT'),'anonymous definition read denied');
select * from finish();
rollback;
