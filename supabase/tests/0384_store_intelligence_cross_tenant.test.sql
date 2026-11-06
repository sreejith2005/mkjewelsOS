-- Store Intelligence: direct cross-tenant, cross-branch and lifecycle denial matrix.
-- Two complete tenants (A and B), each with two branches, a super admin, a manager,
-- a salesperson, a manager of the other branch and an inactive manager. Each tenant
-- has a Ready recording (chunks, transcript, approved analysis, live segment, alert)
-- and an open recording. Tenant B's people then try every signed-in recording
-- contract against tenant A's records, and every list/summary contract is checked
-- for tenant A identifiers or text. Positive controls prove B's contracts work.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- Privilege inventory: only four recording tables are directly readable, none writable.
-- A new grant on any other recording table fails here.
-- ---------------------------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(n.nspname||'.'||c.relname order by n.nspname||'.'||c.relname),'{}') from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','v','m') and n.nspname in ('public','crm_sync') and c.relname ~ '^(recorder|recording)'
      and has_table_privilege('authenticated',c.oid,'select')),
  array['public.recorder_alerts','public.recorder_devices','public.recorder_segments','public.recorder_sessions'],
  'only the four RLS-filtered recording tables are directly readable by signed-in users');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','v','m') and n.nspname in ('public','crm_sync') and c.relname ~ '^(recorder|recording)'
      and (has_table_privilege('authenticated',c.oid,'insert') or has_table_privilege('authenticated',c.oid,'update') or has_table_privilege('authenticated',c.oid,'delete')
        or has_table_privilege('anon',c.oid,'select') or has_table_privilege('anon',c.oid,'insert'))),
  0,'no recording table is writable by signed-in users or visible to anon');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','crm_sync') and c.relname ~ '^(recorder|recording)' and not c.relrowsecurity),
  0,'every recording table has RLS on');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','crm_sync') and p.proname ~ '^(recorder|recording)' and has_function_privilege('anon',p.oid,'execute')),
  0,'anon executes no recording function');
select is((select count(*)::int from storage.buckets where id ~* '(record|audio|transcript)' or name ~* '(record|audio|transcript)'),0,
  'recording audio never lands in Supabase Storage (private S3 only)');

