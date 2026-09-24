begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('17100000-0000-4000-8000-00000000000' || n)::uuid,'authenticated','authenticated','org-'||n||'@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()
from generate_series(1,6) n;
insert into tenants(id,name,slug) values
('17110000-0000-4000-8000-000000000001','Org one','org-one-171'),
('17110000-0000-4000-8000-000000000002','Org two','org-two-171');
insert into branches(id,tenant_id,name,code) values
('17120000-0000-4000-8000-000000000001','17110000-0000-4000-8000-000000000001','Main','MAIN171'),
('17120000-0000-4000-8000-000000000002','17110000-0000-4000-8000-000000000002','Other','OTHER171'),
('17120000-0000-4000-8000-000000000003','17110000-0000-4000-8000-000000000001','Inactive only','INACTIVE171');
insert into departments(id,tenant_id,branch_id,name,code) values
('17130000-0000-4000-8000-000000000001','17110000-0000-4000-8000-000000000001','17120000-0000-4000-8000-000000000001','Sales','SALES171'),
('17130000-0000-4000-8000-000000000002','17110000-0000-4000-8000-000000000002','17120000-0000-4000-8000-000000000002','Other sales','OSALES171'),
('17130000-0000-4000-8000-000000000003','17110000-0000-4000-8000-000000000001','17120000-0000-4000-8000-000000000003','Inactive team','INTEAM171');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
select ('17140000-0000-4000-8000-00000000000'||v.n)::uuid,('17100000-0000-4000-8000-00000000000'||v.n)::uuid,
case when v.n=5 then '17110000-0000-4000-8000-000000000002'::uuid else '17110000-0000-4000-8000-000000000001'::uuid end,
case when v.n=5 then '17120000-0000-4000-8000-000000000002'::uuid when v.n=6 then '17120000-0000-4000-8000-000000000003'::uuid else '17120000-0000-4000-8000-000000000001'::uuid end,
case when v.n=5 then '17130000-0000-4000-8000-000000000002'::uuid when v.n=6 then '17130000-0000-4000-8000-000000000003'::uuid else '17130000-0000-4000-8000-000000000001'::uuid end,
'Org '||v.n,'000001710'||v.n,'org-'||v.n||'@example.invalid','ORG-171-'||v.n,v.role::user_role,'active',v.status::user_account_status,v.status='active','{}'
from (values (1,'super_admin','active'),(2,'admin','active'),(3,'staff','active'),(4,'super_admin','inactive'),(5,'super_admin','active'),(6,'staff','inactive')) v(n,role,status);
insert into role_permissions(tenant_id,user_role,permission_key,is_allowed) values
('17110000-0000-4000-8000-000000000001','super_admin','users.view',false),
('17110000-0000-4000-8000-000000000001','admin','users.manage',false);
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) values
('17140000-0000-4000-8000-000000000001','17110000-0000-4000-8000-000000000001','home.view','deny');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select save_branch_with_audit(null,'{"name":"No actor","code":"NOACT171"}'::jsonb)$$,'42501',null,'unauthenticated caller cannot create branch');
select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000002',true);
select ok(not has_permission('users.manage'),'Admin still respects configured denies');
select throws_ok($$select save_branch_with_audit(null,'{"name":"Admin","code":"ADMIN171"}'::jsonb)$$,'42501',null,'Admin cannot create branch');
select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000003',true);
select throws_ok($$select save_department_with_audit(null,'{"name":"Staff","code":"STAFF171"}'::jsonb)$$,'42501',null,'Staff cannot create department');
select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000004',true);
select throws_ok($$select save_branch_with_audit(null,'{"name":"Inactive","code":"INACT171"}'::jsonb)$$,'42501',null,'inactive Super Admin cannot create branch');

