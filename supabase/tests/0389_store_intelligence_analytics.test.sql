begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Grants: the browser gets the four reads only; roll-ups and helpers stay internal.
select ok(not has_function_privilege('anon','recording_analytics(jsonb)','execute'),'anon cannot read analytics');
select ok(has_function_privilege('authenticated','recording_analytics(jsonb)','execute'),'signed-in users may call analytics');
select ok(has_function_privilege('authenticated','recording_analytics_sessions(jsonb,text,timestamptz,uuid,integer)','execute'),'drill-down is callable');
select ok(has_function_privilege('authenticated','recording_device_days_page(jsonb,integer,integer)','execute'),'device days is callable');
select ok(has_function_privilege('authenticated','recording_analytics_options()','execute'),'options are callable');
select ok(not has_function_privilege('authenticated','recording_refresh_facts(uuid,integer)','execute'),'refresh is internal');
select ok(not has_function_privilege('authenticated','recording_fact_rows(uuid,recording_analytics_args,date,date)','execute'),'row source is internal');
select ok(not has_function_privilege('service_role','recording_analytics(jsonb)','execute'),'service role has no browser contract');
select ok(not has_table_privilege('authenticated','recording_session_facts','select'),'no direct reads of the roll-up');
select ok(not has_table_privilege('authenticated','recorder_device_days','select'),'no direct reads of device days');
select ok((select relrowsecurity from pg_class where oid='recording_session_facts'::regclass),'roll-up RLS on');
select is((select default_roles::text[] from permission_catalog where key='recording.analytics_all_branches'),'{super_admin,admin}'::text[],'all-branch analytics defaults to Super Admin and Admin');

-- Pure helpers.
select is(recording_price_band('around 50k'),'50k_1l','50k is in 50k-1L');
select is(recording_price_band('Rs 1,50,000'),'1l_2l','Indian grouping is read');
select is(recording_price_band('1.5 lakh'),'1l_2l','lakh unit');
select is(recording_price_band('under 20 thousand'),'under_25k','thousand unit');
select is(recording_price_band('maybe 2'),null,'bare small number gives no band');
select is(recording_product_categories(array['gold ear rings']),array['earrings'],'ear rings are earrings, not rings');
select is(recording_product_categories(array['diamond ring','gold chain']),array['chain','ring'],'two products, two categories');
select is(recording_product_elements(array['diamond ring','gold chain']),array['diamond','gold'],'metal words');
select is(recording_crm_class(null,null,null),'not_linked','not linked is unknown, not lost');
select is(recording_crm_class('verified','no_purchase',now()+interval '1 day'),'open','window still open');
select is(recording_crm_class('verified','no_purchase',now()-interval '1 day'),'lost','window closed without purchase');
select is(recording_crm_class('pending','purchase_credited',null),'pending','unverified link never confirms');