-- ---------------------------------------------------------------------------------------------
-- Fixture: identical tenants A and B.
-- ---------------------------------------------------------------------------------------------
create temporary table xf(name text primary key,id uuid);
grant all on xf to authenticated,service_role;
create function pg_temp.mk(tag text) returns void language plpgsql as $$
declare t uuid; b uuid; b2 uuid; d uuid; a uuid; u uuid; person text; dev uuid:=gen_random_uuid(); dev2 uuid:=gen_random_uuid(); r uuid;
 s uuid; so uuid; v uuid; j uuid; an uuid; seg uuid:=gen_random_uuid(); rep uuid; mgr uuid; begin
 insert into tenants(name,slug) values('Cross tenant '||tag,'cross-tenant-'||tag) returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Store '||tag,'XT'||upper(tag)) returning id into b;
 insert into branches(tenant_id,name,code) values(t,'Other '||tag,'XO'||upper(tag)) returning id into b2;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','XT'||upper(tag)) returning id into d;
 foreach person in array array['owner','manager','rep','farmanager','inactive'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
   values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-xt'||tag||'@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,case when person='farmanager' then b2 else b end,d,initcap(person)||' '||upper(tag),'XT'||upper(tag)||'-'||person,person||'-xt'||tag||'@test.local',
    case person when 'owner' then 'super_admin' when 'rep' then 'staff' else 'manager' end::user_role,
    (case when person='inactive' then 'inactive' else 'active' end)::working_status,true,'active') returning id into u;
  insert into xf values(tag||'.'||person,u),(tag||'.'||person||'_auth',a);
 end loop;
 rep:=(select id from xf where name=tag||'.rep'); mgr:=(select id from xf where name=tag||'.manager');
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) values
  (rep,t,'module.sales_recording','grant'),(rep,t,'recording.capture','grant'),(mgr,t,'recording.coach','grant');
 insert into recorder_config(tenant_id,enabled,employee_ids,branch_ids,analysis_enabled) values(t,true,array[rep],array[b],true);
 insert into recorder_devices(id,tenant_id,branch_id,employee_id) values(dev,t,b,rep),(dev2,t,b,rep);
 -- s: Ready, scored and approved. so: still recording on its own device.
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,rep,dev,gen_random_uuid(),'pilot-v1','ready',4,3,now(),now()-interval '2 hours') returning id into s;
 insert into recorder_chunks select s,g,lpad(to_hex(g+10),64,'d'),64000,
  'recordings/'||t||'/'||b||'/'||rep||'/'||dev||'/'||s||'/'||lpad(g::text,8,'0')||'-'||lpad(to_hex(g+10),64,'d')||'.pcm',now() from generate_series(0,3) g;
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,created_at)
  values(t,b,rep,dev2,gen_random_uuid(),'pilot-v1','recording',0,null,now()-interval '5 minutes') returning id into so;
 insert into recorder_segments(session_id,segment_id,sequence,revision,text,is_final,started_ms,ended_ms) values(s,seg,0,2,'XTSECRET'||upper(tag)||' live words',true,0,2000);
 insert into recorder_alerts(session_id,segment_id,code) values(s,seg,'critical_compliance');
 r:=(recording_active_rubric(t)).id;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s,1,'machine',repeat(tag,64)) returning id into v;
 insert into recording_transcript_segments(revision_id,session_id,segment_id,ordinal,source_sequence,source_offset_ms,start_ms,end_ms,raw_text)
  values(v,s,seg,0,0,0,0,2000,'XTSECRET'||upper(tag)||' looking for a gold chain');
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s,v,r,'mk-sales-v1','initial','done') returning id into j;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  values(t,s,j,v,r,'mk-sales-v1','test','m','p1','scored',80,100,jsonb_build_object('summary','XTSECRET'||upper(tag)||' summary',
   'next_best_actions',jsonb_build_array(jsonb_build_object('action','XTSECRET'||upper(tag)||' call back','reason','asked','evidence','[]'::jsonb)),
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','enquiry','confidence',0.8))),'{}'::jsonb) returning id into an;
 insert into recording_analysis_reviews(tenant_id,session_id,analysis_id,actor_id,action,note) values(t,s,an,mgr,'approve','ok');
 insert into xf values(tag||'.tenant',t),(tag||'.branch',b),(tag||'.branch2',b2),(tag||'.device',dev),(tag||'.device2',dev2),(tag||'.session',s),(tag||'.open',so),
  (tag||'.revision',v),(tag||'.segment',seg),(tag||'.analysis',an),(tag||'.rubric',r);
end $$;
select pg_temp.mk('a');
select pg_temp.mk('b');

create function pg_temp.xid(n text) returns uuid language sql as $$select id from xf where name=n$$;
create function pg_temp.act(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.xid(n||'_auth'),'role','authenticated')::text,true),
        set_config('request.jwt.claim.sub',pg_temp.xid(n||'_auth')::text,true),set_config('request.jwt.claim.role','authenticated',true)$$;
create function pg_temp.srv() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true)$$;
-- Does a result mention any tenant A identifier or tenant A text?
create function pg_temp.leaks_a(p text) returns boolean language sql as $$
 select coalesce(p,'') like '%XTSECRETA%' or exists(select 1 from xf where name like 'a.%' and name not like '%\_auth' and position(id::text in coalesce(p,''))>0)$$;
-- Run a statement as an actor; true only when it is refused with an authorization or not-found error.
create function pg_temp.refused(actor text,stmt text) returns text language plpgsql as $$
begin
 perform pg_temp.act(actor);
 begin execute stmt; return 'ALLOWED';
 exception when others then
  -- recording_invalid_rubric: the rubric lookup is scoped to the actor's tenant (0379), so another tenant's id is simply not found.
  return case when sqlstate in ('42501','P0002') or sqlerrm ~ '(denied|not_found|not found)' or sqlerrm='recording_invalid_rubric' then 'refused' else 'UNEXPECTED '||sqlstate||' '||sqlerrm end;
 end;
