begin;
select plan(10);
set search_path = public, extensions;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',email,crypt('local-test-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from (values
  ('87000000-0000-4000-8000-000000000001'::uuid,'direct-actor@example.invalid'),
  ('87000000-0000-4000-8000-000000000002'::uuid,'direct-target@example.invalid'),
  ('87000000-0000-4000-8000-000000000003'::uuid,'direct-inactive@example.invalid'),
  ('87000000-0000-4000-8000-000000000004'::uuid,'direct-disabled@example.invalid'),
  ('87000000-0000-4000-8000-000000000005'::uuid,'direct-resigned@example.invalid'),
  ('87000000-0000-4000-8000-000000000006'::uuid,'direct-other@example.invalid')
) fixture(id,email);
insert into tenants(id,name,slug) values
 ('87100000-0000-4000-8000-000000000001','Direct assignment fixture','direct-assignment-fixture'),
 ('87100000-0000-4000-8000-000000000002','Other assignment fixture','other-assignment-fixture');
insert into branches(id,tenant_id,name,code) values
 ('87200000-0000-4000-8000-000000000001','87100000-0000-4000-8000-000000000001','Actor branch','DA-A'),
 ('87200000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000001','Target branch','DA-B'),
 ('87200000-0000-4000-8000-000000000003','87100000-0000-4000-8000-000000000002','Other branch','DA-O');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('87300000-0000-4000-8000-000000000001','87100000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001','Actor dept','DA-A'),
 ('87300000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002','Target dept','DA-B'),
 ('87300000-0000-4000-8000-000000000003','87100000-0000-4000-8000-000000000002','87200000-0000-4000-8000-000000000003','Other dept','DA-O');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off) values
 ('87400000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87100000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000001','Actor','0000008701','direct-actor@example.invalid','DA-1','admin','active','active',true,'{}'),
 ('87400000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002','87300000-0000-4000-8000-000000000002','Target','0000008702','direct-target@example.invalid','DA-2','crm','active','active',true,'{}'),
 ('87400000-0000-4000-8000-000000000003','87000000-0000-4000-8000-000000000003','87100000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002','87300000-0000-4000-8000-000000000002','Inactive','0000008703','direct-inactive@example.invalid','DA-3','crm','inactive','active',true,'{}'),
 ('87400000-0000-4000-8000-000000000004','87000000-0000-4000-8000-000000000004','87100000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002','87300000-0000-4000-8000-000000000002','Disabled','0000008704','direct-disabled@example.invalid','DA-4','crm','active','active',false,'{}'),
 ('87400000-0000-4000-8000-000000000005','87000000-0000-4000-8000-000000000005','87100000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002','87300000-0000-4000-8000-000000000002','Resigned','0000008705','direct-resigned@example.invalid','DA-5','crm','resigned','left',false,'{}'),
 ('87400000-0000-4000-8000-000000000006','87000000-0000-4000-8000-000000000006','87100000-0000-4000-8000-000000000002','87200000-0000-4000-8000-000000000003','87300000-0000-4000-8000-000000000003','Other','0000008706','direct-other@example.invalid','DA-6','crm','active','active',true,'{}');

select is((select (assert_direct_assignment_user('87400000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000001','CRM')).branch_id),'87200000-0000-4000-8000-000000000002'::uuid,'authorized cross-branch CRM target retains its derived branch');
select is((select (assert_direct_assignment_user('87400000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000001','FMS')).department_id),'87300000-0000-4000-8000-000000000002'::uuid,'authorized cross-branch FMS target retains its derived department');
select throws_ok($$select assert_direct_assignment_user('87400000-0000-4000-8000-000000000003','87100000-0000-4000-8000-000000000001','CRM')$$,'23503','CRM user is not an active login-enabled tenant profile','inactive target is denied');
select throws_ok($$select assert_direct_assignment_user('87400000-0000-4000-8000-000000000004','87100000-0000-4000-8000-000000000001','CRM')$$,'23503','CRM user is not an active login-enabled tenant profile','login-disabled target is denied');
select throws_ok($$select assert_direct_assignment_user('87400000-0000-4000-8000-000000000005','87100000-0000-4000-8000-000000000001','CRM')$$,'23503','CRM user is not an active login-enabled tenant profile','resigned target is denied');
select throws_ok($$select assert_direct_assignment_user('87400000-0000-4000-8000-000000000006','87100000-0000-4000-8000-000000000001','CRM')$$,'23503','CRM user is not an active login-enabled tenant profile','cross-tenant target is denied');
select is((select (assert_direct_assignment_user('87400000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000001','salesperson')).id),'87400000-0000-4000-8000-000000000002'::uuid,'active same-tenant CRM user is eligible as salesperson');
select ok(not exists(select 1 from audit_logs where tenant_id='87100000-0000-4000-8000-000000000001'),'fixture validation is read-only and does not create stray audits');
select is((select resolution from resolve_task_coverage('87400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date)),'original','new direct target keeps normal coverage resolution');
select is((select effective_assignee_id from resolve_task_coverage('87400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date)),'87400000-0000-4000-8000-000000000002'::uuid,'normal effective recipient remains the direct target');
select * from finish();
rollback;
