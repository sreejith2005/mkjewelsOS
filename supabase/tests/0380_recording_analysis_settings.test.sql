begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('anon','recording_analysis_settings()','execute'),'anon cannot read settings');
select ok(has_function_privilege('authenticated','recording_analysis_settings()','execute'),'signed-in users may ask');
create temporary table sf(name text primary key,id uuid);
grant all on sf to authenticated;
do $$ declare t uuid; b uuid; d uuid; a uuid; u uuid; person text; begin
 insert into tenants(name,slug) values('Settings fixture','settings-fixture') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Store','SET') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','SET') returning id into d;
 foreach person in array array['owner','manager','staff'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-set@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,b,d,person,'SET-'||person,person||'-set@test.local',case person when 'owner' then 'super_admin' when 'manager' then 'manager' else 'staff' end::user_role,'active',true,'active') returning id into u;
  insert into sf values(person,u),(person||'_auth',a);
 end loop;
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,t,'module.sales_recording','grant' from sf where name='staff';
end $$;
create function pg_temp.act(n text) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from sf where name=n||'_auth'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',(select id from sf where name=n||'_auth')::text,true),set_config('request.jwt.claim.role','authenticated',true)$$;
select pg_temp.act('staff');
select throws_ok($$select recording_analysis_settings()$$,'42501','recording_rubric_denied','staff cannot read analysis settings');
select pg_temp.act('manager');
select is(recording_analysis_settings()->>'analysis_enabled','false','analysis off by default');
select is(recording_analysis_settings()->>'can_configure','false','manager cannot switch analysis');
select pg_temp.act('owner');
select recording_configure_analysis(true);
select is(recording_analysis_settings()->>'analysis_enabled','true','owner sees the switch state');
select is(recording_analysis_settings()->>'can_configure','true','owner can configure');
select * from finish();
rollback;