end $$;
-- Run a list/summary statement as an actor and return its JSON text (or the refusal).
create function pg_temp.output(actor text,stmt text) returns text language plpgsql as $$
declare r text; begin
 perform pg_temp.act(actor);
 begin execute 'select ('||stmt||')::text' into r; return coalesce(r,'');
 exception when others then return 'refused '||sqlstate; end;
end $$;

-- Snapshot of tenant A's durable state; nothing tenant B does may change it.
create temporary table a_before as
 select (select to_jsonb(c) from recorder_config c where tenant_id=pg_temp.xid('a.tenant')) config,
        (select jsonb_agg(to_jsonb(s) order by s.id) from recorder_sessions s where tenant_id=pg_temp.xid('a.tenant')) sessions,
        (select count(*) from recording_analysis_reviews where tenant_id=pg_temp.xid('a.tenant')) reviews,
        (select count(*) from recording_transcript_revisions where tenant_id=pg_temp.xid('a.tenant')) revisions,
        (select count(*) from recording_analysis_jobs where tenant_id=pg_temp.xid('a.tenant')) jobs,
        (select count(*) from recording_action_tasks x join recorder_sessions s on s.id=x.session_id where s.tenant_id=pg_temp.xid('a.tenant')) action_tasks,
        (select count(*) from recording_customer_links where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))) links,
        (select count(*) from recording_follow_ups where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))) follow_ups,
        (select count(*) from recording_playback_grants where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))) playback_grants,
        (select count(*) from recorder_tickets where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))) tickets,
        (select count(*) from audit_logs where tenant_id=pg_temp.xid('a.tenant')) audits;
grant select on a_before to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Positive controls: tenant B's own contracts work, so the denials below are tenant scoping.
-- ---------------------------------------------------------------------------------------------
select ok(position(pg_temp.xid('b.session')::text in pg_temp.output('b.manager',$q$recording_conversations_page('{}'::jsonb,null,null,100)$q$))>0,'control: B manager lists B conversation');
select ok(pg_temp.output('b.manager',format('recorder_session_snapshot(%L)',pg_temp.xid('b.session'))) like '%XTSECRETB%','control: B manager reads B transcript snapshot');
select ok(pg_temp.output('b.rep',format('recording_conversation_card(%L)',pg_temp.xid('b.session'))) like '%'||pg_temp.xid('b.session')||'%','control: B rep reads own conversation card');
select ok(position(pg_temp.xid('b.session')::text in pg_temp.output('b.owner','recorder_list_sessions()'))>0,'control: B super admin lists B sessions');

