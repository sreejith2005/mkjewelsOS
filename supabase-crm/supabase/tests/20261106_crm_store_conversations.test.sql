begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Grants: the browser gets the exact-match search only; the transport contracts are service-only.
select ok(has_function_privilege('authenticated','crm_store_conversation_candidates(text)','EXECUTE'),'signed-in CRM users can search candidates');
select ok(not has_function_privilege('anon','crm_store_conversation_candidates(text)','EXECUTE'),'anonymous cannot search customers');
select ok(not has_function_privilege('authenticated','crm_apply_store_conversation_event(text,jsonb)','EXECUTE'),'browser cannot impersonate the JewelOS transport');
select ok(not has_function_privilege('authenticated','crm_store_conversation_outcomes(uuid,jsonb)','EXECUTE'),'browser cannot read outcome evidence in bulk');
select ok(has_function_privilege('service_role','crm_apply_store_conversation_event(text,jsonb)','EXECUTE'),'transport may apply events');
select ok(not has_table_privilege('authenticated','crm_private.store_conversation_inbox','SELECT'),'receipts stay private');
select ok(not has_table_privilege('authenticated','crm_store_conversations','INSERT'),'no direct writes to conversation evidence');

-- Synthetic CRM: two branches, an active CRM user mapped to JewelOS, an unmapped JewelOS user.
insert into branches(id,name,jewelos_branch_id) values('20261106-0000-4000-8000-000000000001','Store A','20261106-0000-4000-8000-0000000000a1');
insert into users(id,name,email,role,branch_id,active) values
 ('20261106-1111-4000-8000-000000000001','Synthetic seller','sc-seller@example.invalid','salesperson','20261106-0000-4000-8000-000000000001',true),
 ('20261106-1111-4000-8000-000000000002','Synthetic admin','sc-admin@example.invalid','super_admin',null,true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id) select id,email,id,id from users where email like 'sc-%@example.invalid';
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) select id,'20261106-9999-4000-8000-000000000001',now(),true from users where email like 'sc-%@example.invalid';
-- Two family members share one phone; a third client has a different phone; one open lead.
insert into clients(client_id,primary_name,primary_phone,last_branch_id,lifecycle_stage) values
 ('20261106-2222-4000-8000-000000000001','Asha Family','+919811111111','20261106-0000-4000-8000-000000000001','visited'),
 ('20261106-2222-4000-8000-000000000002','Ravi Family','+919811111111','20261106-0000-4000-8000-000000000001','visited'),
 ('20261106-2222-4000-8000-000000000003','Meera Solo','+919822222222','20261106-0000-4000-8000-000000000001','visited');
insert into leads(id,phone_number,name,country_code,created_by) values('20261106-3333-4000-8000-000000000001','919833333333','Lead Only','+91','20261106-1111-4000-8000-000000000001');
insert into entry_queue(id,token,client_name,mobile,branch_id) values('20261106-4444-4000-8000-000000000001','T1','Walk In','9844444444','20261106-0000-4000-8000-000000000001');

-- Candidate search, as an active CRM user.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261106-1111-4000-8000-000000000001',true);
set local role authenticated;
select is(crm_store_conversation_candidates('98111 11111')->>'query_kind','phone','a phone number is searched as a phone');
select is(jsonb_array_length(crm_store_conversation_candidates('9811111111')->'candidates'),2,'a shared family phone returns every person, never a merge');
select ok((select bool_and(c->>'phone_hint'='••1111') from jsonb_array_elements(crm_store_conversation_candidates('9811111111')->'candidates') c),'only the last four digits are shown');
select is(jsonb_array_length(crm_store_conversation_candidates('9800000000')->'candidates'),0,'an unknown phone finds nobody and creates nobody');
select is(jsonb_array_length(crm_store_conversation_candidates('9833333333')->'candidates'),1,'an enquiry phone finds its one CRM record, not the lead and its client twice');
select is(crm_store_conversation_candidates((select lower(client_code) from clients where client_id='20261106-2222-4000-8000-000000000003'))->'candidates'->0->>'target_id',
 '20261106-2222-4000-8000-000000000003','an exact client code matches one client (case-insensitive)');
