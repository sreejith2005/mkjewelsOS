begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(17);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',email,crypt('synthetic',gen_salt('bf')),now(),'{}','{}',now(),now()
from (values
 ('f1500000-0000-0000-0000-000000000001'::uuid,'dropdown-super@example.invalid'),
 ('f1500000-0000-0000-0000-000000000002'::uuid,'dropdown-admin@example.invalid'),
 ('f1500000-0000-0000-0000-000000000003'::uuid,'dropdown-manager@example.invalid'),
 ('f1500000-0000-0000-0000-000000000004'::uuid,'dropdown-hr@example.invalid'),
 ('f1500000-0000-0000-0000-000000000005'::uuid,'dropdown-crm@example.invalid'),
 ('f1500000-0000-0000-0000-000000000006'::uuid,'dropdown-staff@example.invalid'),
 ('f1500000-0000-0000-0000-000000000007'::uuid,'dropdown-doer@example.invalid'),
 ('f1500000-0000-0000-0000-000000000008'::uuid,'dropdown-housekeeping@example.invalid'),
 ('f1500000-0000-0000-0000-000000000009'::uuid,'dropdown-inactive@example.invalid'),
 ('f1500000-0000-0000-0000-000000000010'::uuid,'dropdown-other@example.invalid')
) v(id,email);
insert into tenants(id,name,slug) values ('f1510000-0000-0000-0000-000000000001','Dropdown Fixture A','dropdown-fixture-a'),('f1510000-0000-0000-0000-000000000002','Dropdown Fixture B','dropdown-fixture-b');
insert into branches(id,tenant_id,name,code) values ('f1520000-0000-0000-0000-000000000001','f1510000-0000-0000-0000-000000000001','Fixture A','DFA'),('f1520000-0000-0000-0000-000000000002','f1510000-0000-0000-0000-000000000002','Fixture B','DFB');
insert into departments(id,tenant_id,branch_id,name,code) values ('f1530000-0000-0000-0000-000000000001','f1510000-0000-0000-0000-000000000001','f1520000-0000-0000-0000-000000000001','Fixture A','DFA'),('f1530000-0000-0000-0000-000000000002','f1510000-0000-0000-0000-000000000002','f1520000-0000-0000-0000-000000000002','Fixture B','DFB');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select ('f1540000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,id,tenant_id,branch_id,department_id,role||' fixture','90000000'||lpad(n::text,2,'0'),role||n||'@example.invalid','D15-'||n,role::user_role,status::working_status,enabled
from (values
 (1,'f1500000-0000-0000-0000-000000000001'::uuid,'super_admin','active',true), (2,'f1500000-0000-0000-0000-000000000002','admin','active',true), (3,'f1500000-0000-0000-0000-000000000003','manager','active',true), (4,'f1500000-0000-0000-0000-000000000004','hr','active',true), (5,'f1500000-0000-0000-0000-000000000005','crm','active',true), (6,'f1500000-0000-0000-0000-000000000006','staff','active',true), (7,'f1500000-0000-0000-0000-000000000007','doer','active',true), (8,'f1500000-0000-0000-0000-000000000008','housekeeping','active',true), (9,'f1500000-0000-0000-0000-000000000009','admin','inactive',false), (10,'f1500000-0000-0000-0000-000000000010','admin','active',true)
) v(n,id,role,status,enabled) cross join lateral (select case when n=10 then 'f1510000-0000-0000-0000-000000000002'::uuid else 'f1510000-0000-0000-0000-000000000001'::uuid end tenant_id,case when n=10 then 'f1520000-0000-0000-0000-000000000002'::uuid else 'f1520000-0000-0000-0000-000000000001'::uuid end branch_id,case when n=10 then 'f1530000-0000-0000-0000-000000000002'::uuid else 'f1530000-0000-0000-0000-000000000001'::uuid end department_id) s;
insert into dropdown_masters(id,tenant_id,master_type,label,value,sort_order,is_active,created_by,updated_by) values ('f1550000-0000-0000-0000-000000000001','f1510000-0000-0000-0000-000000000001','task_category','Fixture tenant','fixture_tenant',1,true,'f1540000-0000-0000-0000-000000000001','f1540000-0000-0000-0000-000000000001'),('f1550000-0000-0000-0000-000000000002',null,'task_category','Fixture global','fixture_global',2,true,'f1540000-0000-0000-0000-000000000001','f1540000-0000-0000-0000-000000000001'),('f1550000-0000-0000-0000-000000000003','f1510000-0000-0000-0000-000000000002','task_category','Fixture other','fixture_other',1,true,'f1540000-0000-0000-0000-000000000010','f1540000-0000-0000-0000-000000000010');

select ok(has_table_privilege('authenticated','dropdown_masters','SELECT'),'authenticated has dropdown SELECT');
select ok(not has_table_privilege('authenticated','dropdown_masters','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'authenticated has no direct dropdown mutations');
select ok(not has_table_privilege('anon','dropdown_masters','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'anon has no dropdown privileges');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000001',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active super_admin reads tenant and global dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000002',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active admin reads authorized dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000003',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active manager reads authorized dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000004',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active hr reads authorized dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000005',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active crm reads authorized dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000006',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active staff reads authorized dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000007',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active doer reads authorized dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000008',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),2,'active housekeeping reads authorized dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000009',true); select is((select count(*)::int from dropdown_masters where id in ('f1550000-0000-0000-0000-000000000001','f1550000-0000-0000-0000-000000000002')),0,'inactive profile receives no dropdowns');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000010',true); select is((select count(*)::int from dropdown_masters where id='f1550000-0000-0000-0000-000000000001'),0,'cross-tenant dropdown is hidden');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000002',true); select throws_ok($$select change_dropdown_with_audit('create',null,'task_category','Denied','denied',9,true)$$,'42501',null,'non-super-admin RPC mutation is denied');
select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000001',true); select lives_ok($$select change_dropdown_with_audit('create',null,'task_category','Audited','audited',9,true)$$,'super_admin RPC mutation succeeds');
select ok(exists(select 1 from audit_logs where action='dropdown_changed' and module='dropdown_master' and tenant_id='f1510000-0000-0000-0000-000000000001'),'audited dropdown write creates audit row');
select throws_ok($$insert into dropdown_masters(tenant_id,master_type,label,value) values ('f1510000-0000-0000-0000-000000000001','task_category','Denied','denied')$$,'42501',null,'direct authenticated write remains denied');
reset role;
select * from finish();
rollback;