-- ---------------------------------------------------------------------------------------------
-- Targeted contracts: tenant B's super admin, manager and salesperson against tenant A's IDs.
-- ---------------------------------------------------------------------------------------------
create temporary table targeted(label text,stmt text);
insert into targeted values
 ('session snapshot',format('select recorder_session_snapshot(%L)',pg_temp.xid('a.session'))),
 ('pause another tenant''s live recording',format('select recorder_control_session(%L,''pause'',null)',pg_temp.xid('a.open'))),
 ('stop another tenant''s live recording',format('select recorder_control_session(%L,''stop'',0)',pg_temp.xid('a.open'))),
 ('renew an ingestion ticket for another tenant''s session',format('select recorder_issue_ticket(%L,null,%L,false,null)',pg_temp.xid('a.device2'),pg_temp.xid('a.open'))),
 ('link a customer to another tenant''s recording',format('select recorder_link_customer(%L,''walkin:''||gen_random_uuid())',pg_temp.xid('a.session'))),
 ('analysis snapshot',format('select recording_analysis_snapshot(%L,null)',pg_temp.xid('a.session'))),
 ('analysis snapshot at a pinned revision',format('select recording_analysis_snapshot(%L,%L)',pg_temp.xid('a.session'),pg_temp.xid('a.revision'))),
 ('conversation card',format('select recording_conversation_card(%L)',pg_temp.xid('a.session'))),
 ('correct the transcript',format('select recording_correct_transcript(%L,%L,''[]''::jsonb,''x'')',pg_temp.xid('a.session'),pg_temp.xid('a.revision'))),
 ('request a rescore',format('select recording_request_rescore(%L,null,null,null,null,''x'')',pg_temp.xid('a.session'))),
 ('request reprocessing',format('select recording_request_reprocess(%L,''x'')',pg_temp.xid('a.session'))),
 ('approve the analysis',format('select recording_review_analysis(%L,''approve'',null,null)',pg_temp.xid('a.analysis'))),
 ('flag the analysis',format('select recording_review_analysis(%L,''flag'',''x'',null)',pg_temp.xid('a.analysis'))),
 ('mint an audio playback ticket',format('select recording_playback_ticket(%L,0,2000)',pg_temp.xid('a.session'))),
 ('create a follow-up task from the analysis',format('select recording_create_action_task(%L,0,now()+interval ''1 day'')',pg_temp.xid('a.analysis'))),
 ('list follow-up tasks',format('select recording_session_action_tasks(%L)',pg_temp.xid('a.session'))),
 ('read CRM integration',format('select recording_session_integration(%L)',pg_temp.xid('a.session'))),
 ('read follow-up options',format('select recording_follow_up_options(%L)',pg_temp.xid('a.session'))),
 ('link a CRM customer',format('select recording_link_crm_customer(%L,''{"kind":"walkin"}''::jsonb,gen_random_uuid(),null)',pg_temp.xid('a.session'))),
 ('unlink a CRM customer',format('select recording_unlink_crm_customer(%L,''x'')',pg_temp.xid('a.session'))),
 ('retry CRM sync',format('select recording_retry_crm_sync(%L)',pg_temp.xid('a.session'))),
 ('create a CRM follow-up',format('select recording_create_follow_up(jsonb_build_object(''analysis_id'',%L::uuid,''action_index'',0,''request_key'',gen_random_uuid(),''title'',''x'',''due_date'',current_date+1,''due_half'',''first''))',pg_temp.xid('a.analysis'))),
 ('activate another tenant''s rubric',format('select recording_activate_rubric_version(%L)',pg_temp.xid('a.rubric')));
select is(pg_temp.refused(actor,stmt),'refused','tenant B '||replace(actor,'b.','')||': '||label)
 from targeted cross join (values ('b.owner'),('b.manager'),('b.rep')) x(actor) order by label,actor;

-- Tenant A's own other-branch manager and inactive manager are refused the same reads.
select is(pg_temp.refused('a.farmanager',stmt),'refused','other-branch manager: '||label) from targeted
 where label in ('session snapshot','analysis snapshot','conversation card','mint an audio playback ticket','approve the analysis','read CRM integration','correct the transcript');
select is(pg_temp.refused('a.inactive',stmt),'refused','inactive manager: '||label) from targeted
 where label in ('session snapshot','analysis snapshot','conversation card','mint an audio playback ticket','approve the analysis');

-- recorder_can_read never answers true across tenants.
select pg_temp.act('b.owner');
select is(recorder_can_read(pg_temp.xid('a.rep'),pg_temp.xid('a.tenant'),pg_temp.xid('a.branch')),false,'can_read is false for another tenant, even for a super admin');

-- ---------------------------------------------------------------------------------------------
-- List and summary contracts: no tenant A identifier or text in anything tenant B sees.
-- ---------------------------------------------------------------------------------------------
create temporary table listing(label text,stmt text);
insert into listing values
 ('session list','recorder_list_sessions()'),
 ('conversations page',$q$recording_conversations_page('{}'::jsonb,null,null,100)$q$),
 ('conversations page searching A text',$q$recording_conversations_page('{"q":"XTSECRETA"}'::jsonb,null,null,100)$q$),
 ('today','recording_today()'),
 ('devices page','recording_devices_page(null,null,0,100)'),
 ('insights','recording_insights(current_date-30,current_date+1,null)'),
 ('coaching lists','recording_coaching_lists(current_date-30,current_date+1)'),
 ('integration health','recording_integration_health()'),
 ('workspace settings','recording_workspace_settings()'),
 ('analysis settings','recording_analysis_settings()'),
 ('rubric and SOP versions','recording_list_versions()'),
 ('linkable walk-ins','recorder_linkable_walkins()');
