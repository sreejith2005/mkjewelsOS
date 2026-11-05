begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok(not has_function_privilege('anon','recording_playback_ticket(uuid,integer,integer)','execute'),'anon cannot ask for playback');
select ok(has_function_privilege('authenticated','recording_playback_ticket(uuid,integer,integer)','execute'),'signed-in reviewers may ask');
select ok(not has_function_privilege('authenticated','recording_playback_ingest(text,jsonb)','execute'),'browser cannot redeem tickets');
select ok(has_function_privilege('service_role','recording_playback_ingest(text,jsonb)','execute'),'recorder boundary redeems');
select ok(not has_table_privilege('authenticated','recording_playback_grants','select'),'no direct grant reads');
select ok((select relrowsecurity from pg_class where oid='recording_playback_grants'::regclass),'grant RLS on');

create temporary table pf(name text primary key,id uuid,body jsonb);
grant all on pf to authenticated,service_role;
do $$ declare t uuid; b uuid; b2 uuid; d uuid; a uuid; u uuid; person text; dev uuid:=gen_random_uuid(); s uuid; s2 uuid; begin
 insert into tenants(name,slug) values('Playback fixture','playback-fixture') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Store','PLB') returning id into b;
 insert into branches(tenant_id,name,code) values(t,'Other','PLB2') returning id into b2;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','PLB') returning id into d;
 foreach person in array array['manager','rep','farmanager','inactive'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-plb@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,case when person='farmanager' then b2 else b end,d,person,'PLB-'||person,person||'-plb@test.local',
    case when person in ('manager','farmanager','inactive') then 'manager' else 'staff' end::user_role,(case when person='inactive' then 'inactive' else 'active' end)::working_status,true,'active') returning id into u;
  insert into pf values(person,u,null),(person||'_auth',a,null);
 end loop;
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,t,'module.sales_recording','grant' from pf where name='rep';
 insert into recorder_devices(id,tenant_id,branch_id,employee_id) values(dev,t,b,(select id from pf where name='rep'));
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at)
  values(t,b,(select id from pf where name='rep'),dev,gen_random_uuid(),'pilot-v1','ready',4,3,now()) returning id into s;
 insert into recorder_chunks select s,g,lpad(to_hex(g+10),64,'b'),case when g=3 then 1000 else 64000 end,
  'recordings/'||t||'/'||b||'/'||(select id from pf where name='rep')||'/'||dev||'/'||s||'/'||lpad(g::text,8,'0')||'-'||lpad(to_hex(g+10),64,'b')||'.pcm',now() from generate_series(0,3) g;
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at)
  values(t,b,(select id from pf where name='rep'),dev,gen_random_uuid(),'pilot-v1','processing',1,0,now()) returning id into s2;
 insert into pf values('session',s,null),('busy',s2,null),('tenant',t,null);
end $$;
create function pg_temp.pid(n text) returns uuid language sql as $$select id from pf where name=n$$;
create function pg_temp.pact(n text) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(n||'_auth'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',pg_temp.pid(n||'_auth')::text,true),set_config('request.jwt.claim.role','authenticated',true)$$;
create function pg_temp.psrv() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true)$$;

-- Who may listen.
select pg_temp.pact('rep');
select throws_ok(format($$select recording_playback_ticket(%L,0,4000)$$,pg_temp.pid('session')),'42501','recording_review_denied','the recorded employee cannot pull audio');
select pg_temp.pact('farmanager');
select throws_ok(format($$select recording_playback_ticket(%L,0,4000)$$,pg_temp.pid('session')),'42501','recording_review_denied','manager of another branch denied');
select pg_temp.pact('inactive');
select throws_ok(format($$select recording_playback_ticket(%L,0,4000)$$,pg_temp.pid('session')),'42501',null,'inactive manager denied');