create temporary table af(name text primary key,id uuid);
grant all on af to authenticated,service_role;
-- Period under test: 5-6 Oct 2026 (India). Prior period: 3-4 Oct.
do $$ declare t uuid; b uuid; b2 uuid; d uuid; a uuid; u uuid; person text; dev uuid:=gen_random_uuid(); dev2 uuid:=gen_random_uuid(); r uuid; rep uuid; rep2 uuid; mgr uuid;
 s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; v uuid; j uuid; an uuid; l uuid; visit uuid:=gen_random_uuid(); seg text:='[{"segment_id":"00000000-0000-4000-8000-000000000000","quote":"x"}]'; begin
 insert into tenants(name,slug) values('Analytics fixture','analytics-fixture') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Main store','ANF') returning id into b;
 insert into branches(tenant_id,name,code) values(t,'Second store','ANF2') returning id into b2;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','ANF') returning id into d;
 foreach person in array array['manager','admin','farmanager','rep','rep2'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-anf@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,case when person in ('farmanager','rep2') then b2 else b end,d,initcap(person),'ANF-'||person,person||'-anf@test.local',
    case when person in ('manager','farmanager') then 'manager' when person='admin' then 'admin' else 'staff' end::user_role,'active'::working_status,true,'active') returning id into u;
  insert into af values(person,u),(person||'_auth',a);
 end loop;
 rep:=(select id from af where name='rep'); rep2:=(select id from af where name='rep2'); mgr:=(select id from af where name='manager');
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,t,'module.sales_recording','grant' from af where name in ('rep','rep2');
 insert into recorder_config(tenant_id,enabled,employee_ids,branch_ids,analysis_enabled) values(t,true,array[rep,rep2],array[b,b2],true);
 insert into recorder_devices(id,tenant_id,branch_id,employee_id,last_seen_at) values(dev,t,b,rep,'2026-10-05 04:00:00+00'),(dev2,t,b2,rep2,'2026-10-05 04:00:00+00');
 r:=(recording_active_rubric(t)).id;
 -- s1: 10:30 IST 5 Oct, scored 80 and approved, evidenced product and budget, CRM-confirmed purchase.
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,rep,dev,gen_random_uuid(),'pilot-v1','ready',4,3,now(),'2026-10-05 05:00:00+00') returning id into s1;
 insert into recorder_chunks select s1,g,lpad(to_hex(g+10),64,'c'),case when g=3 then 1000 else 64000 end,'anf/'||s1||'/'||g,now() from generate_series(0,3) g;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s1,1,'machine',repeat('a',64)) returning id into v;
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s1,v,r,'mk-sales-v1','initial','done') returning id into j;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  values(t,s1,j,v,r,'mk-sales-v1','test','m','p1','scored',80,100,jsonb_build_object('summary','Gold chain for a wedding.',
   'product_interests',jsonb_build_array(jsonb_build_object('text','Gold  Chain','evidence',seg::jsonb)),
   'customer_requirements',jsonb_build_object('budget',jsonb_build_object('text','around 50k','evidence',seg::jsonb)),
   'customer_concerns',jsonb_build_array(jsonb_build_object('text','Making charges','evidence',seg::jsonb)),
   'competitor_mentions',jsonb_build_array(jsonb_build_object('text','Other Jewellers','evidence',seg::jsonb)),
   'coaching_strengths',jsonb_build_array(jsonb_build_object('text','Asked about the occasion','evidence',seg::jsonb)),
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','reported_purchase','confidence',0.9),'price_concern',jsonb_build_object('detected',true,'confidence',0.9,'evidence',seg::jsonb))),'{}'::jsonb) returning id into an;
 insert into recording_score_dimensions(analysis_id,dimension_key,label,configured_weight,status,rating,reason,evidence)
  values(an,'greeting_sop','Greeting & SOP',15,'assessed',9,'Reason',seg::jsonb),(an,'needs_discovery','Needs Discovery & Listening',15,'assessed',5,'Reason',seg::jsonb);
 insert into recording_analysis_reviews(tenant_id,session_id,analysis_id,actor_id,action,note) values(t,s1,an,mgr,'approve','Good');
 -- s2: 23:50 IST 5 Oct (still 5 Oct in India), scored 50, not reviewed, no evidence, CRM: no purchase and window closed.
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,rep,dev,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),'2026-10-05 18:20:00+00') returning id into s2;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s2,1,'machine',repeat('b',64)) returning id into v;
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s2,v,r,'mk-sales-v1','initial','done') returning id into j;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  values(t,s2,j,v,r,'mk-sales-v1','test','m','p1','scored',50,100,jsonb_build_object('summary','Browsing rings.',
   'product_interests',jsonb_build_array(jsonb_build_object('text','Ring','evidence','[]'::jsonb)),
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','follow_up','confidence',0.7))),'{}'::jsonb) returning id into an;
 insert into af values('a2',an);
 -- s3: 00:10 IST 6 Oct (18:40 UTC on 5 Oct), AI review still queued, not linked.
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,rep,dev,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),'2026-10-05 18:40:00+00') returning id into s3;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s3,1,'machine',repeat('c',64)) returning id into v;
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s3,v,r,'mk-sales-v1','initial','pending');
 -- s4: the second branch, same day.
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b2,rep2,dev2,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),'2026-10-05 06:00:00+00') returning id into s4;
 -- s5: prior period, past retention (its analysis is already gone).
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at,expires_at)
  values(t,b,rep,dev,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),'2026-10-03 06:00:00+00',now()-interval '1 day') returning id into s5;
 -- s6: 09:00 IST 5 Oct, same customer and the same CRM purchase visit as s1 (credited to the later s1).
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,rep,dev,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),'2026-10-05 03:30:00+00') returning id into s6;
 -- CRM links (verified) and outcomes.
 insert into recording_customer_links(tenant_id,session_id,target_kind,target_id,match_basis,candidate_count,display_source,display_expires_at,state,verified_at,linked_by,request_key,crm_client_id)
  values(t,s1,'client',gen_random_uuid(),'client_code',1,'crm_search',now()+interval '1 day','verified',now(),rep,gen_random_uuid(),gen_random_uuid()) returning id into l;
 insert into recording_crm_outcomes(link_id,tenant_id,session_id,state,purchase_visit_id,purchase_visit_at,purchase_outcome,visits,window_from,window_until,checked_at,next_check_at)
  values(l,t,s1,'purchase_verified',visit,'2026-10-05 06:30:00+00','YES',1,'2026-10-04 18:30:00+00','2026-11-04 18:30:00+00',now(),now()+interval '6 hours');
 insert into recording_customer_links(tenant_id,session_id,target_kind,target_id,match_basis,candidate_count,display_source,display_expires_at,state,verified_at,linked_by,request_key,crm_client_id)
  values(t,s6,'client',gen_random_uuid(),'client_code',1,'crm_search',now()+interval '1 day','verified',now(),rep,gen_random_uuid(),gen_random_uuid()) returning id into l;
 insert into recording_crm_outcomes(link_id,tenant_id,session_id,state,purchase_visit_id,purchase_visit_at,purchase_outcome,visits,window_from,window_until,checked_at,next_check_at)
  values(l,t,s6,'purchase_verified',visit,'2026-10-05 06:30:00+00','YES',1,'2026-10-04 18:30:00+00','2026-11-04 18:30:00+00',now(),now()+interval '6 hours');
 insert into recording_customer_links(tenant_id,session_id,target_kind,target_id,match_basis,candidate_count,display_source,display_expires_at,state,verified_at,linked_by,request_key,crm_client_id)
  values(t,s2,'client',gen_random_uuid(),'client_code',1,'crm_search',now()+interval '1 day','verified',now(),rep,gen_random_uuid(),gen_random_uuid()) returning id into l;
 insert into recording_crm_outcomes(link_id,tenant_id,session_id,state,visits,window_from,window_until,checked_at,next_check_at)
  values(l,t,s2,'no_purchase_recorded',0,'2026-10-04 18:30:00+00',now()-interval '1 hour',now(),now()+interval '6 hours');
 insert into af values('tenant',t),('b',b),('b2',b2),('dev',dev),('s1',s1),('s2',s2),('s3',s3),('s4',s4),('s5',s5),('s6',s6);