select ok(not pg_temp.leaks_a(pg_temp.output(actor,stmt)),'tenant B '||replace(actor,'b.','')||': '||label||' shows nothing of tenant A')
 from listing cross join (values ('b.owner'),('b.manager'),('b.rep')) x(actor) order by label,actor;
select ok(not pg_temp.leaks_a(pg_temp.output(actor,format('recording_insights(current_date-30,current_date+1,%L)',pg_temp.xid('a.rep'))))
 ,'tenant B '||replace(actor,'b.','')||': insights filtered to a tenant A employee show nothing of tenant A')
 from (values ('b.owner'),('b.manager')) x(actor);
-- Same-tenant other branch sees nothing of the store branch either.
-- Recording content only: the tenant's pilot allowlist (employee names) is tenant-wide settings by design (0383).
create function pg_temp.leaks_store(p text) returns boolean language sql as $$
 select coalesce(p,'') like '%XTSECRETA%' or exists(select 1 from xf where name in ('a.session','a.open','a.device','a.device2','a.analysis','a.revision','a.segment')
  and position(id::text in coalesce(p,''))>0)$$;
select ok(not pg_temp.leaks_store(pg_temp.output('a.farmanager',stmt)),'other-branch manager: '||label||' shows nothing of the store branch')
 from listing order by label;

-- ---------------------------------------------------------------------------------------------
-- Direct table reads under RLS (role authenticated).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.visible(actor text,tbl text,tenant_tag text) returns bigint language plpgsql as $$
declare n bigint; t uuid:=pg_temp.xid(tenant_tag||'.tenant'); ids uuid[]:=array(select id from xf where name like tenant_tag||'.%'); q text; begin
 -- Resolve everything first: the signed-in role cannot execute pg_temp helpers (0006 revokes default EXECUTE).
 q:=case when tbl in ('recorder_sessions','recorder_devices') then format('select count(*) from %I where tenant_id=%L',tbl,t)
         else format('select count(*) from %I where session_id=any(%L::uuid[])',tbl,ids) end;
 perform pg_temp.act(actor);
 set local role authenticated;
 execute q into n;
 reset role; return n;
end $$;
select is(pg_temp.visible(actor,tbl,'a'),0::bigint,'RLS: tenant B '||replace(actor,'b.','')||' sees no tenant A rows in '||tbl)
 from (values ('recorder_sessions'),('recorder_devices'),('recorder_segments'),('recorder_alerts')) t(tbl)
 cross join (values ('b.owner'),('b.manager'),('b.rep')) x(actor) order by tbl,actor;
select ok(pg_temp.visible('b.manager','recorder_sessions','b')>0 and pg_temp.visible('b.manager','recorder_segments','b')>0 and pg_temp.visible('b.manager','recorder_alerts','b')>0,
  'control: B manager reads B sessions, segments and alerts through RLS');
select is(pg_temp.visible('a.farmanager','recorder_sessions','a'),0::bigint,'RLS: other-branch manager sees no store-branch sessions');
select is(pg_temp.visible('a.farmanager',tbl,'a'),0::bigint,'RLS: other-branch manager sees no store-branch rows in '||tbl)
 from (values ('recorder_devices'),('recorder_segments'),('recorder_alerts')) t(tbl) order by tbl;
-- A deactivated account (disabled login, inactive account or resigned) reads nothing directly.
-- The 'manager' of the store branch is used, so the only change is the deactivation itself.
create function pg_temp.deactivated_reads(col text,val text) returns bigint language plpgsql as $$
declare n bigint:=0; tbl text; begin
 execute format('update user_profiles set %I=%L where id=%L',col,val,pg_temp.xid('a.manager'));
 foreach tbl in array array['recorder_sessions','recorder_devices','recorder_segments','recorder_alerts'] loop n:=n+pg_temp.visible('a.manager',tbl,'a'); end loop;
 reset role;
 update user_profiles set is_login_enabled=true,account_status='active',working_status='active' where id=pg_temp.xid('a.manager');
 return n;
