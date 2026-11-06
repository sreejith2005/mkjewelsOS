begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Grants and shape are unchanged by the replacement.
select ok(has_function_privilege('authenticated','recorder_can_read(uuid,uuid,uuid)','execute'),'signed-in users keep execute');
select ok(not has_function_privilege('anon','recorder_can_read(uuid,uuid,uuid)','execute'),'anon still cannot execute');
select ok((select prosecdef from pg_proc where oid='recorder_can_read(uuid,uuid,uuid)'::regprocedure),'still security definer');

create temporary table af(name text primary key,id uuid);
grant all on af to authenticated;
do $$ declare t uuid; b uuid; d uuid; a uuid; u uuid; person text; dev uuid:=gen_random_uuid(); s uuid; seg uuid:=gen_random_uuid(); begin
 insert into tenants(name,slug) values('Active employment','active-employment') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Store','AEM') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','AEM') returning id into d;
 foreach person in array array['manager','rep'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
   values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-aem@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,b,d,initcap(person),'AEM-'||person,person||'-aem@test.local',case person when 'manager' then 'manager' else 'staff' end::user_role,'active',true,'active') returning id into u;
  insert into af values(person,u),(person||'_auth',a);
 end loop;
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) values
  ((select id from af where name='rep'),t,'module.sales_recording','grant'),((select id from af where name='manager'),t,'recording.coach','grant');
 insert into recorder_devices(id,tenant_id,branch_id,employee_id) values(dev,t,b,(select id from af where name='rep'));
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at)
  values(t,b,(select id from af where name='rep'),dev,gen_random_uuid(),'pilot-v1','ready',1,0,now()) returning id into s;
 insert into recorder_segments(session_id,segment_id,sequence,revision,text,is_final,started_ms,ended_ms) values(s,seg,0,2,'Final words',true,0,2000);
 insert into recorder_alerts(session_id,segment_id,code) values(s,seg,'critical_compliance');
 insert into af values('session',s);
end $$;

-- Rows visible to a person through RLS, summed over the four directly readable recording tables.
create function pg_temp.reads(person text) returns bigint language plpgsql as $$
declare n bigint:=0; c bigint; auth_id uuid:=(select id from af where name=person||'_auth'); tbl text; begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',auth_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
 foreach tbl in array array['recorder_sessions','recorder_devices','recorder_segments','recorder_alerts'] loop
  set local role authenticated; execute format('select count(*) from %I',tbl) into c; reset role; n:=n+c;
 end loop;
 return n;
end $$;
create function pg_temp.snapshot_refused(person text) returns boolean language plpgsql as $$
declare auth_id uuid:=(select id from af where name=person||'_auth'); begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',auth_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
 perform recorder_session_snapshot((select id from af where name='session')); return false;
exception when others then return true; end $$;
create function pg_temp.set_status(person text,v text) returns void language sql as $$
 update user_profiles set working_status=v::working_status where id=(select id from af where name=person)$$;

-- Active: the reviewer reads all four tables (session, device, segment, alert), the employee their own three.
select is(pg_temp.reads('manager'),4::bigint,'active branch reviewer reads session, device, segment and alert');
select is(pg_temp.reads('rep'),3::bigint,'active employee reads their own session, device and segment');
select ok(not pg_temp.snapshot_refused('manager'),'active reviewer opens the snapshot');

-- Every non-active working status: no direct reads, matching the RPC refusal. Each status is
-- set, checked and restored inside one call, so each pair of assertions tests exactly one state.
create function pg_temp.check_status(person text,v text) returns setof text language plpgsql as $$
begin
 perform pg_temp.set_status(person,v);
 return next is(pg_temp.reads(person),0::bigint,person||' with working status '||v||' reads no recording rows directly');
 return next ok(pg_temp.snapshot_refused(person),person||' with working status '||v||' is refused the snapshot too');
 perform pg_temp.set_status(person,'active');
end $$;
select pg_temp.check_status('manager','inactive');
select pg_temp.check_status('manager','on_leave');
select pg_temp.check_status('manager','half_day');
select pg_temp.check_status('manager','resigned');
select pg_temp.check_status('rep','inactive');
select pg_temp.check_status('rep','on_leave');
select pg_temp.check_status('rep','half_day');
select pg_temp.check_status('rep','resigned');
select is(pg_temp.reads('manager'),4::bigint,'restored reviewer reads again');
select is(pg_temp.reads('rep'),3::bigint,'restored employee reads again');
select * from finish();
rollback;