end $$;
create function pg_temp.aid(n text) returns uuid language sql as $$select id from af where name=n$$;
create function pg_temp.aact(n text) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.aid(n||'_auth'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',pg_temp.aid(n||'_auth')::text,true),set_config('request.jwt.claim.role','authenticated',true)$$;
create function pg_temp.period() returns jsonb language sql as $$select '{"from":"2026-10-05","to":"2026-10-06"}'::jsonb$$;
create function pg_temp.drill(p jsonb,m text,lim integer default 25) returns uuid[] language sql as $$
 select coalesce(array_agg((x->>'session_id')::uuid order by x->>'session_id'),'{}') from jsonb_array_elements(recording_analytics_sessions(p,m,null,null,lim)->'rows') x$$;
create function pg_temp.sorted(variadic p uuid[]) returns uuid[] language sql as $$select array_agg(x order by x::text) from unnest(p) x$$;

select ok((select count(*) from recording_fact_queue where tenant_id=pg_temp.aid('tenant'))>=6,'changes queue their conversations for recount');

-- Who may read.
select pg_temp.aact('rep');
select throws_ok($$select recording_analytics(pg_temp.period())$$,'42501',null,'a salesperson cannot read branch analytics');
select pg_temp.aact('manager');
select throws_ok($$select recording_analytics(pg_temp.period()||jsonb_build_object('branch_ids',jsonb_build_array(pg_temp.aid('b2'))))$$,'42501',null,'a manager cannot ask for another branch');
select throws_ok($$select recording_analytics('{"from":"2026-10-06","to":"2026-10-05"}')$$,'22023',null,'reversed dates are refused');
select throws_ok($$select recording_analytics('{"from":"2025-01-01","to":"2026-10-05"}')$$,'22023',null,'more than 366 days is refused');
select throws_ok($$select recording_analytics(pg_temp.period()||'{"sql":"x"}')$$,'22023',null,'unknown filter keys are refused');

create temporary table res as select recording_analytics(pg_temp.period()) j;
select is((select count(*) from recording_fact_queue where tenant_id=pg_temp.aid('tenant')),0::bigint,'a read drains the queue (data is current)');
select is((select j#>>'{meta,timezone}' from res),'Asia/Kolkata','period is in India time');
select is((select (j#>>'{current,sessions}')::int from res),4,'manager sees the four conversations of their branch in the period');
select is((select (j#>>'{current,branches}')::int from res),1,'one branch in scope');
-- Timezone boundaries: 23:50 IST stays on 5 Oct; 00:10 IST is 6 Oct.
select is((select (d->>'sessions')::int from res,jsonb_array_elements(j->'by_day') d where d->>'date'='2026-10-05'),3,'5 Oct (IST) holds s1, s2 and s6');
select is((select (d->>'sessions')::int from res,jsonb_array_elements(j->'by_day') d where d->>'date'='2026-10-06'),1,'00:10 IST counts on 6 Oct');
-- Score uses the scored denominator, not every conversation.
select is((select (j#>>'{current,scored}')::int from res),2,'two scored');
select is((select (j#>>'{current,average_score}')::numeric from res),65.0,'average = (80+50)/2 over scored only');
select is((select (j#>>'{current,analysed}')::int from res),2,'two analysed');
select is((select (j#>>'{current,not_analysed}')::int from res),2,'queued and unlinked conversations are not analysed (never zero-scored)');
select is((select (j#>>'{current,unreviewed}')::int from res),1,'one review waiting');
select is((select (j#>>'{current,with_audio}')::int from res),1,'average duration counts only conversations with audio');
select is((select (j#>>'{current,average_duration_ms}')::bigint from res),6031::bigint,'duration from captured audio (193000 bytes / 32)');
-- CRM outcomes: one purchase visit credited once.
select is((select (j#>>'{current,crm,confirmed}')::int from res),1,'one confirmed purchase, not two');
select is((select (j#>>'{current,crm,credited_elsewhere}')::int from res),1,'the earlier conversation is credited elsewhere');
select is((select (j#>>'{current,crm,lost}')::int from res),1,'closed window without purchase is lost');
select is((select (j#>>'{current,crm,eligible}')::int from res),3,'eligible = verified, checked links');
select is((select (j#>>'{current,crm,not_linked}')::int from res),1,'unlinked conversations are unknown');
select is((select (j#>>'{current,outcomes,follow_up}')::int from res),1,'AI follow-up kept apart from CRM');
-- Evidence-based stages.
select is((select (j#>>'{current,funnel,engaged}')::int from res),2,'engaged = analysed with enough speech');
select is((select (j#>>'{current,funnel,interest}')::int from res),1,'interest needs an evidenced product (s2 had none)');
select is((select (j#>>'{current,funnel,price}')::int from res),1,'price discussed needs evidence');
select is((select (j#>>'{current,funnel,confirmed}')::int from res),1,'confirmed stage is CRM-verified');
select is((select (c->>'sessions')::int from res,jsonb_array_elements(j->'categories') c where c->>'key'='chain'),1,'product category from the words used');
select is((select (c->>'confirmed')::int from res,jsonb_array_elements(j->'categories') c where c->>'key'='chain'),1,'category conversion counts the confirmed purchase');
select is((select p->>'text' from res,jsonb_array_elements(j->'products') p where p->>'text' like 'gold%'),'gold chain','product text normalised');
select is((select (b->>'sessions')::int from res,jsonb_array_elements(j->'price_bands') b where b->>'key'='50k_1l'),1,'budget band');
select is((select (b->>'sessions')::int from res,jsonb_array_elements(j->'price_bands') b where b->>'key'='not_stated'),1,'no budget is "not stated"');
select is((select (j#>>'{current,at_risk}')::int from res),0,'confirmed purchases are not at risk');
-- Prior period and retention.
select is((select (j#>>'{prior,sessions}')::int from res),1,'prior period has one conversation');
select is((select (j#>>'{prior,retention_removed}')::int from res),1,'expired recording counted as removed after retention');
select is((select (j#>>'{prior,not_analysed}')::int from res),0,'removed after retention is not "not analysed"');
select is((select (j#>>'{prior,average_score}') from res),null,'no score in prior period is unknown, not zero');
-- Delayed AI job and freshness.
select is((select (j#>>'{meta,freshness,analysis_waiting}')::int from res),1,'queued AI review is reported');
select is((select (j#>>'{meta,freshness,queued}')::int from res),0,'nothing left to recount');
-- Rankings inputs: per person and per branch.
select is((select (e->>'sessions')::int from res,jsonb_array_elements(j->'by_employee') e where (e->>'employee_id')::uuid=pg_temp.aid('rep')),4,'rep has four conversations');
select is((select (e->>'prior_sessions')::int from res,jsonb_array_elements(j->'by_employee') e where (e->>'employee_id')::uuid=pg_temp.aid('rep')),1,'and one in the prior period');
select is((select jsonb_array_length(j->'by_branch') from res),1,'one branch row');
select is((select (j#>>'{correlation,sessions,n}')::int from res),2,'score vs conversion uses scored, eligible conversations');
select is((select (j#>>'{correlation,employees,n}')::int from res),0,'too few to correlate people');

-- Empty period: zero conversations, no division errors, averages unknown.
select is((select (recording_analytics('{"from":"2026-01-01","to":"2026-01-02"}')#>>'{current,sessions}')::int),0,'empty period has zero conversations');
select is((select recording_analytics('{"from":"2026-01-01","to":"2026-01-02"}')#>>'{current,average_score}'),null,'empty period has no average');

-- Filters.
select is((select (recording_analytics(pg_temp.period()||'{"crm":"confirmed"}')#>>'{current,sessions}')::int),1,'CRM filter');
select is((select (recording_analytics(pg_temp.period()||'{"category":"chain"}')#>>'{current,sessions}')::int),1,'category filter');
select is((select (recording_analytics(pg_temp.period()||'{"product":"CHAIN"}')#>>'{current,sessions}')::int),1,'product filter is case-insensitive');
select is((select (recording_analytics(pg_temp.period()||jsonb_build_object('device_id',pg_temp.aid('dev')))#>>'{current,sessions}')::int),4,'device filter');

-- Drill-down returns exactly the conversations behind a figure.
select is(pg_temp.drill(pg_temp.period(),'crm:confirmed'),array[pg_temp.aid('s1')],'confirmed drill-down');
select is(pg_temp.drill(pg_temp.period(),'scored'),pg_temp.sorted(pg_temp.aid('s1'),pg_temp.aid('s2')),'scored drill-down');
select is(pg_temp.drill(pg_temp.period(),'not_analysed'),pg_temp.sorted(pg_temp.aid('s3'),pg_temp.aid('s6')),'not analysed drill-down');
select is(pg_temp.drill('{"from":"2026-10-06","to":"2026-10-06"}','sessions'),array[pg_temp.aid('s3')],'day drill-down honours India time');
select is(pg_temp.drill(pg_temp.period(),'slot:1-23'),array[pg_temp.aid('s2')],'Monday 11pm slot');
select is(pg_temp.drill(pg_temp.period(),'category:chain'),array[pg_temp.aid('s1')],'category drill-down');
select is((recording_analytics_sessions(pg_temp.period(),'sessions',null,null,1)->>'total')::int,4,'drill-down total equals the figure');
select is(recording_analytics_sessions(pg_temp.period(),'sessions',null,null,1)->>'has_more','true','first page says there is more');
select is((select count(distinct id) from (
  select (recording_analytics_sessions(pg_temp.period(),'sessions',null,null,2)->'rows'->0->>'session_id') id union all
  select (recording_analytics_sessions(pg_temp.period(),'sessions',null,null,2)->'rows'->1->>'session_id') union all
  select (x->>'session_id') from jsonb_array_elements(recording_analytics_sessions(pg_temp.period(),'sessions',
   (recording_analytics_sessions(pg_temp.period(),'sessions',null,null,2)->'rows'->1->>'created_at')::timestamptz,
   (recording_analytics_sessions(pg_temp.period(),'sessions',null,null,2)->'rows'->1->>'session_id')::uuid,2)->'rows') x) z),4::bigint,'keyset pages cover every conversation once');
select is((recording_analytics_sessions(pg_temp.period(),'sessions',null,null,1)->'rows'->0->>'can_open'),'true','own-branch rows can be opened');
select ok(not (recording_analytics_sessions(pg_temp.period(),'sessions',null,null,1)->'rows'->0 ? 'summary'),'drill-down carries no summary text');
select throws_ok($$select recording_analytics_sessions(pg_temp.period(),'drop table',null,null,5)$$,'22023',null,'unknown metric is refused');
select throws_ok($$select recording_analytics_sessions(pg_temp.period(),'slot:9-99',null,null,5)$$,'22023',null,'malformed slot is refused');
select throws_ok($$select recording_analytics_sessions(pg_temp.period(),'category',null,null,5)$$,'22023',null,'metric without its value is refused');

-- Source changes are picked up on the next read.
reset role;
insert into recording_analysis_reviews(tenant_id,session_id,analysis_id,actor_id,action,note) values(pg_temp.aid('tenant'),pg_temp.aid('s2'),pg_temp.aid('a2'),pg_temp.aid('manager'),'flag','Check pricing');
select pg_temp.aact('manager');
select is((select (recording_analytics(pg_temp.period())#>>'{current,unreviewed}')::int),0,'a new review is counted on the next read');
select is((select (recording_analytics(pg_temp.period())#>>'{current,flagged}')::int),1,'and the flag');
-- Delayed AI job finishes later: the conversation moves from not analysed to analysed.
reset role;
update recording_analysis_jobs set state='dead' where session_id=pg_temp.aid('s3');
select pg_temp.aact('manager');
select is((select (recording_analytics(pg_temp.period())#>>'{meta,freshness,analysis_waiting}')::int),0,'finished jobs leave the waiting count');

-- All-branch scope: Admin sees both branches; other branches are metadata only.
select pg_temp.aact('admin');
select is((select (recording_analytics(pg_temp.period())#>>'{current,sessions}')::int),5,'admin sees every branch');
select is((select jsonb_array_length(recording_analytics(pg_temp.period())->'by_branch')),2,'two branch rows to compare');
select is((select (recording_analytics(pg_temp.period()||jsonb_build_object('branch_ids',jsonb_build_array(pg_temp.aid('b2'))))#>>'{current,sessions}')::int),1,'admin can narrow to one branch');
select is((select x->>'can_open' from jsonb_array_elements(recording_analytics_sessions(pg_temp.period()||jsonb_build_object('branch_ids',jsonb_build_array(pg_temp.aid('b2'))),'sessions',null,null,5)->'rows') x),'false','another branch''s conversation cannot be opened from analytics');
select is((select jsonb_array_length(recording_analytics_options()->'branches')),2,'admin options list both branches');
select pg_temp.aact('farmanager');
select is((select (recording_analytics(pg_temp.period())#>>'{current,sessions}')::int),1,'the other branch manager sees only their branch');
select is((select jsonb_array_length(recording_analytics_options()->'branches')),1,'manager options list one branch');
-- Revoking the permission narrows an Admin back to their branch.
reset role;
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) values(pg_temp.aid('admin'),pg_temp.aid('tenant'),'recording.analytics_all_branches','deny');
select pg_temp.aact('admin');
select is((select (recording_analytics(pg_temp.period())#>>'{current,sessions}')::int),4,'without the permission an Admin sees their own branch');
select throws_ok($$select recording_analytics(pg_temp.period()||jsonb_build_object('branch_ids',jsonb_build_array(pg_temp.aid('b2'))))$$,'42501',null,'and cannot ask for another');

-- Connected time: contacts at most 2 minutes apart add the gap; a longer silence adds nothing.
reset role;
update recorder_devices set last_seen_at='2026-10-05 04:01:00+00' where id=pg_temp.aid('dev');
update recorder_devices set last_seen_at='2026-10-05 04:02:30+00' where id=pg_temp.aid('dev');
update recorder_devices set last_seen_at='2026-10-05 04:20:00+00' where id=pg_temp.aid('dev');
select is((select connected_ms from recorder_device_days where device_id=pg_temp.aid('dev') and local_date='2026-10-05'),150000::bigint,'60 s + 90 s connected; the 17.5 min gap is not');
select is((select contacts from recorder_device_days where device_id=pg_temp.aid('dev') and local_date='2026-10-05'),4,'every contact counted (first sighting and three more)');
select pg_temp.aact('manager');
select is((select (x->>'connected_ms')::bigint from jsonb_array_elements(recording_device_days_page(pg_temp.period())->'rows') x where x->>'date'='2026-10-05'),150000::bigint,'device day shows connected time');
select is((select (x->>'recorded_ms')::bigint from jsonb_array_elements(recording_device_days_page(pg_temp.period())->'rows') x where x->>'date'='2026-10-05'),6031::bigint,'and recorded time from the same day');
select is((recording_device_days_page(pg_temp.period())->>'total')::int,2,'one row per phone and India day');

select * from finish();
rollback;