end $$;
select ok(pg_temp.visible('a.manager','recorder_segments','a')>0,'control: the active store manager reads store segments');
select is(pg_temp.deactivated_reads('is_login_enabled','false'),0::bigint,'RLS: login-disabled manager reads no recording rows');
select is(pg_temp.deactivated_reads('account_status','inactive'),0::bigint,'RLS: inactive-account manager reads no recording rows');
select is(pg_temp.deactivated_reads('working_status','resigned'),0::bigint,'RLS: resigned manager reads no recording rows');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Configuration cannot reach across tenants.
-- ---------------------------------------------------------------------------------------------
select pg_temp.act('b.owner');
-- The allowlist validation only accepts active employees of the actor's own tenant (0377).
select throws_ok(format('select recorder_configure(true,array[%L]::uuid[],array[%L]::uuid[],7,false)',pg_temp.xid('a.rep'),pg_temp.xid('b.branch')),'22023','recorder_invalid_config',
  'tenant B super admin cannot allowlist a tenant A employee');
select throws_ok(format('select recorder_configure(true,array[%L]::uuid[],array[%L]::uuid[],7,false)',pg_temp.xid('b.rep'),pg_temp.xid('a.branch')),'22023','recorder_invalid_config',
  'tenant B super admin cannot allowlist a tenant A branch');
select lives_ok($$select recording_configure_analysis(false,'mk-sales-v1')$$,'tenant B super admin changes B analysis setting');
select lives_ok($$select recording_configure_crm_outcomes(45,25000)$$,'tenant B super admin changes B CRM outcome setting');
select lives_ok(format('select recorder_configure(false,array[%L]::uuid[],array[%L]::uuid[],14,false)',pg_temp.xid('b.rep'),pg_temp.xid('b.branch')),'tenant B super admin changes B pilot');
select is((select analysis_enabled from recorder_config where tenant_id=pg_temp.xid('b.tenant')),false,'B analysis setting changed');

-- ---------------------------------------------------------------------------------------------
-- Tenant A unchanged by everything above.
-- ---------------------------------------------------------------------------------------------
reset role;
select is((select to_jsonb(c) from recorder_config c where tenant_id=pg_temp.xid('a.tenant')),(select config from a_before),'tenant A pilot, analysis and CRM settings unchanged');
select is((select jsonb_agg(to_jsonb(s) order by s.id) from recorder_sessions s where tenant_id=pg_temp.xid('a.tenant')),(select sessions from a_before),'tenant A sessions unchanged (no pause/stop/link)');
select is((select count(*) from recording_analysis_reviews where tenant_id=pg_temp.xid('a.tenant')),(select reviews from a_before),'no review written on tenant A');
select is((select count(*) from recording_transcript_revisions where tenant_id=pg_temp.xid('a.tenant')),(select revisions from a_before),'no transcript correction written on tenant A');
select is((select count(*) from recording_analysis_jobs where tenant_id=pg_temp.xid('a.tenant')),(select jobs from a_before),'no rescore/reprocess job queued on tenant A');
select is((select count(*) from recording_action_tasks x join recorder_sessions s on s.id=x.session_id where s.tenant_id=pg_temp.xid('a.tenant')),(select action_tasks from a_before),'no follow-up task created on tenant A');
select is((select count(*) from recording_customer_links where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))),(select links from a_before),'no CRM link on tenant A');
select is((select count(*) from recording_follow_ups where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))),(select follow_ups from a_before),'no CRM follow-up on tenant A');
select is((select count(*) from recording_playback_grants where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))),(select playback_grants from a_before),'no audio playback grant on tenant A');
select is((select count(*) from recorder_tickets where session_id in (select id from recorder_sessions where tenant_id=pg_temp.xid('a.tenant'))),(select tickets from a_before),'no ingestion ticket minted for tenant A');
select is((select count(*) from audit_logs where tenant_id=pg_temp.xid('a.tenant')),(select audits from a_before),'no audit row written into tenant A');

