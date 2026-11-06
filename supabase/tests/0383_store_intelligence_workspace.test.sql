begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Grants: browser gets the named contracts only.
select ok(not has_function_privilege('anon','recording_conversations_page(jsonb,timestamptz,uuid,integer)','execute'),'anon cannot list conversations');
select ok(has_function_privilege('authenticated','recording_conversations_page(jsonb,timestamptz,uuid,integer)','execute'),'signed-in users may list conversations');
select ok(has_function_privilege('authenticated','recording_today()','execute'),'today is callable');
select ok(has_function_privilege('authenticated','recording_create_action_task(uuid,integer,timestamptz)','execute'),'follow-up task is callable');
select ok(not has_function_privilege('authenticated','recording_session_card(recorder_sessions,boolean)','execute'),'card helper is internal');
select ok(not has_function_privilege('authenticated','recording_visible_analysis(uuid,boolean)','execute'),'visibility helper is internal');
select ok(not has_function_privilege('service_role','recording_insights(date,date,uuid)','execute'),'service role has no browser contracts');
select ok(not has_table_privilege('authenticated','recording_action_tasks','select'),'no direct reads of follow-up links');
select ok((select relrowsecurity from pg_class where oid='recording_action_tasks'::regclass),'follow-up link RLS on');

create temporary table wf(name text primary key,id uuid);
grant all on wf to authenticated,service_role;
do $$ declare t uuid; b uuid; b2 uuid; d uuid; a uuid; u uuid; person text; dev uuid:=gen_random_uuid(); dev2 uuid:=gen_random_uuid(); r uuid;
 s1 uuid; s2 uuid; s3 uuid; v1 uuid; v2 uuid; j1 uuid; j2 uuid; a1 uuid; a2 uuid; seg uuid:=gen_random_uuid(); begin
 insert into tenants(name,slug) values('Workspace fixture','workspace-fixture') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Store','WSF') returning id into b;
 insert into branches(tenant_id,name,code) values(t,'Other','WSF2') returning id into b2;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','WSF') returning id into d;
 foreach person in array array['manager','rep','peer','farmanager','inactive'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-wsf@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,case when person='farmanager' then b2 else b end,d,initcap(person),'WSF-'||person,person||'-wsf@test.local',
    case when person in ('manager','farmanager','inactive') then 'manager' else 'staff' end::user_role,(case when person='inactive' then 'inactive' else 'active' end)::working_status,true,'active') returning id into u;
  insert into wf values(person,u),(person||'_auth',a);
 end loop;
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,t,'module.sales_recording','grant' from wf where name in ('rep','peer');
 insert into recorder_config(tenant_id,enabled,employee_ids,branch_ids,analysis_enabled) values(t,true,array[(select id from wf where name='rep')],array[b],true);
 insert into recorder_devices(id,tenant_id,branch_id,employee_id) values(dev,t,b,(select id from wf where name='rep')),(dev2,t,b,(select id from wf where name='peer'));
 -- s1: the rep's approved, scored conversation (4 chunks = 6.03 s). s2: the rep's unreviewed one. s3: the peer's, still processing.
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,(select id from wf where name='rep'),dev,gen_random_uuid(),'pilot-v1','ready',4,3,now(),now()-interval '2 hours') returning id into s1;
 insert into recorder_chunks select s1,g,lpad(to_hex(g+10),64,'c'),case when g=3 then 1000 else 64000 end,
  'recordings/'||t||'/'||b||'/'||(select id from wf where name='rep')||'/'||dev||'/'||s1||'/'||lpad(g::text,8,'0')||'-'||lpad(to_hex(g+10),64,'c')||'.pcm',now() from generate_series(0,3) g;
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,(select id from wf where name='rep'),dev,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),now()-interval '1 hour') returning id into s2;
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,(select id from wf where name='peer'),dev2,gen_random_uuid(),'pilot-v1','processing',0,-1,now(),now()-interval '30 minutes') returning id into s3;
 r:=(recording_active_rubric(t)).id;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s1,1,'machine',repeat('a',64)) returning id into v1;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s2,1,'machine',repeat('b',64)) returning id into v2;
 insert into recording_transcript_segments(revision_id,session_id,segment_id,ordinal,source_sequence,source_offset_ms,start_ms,end_ms,raw_text) values(v1,s1,seg,0,0,0,0,2000,'Looking for a gold chain');
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s1,v1,r,'mk-sales-v1','initial','done') returning id into j1;
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s2,v2,r,'mk-sales-v1','initial','done') returning id into j2;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  values(t,s1,j1,v1,r,'mk-sales-v1','test','m','p1','scored',80,100,jsonb_build_object('summary','Customer wants a gold chain for a wedding.',
   'product_interests',jsonb_build_array(jsonb_build_object('text','Gold chain','evidence','[]'::jsonb)),
   'customer_concerns',jsonb_build_array(jsonb_build_object('text','Making charges','evidence','[]'::jsonb)),'purchase_blockers','[]'::jsonb,'competitor_mentions','[]'::jsonb,
   'coaching_interventions',jsonb_build_array(jsonb_build_object('text','Ask about the occasion first','reason','Builds trust','evidence','[]'::jsonb)),
   'next_best_actions',jsonb_build_array(jsonb_build_object('action','Call back with two chain designs','reason','Customer asked for options','evidence','[]'::jsonb),
     jsonb_build_object('action','Share making charge breakdown','reason','Price concern','evidence','[]'::jsonb)),
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','reported_purchase','confidence',0.9),'price_concern',jsonb_build_object('detected',true,'confidence',0.9))),'{}'::jsonb) returning id into a1;
 insert into recording_score_dimensions(analysis_id,dimension_key,label,configured_weight,status,rating,reason,evidence)
  select a1,k,l,w,case when k='objection_handling' then 'not_applicable' else 'assessed' end,case when k='objection_handling' then null else g end,'Reason',
   case when k='objection_handling' then '[]'::jsonb else '[{"segment_id":"00000000-0000-4000-8000-000000000000","quote":"x"}]'::jsonb end
  from (values ('greeting_sop','Greeting & SOP',15,9),('product_knowledge','Product Knowledge',20,9),('needs_discovery','Needs Discovery & Listening',15,5),
   ('objection_handling','Objection Handling',15,0),('pricing_value','Pricing & Value Communication',10,8),('closing_follow_up','Closing & Follow-up',15,8),
   ('personalization_empathy','Personalization & Empathy',10,9)) v(k,l,w,g);
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  values(t,s2,j2,v2,r,'mk-sales-v1','test','m','p1','scored',50,100,jsonb_build_object('summary','Browsing rings.','next_best_actions','[]'::jsonb,
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','enquiry','confidence',0.7))),'{}'::jsonb) returning id into a2;
 insert into recording_analysis_reviews(tenant_id,session_id,analysis_id,actor_id,action,note) values(t,s1,a1,(select id from wf where name='manager'),'approve','Good');
 insert into wf values('tenant',t),('s1',s1),('s2',s2),('s3',s3),('a1',a1),('a2',a2);
end $$;
create function pg_temp.wid(n text) returns uuid language sql as $$select id from wf where name=n$$;
create function pg_temp.wact(n text) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.wid(n||'_auth'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',pg_temp.wid(n||'_auth')::text,true),set_config('request.jwt.claim.role','authenticated',true)$$;
create function pg_temp.ids(p jsonb) returns uuid[] language sql as $$select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),'{}') from jsonb_array_elements(p->'rows') x$$;
create function pg_temp.sorted(variadic p uuid[]) returns uuid[] language sql as $$select array_agg(x order by x::text) from unnest(p) x$$;
create function pg_temp.card(p jsonb,s uuid) returns jsonb language sql as $$select x from jsonb_array_elements(p->'rows') x where (x->>'id')::uuid=s$$;

-- Who sees which conversations.
select pg_temp.wact('rep');
select is(pg_temp.ids(recording_conversations_page()),pg_temp.sorted(pg_temp.wid('s1'),pg_temp.wid('s2')),'employee sees only own conversations');
select is((pg_temp.card(recording_conversations_page(),pg_temp.wid('s1'))#>>'{analysis,score}')::numeric,80::numeric,'employee sees the approved score');
select is(pg_temp.card(recording_conversations_page(),pg_temp.wid('s2'))->'analysis','null'::jsonb,'employee does not see an unapproved review');
select is((pg_temp.card(recording_conversations_page(),pg_temp.wid('s2'))->>'awaiting_review')::boolean,true,'employee is told a review is waiting');
select is((pg_temp.card(recording_conversations_page(),pg_temp.wid('s1'))->>'duration_ms')::bigint,6031::bigint,'duration comes from saved audio');
select is((recording_conversations_page()->>'is_reviewer')::boolean,false,'employee is not a reviewer');
select pg_temp.wact('peer');
select is(pg_temp.ids(recording_conversations_page()),array[pg_temp.wid('s3')],'colleague sees only their own');
select throws_ok(format($$select recording_conversation_card(%L)$$,pg_temp.wid('s1')),'42501','recorder_session_denied','colleague cannot open another person''s conversation');
select pg_temp.wact('manager');
select is(pg_temp.ids(recording_conversations_page()),pg_temp.sorted(pg_temp.wid('s1'),pg_temp.wid('s2'),pg_temp.wid('s3')),'manager sees the branch');
select is((pg_temp.card(recording_conversations_page(),pg_temp.wid('s2'))#>>'{analysis,score}')::numeric,50::numeric,'manager sees unreviewed AI score');
select is(pg_temp.card(recording_conversations_page(),pg_temp.wid('s3'))->>'stage','processing','stage is plain');
select pg_temp.wact('farmanager');
select is(pg_temp.ids(recording_conversations_page()),'{}'::uuid[],'another branch''s manager sees nothing');
select pg_temp.wact('inactive');
select throws_ok($$select recording_conversations_page()$$,'42501',null,'inactive manager refused');

-- Filters and paging.
select pg_temp.wact('manager');
select is(pg_temp.ids(recording_conversations_page('{"stage":"processing"}')),array[pg_temp.wid('s3')],'stage filter');
select is(pg_temp.ids(recording_conversations_page('{"outcome":"reported_purchase"}')),array[pg_temp.wid('s1')],'outcome filter');
select is(pg_temp.ids(recording_conversations_page('{"q":"chain"}')),array[pg_temp.wid('s1')],'search covers summary and products');
select is(pg_temp.ids(recording_conversations_page('{"q":"pee"}')),array[pg_temp.wid('s3')],'search covers employee name');
select is(pg_temp.ids(recording_conversations_page('{"q":"100%_"}')),'{}'::uuid[],'search wildcards are literal');
select is(pg_temp.ids(recording_conversations_page('{"min_score":60}')),array[pg_temp.wid('s1')],'score filter');
select is(pg_temp.ids(recording_conversations_page(jsonb_build_object('employee_id',pg_temp.wid('peer')))),array[pg_temp.wid('s3')],'employee filter');
select throws_ok($$select recording_conversations_page('{"evil":1}')$$,'22023','recording_invalid_filter','unknown filter refused');
select throws_ok($$select recording_conversations_page('{"date_from":"not a date"}')$$,'22023','recording_invalid_filter','bad date refused');
select is(jsonb_array_length(recording_conversations_page('{}',null,null,1)->'rows'),1,'page size respected');
select is((recording_conversations_page('{}',null,null,1)->>'has_more')::boolean,true,'more pages flagged');
select is((recording_conversations_page('{}',(select created_at from recorder_sessions where id=pg_temp.wid('s3')),pg_temp.wid('s3'),5)->'rows'->0->>'id')::uuid,pg_temp.wid('s2'),'keyset cursor continues after the last row');

-- A manager's edit replaces the AI total everywhere.
select recording_review_analysis(pg_temp.wid('a1'),'edit','Discovery was better on the audio','[{"key":"needs_discovery","status":"assessed","rating":7,"reason":"Asked about the wedding"}]');
select pg_temp.wact('rep');
select is((pg_temp.card(recording_conversations_page(),pg_temp.wid('s1'))#>>'{analysis,manager_scored}')::boolean,true,'edit is visible as a manager score');
-- 10 * (9*15+9*20+7*15+8*10+8*15+9*10) / 85 assessed weight.
select is((pg_temp.card(recording_conversations_page(),pg_temp.wid('s1'))#>>'{analysis,score}')::numeric,83.53::numeric,'manager score replaces the AI score');

-- Today.
select is((recording_today()#>>'{today,total}')::integer,2,'today counts own conversations');
select is((recording_today()->>'can_record')::boolean,false,'no capture permission means no recording');
select is(jsonb_array_length(recording_today()->'next_actions'),2,'next actions from the approved review');
select is((recording_today()#>>'{coaching,reviewed}')::integer,1,'coaching counts released reviews only');
select is(recording_today()#>>'{coaching,focus,label}','Needs Discovery & Listening','focus is the weakest area');
select is((recording_today()#>>'{coaching,focus,average}')::numeric,7.0,'focus uses the manager''s edited rating');
select is((recording_today()#>>'{coaching,average_score}')::numeric,83.5,'average uses the manager score');
select is(recording_today()->'review_queue','null'::jsonb,'employees get no review queue');

-- Follow-up tasks: released reviews only, one task per action.
select throws_ok(format($$select recording_create_action_task(%L,0,now()+interval '1 day')$$,pg_temp.wid('a2')),'42501','recording_action_denied','unreleased review cannot create work');
select throws_ok(format($$select recording_create_action_task(%L,5,now()+interval '1 day')$$,pg_temp.wid('a1')),'22023','recording_action_not_found','unknown action refused');
select throws_ok(format($$select recording_create_action_task(%L,0,now()+interval '200 days')$$,pg_temp.wid('a1')),'22023','recording_invalid_due','far due date refused');
select is((recording_create_action_task(pg_temp.wid('a1'),0,now()+interval '1 day')->>'already_created')::boolean,false,'first tap creates the task');
select is((recording_create_action_task(pg_temp.wid('a1'),0,now()+interval '2 days')->>'already_created')::boolean,true,'second tap reuses it');
select is((select count(*)::integer from recording_action_tasks where analysis_id=pg_temp.wid('a1')),1,'one link per action');
select is((select title from task_instances where id=(select task_id from recording_action_tasks where analysis_id=pg_temp.wid('a1'))),'Follow up: Call back with two chain designs','task carries the action');
select is((select user_profile_id from task_assignees where task_instance_id=(select task_id from recording_action_tasks where analysis_id=pg_temp.wid('a1')) and is_active),pg_temp.wid('rep'),'task goes to the recorded employee');
select is((select task_type::text from task_instances where id=(select task_id from recording_action_tasks where analysis_id=pg_temp.wid('a1'))),'checklist','one tick completes it');
select ok(exists(select 1 from audit_logs where action='recording_action_task_created' and record_id=pg_temp.wid('s1')),'creation audited');
select is(jsonb_array_length(recording_today()->'next_actions'),1,'a tasked action leaves Next Actions');
select is(jsonb_array_length(recording_session_action_tasks(pg_temp.wid('s1'))),1,'task status is readable on the conversation');
select pg_temp.wact('peer');
select throws_ok(format($$select recording_create_action_task(%L,1,now()+interval '1 day')$$,pg_temp.wid('a1')),'42501','recording_action_denied','colleague cannot act on it');
select throws_ok(format($$select recording_session_action_tasks(%L)$$,pg_temp.wid('s1')),'42501','recorder_session_denied','colleague cannot read its tasks');

-- Devices: managers only, own branch, plain statuses.
select throws_ok($$select recording_devices_page()$$,'42501','recording_review_denied','employees cannot see devices');
select pg_temp.wact('manager');
select is((recording_devices_page()->>'total')::integer,2,'manager sees branch devices');
select is((recording_devices_page('idle')->>'total')::integer,2,'freshly seen phones are idle, not recording');
select ok(recording_devices_page()->'rows'->0->>'device_label' like 'Phone ending %','devices have a readable label');
select throws_ok($$select recording_devices_page('offline')$$,'22023','recording_invalid_filter','unknown status refused');
select pg_temp.wact('farmanager');
select is((recording_devices_page()->>'total')::integer,0,'other branch sees none');

-- Insights and coaching lists.
select pg_temp.wact('manager');
select is((recording_insights(current_date-7,current_date+1)#>>'{totals,conversations}')::integer,3,'branch totals');
select is((recording_insights(current_date-7,current_date+1)#>>'{outcomes,reported_purchase}')::integer,1,'AI-heard outcomes counted');
select is((recording_insights(current_date-7,current_date+1)#>>'{signals,price_concern}')::integer,1,'signals counted');
select is((recording_insights(current_date-7,current_date+1)#>>'{follow_ups,created}')::integer,1,'follow-up effectiveness counts tasks');
select is((recording_insights(current_date-7,current_date+1)->>'crm_outcomes_connected')::boolean,false,'CRM outcomes are not claimed');
select is(recording_insights(current_date-7,current_date+1)#>>'{top_mentions,products,0,text}','gold chain','product mentions aggregated');
select is((recording_insights(current_date-7,current_date+1,pg_temp.wid('peer'))#>>'{totals,conversations}')::integer,1,'employee filter');
select throws_ok($$select recording_insights(current_date,current_date-1)$$,'22023','recording_invalid_filter','reversed range refused');
select throws_ok($$select recording_insights(current_date-400,current_date)$$,'22023','recording_invalid_filter','range capped at a year');
select is((select (x->>'id')::uuid from jsonb_array_elements(recording_coaching_lists(current_date-7,current_date+1)->'to_review') x),pg_temp.wid('s2'),'unreviewed work listed');
select is((select (x->>'id')::uuid from jsonb_array_elements(recording_coaching_lists(current_date-7,current_date+1)->'strongest') x),pg_temp.wid('s1'),'strongest released example listed');
select is(jsonb_array_length(recording_coaching_lists(current_date-7,current_date+1)->'notes'),2,'manager notes listed');
select is((recording_today()->>'review_queue')::integer,1,'manager sees the review queue');
select is(recording_workspace_settings()->'choices','null'::jsonb,'only the configurer gets allowlist pickers');
select is((recording_workspace_settings()#>>'{config,enabled}')::boolean,true,'settings show the configuration');
select pg_temp.wact('rep');
select throws_ok($$select recording_insights(current_date-7,current_date)$$,'42501','recording_review_denied','employees cannot read insights');
select throws_ok($$select recording_coaching_lists(current_date-7,current_date)$$,'42501','recording_review_denied','employees cannot read coaching lists');
select throws_ok($$select recording_workspace_settings()$$,'42501','recording_rubric_denied','employees cannot read settings');

-- Retention: an expired conversation cannot create new work.
select pg_temp.wact('manager');
update recorder_sessions set expires_at=now()-interval '1 minute' where id=pg_temp.wid('s1');
select throws_ok(format($$select recording_create_action_task(%L,1,now()+interval '1 day')$$,pg_temp.wid('a1')),'22023','recording_retention_expired','expired conversation');
select is((pg_temp.card(recording_conversations_page(),pg_temp.wid('s1'))->>'retention_expired')::boolean,true,'list marks retention expiry');

select * from finish();
rollback;
