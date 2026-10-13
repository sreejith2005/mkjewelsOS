begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temp table choice_fixture(kind text,id uuid);
do $$ declare tenant uuid; branch uuid; dept uuid; person uuid; auth_id uuid; kind text; begin
 insert into tenants(name,slug) values('Department choice test','department-choice-test') returning id into tenant;
 insert into branches(tenant_id,name,code) values(tenant,'Choice branch','CH') returning id into branch;
 foreach kind in array array['CRM','Sales','Accounts'] loop
  insert into departments(tenant_id,branch_id,name,code) values(tenant,branch,kind,kind) returning id into dept;
  auth_id:=gen_random_uuid();
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
  values(auth_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',lower(kind)||'-choice@example.invalid','x',now(),now());
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
  values(tenant,auth_id,branch,dept,'Synthetic '||kind,kind||'-CHOICE',lower(kind)||'-choice@example.invalid','staff','active','active',true) returning id into person;
  insert into choice_fixture values(kind,person);
 end loop;
end $$;
select is(crm_sync.staff_roster_fields(id)->>'selection_department',lower(kind),'choice follows department '||kind)
from choice_fixture where kind in ('CRM','Sales');
select is(crm_sync.staff_roster_fields(id)->>'selection_department','other','Accounts cannot appear in either staff choice') from choice_fixture where kind='Accounts';
select is((crm_sync.staff_roster_fields(id)->>'crm_roster')::boolean,kind='CRM','CRM roster follows department, independently of role') from choice_fixture;
select is((crm_sync.staff_roster_fields(id)->>'crm_roster_all_branches')::boolean,true,'CRM department remains a company-wide team') from choice_fixture where kind='CRM';
update departments set name='Renamed customer team' where code='CRM' and tenant_id=(select tenant_id from user_profiles where id=(select id from choice_fixture where kind='CRM'));
select is(crm_sync.staff_roster_fields(id)->>'selection_department','crm','canonical CRM department code survives a display-name change') from choice_fixture where kind='CRM';
update user_profiles set user_role='crm' where id=(select id from choice_fixture where kind='Accounts');
select is((crm_sync.staff_roster_fields(id)->>'crm_roster')::boolean,false,'CRM login role cannot add Accounts employee to CRM dropdown') from choice_fixture where kind='Accounts';
update departments set is_active=false where id=(select department_id from user_profiles where id=(select id from choice_fixture where kind='Sales'));
select is(crm_sync.staff_roster_fields(id)->>'selection_department','other','inactive department removed from choices') from choice_fixture where kind='Sales';
select is(crm_sync.staff_roster_fields(gen_random_uuid())->>'selection_department','other','missing user fails closed');
select ok(not has_function_privilege('authenticated','crm_sync.staff_roster_fields(uuid)','execute'),'client cannot forge department metadata');
select ok(not has_function_privilege('anon','public.crm_sync_staff_roster()','execute'),'anonymous roster access denied');
select * from finish();
rollback;