select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000001',true);
select ok(has_permission('users.view') and has_permission('home.view') and has_permission('organization.manage'),'effective Super Admin keeps every capability despite denies');
select ok(position('assert_module_enabled(''users'')' in pg_get_functiondef('save_branch_with_audit(uuid,jsonb)'::regprocedure))>0,'branch writes enforce the Users section gate');
select ok(position('assert_module_enabled(''users'')' in pg_get_functiondef('save_department_with_audit(uuid,jsonb)'::regprocedure))>0,'department writes enforce the Users section gate');
select throws_ok($$select save_branch_with_audit(null,'{"name":"Duplicate","code":"MAIN171"}'::jsonb)$$,'23505',null,'duplicate branch code is rejected');
select throws_ok($$select save_department_with_audit(null,'{"name":"Invalid","code":"INVALID171","unexpected":true}'::jsonb)$$,'22023',null,'unsupported department changes are rejected');
select throws_ok($$select save_department_with_audit(null,'{"name":"Duplicate","code":"SALES171"}'::jsonb)$$,'23505',null,'duplicate department code is rejected');
select lives_ok($$select save_branch_with_audit(null,'{"name":"New branch","code":"NEW171"}'::jsonb)$$,'Super Admin creates branch');
select is((select count(*)::integer from branches where tenant_id='17110000-0000-4000-8000-000000000001' and code='NEW171'),1,'new branch persisted');
select lives_ok($$select save_department_with_audit(null,'{"name":"Shared service","code":"SHARED171"}'::jsonb)$$,'Super Admin creates shared department');
select is((select branch_id from departments where code='SHARED171'),null::uuid,'new department is shared');
select throws_ok($$select save_department_with_audit(null,'{"name":"Foreign scope","code":"FOREIGN171","branch_id":"17120000-0000-4000-8000-000000000002"}'::jsonb)$$,'42501',null,'cannot create department in another tenant branch');
select throws_ok($$select save_branch_with_audit('17120000-0000-4000-8000-000000000002','{"name":"Hijack"}'::jsonb)$$,'42501',null,'cannot edit other tenant branch');
select throws_ok($$select save_department_with_audit('17130000-0000-4000-8000-000000000002','{"name":"Hijack"}'::jsonb)$$,'42501',null,'cannot edit other tenant department');
select throws_ok($$select save_department_with_audit('17130000-0000-4000-8000-000000000001','{"branch_id":null}'::jsonb)$$,'23514',null,'occupied department scope is not silently changed');
select throws_ok($$select save_branch_with_audit('17120000-0000-4000-8000-000000000001','{"manager_id":"17140000-0000-4000-8000-000000000005"}'::jsonb)$$,'23503',null,'branch manager from another tenant is rejected');
select throws_ok($$select save_branch_with_audit('17120000-0000-4000-8000-000000000001','{"is_active":false}'::jsonb)$$,'23514',null,'cannot deactivate branch with employees');
select throws_ok($$select save_department_with_audit('17130000-0000-4000-8000-000000000001','{"is_active":false}'::jsonb)$$,'23514',null,'cannot deactivate department with employees');
select lives_ok($$select save_department_with_audit('17130000-0000-4000-8000-000000000001','{"name":"Sales team"}'::jsonb)$$,'can rename occupied department without changing assignments');
select lives_ok($$select save_branch_with_audit('17120000-0000-4000-8000-000000000001','{"manager_id":"17140000-0000-4000-8000-000000000002"}'::jsonb)$$,'active employee can become branch manager');
select lives_ok($$select save_department_with_audit('17130000-0000-4000-8000-000000000001','{"head_id":"17140000-0000-4000-8000-000000000002"}'::jsonb)$$,'active department employee can become head');
select is((select count(*)::integer from audit_logs where action in ('branch_saved','department_saved') and tenant_id='17110000-0000-4000-8000-000000000001'),5,'successful organization changes are audited');
select throws_ok($$select update_user_profile_with_audit('17140000-0000-4000-8000-000000000002','{"account_status":"inactive"}'::jsonb)$$,'23514',null,'assigned leader cannot be deactivated before reassignment');
select throws_ok($$select update_user_profile_with_audit('17140000-0000-4000-8000-000000000002','{"branch_id":"17120000-0000-4000-8000-000000000003","department_id":"17130000-0000-4000-8000-000000000003"}'::jsonb)$$,'23514',null,'assigned leader cannot be moved before reassignment');
select lives_ok($$select update_user_profile_with_audit('17140000-0000-4000-8000-000000000002','{"branch_id":"17120000-0000-4000-8000-000000000001","account_status":"active"}'::jsonb)$$,'re-saving a leader without changing assignments is allowed');
select lives_ok($$select save_department_with_audit('17130000-0000-4000-8000-000000000003','{"is_active":false}'::jsonb)$$,'department containing only inactive employees can be deactivated');
select lives_ok($$select save_branch_with_audit('17120000-0000-4000-8000-000000000003','{"is_active":false}'::jsonb)$$,'branch containing only inactive employees and inactive departments can be deactivated');
select is((select count(*)::integer from branches where tenant_id='17110000-0000-4000-8000-000000000002'),0,'Super Admin cannot read another tenant branch');
select is((select count(*)::integer from departments where tenant_id='17110000-0000-4000-8000-000000000002'),0,'Super Admin cannot read another tenant department');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select save_branch_with_audit(null,'{"name":"Service","code":"SERVICE171"}'::jsonb)$$,'42501',null,'service role without an authenticated actor cannot use the employee contract');

select * from finish();
rollback;