select is(crm_store_conversation_candidates('Meera')->>'query_kind','invalid','a name alone is not a search: no fuzzy matching');
select is((select count(*)::integer from clients),4,'searching never creates a client (3 customers + the lead''s own record)');
reset role;
select set_config('request.jwt.claim.sub','20261106-5555-4000-8000-000000000099',true);
set local role authenticated;
select throws_ok($$select crm_store_conversation_candidates('9811111111')$$,'42501',null,'a signed-in person without CRM access gets nothing');
reset role;

-- Link events through the transport.
create function pg_temp.ev(p_link uuid,p_type text,p_kind text default 'client',p_target uuid default '20261106-2222-4000-8000-000000000001',
 p_actor uuid default '20261106-1111-4000-8000-000000000001',p_session uuid default '20261106-6666-4000-8000-000000000001') returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','eventId','jewelos.store_conversation.'||p_link||'.'||p_type,
  'eventType','store_conversation.'||p_type,'tenantId','20261106-9999-4000-8000-000000000001','branchId','20261106-0000-4000-8000-0000000000a1',
  'actorId',p_actor,'linkId',p_link,'sessionId',p_session,'occurredAt','2026-11-01T10:00:00Z','durationSeconds',420,'salespersonName','Synthetic seller',
  'target',case when p_type='linked' then jsonb_build_object('kind',p_kind,'id',p_target) end,'reason',case when p_type='unlinked' then 'Wrong customer' end));
$$;
create function pg_temp.apply(p jsonb) returns jsonb language sql as $$ select crm_apply_store_conversation_event(p->>'eventId',p) $$;
select set_config('request.jwt.claim.role','service_role',true);
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000001','linked'))->>'outcome','source_unapproved','an unapproved JewelOS tenant is held, not applied');
select is((select count(*)::integer from crm_store_conversations),0,'held event writes nothing');
insert into crm_private.customer_sources values('20261106-9999-4000-8000-000000000001',true,'20261106-1111-4000-8000-000000000002',now());
select throws_ok($$select pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000001','linked')||'{"transcript":"x"}')$$,'22023',null,'unknown payload fields (transcript, audio) are refused');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000001','linked'))->>'outcome','accepted','approved link is applied');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000001','linked'))->>'client_code',(select client_code from clients where client_id='20261106-2222-4000-8000-000000000001'),'acknowledgement carries the CRM code');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000001','linked'))->>'duplicate','true','replay returns the stored result');
select is((select count(*)::integer from crm_store_conversations),1,'replay writes once');
select throws_ok($$select pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000001','linked','client','20261106-2222-4000-8000-000000000002'))$$,'23514',null,'an event id reused for a different customer is refused');
select is((select count(*)::integer from crm_client_activity where client_id='20261106-2222-4000-8000-000000000001' and kind='STORE_CONVERSATION'),1,'the customer history shows the conversation');
select is((select details->>'jewelosPath' from crm_client_activity where kind='STORE_CONVERSATION'),'/sales-recording/conversations/20261106-6666-4000-8000-000000000001','entry links back to JewelOS only by path');
select is((select total_purchase_visits from clients where client_id='20261106-2222-4000-8000-000000000001'),0,'a conversation is never a purchase');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000002','linked','client','20261106-2222-4000-8000-000000000002'))->>'outcome','retry','a second live link waits for the first to be withdrawn');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000001','unlinked'))->>'withdrawn','true','unlink withdraws the entry');
select is((select count(*)::integer from crm_client_activity where kind='STORE_CONVERSATION'),0,'withdrawn entry leaves the history');
select is((select count(*)::integer from crm_store_conversations),1,'withdrawn evidence is kept');
select throws_ok($$update crm_store_conversations set client_id='20261106-2222-4000-8000-000000000003'$$,'23514',null,'evidence cannot be retargeted');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000002','linked','client','20261106-2222-4000-8000-000000000002'))->>'outcome','accepted','the corrected link applies after the withdrawal');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000003','linked','client','20261106-2222-4000-8000-000000000003','20261106-5555-4000-8000-000000000099','20261106-6666-4000-8000-000000000002'))->>'reason','actor_not_crm_user','a person without CRM access cannot write CRM history');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000004','linked','client','20261106-2222-4000-8000-0000000000ff','20261106-1111-4000-8000-000000000001','20261106-6666-4000-8000-000000000003'))->>'reason','target_not_found','an unknown customer is refused, never created');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000005','linked','walkin','20261106-4444-4000-8000-000000000001','20261106-1111-4000-8000-000000000001','20261106-6666-4000-8000-000000000004'))->>'outcome','retry','an unregistered walk-in waits for its client');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000006','linked','lead','20261106-3333-4000-8000-000000000001','20261106-1111-4000-8000-000000000001','20261106-6666-4000-8000-000000000005'))->>'outcome','accepted','a lead can be linked');
select is(pg_temp.apply(pg_temp.ev('20261106-7777-4000-8000-000000000008','unlinked','client','20261106-2222-4000-8000-000000000001','20261106-1111-4000-8000-000000000001','20261106-6666-4000-8000-000000000009'))->>'withdrawn','false','unlinking a link that never arrived is a harmless no-op');
select is((select count(*)::integer from clients),4,'no event created a client');

