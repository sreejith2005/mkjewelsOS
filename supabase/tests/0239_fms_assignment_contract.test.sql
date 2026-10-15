begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_column('public','fms_flows','assignment_version','flow has an independent assignment contract');
select has_column('public','fms_instances','assignment_version','instance pins its assignment contract');
select has_function('public','assert_fms_assignment_publishable',array['uuid'],'server validates new assignment modes');
select ok(not has_function_privilege('anon','save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)','EXECUTE'),'anonymous callers cannot author workflows');
create temporary table assignment_version_fixture(name text primary key,id uuid);
grant all on assignment_version_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid:=gen_random_uuid(); u uuid; flow uuid;
begin
  insert into tenants(name,slug) values('Assignment version fixture','fms-assignment-version') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','AV') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Operations','AV') returning id into d;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','assignment-version@test.local','x',now(),now());
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
    values(t,a,b,d,'Version author','AV1','assignment-version@test.local','super_admin','active','active',true) returning id into u;
  insert into fms_flows(tenant_id,name,family_id,status,scope_type,created_by,updated_by)
    values(t,'Legacy flow',gen_random_uuid(),'draft','tenant',u,u) returning id into flow;
  insert into assignment_version_fixture values('tenant',t),('branch',b),('department',d),('auth',a),('user',u),('legacy',flow);
end $$;
select is((select assignment_version from fms_flows where id=(select id from assignment_version_fixture where name='legacy')),1,'existing/legacy creation contract stays version one');
select set_config('request.jwt.claim.sub',(select id::text from assignment_version_fixture where name='auth'),true);
set local role authenticated;
insert into assignment_version_fixture select 'new',save_fms_flow_draft_with_audit(null,'{"name":"New flow","scope_type":"tenant"}','[]');
select is((select assignment_version from fms_flows where id=(select id from assignment_version_fixture where name='new')),2,'new builder drafts use version two');
select throws_ok($$select save_fms_flow_draft_with_audit((select id from assignment_version_fixture where name='new'),'{"name":"New flow","assignment_version":1}','[]')$$,'23514','Invalid assignment contract version','new drafts cannot silently downgrade');
reset role;
insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by,assignment_version)
select f.tenant_id,(select id from assignment_version_fixture where name='branch'),(select id from assignment_version_fixture where name='department'),f.id,f.family_id,f.version,'AV-INSTANCE','Pinned assignment','active','medium','{}',f.created_by,1 from fms_flows f where f.id=(select id from assignment_version_fixture where name='new');
select is((select assignment_version from fms_instances where reference_number='AV-INSTANCE'),2,'instance version comes from flow rather than caller');
select throws_ok($$update fms_instances set assignment_version=1 where reference_number='AV-INSTANCE'$$,'23514','A running workflow cannot change its assignment contract','active instance version is immutable');
select ok(not has_function_privilege('authenticated','save_fms_flow_draft_before_assignment(uuid,jsonb,jsonb)','EXECUTE'),'clients cannot bypass new draft contract');
select * from finish();
rollback;
