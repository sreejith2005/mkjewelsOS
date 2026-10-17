begin;
set local search_path=public,extensions;
select plan(26);
select has_function('public','task_workspace_page',array['jsonb','integer','integer'],'filtered workspace RPC exists');
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

insert into task_instances(id,tenant_id,branch_id,task_type,title,description,status,planned_datetime,created_by,source,requires_upload,priority) values
 ('98952000-0000-4000-8000-000000000001','15952000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000001','checklist','Silver showroom','50%_ silver opening','pending',now()+interval '1 day','45952000-0000-4000-8000-000000000001','manual',true,'high'),
 ('98952000-0000-4000-8000-000000000002','15952000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000001','checklist','Silver CRM visit','Historical follow-up','completed',now()-interval '60 days','45952000-0000-4000-8000-000000000002','crm_walkin',false,'low'),
 ('98952000-0000-4000-8000-000000000003','15952000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000001','checklist','Silver watched task','Watch only','pending',now()+interval '1 day','45952000-0000-4000-8000-000000000002','manual',false,'medium'),
 ('98952000-0000-4000-8000-000000000004','15952000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000001','checklist','Silver private task','Another employee only','pending',now(),'45952000-0000-4000-8000-000000000002','manual',false,'medium');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values
 ('98952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000001','doer',true,true),
 ('98952000-0000-4000-8000-000000000002','45952000-0000-4000-8000-000000000001','doer',true,true),
 ('98952000-0000-4000-8000-000000000003','45952000-0000-4000-8000-000000000002','doer',true,true),
 ('98952000-0000-4000-8000-000000000004','45952000-0000-4000-8000-000000000002','doer',true,true);
insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by) values('15952000-0000-4000-8000-000000000001','98952000-0000-4000-8000-000000000003','45952000-0000-4000-8000-000000000001','45952000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000001',true);
select is((task_workspace_page('{"query":"silver"}')->>'total')::integer,3,'global search combines delegated and watched work with history');
select is((task_workspace_page('{"query":"silver","kind":"crm"}')->>'total')::integer,1,'CRM filter includes old completed records');
select is((task_workspace_page('{"query":"50%_"}')->>'total')::integer,1,'percent and underscore search literally');
select is((task_workspace_page('{"query":"silver","priority":"high","requirement":"upload"}')->>'total')::integer,1,'filters combine');
select is((task_workspace_page('{"query":"silver","subsection":"inLoop"}')->>'total')::integer,1,'subsection filter narrows global search');
select is(task_workspace_page('{"query":"watched"}')->'sections'->>'98952000-0000-4000-8000-000000000003','inLoop','results label their original subsection');
select is((task_workspace_page('{"query":"silver","status":"completed"}')->>'total')::integer,1,'completed history is searchable');
select is((task_workspace_page('{"query":"silver"}',0,1)->>'total')::integer,3,'paging retains the full count');
select is(jsonb_array_length(task_workspace_page('{"query":"silver"}',0,1)->'ids'),1,'hydration is bounded');
select isnt(task_workspace_page('{"query":"silver"}',0,1)->'ids',task_workspace_page('{"query":"silver"}',1,1)->'ids','pages have stable distinct IDs');
select is((task_workspace_page('{"query":"TASK-FMS-TEST","kind":"fms"}')->>'total')::integer,1,'workflow reference search finds an assigned runtime');
select is((task_workspace_page(jsonb_build_object('query','silver','from',((now()+interval '1 day') at time zone 'Asia/Kolkata')::date::text,'to',((now()+interval '1 day') at time zone 'Asia/Kolkata')::date::text))->>'total')::integer,2,'inclusive business-day dates filter all subsections');
select is(task_workspace_page('{"query":"silver","sort":"priority"}')->'ids'->>0,'98952000-0000-4000-8000-000000000001','highest priority comes first');
select throws_ok($$select task_workspace_page('{"query":12}')$$,'22023','Invalid task filters','non-string filter rejected');
select throws_ok($$select task_workspace_page('{"from":"2026-10-20","to":"2026-10-19"}')$$,'22023','Invalid task dates','reversed range rejected');
select throws_ok($$select task_workspace_page('{"kind":"unknown"}')$$,'22023','Invalid task filters','unknown kind rejected');
select throws_ok($$select task_workspace_page('{"subsection":"all"}')$$,'42501','All tasks access denied','ordinary employee cannot use administrator scope');
select throws_ok($$select task_workspace_page('{"user_id":"45952000-0000-4000-8000-000000000002"}')$$,'22023','Invalid task filters','caller cannot choose another actor');
select throws_ok($$select task_workspace_page('{}',0,51)$$,'22023','Invalid task page','page size is capped');
select throws_ok($$select task_workspace_page('{"from":"2026-02-30"}')$$,'22023','Invalid task dates','invalid dates rejected');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000003',true);
select is((task_workspace_page('{"query":"silver"}')->>'total')::integer,0,'cross-tenant work is absent');
reset role;
update user_profiles set user_role='admin' where id='45952000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000001',true);
select is((task_workspace_page('{"query":"silver","subsection":"all"}')->>'total')::integer,4,'authorized admin can search all tenant tasks');
reset role;
update user_profiles set is_login_enabled=false where id='45952000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5951000-0000-4000-8000-000000000001',true);
select throws_ok($$select task_workspace_page('{}')$$,'42501',null,'inactive employee denied');
reset role;
select ok(not has_function_privilege('anon','task_workspace_page(jsonb,integer,integer)','EXECUTE'),'anon cannot search');
select ok(not has_function_privilege('service_role','task_workspace_page(jsonb,integer,integer)','EXECUTE'),'service role gains no actor search grant');
select * from finish();
rollback;
