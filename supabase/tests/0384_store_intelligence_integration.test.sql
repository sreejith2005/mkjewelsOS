begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- Grants: the browser gets the named contracts; the transport contracts are service-only.
-- ---------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','recording_link_crm_customer(uuid,jsonb,uuid,text)','execute'),'signed-in users may link');
select ok(has_function_privilege('authenticated','recording_create_follow_up(jsonb)','execute'),'signed-in users may create follow-ups');
select ok(not has_function_privilege('anon','recording_session_integration(uuid)','execute'),'anon reads nothing');
select ok(not has_function_privilege('authenticated','crm_sync_finish_recording_event(uuid,uuid,jsonb,text)','execute'),'the browser cannot acknowledge its own link');
select ok(not has_function_privilege('authenticated','crm_sync_record_recording_outcomes(uuid,jsonb)','execute'),'the browser cannot record a CRM purchase');
select ok(has_function_privilege('service_role','crm_sync_claim_recording_events(integer)','execute'),'the transport claims events');
select ok(not has_function_privilege('service_role','recording_link_crm_customer(uuid,jsonb,uuid,text)','execute'),'service role has no browser contracts');
select ok(not has_function_privilege('authenticated','recording_insert_link(recorder_sessions,uuid,text,uuid,text,integer,text,text,text,uuid,uuid,text)','execute'),'link helper is internal');
select ok(not has_table_privilege('authenticated','recording_customer_links','select'),'no direct reads of links');
select ok(not has_table_privilege('authenticated','recording_follow_ups','select'),'no direct reads of follow-ups');
select ok(not has_table_privilege('authenticated','crm_sync.recording_events','select'),'outbox is private');
select ok((select relrowsecurity from pg_class where oid='recording_customer_links'::regclass),'link RLS on');
select is(recording_action_key('  Call back WITH two   chain designs '),recording_action_key('call back with two chain designs'),'action key ignores case and spacing');