-- Window rules.
select pg_temp.pact('manager');
select throws_ok(format($$select recording_playback_ticket(%L,0,4000)$$,pg_temp.pid('busy')),'22023','recording_playback_not_ready','still processing');
select throws_ok(format($$select recording_playback_ticket(%L,0,60001)$$,pg_temp.pid('session')),'22023','recording_invalid_window','longer than 60 seconds');
select throws_ok(format($$select recording_playback_ticket(%L,5000,5000)$$,pg_temp.pid('session')),'22023','recording_invalid_window','empty window');
select throws_ok(format($$select recording_playback_ticket(%L,-1,1000)$$,pg_temp.pid('session')),'22023','recording_invalid_window','negative start');
select throws_ok(format($$select recording_playback_ticket(%L,20000,24000)$$,pg_temp.pid('session')),'22023','recording_audio_not_found','no audio there');

update pf set body=recording_playback_ticket(pg_temp.pid('session'),2500,6100) where name='session';
select is((select body->>'start_ms' from pf where name='session'),'2000','window snapped to chunk start');
select is((select body->>'end_ms' from pf where name='session'),'8000','window ends on chunk boundary');
select ok((select body->>'ticket' ~ '^[0-9a-f]{64}$' from pf where name='session'),'opaque ticket');
select ok(not exists(select 1 from recording_playback_grants where hash=(select body->>'ticket' from pf where name='session')),'only the hash is stored');
select is((select count(*)::int from audit_logs where action='recording_audio_played' and record_id=pg_temp.pid('session') and actor_user_id=pg_temp.pid('manager')),1,'listening is audited');
select is((select new_value->>'start_ms' from audit_logs where action='recording_audio_played' and record_id=pg_temp.pid('session')),'2000','audit keeps the window');

-- Redemption: service boundary only, single use.
select throws_ok(format($$select recording_playback_ingest('playback_redeem',jsonb_build_object('ticket',%L))$$,(select body->>'ticket' from pf where name='session')),'42501','recording_service_only','browser role cannot redeem');
select pg_temp.psrv();
update pf set body=body||jsonb_build_object('redeemed',recording_playback_ingest('playback_redeem',jsonb_build_object('ticket',body->>'ticket'))) where name='session';
select is((select jsonb_array_length(body->'redeemed'->'chunks') from pf where name='session'),3,'three chunks in window (1,2,3)');
select is((select body->'redeemed'->'chunks'->2->>'byte_count' from pf where name='session'),'1000','partial last chunk reported as stored');
select is((select body->'redeemed'->'session'->>'id' from pf where name='session'),pg_temp.pid('session')::text,'scope returned for key checks');
select throws_ok(format($$select recording_playback_ingest('playback_redeem',jsonb_build_object('ticket',%L))$$,(select body->>'ticket' from pf where name='session')),'42501','recording_playback_denied','ticket is single use');
select throws_ok($$select recording_playback_ingest('playback_redeem','{"ticket":"zz"}')$$,'42501','recording_playback_denied','malformed ticket');
select throws_ok($$select recording_playback_ingest('other','{}')$$,'22023','recording_invalid_action','unknown action');

-- Expired ticket.
select pg_temp.pact('manager');
update pf set body=recording_playback_ticket(pg_temp.pid('session'),0,2000) where name='session';
reset role;
update recording_playback_grants set expires_at=now()-interval '1 second' where hash=encode(digest((select body->>'ticket' from pf where name='session'),'sha256'),'hex');
select pg_temp.psrv();
select throws_ok(format($$select recording_playback_ingest('playback_redeem',jsonb_build_object('ticket',%L))$$,(select body->>'ticket' from pf where name='session')),'42501','recording_playback_denied','expired ticket');

-- Retention: an expired recording plays nothing.
select pg_temp.pact('manager');
update recorder_sessions set expires_at=now()-interval '1 minute' where id=pg_temp.pid('session');
select throws_ok(format($$select recording_playback_ticket(%L,0,2000)$$,pg_temp.pid('session')),'22023','recording_retention_expired','expired recording');

select * from finish();
rollback;