-- Verified purchase evidence (docs/REPORTS.md rule). Visits are recorded by the CRM seller.
select set_config('request.jwt.claim.sub','20261106-1111-4000-8000-000000000001',true);
insert into client_timeline(id,client_id,event_date,buy_status,branch_id) values
 ('20261106-8888-4000-8000-000000000001','20261106-2222-4000-8000-000000000002','2026-10-30T10:00:00Z','YES','20261106-0000-4000-8000-000000000001'),
 ('20261106-8888-4000-8000-000000000002','20261106-2222-4000-8000-000000000002','2026-11-02T10:00:00Z','REPAIR_PICKUP','20261106-0000-4000-8000-000000000001'),
 ('20261106-8888-4000-8000-000000000003','20261106-2222-4000-8000-000000000002','2026-11-03T10:00:00Z','PRICE_CALCULATION','20261106-0000-4000-8000-000000000001');
create function pg_temp.outcome(p_link uuid,p_since timestamptz default '2026-10-31T18:30:00Z',p_until timestamptz default '2026-12-01T18:30:00Z') returns jsonb language sql as $$
 select crm_store_conversation_outcomes('20261106-9999-4000-8000-000000000001',jsonb_build_array(jsonb_build_object('linkId',p_link,'since',p_since,'until',p_until)))->'results'->0 $$;
select is(pg_temp.outcome('20261106-7777-4000-8000-000000000002')->>'state','no_purchase_recorded','a purchase before the recording day, a repair pickup and a price check are not this sale');
select is((pg_temp.outcome('20261106-7777-4000-8000-000000000002')->>'visits')::integer,2,'visits in the window are counted');
insert into client_timeline(id,client_id,event_date,buy_status,branch_id) values
 ('20261106-8888-4000-8000-000000000004','20261106-2222-4000-8000-000000000002','2026-11-05T10:00:00Z','YES','20261106-0000-4000-8000-000000000001'),
 ('20261106-8888-4000-8000-000000000005','20261106-2222-4000-8000-000000000002','2026-11-06T10:00:00Z','YES_AND_ORDER_PLACED','20261106-0000-4000-8000-000000000001');
select is(pg_temp.outcome('20261106-7777-4000-8000-000000000002')->>'state','purchase_verified','a purchase recorded after the recording date is confirmed');
select is(pg_temp.outcome('20261106-7777-4000-8000-000000000002')->>'purchaseVisitId','20261106-8888-4000-8000-000000000004','the first verified purchase visit in the window is the one credited');
select is(pg_temp.outcome('20261106-7777-4000-8000-000000000002','2026-10-31T18:30:00Z','2026-11-04T18:30:00Z')->>'state','no_purchase_recorded','a purchase after the window is not credited');
select is(pg_temp.outcome('20261106-7777-4000-8000-000000000001')->>'state','not_linked','a withdrawn link reports nothing');
select is(pg_temp.outcome('20261106-7777-4000-8000-000000000006')->>'state','no_client','an unconverted lead has no purchases yet');
select throws_ok($$select crm_store_conversation_outcomes('20261106-9999-4000-8000-000000000001','[{"linkId":"20261106-7777-4000-8000-000000000002","since":"2026-01-01Z","until":"2026-12-01Z"}]')$$,'22023',null,'windows are bounded');
select is(pg_temp.outcome('20261106-7777-4000-8000-000000000002')#>>'{}' is not null,true,'outcome reads are side-effect free');
select is((select total_purchase_visits from clients where client_id='20261106-2222-4000-8000-000000000002'),3,'purchase rollups stay the CRM''s own (3 purchase visits), unchanged by these reads');

select * from finish();
rollback;