-- ---------------------------------------------------------------------------------------------
-- Fixture (as 0383): a branch with a manager, two salespeople, a super admin; another branch.
-- ---------------------------------------------------------------------------------------------
create temporary table wf(name text primary key,id uuid);
grant all on wf to authenticated,service_role;
do $$ declare t uuid; b uuid; b2 uuid; d uuid; a uuid; u uuid; person text; dev uuid:=gen_random_uuid(); dev2 uuid:=gen_random_uuid(); r uuid;
 s1 uuid; s2 uuid; s3 uuid; v1 uuid; v2 uuid; j1 uuid; j2 uuid; a1 uuid; a2 uuid; begin
 insert into tenants(name,slug) values('Integration fixture','integration-fixture') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Store','INT') returning id into b;
 insert into branches(tenant_id,name,code) values(t,'Other','INT2') returning id into b2;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','INT') returning id into d;
 foreach person in array array['manager','rep','peer','farmanager','admin'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-int@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,case when person='farmanager' then b2 else b end,d,initcap(person),'INT-'||person,person||'-int@test.local',
    case person when 'manager' then 'manager' when 'farmanager' then 'manager' when 'admin' then 'super_admin' else 'staff' end::user_role,'active',true,'active') returning id into u;
  insert into wf values(person,u),(person||'_auth',a);
 end loop;
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,t,'module.sales_recording','grant' from wf where name in ('rep','peer');
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,t,'crm.view','grant' from wf where name in ('rep','manager','farmanager','admin');
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,t,'crm.view','deny' from wf where name='peer';
 insert into recorder_config(tenant_id,enabled,employee_ids,branch_ids,analysis_enabled) values(t,true,array[(select id from wf where name='rep')],array[b],true);
 insert into recorder_devices(id,tenant_id,branch_id,employee_id) values(dev,t,b,(select id from wf where name='rep')),(dev2,t,b,(select id from wf where name='peer'));
 -- s1: the rep's approved conversation (2 days ago). s2: the rep's later one (1 day ago). s3: the peer's, unlinked.
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,(select id from wf where name='rep'),dev,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),now()-interval '2 days') returning id into s1;
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,(select id from wf where name='rep'),dev,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),now()-interval '1 day') returning id into s2;
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at,created_at)
  values(t,b,(select id from wf where name='peer'),dev2,gen_random_uuid(),'pilot-v1','ready',0,-1,now(),now()-interval '3 hours') returning id into s3;
 r:=(recording_active_rubric(t)).id;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s1,1,'machine',repeat('a',64)) returning id into v1;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,content_sha256) values(t,s2,1,'machine',repeat('b',64)) returning id into v2;
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s1,v1,r,'mk-sales-v1','initial','done') returning id into j1;
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(t,s2,v2,r,'mk-sales-v1','initial','done') returning id into j2;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  values(t,s1,j1,v1,r,'mk-sales-v1','test','m','p1','scored',80,100,jsonb_build_object('summary','Customer wants a gold chain.',
   'next_best_actions',jsonb_build_array(jsonb_build_object('action','Call back with two chain designs','reason','Customer asked for options','evidence','[]'::jsonb),
     jsonb_build_object('action','Share making charge breakdown','reason','Price concern','evidence','[]'::jsonb)),
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','reported_purchase','confidence',0.9))),'{}'::jsonb) returning id into a1;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  values(t,s2,j2,v2,r,'mk-sales-v1','test','m','p1','scored',60,100,jsonb_build_object('summary','Came back for the chain.','next_best_actions','[]'::jsonb,
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','follow_up','confidence',0.8))),'{}'::jsonb) returning id into a2;
 insert into recording_analysis_reviews(tenant_id,session_id,analysis_id,actor_id,action,note) values(t,s1,a1,(select id from wf where name='manager'),'approve','Good');
 insert into wf values('tenant',t),('branch',b),('dept',d),('s1',s1),('s2',s2),('s3',s3),('a1',a1),('a2',a2),('v1',v1),('j1',j1),('rubric',r),
  ('client_x','20261106-aaaa-4000-8000-000000000001'),('client_y','20261106-aaaa-4000-8000-000000000002'),('visit_1','20261106-bbbb-4000-8000-000000000001');
end $$;
create function pg_temp.wid(n text) returns uuid language sql as $$select id from wf where name=n$$;
create function pg_temp.wact(n text) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.wid(n||'_auth'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',pg_temp.wid(n||'_auth')::text,true),set_config('request.jwt.claim.role','authenticated',true)$$;
create function pg_temp.svc() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true)$$;
create function pg_temp.target(p_client text,p_n integer default 2,p_name text default 'Asha Family') returns jsonb language sql as $$
 select jsonb_build_object('kind','client','target_id',pg_temp.wid(p_client),'match_basis','phone','candidate_count',p_n,'display_code','MKC-200001','display_name',p_name) $$;
create function pg_temp.integ(n text) returns jsonb language sql as $$ select recording_session_integration(pg_temp.wid(n)) $$;
-- Deliver every due event with one CRM answer per event type.
create function pg_temp.deliver(p_linked jsonb,p_unlinked jsonb default '{"outcome":"accepted","withdrawn":true}',p_error text default null) returns text[] language plpgsql as $$
declare e record; out text[]:='{}'; begin
 for e in select * from crm_sync_claim_recording_events(10) loop
  out:=out||crm_sync_finish_recording_event(e.id,e.lease_token,case when p_error is not null then null when e.payload->>'eventType'='store_conversation.linked' then p_linked else p_unlinked end,p_error);
 end loop; return out; end $$;
create function pg_temp.ack(p_client text) returns jsonb language sql as $$
 select jsonb_build_object('outcome','accepted','client_id',pg_temp.wid(p_client),'client_code','MKC-'||case p_client when 'client_x' then '200001' else '200002' end,
  'display_name',case p_client when 'client_x' then 'Asha Family (CRM)' else 'Ravi Family (CRM)' end) $$;

-- ---------------------------------------------------------------------------------------------
-- No customer: nothing is claimed.
-- ---------------------------------------------------------------------------------------------
select pg_temp.wact('peer');
select is(pg_temp.integ('s3')#>>'{outcome,crm,state}','pending_crm_confirmation','no customer: pending CRM confirmation');
select is(pg_temp.integ('s3')#>>'{readiness,client_match}','not_linked','readiness says not linked');
select is((pg_temp.integ('s3')->>'can_link')::boolean,false,'no CRM access: no linking');
select throws_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_x'),gen_random_uuid())$$,pg_temp.wid('s3')),'42501','recording_link_denied','without CRM access a person cannot link');

-- ---------------------------------------------------------------------------------------------
-- Several possible customers on one phone: a person chose one; it stays pending until the CRM says so.
-- ---------------------------------------------------------------------------------------------
select pg_temp.wact('rep');
select throws_ok(format($$select recording_link_crm_customer(%L,'{"kind":"client","target_id":"x"}',gen_random_uuid())$$,pg_temp.wid('s1')),'22023','recording_invalid_link','malformed choice refused');
select throws_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_x')||'{"phone":"9811111111"}',gen_random_uuid())$$,pg_temp.wid('s1')),'22023','recording_invalid_link','no extra customer data is stored');
select throws_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_x',0),gen_random_uuid())$$,pg_temp.wid('s1')),'22023','recording_invalid_link','a link needs at least one real candidate');
select is((recording_link_crm_customer(pg_temp.wid('s1'),pg_temp.target('client_x'),'20261106-cccc-4000-8000-000000000001')->>'already_linked')::boolean,false,'salesperson links the chosen customer');
select is((recording_link_crm_customer(pg_temp.wid('s1'),pg_temp.target('client_x'),'20261106-cccc-4000-8000-000000000001')->>'already_linked')::boolean,true,'a retried request is a replay');
select is((recording_link_crm_customer(pg_temp.wid('s1'),pg_temp.target('client_x'),gen_random_uuid())->>'already_linked')::boolean,true,'the same customer twice is one link');
select throws_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_y'),'20261106-cccc-4000-8000-000000000001')$$,pg_temp.wid('s1')),'23514','recording_request_reused','a request key cannot be reused for another customer');
select is(pg_temp.integ('s1')#>>'{customer,state}','pending','link is pending until the CRM acknowledges');
select is(pg_temp.integ('s1')#>>'{customer,sync}','queued','sync is queued, not synced');
select is((pg_temp.integ('s1')#>>'{customer,candidate_count}')::integer,2,'how many candidates the person chose from is kept');
select is(pg_temp.integ('s1')#>>'{outcome,crm,state}','pending_crm_confirmation','no CRM verdict yet');
select is(pg_temp.integ('s1')#>>'{outcome,ai_label}','converted','the AI-suggested intent is shown separately');
select ok(exists(select 1 from audit_logs where action='recording_customer_linked' and record_id=pg_temp.wid('s1')),'link audited');
select is((select count(*)::integer from crm_sync.recording_events where session_id=pg_temp.wid('s1')),1,'one CRM event queued');
select ok((select payload ? 'target' and not (payload ? 'transcript') and not (payload ? 'summary') from crm_sync.recording_events where session_id=pg_temp.wid('s1')),'the CRM event carries no transcript or AI text');
select pg_temp.wact('farmanager');
select throws_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_y'),gen_random_uuid(),'wrong')$$,pg_temp.wid('s1')),'42501',null,'another branch''s manager cannot touch the link');
select pg_temp.wact('peer');
select throws_ok(format($$select recording_session_integration(%L)$$,pg_temp.wid('s1')),'42501','recorder_session_denied','a colleague cannot read the link');

-- The transport acknowledges: CRM identifiers and display replace the browser's.
select pg_temp.svc();
select is(pg_temp.deliver(pg_temp.ack('client_x')),array['delivered'],'CRM accepted the link');
select pg_temp.wact('rep');
select is(pg_temp.integ('s1')#>>'{customer,state}','verified','verified by the CRM');
select is(pg_temp.integ('s1')#>>'{customer,sync}','synced','CRM entry synced');
select is(pg_temp.integ('s1')#>>'{customer,name}','Asha Family (CRM)','display comes from the CRM acknowledgement');
select is(pg_temp.integ('s1')#>>'{customer,display_source}','crm_ack','display source recorded');
select is((pg_temp.integ('s1')#>>'{customer,crm_client_id}')::uuid,pg_temp.wid('client_x'),'authoritative CRM id stored');
select ok(exists(select 1 from audit_logs where action='recording_customer_link_verified' and record_id=pg_temp.wid('s1')),'verification audited');
select is((select (c->'customer'->>'state') from jsonb_array_elements(recording_conversations_page('{"linked":true}')->'rows') c where (c->>'id')::uuid=pg_temp.wid('s1')),'verified','the card shows the verified customer and "only linked" finds it');

-- ---------------------------------------------------------------------------------------------
-- Wrong / duplicate phone: correcting needs a reason, withdraws the old CRM entry first.
-- ---------------------------------------------------------------------------------------------
select pg_temp.wact('manager');
select throws_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_y'),gen_random_uuid())$$,pg_temp.wid('s1')),'22023','recording_reason_required','changing the customer needs a reason');
select is((recording_link_crm_customer(pg_temp.wid('s1'),pg_temp.target('client_y',2,'Ravi Family'),gen_random_uuid(),'Same phone, it was her husband')->>'already_linked')::boolean,false,'manager corrects the customer');
select is(jsonb_array_length(pg_temp.integ('s1')->'history'),1,'the old link stays in history');
select is(pg_temp.integ('s1')#>>'{history,0,end_kind}','corrected','marked as a correction');
select ok(exists(select 1 from audit_logs where action='recording_customer_link_corrected' and record_id=pg_temp.wid('s1')),'correction audited');
select pg_temp.svc();
select is((select array_agg(payload->>'eventType') from crm_sync_claim_recording_events(10)),array['store_conversation.unlinked'],'the withdrawal goes first; the new link waits for it');
update crm_sync.recording_events set lease_until=now()-interval '1 second' where session_id=pg_temp.wid('s1');

-- Failed CRM sync: retries with backoff, then fails visibly; a person can retry; never "synced".
select is(pg_temp.deliver(null,null,'network'),array['retry'],'network failure is a retry');
select is((select last_error from crm_sync.recording_events where session_id=pg_temp.wid('s1') and event_type='store_conversation.unlinked'),'network','fixed error code kept');
update crm_sync.recording_events set next_attempt_at=now() where session_id=pg_temp.wid('s1');
select is(pg_temp.deliver(pg_temp.ack('client_y')),array['delivered'],'withdrawal delivered after the retry');
update crm_sync.recording_events set next_attempt_at=now() where session_id=pg_temp.wid('s1');
select is(pg_temp.deliver('{"outcome":"retry","reason":"previous_link_live"}'),array['retry'],'CRM asked to retry the new link');
select pg_temp.wact('rep');
select is(pg_temp.integ('s1')#>>'{customer,sync}','retrying','screen says retrying');
select is(pg_temp.integ('s1')#>>'{customer,state}','pending','still not verified');
update crm_sync.recording_events set attempts=10,next_attempt_at=now() where session_id=pg_temp.wid('s1') and event_type='store_conversation.linked';
select pg_temp.svc();
select is(pg_temp.deliver(null,null,'http_500'),array['dead'],'after ten attempts the event fails');
select pg_temp.wact('rep');
select is(pg_temp.integ('s1')#>>'{customer,sync}','failed','screen says failed');
select is(pg_temp.integ('s1')#>>'{readiness,crm_sync}','failed','readiness says failed');
select is((recording_retry_crm_sync(pg_temp.wid('s1'))->>'requeued')::integer,1,'the salesperson can send it again');
select ok(exists(select 1 from audit_logs where action='recording_crm_sync_retried'),'retry audited');
select pg_temp.svc();
select is(pg_temp.deliver('{"outcome":"source_unapproved"}'),array['held'],'an unapproved source is held');
select pg_temp.wact('rep');
select is(pg_temp.integ('s1')#>>'{customer,sync}','waiting_for_crm_approval','screen says waiting for CRM approval');
update crm_sync.recording_events set next_attempt_at=now() where session_id=pg_temp.wid('s1');
select pg_temp.svc();
select is(pg_temp.deliver(pg_temp.ack('client_y')),array['delivered'],'delivered once approved');
select pg_temp.wact('rep');
select is(pg_temp.integ('s1')#>>'{customer,name}','Ravi Family (CRM)','corrected customer verified');

-- A CRM refusal is final and shown.
select throws_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_x'),gen_random_uuid())$$,pg_temp.wid('s3')),'42501',null,'a salesperson cannot link another person''s conversation');
select pg_temp.wact('manager');
select lives_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_x',1,'Mystery'),gen_random_uuid())$$,pg_temp.wid('s3')),'manager links the peer''s conversation');
select pg_temp.svc();
select is(pg_temp.deliver('{"outcome":"rejected","reason":"target_not_found"}'),array['rejected'],'CRM refused the customer');
select pg_temp.wact('manager');
select is(pg_temp.integ('s3')#>>'{customer,state}','rejected','link shows refused');
select is(pg_temp.integ('s3')#>>'{customer,state_reason}','target_not_found','with the CRM''s reason');
select is(pg_temp.integ('s3')#>>'{outcome,crm,state}','pending_crm_confirmation','a refused link confirms nothing');
select throws_ok(format($$select recording_unlink_crm_customer(%L,'')$$,pg_temp.wid('s3')),'22023','recording_reason_required','unlink needs a reason');
select is((recording_unlink_crm_customer(pg_temp.wid('s3'),'CRM could not find this customer')->>'unlinked')::boolean,true,'refused link removed');
select ok(exists(select 1 from audit_logs where action='recording_customer_unlinked' and record_id=pg_temp.wid('s3')),'unlink audited');
select throws_ok($$delete from recording_customer_links$$,'23514','recording_evidence_immutable','links are never deleted');
select throws_ok(format($$update recording_customer_links set target_id=gen_random_uuid() where session_id=%L$$,pg_temp.wid('s3')),'23514','recording_evidence_immutable','links are never retargeted');

-- ---------------------------------------------------------------------------------------------
-- CRM-confirmed purchase after the recording date, counted once across repeat conversations.
-- ---------------------------------------------------------------------------------------------
select pg_temp.wact('rep');
select lives_ok(format($$select recording_link_crm_customer(%L,pg_temp.target('client_y',2,'Ravi Family'),gen_random_uuid())$$,pg_temp.wid('s2')),'the repeat conversation links the same customer');
select pg_temp.svc();
select ok('delivered'=all(pg_temp.deliver(pg_temp.ack('client_y'))),'second link (and the refused link''s withdrawal) delivered');
select is((select count(*)::integer from crm_sync_claim_recording_outcome_checks(50) c where c.tenant_id=pg_temp.wid('tenant')),2,'both verified links are due for an outcome check');
select is((select (since at time zone 'Asia/Kolkata')::time from crm_sync_claim_recording_outcome_checks(50) where link_id=(select id from recording_customer_links where session_id=pg_temp.wid('s1') and ended_at is null)),'00:00'::time,'the window starts at the start of the recording''s India day');
-- No purchase yet for the conversation whose AI said "converted": unverified.
select is(crm_sync_record_recording_outcomes(pg_temp.wid('tenant'),jsonb_build_array(
 jsonb_build_object('linkId',(select id from recording_customer_links where session_id=pg_temp.wid('s1') and ended_at is null),'state','no_purchase_recorded','clientId',pg_temp.wid('client_y'),'visits',1))),1,'outcome recorded');
select pg_temp.wact('rep');
select is(pg_temp.integ('s1')#>>'{outcome,crm,state}','no_crm_purchase_yet','AI said converted, CRM shows no purchase yet: unverified');
select is(pg_temp.integ('s1')#>>'{outcome,ai_label}','converted','AI intent unchanged and separate');
select pg_temp.wact('manager');
select is((recording_insights(current_date-7,current_date)#>>'{crm,crm,ai_converted_not_confirmed}')::integer,1,'insights count the unverified AI conversion');
select is((recording_insights(current_date-7,current_date)#>>'{crm,crm,confirmed_purchases}')::integer,0,'no confirmed purchase yet');
-- A purchase is entered in the CRM after the recording date; both conversations see the same visit.
select pg_temp.svc();
select is(crm_sync_record_recording_outcomes(pg_temp.wid('tenant'),(select jsonb_agg(jsonb_build_object('linkId',l.id,'state','purchase_verified','clientId',pg_temp.wid('client_y'),'visits',2,
 'purchaseVisitId',pg_temp.wid('visit_1'),'purchaseVisitAt',now()-interval '2 hours','purchaseOutcome','YES')) from recording_customer_links l where l.session_id in (pg_temp.wid('s1'),pg_temp.wid('s2')) and l.ended_at is null)),2,'both outcomes refreshed');
select pg_temp.wact('rep');
select is(pg_temp.integ('s2')#>>'{outcome,crm,state}','crm_confirmed_purchase','the latest conversation before the purchase is credited');
select is(pg_temp.integ('s1')#>>'{outcome,crm,state}','purchase_credited_elsewhere','the earlier conversation is not credited again');
select pg_temp.wact('manager');
select is((recording_insights(current_date-7,current_date)#>>'{crm,crm,confirmed_purchases}')::integer,1,'one purchase counted once across repeat conversations');
select is(recording_insights(current_date-7,current_date)#>'{crm,revenue,estimated}','null'::jsonb,'no estimate without a configured ticket');
select is(recording_insights(current_date-7,current_date)#>'{crm,revenue,verified}','null'::jsonb,'no verified revenue: the CRM records no amounts');
select throws_ok($$select recording_configure_crm_outcomes(30,25000)$$,'42501',null,'a manager cannot set the estimate');
select pg_temp.wact('admin');
select is((recording_configure_crm_outcomes(30,25000)->>'estimated_ticket_inr')::numeric,25000::numeric,'an admin sets the average ticket');
select ok(exists(select 1 from audit_logs where action='recording_crm_outcomes_configured'),'estimate setting audited');
select is((recording_insights(current_date-7,current_date)#>>'{crm,revenue,estimated}')::numeric,25000::numeric,'estimate = 1 confirmed purchase × ticket, never double counted');
select is((recording_workspace_settings()#>>'{crm_outcomes,estimated_ticket_inr}')::numeric,25000::numeric,'settings show the ticket');
select pg_temp.svc();
select is((select count(*)::integer from crm_sync_claim_recording_outcome_checks(50) c where c.tenant_id=pg_temp.wid('tenant')),0,'checked links wait six hours before the next check');

-- ---------------------------------------------------------------------------------------------
-- Follow-ups: review first, one per suggested action across retries, the old button and rescoring.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.fu(p_analysis text,p_index integer,p_key uuid,p_extra jsonb default '{}') returns jsonb language sql as $$
 select recording_create_follow_up(jsonb_build_object('analysis_id',pg_temp.wid(p_analysis),'action_index',p_index,'request_key',p_key)||p_extra) $$;
select pg_temp.wact('rep');
select throws_ok($$select pg_temp.fu('a2',0,gen_random_uuid())$$,'42501','recording_action_denied','an unreleased review cannot create work');
select throws_ok($$select pg_temp.fu('a1',9,gen_random_uuid())$$,'22023','recording_action_not_found','unknown action refused');
select throws_ok($$select pg_temp.fu('a1',0,gen_random_uuid(),'{"due_date":"2026-01-01","due_half":"noon"}')$$,'22023','recording_invalid_due','due half must be first or second half');
select throws_ok($$select pg_temp.fu('a1',0,gen_random_uuid(),'{"send_whatsapp":true}')$$,'22023','recording_invalid_follow_up','no hidden sending option exists');
select throws_ok($$select pg_temp.fu('a1',0,gen_random_uuid(),jsonb_build_object('owner_id',pg_temp.wid('peer')))$$,'42501','recording_owner_denied','a salesperson cannot give it to a colleague');
create temporary table fu_result(name text primary key,v jsonb);
grant all on fu_result to authenticated;
insert into fu_result select 'first',pg_temp.fu('a1',0,'20261106-dddd-4000-8000-000000000001',jsonb_build_object('channel','whatsapp','title','Send two chain designs on WhatsApp','note','Prefers evenings',
 'due_date',((now() at time zone 'Asia/Kolkata')::date+1)::text,'due_half','first_half'));
select is((select (v->>'already_created')::boolean from fu_result where name='first'),false,'follow-up created');
select is((select (planned_datetime at time zone 'Asia/Kolkata')::time from task_instances where id=(select (v->>'task_id')::uuid from fu_result where name='first')),'15:00'::time,'first half is 3 PM India time');
select is((select title from task_instances where id=(select (v->>'task_id')::uuid from fu_result where name='first')),'Send two chain designs on WhatsApp','the reviewed title is used');
select ok((select description like '%nothing is sent automatically%' and description like '%/sales-recording/conversations/'||pg_temp.wid('s1')||'?tab=actions%' and description like '%Ravi Family (CRM)%'
 from task_instances where id=(select (v->>'task_id')::uuid from fu_result where name='first')),'task shows method, evidence link and CRM customer');
select is((select user_profile_id from task_assignees where task_instance_id=(select (v->>'task_id')::uuid from fu_result where name='first') and is_active and role_at_task='doer'),pg_temp.wid('rep'),'owned by the salesperson');
select ok(exists(select 1 from notifications where source_record_id=(select (v->>'task_id')::uuid from fu_result where name='first') and event_type='task_assigned' and user_profile_id=pg_temp.wid('rep')),'the existing assignment notification fired');
select is((select output->'next_best_actions'->0->>'action' from recording_analyses where id=pg_temp.wid('a1')),'Call back with two chain designs','editing the action never changes the source analysis');
select is((select source_text from recording_follow_ups where id=(select (v->>'follow_up_id')::uuid from fu_result where name='first')),'Call back with two chain designs','the original suggestion is kept as the source');
select ok(exists(select 1 from audit_logs where action='recording_follow_up_created' and record_id=pg_temp.wid('s1')),'creation audited');
select is((pg_temp.fu('a1',0,'20261106-dddd-4000-8000-000000000001')->>'follow_up_id'),(select v->>'follow_up_id' from fu_result where name='first'),'a retried request returns the same follow-up');
select is((pg_temp.fu('a1',0,gen_random_uuid())->>'already_created')::boolean,true,'a second tap never duplicates');
select is((recording_create_action_task(pg_temp.wid('a1'),0,now()+interval '1 day')->>'task_id'),(select v->>'task_id' from fu_result where name='first'),'the older button finds it too');
-- Rescore: a newer analysis repeats the same suggestion with different spacing and case.
select pg_temp.wact('manager');
do $$ declare a3 uuid; j3 uuid; begin
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state) values(pg_temp.wid('tenant'),pg_temp.wid('s1'),pg_temp.wid('v1'),pg_temp.wid('rubric'),'mk-sales-v2','rescore','done') returning id into j3;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,created_at,output,quality)
  values(pg_temp.wid('tenant'),pg_temp.wid('s1'),j3,pg_temp.wid('v1'),pg_temp.wid('rubric'),'mk-sales-v2','test','m','p2','scored',82,100,now()+interval '1 minute',jsonb_build_object('summary','Rescored.',
   'next_best_actions',jsonb_build_array(jsonb_build_object('action','call back with  two chain DESIGNS','reason','Same','evidence','[]'::jsonb),
    jsonb_build_object('action','Share making charge breakdown','reason','Price','evidence','[]'::jsonb),
    jsonb_build_object('action','Invite for the bridal collection preview','reason','Wedding in March','evidence','[]'::jsonb)),
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','follow_up','confidence',0.7))),'{}'::jsonb) returning id into a3;
 insert into recording_analysis_reviews(tenant_id,session_id,analysis_id,actor_id,action,note) values(pg_temp.wid('tenant'),pg_temp.wid('s1'),a3,pg_temp.wid('manager'),'approve','Rescored');
 insert into wf values('a3',a3);
end $$;
select is((pg_temp.fu('a3',0,gen_random_uuid())->>'task_id'),(select v->>'task_id' from fu_result where name='first'),'a rescore repeating the suggestion reuses the task');
select is((recording_create_action_task(pg_temp.wid('a1'),1,now()+interval '1 day')->>'already_created')::boolean,false,'the older button creates action 2 once');
select is((pg_temp.fu('a3',1,gen_random_uuid())->>'already_created')::boolean,true,'the new form finds the older button''s task after a rescore');
select is((select count(*)::integer from recording_follow_ups where session_id=pg_temp.wid('s1'))+(select count(*)::integer from recording_action_tasks where session_id=pg_temp.wid('s1')),2,'two suggestions, two pieces of work, no duplicates');
select throws_ok(format($$update recording_follow_ups set title='x' where session_id=%L$$,pg_temp.wid('s1')),'23514','recording_evidence_immutable','follow-up source records are immutable');
-- A manager delegates with an optional coaching reminder.
select throws_ok($$select pg_temp.fu('a3',2,gen_random_uuid(),jsonb_build_object('owner_id',pg_temp.wid('peer'),'supervisor_id',pg_temp.wid('rep')))$$,'42501','recording_supervisor_denied','only a branch manager can be the coaching reminder');
select throws_ok($$select pg_temp.fu('a3',2,gen_random_uuid(),jsonb_build_object('owner_id',pg_temp.wid('peer'),'supervisor_id',pg_temp.wid('manager')))$$,'42501','recording_supervisor_denied','the creator is not their own reminder (they already get the task''s updates)');
insert into fu_result select 'delegated',pg_temp.fu('a3',2,gen_random_uuid(),jsonb_build_object('owner_id',pg_temp.wid('peer'),'supervisor_id',pg_temp.wid('admin'),'channel','visit'));
select is((select user_profile_id from task_assignees where task_instance_id=(select (v->>'task_id')::uuid from fu_result where name='delegated') and is_active and role_at_task='doer'),pg_temp.wid('peer'),'a manager can assign a permitted delegate');
select ok(exists(select 1 from task_watchers where task_instance_id=(select (v->>'task_id')::uuid from fu_result where name='delegated') and user_profile_id=pg_temp.wid('admin')),'the supervisor is looped in through the existing watcher path');
select is((select (due_at at time zone 'Asia/Kolkata')::time from recording_follow_ups where id=(select (v->>'follow_up_id')::uuid from fu_result where name='delegated')) in ('15:00'::time,'21:00'::time),true,'no due date picked: the next half-day deadline');

-- FMS only when explicitly chosen, and only a manual-start flow.
select pg_temp.wact('admin');
do $$ declare flow uuid; auto uuid; st uuid; adm uuid:=pg_temp.wid('admin'); rule jsonb:='{"assignment":{"mode":"fixed_employee","sources":[],"allowHandoff":false},"deadlineEnabled":false}';
 a4 uuid; j4 uuid; begin
 insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version,start_mode,start_trigger)
  values(pg_temp.wid('tenant'),gen_random_uuid(),1,'Conversation follow-up','tenant','draft',true,adm,adm,2,'manual',null) returning id into flow;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,completion_rule) values(flow,'follow_1','Follow-Up 1','task',0,true,rule,'any_doer') returning id into st;
 insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values(st,'specific_user',pg_temp.wid('rep'),0);
 perform publish_fms_flow_with_audit(flow);
 insert into wf values('flow',flow);
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,job_version,reason,state)
  select pg_temp.wid('tenant'),pg_temp.wid('s2'),v.id,pg_temp.wid('rubric'),'mk-sales-v2','rescore','done' from recording_transcript_revisions v where v.session_id=pg_temp.wid('s2') returning id into j4;
 insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,status,raw_total,assessed_weight,output,quality)
  select pg_temp.wid('tenant'),pg_temp.wid('s2'),j4,v.id,pg_temp.wid('rubric'),'mk-sales-v2','test','m','p2','scored',70,100,jsonb_build_object('summary','Ready to order.',
   'next_best_actions',jsonb_build_array(jsonb_build_object('action','Start the custom order follow-up','reason','Wants a custom piece','evidence','[]'::jsonb)),
   'signals',jsonb_build_object('sales_outcome',jsonb_build_object('value','follow_up','confidence',0.8))),'{}'::jsonb from recording_transcript_revisions v where v.session_id=pg_temp.wid('s2') returning id into a4;
 insert into wf values('a4',a4);
end $$;
select is((select f->>'name' from jsonb_array_elements(recording_follow_up_options(pg_temp.wid('s2'))->'flows') f),'Conversation follow-up','a published manual-start flow is offered');
select throws_ok($$select pg_temp.fu('a4',0,gen_random_uuid(),jsonb_build_object('fms_flow_id',gen_random_uuid()))$$,'23514','recording_flow_not_startable','an unknown flow is refused');
insert into fu_result select 'fms',pg_temp.fu('a4',0,'20261106-dddd-4000-8000-000000000009',jsonb_build_object('fms_flow_id',pg_temp.wid('flow'),'channel','call'));
select ok((select v->>'fms_reference' like 'FMS-%' and v->>'task_id' is null from fu_result where name='fms'),'the chosen flow started through its audited manual start, not a task');
select is((select context->>'manual_start_key' from fms_instances where id=(select (v->>'fms_instance_id')::uuid from fu_result where name='fms')),
 md5('recording-follow-up:'||pg_temp.wid('s2')||':'||recording_action_key('Start the custom order follow-up'))::uuid::text,'the run keeps a deterministic idempotency key');
select is((pg_temp.fu('a4',0,gen_random_uuid(),jsonb_build_object('fms_flow_id',pg_temp.wid('flow')))->>'fms_instance_id'),(select v->>'fms_instance_id' from fu_result where name='fms'),'a retry never starts a second run');
select is((select count(*)::integer from fms_instances where fms_flow_id=pg_temp.wid('flow')),1,'exactly one run');
select ok(exists(select 1 from audit_logs where action='fms_instance_started_manually' and record_id=(select (v->>'fms_instance_id')::uuid from fu_result where name='fms')),'the FMS start is audited by its own contract');
select is((select count(*)::integer from form_submissions where tenant_id=pg_temp.wid('tenant')),0,'no form submission was fabricated');
select pg_temp.wact('manager');
select is(jsonb_array_length(recording_follow_up_options(pg_temp.wid('s1'))->'owners')>=3,true,'a manager may choose branch colleagues');
select pg_temp.wact('rep');
select is(jsonb_array_length(recording_follow_up_options(pg_temp.wid('s1'))->'owners'),1,'a salesperson owns their own follow-ups');
select is((select array_agg(f->>'name') from jsonb_array_elements(recording_follow_up_options(pg_temp.wid('s1'))->'flows') f),array['Conversation follow-up'],'only published manual-start flows are offered');
select is(jsonb_array_length(pg_temp.integ('s1')->'follow_ups'),3,'the conversation lists every follow-up, old and new');
select is((select f->>'status' from jsonb_array_elements(pg_temp.integ('s1')->'follow_ups') f where f->>'title'='Send two chain designs on WhatsApp'),'pending','live task status is shown');
select is(pg_temp.integ('s1')#>>'{readiness,work}','created','readiness: work created');
select ok(pg_temp.integ('s1')#>>'{readiness,notifications}' in ('pending','delivered'),'readiness: notification outcome from the existing engine');
select is(jsonb_array_length(recording_today()->'next_actions'),0,'Today hides suggestions that already have work');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.integ('s1')->'suggestions') x where x->'existing' is not null),3,'every suggestion of the latest analysis shows its existing work');
select is(pg_temp.integ('s1')#>>'{suggestions,0,existing,task_id}',(select v->>'task_id' from fu_result where name='first'),'the rescored suggestion points at the original task');

-- Manager readiness view.
select throws_ok($$select recording_integration_health()$$,'42501','recording_review_denied','salespeople do not get branch health');
select pg_temp.wact('manager');
select is((recording_integration_health()#>>'{client_match,verified}')::integer,2,'branch health counts verified links');
select is((recording_integration_health()#>>'{crm_sync,refused}')::integer,1,'and refused CRM entries');
select is((recording_integration_health()#>>'{work,created}')::integer,3,'and follow-ups made here (tasks and FMS)');
select is((recording_integration_health()#>>'{work,via_fms}')::integer,1,'one through FMS');

select * from finish();
rollback;