-- ---------------------------------------------------------------------------------------------
-- Service boundary: a redeemed tenant A lease cannot write outside its own scope.
-- ---------------------------------------------------------------------------------------------
create temporary table lease(name text primary key,body jsonb);
grant all on lease to authenticated,service_role;
select pg_temp.act('a.rep');
insert into lease values('t1',recorder_issue_ticket(pg_temp.xid('a.device2'),null,pg_temp.xid('a.open'),false,null));
select pg_temp.srv();
update lease set body=body||jsonb_build_object('claims',recorder_ingest('redeem',jsonb_build_object('ticket',body->>'ticket'))->'session') where name='t1';
create function pg_temp.claims() returns jsonb language sql as $$
 select jsonb_build_object('session_id',c->>'id','device_id',c->>'device_id','employee_id',c->>'employee_id','tenant_id',c->>'tenant_id','branch_id',c->>'branch_id')
 from (select body->'claims' c from lease where name='t1') x$$;
select is(pg_temp.claims()->>'tenant_id',pg_temp.xid('a.tenant')::text,'redeem returns the session''s own tenant scope');
select throws_ok(format($$select recorder_ingest('chunk',pg_temp.claims()||jsonb_build_object('sequence',0,'sha256',repeat('e',64),'byte_count',64000,
  'object_key','recordings/%s/%s/%s/%s/%s/00000000-'||repeat('e',64)||'.pcm'))$$,
  pg_temp.xid('b.tenant'),pg_temp.xid('b.branch'),pg_temp.xid('b.rep'),pg_temp.xid('b.device2'),pg_temp.xid('b.open')),
  '42501','recorder_object_scope_denied','a tenant A lease cannot write a tenant B object key');
select throws_ok(format($$select recorder_ingest('chunk',pg_temp.claims()||jsonb_build_object('tenant_id',%L,'branch_id',%L,'sequence',0,'sha256',repeat('e',64),'byte_count',64000,'object_key','x'))$$,
  pg_temp.xid('b.tenant'),pg_temp.xid('b.branch')),'42501','recorder_scope_denied','a tenant A session cannot be re-scoped to tenant B');
select throws_ok(format($$select recorder_ingest('chunk',pg_temp.claims()||jsonb_build_object('session_id',%L,'sequence',0,'sha256',repeat('e',64),'byte_count',64000,'object_key','x'))$$,
  pg_temp.xid('b.open')),'42501','recorder_scope_denied','a tenant A lease cannot write into a tenant B session');
select throws_ok(format($$select recorder_ingest('heartbeat',pg_temp.claims()||jsonb_build_object('device_id',%L))$$,pg_temp.xid('b.device2')),
  '42501','recorder_scope_denied','a tenant A lease cannot report health for a tenant B device');

-- ---------------------------------------------------------------------------------------------
-- Lifecycle denial: expired ticket, revoked authorization, inactive user, missing consent.
-- Every redeem re-checks employment, branch, allowlist and recording.capture.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.fresh_ticket() returns text language plpgsql as $$
declare r jsonb; begin
 perform pg_temp.act('a.rep');
 r:=recorder_issue_ticket(pg_temp.xid('a.device2'),null,pg_temp.xid('a.open'),false,null);
 perform pg_temp.srv(); return r->>'ticket';
end $$;
create function pg_temp.redeem(ticket text) returns text language plpgsql as $$
begin perform pg_temp.srv(); perform recorder_ingest('redeem',jsonb_build_object('ticket',ticket)); return 'redeemed';
exception when others then return sqlerrm; end $$;

-- Expired ingestion ticket.
insert into lease values('expired',jsonb_build_object('ticket',pg_temp.fresh_ticket()));
reset role;
update recorder_tickets set expires_at=clock_timestamp()-interval '1 second' where hash=encode(digest((select body->>'ticket' from lease where name='expired'),'sha256'),'hex');
select is(pg_temp.redeem((select body->>'ticket' from lease where name='expired')),'recorder_ticket_denied','expired ingestion ticket is refused');
select is(pg_temp.redeem(repeat('0',64)),'recorder_ticket_denied','unknown ingestion ticket is refused');

