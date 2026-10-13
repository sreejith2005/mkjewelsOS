begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(has_table_privilege('authenticated','public.fms_context_assignee_defaults','select'),'authenticated builder has a read grant');
select ok(not has_table_privilege('anon','public.fms_context_assignee_defaults','select'),'anonymous read denied');
select ok(not has_table_privilege('authenticated','public.fms_context_assignee_defaults','insert'),'direct client writes remain denied');
create temp table context_fixture(kind text,id uuid,auth_id uuid,tenant_id uuid);
do $$ declare tenant uuid; branch uuid; department uuid; person uuid; aid uuid; kind text; begin
 foreach kind in array array['allowed','other_tenant','inactive','denied'] loop
  if kind in ('allowed','other_tenant') then
   insert into tenants(name,slug) values('FMS read '||kind,'fms-read-'||kind) returning id into tenant;
   insert into branches(tenant_id,name,code) values(tenant,'FMS read branch','FMR') returning id into branch;
   insert into departments(tenant_id,branch_id,name,code) values(tenant,branch,'FMS read department','FMR') returning id into department;
  else select tenant_id into tenant from context_fixture where context_fixture.kind='allowed';
   select b.id into branch from branches b where b.tenant_id=tenant limit 1;
   select d.id into department from departments d where d.tenant_id=tenant limit 1;
  end if;
  aid:=gen_random_uuid();
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
  values(aid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fms-read-'||kind||'@example.invalid','x',now(),now());
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
  values(tenant,aid,branch,department,'Synthetic FMS '||kind,'FMR-'||kind,'fms-read-'||kind||'@example.invalid','manager','active',(case when kind='inactive' then 'suspended' else 'active' end)::user_account_status,true) returning id into person;
  insert into context_fixture values(kind,person,aid,tenant);
  if kind in ('allowed','other_tenant') then
   insert into fms_context_assignee_defaults(tenant_id,module_context,user_profile_id,created_by,updated_by) values(tenant,'read_test',person,person,person);
  end if;
 end loop;
end $$;
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect)
select id,tenant_id,'fms.view','deny' from context_fixture where kind='denied';
grant select on context_fixture to authenticated;
create function pg_temp.actor(p_kind text) returns text language sql as $$ select auth_id::text from context_fixture where kind=p_kind $$;
grant execute on function pg_temp.actor(text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.actor('allowed'),true);
select is((select count(*)::int from fms_context_assignee_defaults where module_context='read_test'),1,'builder reads its tenant configuration');
select is((select count(*)::int from fms_context_assignee_defaults where tenant_id=(select tenant_id from context_fixture where kind='other_tenant')),0,'cross-tenant configuration remains hidden');
select throws_ok($$update fms_context_assignee_defaults set module_context='changed' where module_context='read_test'$$,'42501',null,'direct client update denied');
select set_config('request.jwt.claim.sub',pg_temp.actor('inactive'),true);
select is((select count(*)::int from fms_context_assignee_defaults where module_context='read_test'),0,'inactive profile cannot read defaults');
select set_config('request.jwt.claim.sub',pg_temp.actor('denied'),true);
select is((select count(*)::int from fms_context_assignee_defaults where module_context='read_test'),0,'direct API cannot bypass denied FMS section access');
reset role;
select * from finish();
rollback;