-- Removed from the pilot allowlist after the ticket was issued.
insert into lease values('allowlist',jsonb_build_object('ticket',pg_temp.fresh_ticket()));
reset role;
update recorder_config set employee_ids='{}' where tenant_id=pg_temp.xid('a.tenant');
select is(pg_temp.redeem((select body->>'ticket' from lease where name='allowlist')),'recorder_session_denied','ticket refused after removal from the pilot allowlist');
reset role;
update recorder_config set employee_ids=array[pg_temp.xid('a.rep')] where tenant_id=pg_temp.xid('a.tenant');

-- Pilot switched off after the ticket was issued.
insert into lease values('disabled',jsonb_build_object('ticket',pg_temp.fresh_ticket()));
reset role;
update recorder_config set enabled=false where tenant_id=pg_temp.xid('a.tenant');
select is(pg_temp.redeem((select body->>'ticket' from lease where name='disabled')),'recorder_session_denied','ticket refused after the pilot is switched off');
reset role;
update recorder_config set enabled=true where tenant_id=pg_temp.xid('a.tenant');

-- recording.capture revoked after the ticket was issued.
insert into lease values('revoked',jsonb_build_object('ticket',pg_temp.fresh_ticket()));
reset role;
update user_permission_overrides set effect='deny' where user_profile_id=pg_temp.xid('a.rep') and permission_key='recording.capture';
select is(pg_temp.redeem((select body->>'ticket' from lease where name='revoked')),'recorder_session_denied','ticket refused after recording.capture is revoked');
select is(pg_temp.refused('a.rep',format('select recorder_issue_ticket(%L,null,%L,false,null)',pg_temp.xid('a.device2'),pg_temp.xid('a.open'))),'refused','no new ticket once recording.capture is revoked');
reset role;
update user_permission_overrides set effect='grant' where user_profile_id=pg_temp.xid('a.rep') and permission_key='recording.capture';

-- Employee made inactive after the ticket was issued.
insert into lease values('inactive',jsonb_build_object('ticket',pg_temp.fresh_ticket()));
reset role;
update user_profiles set working_status='inactive' where id=pg_temp.xid('a.rep');
select is(pg_temp.redeem((select body->>'ticket' from lease where name='inactive')),'recorder_session_denied','ticket refused after the employee is made inactive');
select is(pg_temp.refused('a.rep',format('select recorder_session_snapshot(%L)',pg_temp.xid('a.session'))),'refused','inactive employee cannot read their own recording');
reset role;
update user_profiles set working_status='active' where id=pg_temp.xid('a.rep');

-- Moved to another branch after the ticket was issued.
insert into lease values('moved',jsonb_build_object('ticket',pg_temp.fresh_ticket()));
reset role;
update user_profiles set branch_id=pg_temp.xid('a.branch2') where id=pg_temp.xid('a.rep');
select is(pg_temp.redeem((select body->>'ticket' from lease where name='moved')),'recorder_session_denied','ticket refused after the employee moves branch');
reset role;
update user_profiles set branch_id=pg_temp.xid('a.branch') where id=pg_temp.xid('a.rep');

-- Missing consent, and the wrong consent version, never start a recording.
reset role;
-- Tenant B's pilot was switched off by its own super admin above; switch it back on, so only consent decides.
update recorder_config set enabled=true where tenant_id=pg_temp.xid('b.tenant');
update recorder_sessions set status='ready',capture_ended_at=now() where id=pg_temp.xid('b.open');
select pg_temp.act('b.rep');
select throws_ok(format($$select recorder_issue_ticket(%L,gen_random_uuid(),null,false,'pilot-v1')$$,pg_temp.xid('b.device2')),'22023','recorder_consent_required','start without consent is refused');
select throws_ok(format($$select recorder_issue_ticket(%L,gen_random_uuid(),null,true,'pilot-v0')$$,pg_temp.xid('b.device2')),'22023',null,'start with an unknown consent version is refused');
select throws_ok(format($$select recorder_issue_ticket(%L,gen_random_uuid(),null,true,'pilot-v1')$$,pg_temp.xid('a.device2')),'42501',null,'start on another tenant''s registered device is refused');

-- A valid ticket still works after every restore (the denials above were the revocations).
select is(pg_temp.redeem(pg_temp.fresh_ticket()),'redeemed','control: restored employee redeems a fresh ticket');

select * from finish();
rollback;
