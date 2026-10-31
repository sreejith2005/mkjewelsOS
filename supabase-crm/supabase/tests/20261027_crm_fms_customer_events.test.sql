begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_table('crm_private','customer_event_inbox','customer event receipts are durable');
select has_table('crm_private','customer_mapping_registry','receiver owns mapping approval');
select has_table('crm_private','customer_source_identities','external identities are scoped');
select ok(not has_table_privilege('authenticated','crm_private.customer_event_inbox','SELECT'),'raw customer receipts remain private');
select ok(not has_function_privilege('authenticated','crm_apply_customer_event(text,jsonb)','EXECUTE'),'browser cannot impersonate the transport');
select ok(not has_function_privilege('anon','get_customer_workflow_history(uuid,timestamptz,text,integer)','EXECUTE'),'anonymous cannot read customer history');
select ok(not has_table_privilege('authenticated','crm_private.customer_mapping_registry','UPDATE'),'browser cannot approve mappings directly');
insert into branches(id,name,jewelos_branch_id) values
 ('20261027-0000-4000-8000-000000000001','Synthetic A','20261027-0000-4000-8000-000000000001'),
 ('20261027-0000-4000-8000-000000000002','Synthetic B','20261027-0000-4000-8000-000000000002');
insert into users(id,name,email,role,branch_id,active) values
 ('20261027-1111-4000-8000-000000000001','Synthetic CRM','synthetic-fms@example.invalid','salesperson','20261027-0000-4000-8000-000000000001',true),
 ('20261027-1111-4000-8000-000000000002','Synthetic admin','synthetic-fms-admin@example.invalid','super_admin',null,true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id) select id,email,id,id from users where email like 'synthetic-fms%@example.invalid';
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) select id,'20261027-9999-4000-8000-000000000001',now(),true from users where email like 'synthetic-fms%@example.invalid';
insert into crm_private.customer_sources values('20261027-9999-4000-8000-000000000001',true,'20261027-1111-4000-8000-000000000002',now());
create temporary table customer_test_mapping(descriptor jsonb,digest text);
insert into customer_test_mapping(descriptor) values('{"schemaVersion":1,"sourceProject":"jewelos","tenantId":"20261027-9999-4000-8000-000000000001","templateId":"20261027-3333-4000-8000-000000000001","templateVersion":1,"identityScope":"synthetic-account","channel":"INSTAGRAM","fields":[{"fieldKey":"name","label":"Name","type":"text","mode":"both","destination":"primary_name"},{"fieldKey":"phone","label":"Phone","type":"phone","mode":"both","destination":"primary_phone"},{"fieldKey":"city","label":"City","type":"text","mode":"both","destination":"city"}]}');
update customer_test_mapping set descriptor=jsonb_set(descriptor,'{fields}',descriptor->'fields'||'[{"fieldKey":"chat","label":"Website chat identity","type":"text","mode":"both","destination":"website_chat"},{"fieldKey":"instagram","label":"Instagram identity","type":"text","mode":"both","destination":"instagram"}]'::jsonb);
update customer_test_mapping set digest=encode(digest(descriptor::text,'sha256'),'hex');
select set_config('request.jwt.claim.role','service_role',true);
select is((select crm_register_customer_mapping('20261027-4444-4000-8000-000000000001',descriptor,digest)->>'outcome' from customer_test_mapping),'mapping_unapproved','transport registration does not approve a mapping');
create function pg_temp.event(p_event text,p_phone text default '9876543210',p_journey uuid default '20261027-5555-4000-8000-000000000001',p_at timestamptz default '2026-10-01Z',p_city text default 'First city') returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','eventId',p_event,'eventType','form.submitted',
 'tenantId','20261027-9999-4000-8000-000000000001','branchId','20261027-0000-4000-8000-000000000001','actorId','20261027-1111-4000-8000-000000000001',
 'journeyKey',p_journey,'occurredAt',p_at,'mappingId','20261027-4444-4000-8000-000000000001','mappingDigest',(select digest from customer_test_mapping),
 'answers',jsonb_build_array(jsonb_build_object('fieldKey','name','label','Name','type','text','mode','both','destination','primary_name','original','Synthetic customer','normalized','Synthetic customer'))
 ||case when p_phone is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('fieldKey','phone','label','Phone','type','phone','mode','both','destination','primary_phone','original',p_phone,'normalized',p_phone)) end
 ||jsonb_build_array(jsonb_build_object('fieldKey','city','label','City','type','text','mode','both','destination','city','original',p_city,'normalized',p_city)));
$$;
select is(crm_apply_customer_event('synthetic.new',pg_temp.event('synthetic.new'))->>'outcome','mapping_unapproved','unapproved data stays pending');
select is((select count(*)::integer from clients),0,'unapproved event creates no customer');
update crm_private.customer_mapping_registry set approved_at=now(),approved_by='20261027-1111-4000-8000-000000000002';
select is(crm_apply_customer_event('synthetic.new',pg_temp.event('synthetic.new'))->>'outcome','accepted','approved event creates real CRM identity');
select is((select count(*)::integer from clients),1,'one customer exists');
select is((select primary_phone from clients),'919876543210','Indian phone normalization uses existing contract');
select is(crm_apply_customer_event('synthetic.new',pg_temp.event('synthetic.new'))->>'duplicate','true','exact replay returns original receipt');
select is((select count(*)::integer from crm_customer_workflow_events),1,'replay does not duplicate history');
select throws_ok($$select crm_apply_customer_event('synthetic.new',pg_temp.event('synthetic.new')||'{"channel":"forged"}')$$,'23514',null,'conflicting source identity reuse is rejected');
select is(crm_apply_customer_event('synthetic.next',pg_temp.event('synthetic.next','+919876543210','20261027-5555-4000-8000-000000000002','2026-10-03Z','New city'))->>'outcome','accepted','later enquiry resolves same normalized phone');
select is((select count(*)::integer from clients),1,'new journey reuses the same customer');
select is(crm_apply_customer_event('synthetic.old',pg_temp.event('synthetic.old','919876543210','20261027-5555-4000-8000-000000000001','2026-10-02Z','Old delayed city'))->>'outcome','accepted','delayed event remains evidence');
select is((select value#>>'{}' from crm_private.customer_attribute_projection where destination='city'),'New city','older arrival cannot replace newer business answer');
select is((select total_purchase_visits from clients),0,'FMS evidence does not fabricate a purchase');
select is(crm_apply_customer_event('synthetic.nophone',pg_temp.event('synthetic.nophone',null,'20261027-5555-4000-8000-000000000003'))->>'outcome','accepted','name-only no-phone enquiry gets a safe new identity');
select is((select count(*)::integer from clients),2,'no-phone identity is persisted');
insert into clients(primary_name,primary_phone,last_branch_id,lifecycle_stage) values('Synthetic family member','+919876543210','20261027-0000-4000-8000-000000000001','lead');
select is(crm_apply_customer_event('synthetic.shared',pg_temp.event('synthetic.shared','9876543210','20261027-5555-4000-8000-000000000004'))->>'reason','ambiguous_phone','shared family phone goes to review');
select is((select count(*)::integer from clients),3,'ambiguous phone never merges or creates another identity');
select is(crm_apply_customer_event('synthetic.cross',pg_temp.event('synthetic.cross')||'{"branchId":"20261027-0000-4000-8000-000000000002"}')->>'reason','actor_or_branch_denied','branch authority is checked independently from service delivery');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261027-1111-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(get_customer_workflow_history((select client_id from clients order by primary_phone nulls last limit 1),null,null,2)),2,'customer history is bounded');
select throws_ok($$select customer_integration_review_queue()$$,'42501',null,'ordinary CRM user cannot read integration diagnostics');
reset role;

-- Additive reads retain CRM browsing and actual commercial evidence.
select set_config('request.jwt.claim.sub','20261027-1111-4000-8000-000000000001',true);
select is((select customer_city from crm_client_browse_state where client_id=(select client_id from crm_private.customer_journeys where journey_key='20261027-5555-4000-8000-000000000001')),'New city','channel city is incrementally cached');
set local role authenticated;
select is((browse_crm_records_page('{"city":"New city"}',0,50)->>'total')::integer,1,'existing city filter sees projected customer city');
select is((get_customer_commercial_summary((select client_id from clients where primary_phone is null))->>'classification'),'Non-Buyer/Prospect','a no-phone lead is not classified as a purchase');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select is(crm_apply_customer_event('synthetic.newphone',pg_temp.event('synthetic.newphone','+14155552671','20261027-5555-4000-8000-000000000001'))->>'outcome','accepted','established journey preserves new international phone evidence');
select is(crm_apply_customer_event('synthetic.alias',pg_temp.event('synthetic.alias','+14155552671','20261027-5555-4000-8000-000000000006'))->>'client_id',(select client_id::text from crm_private.customer_journeys where journey_key='20261027-5555-4000-8000-000000000001'),'later channel can resolve accepted phone alias without overwriting original phone');
select is(crm_apply_customer_event('synthetic.child',pg_temp.event('synthetic.child',null,'20261027-5555-4000-8000-000000000007')||'{"workflow":{"instanceId":"20261027-5555-4000-8000-000000000007","parentInstanceId":"20261027-5555-4000-8000-000000000001"},"isStartingForm":true}')->>'client_id',(select client_id::text from crm_private.customer_journeys where journey_key='20261027-5555-4000-8000-000000000001'),'child journey inherits its parent customer');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261027-1111-4000-8000-000000000002',true);
set local role authenticated;
select lives_ok($$select review_customer_identity('synthetic.shared',(select client_id from clients where primary_phone is null),'Synthetic reviewed family identity')$$,'administrator can explicitly resolve ambiguous source');
select lives_ok($$select reject_customer_event('synthetic.cross','Synthetic source authority rejected')$$,'administrator rejection preserves evidence');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select is(crm_apply_customer_event('synthetic.cross',pg_temp.event('synthetic.cross')||'{"branchId":"20261027-0000-4000-8000-000000000002"}')->>'outcome','rejected','rejected evidence stays terminal on technical retry');
select throws_ok($$update crm_customer_workflow_events set answers='[]' where event_id='synthetic.new'$$,'23514',null,'accepted mapped evidence is immutable');
select throws_ok($$update crm_private.customer_event_inbox set payload='{}' where event_id='synthetic.new'$$,'23514',null,'source receipt cannot be edited');
select throws_ok($$select crm_customer_export_batch('20261027-9999-4000-8000-000000000001','20261027-1111-4000-8000-000000000001',gen_random_uuid(),'customer_master','{}',now(),0,50)$$,'42501',null,'ordinary CRM writer cannot use worker authority to export');
select is((crm_customer_export_batch('20261027-9999-4000-8000-000000000001','20261027-1111-4000-8000-000000000002',gen_random_uuid(),'customer_master','{}',now(),0,2)->'rows')::jsonb @> '[]'::jsonb,true,'CRM administrator export uses bounded existing identities');
select is(jsonb_array_length(crm_customer_export_batch('20261027-9999-4000-8000-000000000001','20261027-1111-4000-8000-000000000002',gen_random_uuid(),'customer_master','{}',now(),0,2)->'rows'),2,'CRM export page size is enforced');
insert into client_timeline(client_id,event_date,branch_id,buy_status) select client_id,'2026-09-12T04:00Z','20261027-0000-4000-8000-000000000001','REPAIR_PLACED' from clients where primary_phone is null;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is(get_customer_commercial_summary((select client_id from clients where primary_phone is null))->>'classification','Repair-only Customer','repair alone is separately classified');
reset role;
insert into client_timeline(client_id,event_date,branch_id,buy_status) select client_id,'2026-09-15T04:00Z','20261027-0000-4000-8000-000000000001','REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT' from clients where primary_phone is null;
set local role authenticated;
select is(get_customer_commercial_summary((select client_id from clients where primary_phone is null))->>'classification','Buyer','mixed repair and buying preserves trusted purchase vocabulary');
select is(get_customer_commercial_summary((select client_id from clients where primary_phone is null))->>'firstVerifiedPurchase','2026-09-15T04:00:00+00:00','verified first purchase keeps its original instant');
select is((browse_crm_records_page('{"commercial":"Buyer"}',0,50)->>'total')::integer,1,'commercial filter is compatible with the existing paged query');
reset role;


select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(format('select crm_customer_export_batch(%L,%L,gen_random_uuid(),%L,%L,now(),0,25)','20261027-9999-4000-8000-000000000001','20261027-1111-4000-8000-000000000002',key,'{}'),'bounded export query: '||key) from unnest(array['customer_enquiries','customer_stages','customer_activity','customer_followups','customer_commercial','customer_exceptions'])key;
update users set active=false where id='20261027-1111-4000-8000-000000000001';
select is(crm_apply_customer_event('synthetic.inactive',pg_temp.event('synthetic.inactive'))->>'reason','actor_or_branch_denied','inactive source actor cannot borrow transport authority');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261027-1111-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select get_customer_workflow_history((select client_id from clients limit 1),null,null,25)$$,'42501',null,'inactive CRM session cannot read mapped history');
reset role;


select set_config('request.jwt.claim.sub','20261027-1111-4000-8000-000000000002',true);
update clients set city='Verified family store city' where primary_name='Synthetic family member';
insert into client_timeline(client_id,event_date,branch_id,buy_status) select client_id,'2026-10-20T04:00Z','20261027-0000-4000-8000-000000000001','STORE_VISIT' from clients where primary_name='Synthetic family member';
set local role authenticated;
select is((select city from get_client_profile((select client_id from clients where primary_name='Synthetic customer' and primary_phone='919876543210'))),'Verified family store city','FMS projection cannot replace cumulative native shared-phone answers');
select is((select primary_name from lookup_client_profile_by_phone('+919876543210')),'Synthetic family member','phone intake keeps the approved latest visited match');
select is((preview_customer_reconciliation(array['synthetic.new','synthetic.missing'])#>>'{counts,missing_source_event}')::integer,1,'reconciliation reports missing source delivery without creating a record');
reset role;


select set_config('request.jwt.claim.role','service_role',true);
update users set active=true where id='20261027-1111-4000-8000-000000000001';
select is(crm_apply_customer_event('synthetic.chat',jsonb_set(pg_temp.event('synthetic.chat',null,'20261027-5555-4000-8000-000000000009'),'{answers}',pg_temp.event('synthetic.chat',null,'20261027-5555-4000-8000-000000000009')->'answers'||jsonb_build_array(jsonb_build_object('fieldKey','chat','label','Website chat identity','type','text','mode','both','destination','website_chat','original','CaseSensitive-ID','normalized','CaseSensitive-ID'))))->>'outcome','accepted','opaque website identity is accepted as source evidence');
select is((select normalized from crm_private.customer_source_identities where kind='website_chat'),'CaseSensitive-ID','opaque provider identifiers retain case identity');


select is((crm_customer_export_batch('20261027-9999-4000-8000-000000000001','20261027-1111-4000-8000-000000000002',gen_random_uuid(),'customer_stages','{"stageId":"20261027-7777-4000-8000-000000000099"}',now(),0,50)->>'total')::integer,0,'stage export filter excludes other stage definitions');


-- Final review regressions: pending reviews cannot move an established journey.
select set_config('request.jwt.claim.role','service_role',true);
select is(crm_apply_customer_event('synthetic.late_review',pg_temp.event('synthetic.late_review','9876543210','20261027-5555-4000-8000-000000000099'))->>'reason','ambiguous_phone','pending identity initially has no journey binding');
select is(crm_apply_customer_event('synthetic.bind_review',pg_temp.event('synthetic.bind_review',null,'20261027-5555-4000-8000-000000000099'))->>'outcome','accepted','another source binds the pending journey');
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select review_customer_identity('synthetic.late_review',(select client_id from clients where primary_phone is null and primary_name='Synthetic customer' limit 1),'Cannot move accepted work')$$,'23514',null,'review cannot attach a bound journey to another customer');
select throws_ok($$select create_customer_from_event_review('synthetic.late_review','Orphan forbidden','Cannot split a journey')$$,'23514',null,'distinct review checks journey before creating an orphan');
reset role;
select is((select count(*)::integer from clients where primary_name='Orphan forbidden'),0,'denied review leaves no orphan customer');
select is((select customer_city from crm_client_browse_state where client_id=(select client_id from crm_private.customer_journeys where journey_key='20261027-5555-4000-8000-000000000001')),'Verified family store city','shared-phone native changes invalidate effective browse city for every affected customer');
select set_config('request.jwt.claim.role','service_role',true);
select is((crm_customer_export_batch('20261027-9999-4000-8000-000000000001','20261027-1111-4000-8000-000000000002',gen_random_uuid(),'customer_master',jsonb_build_object('clientId',(select client_id from crm_private.customer_journeys where journey_key='20261027-5555-4000-8000-000000000001')),clock_timestamp(),0,50)#>>'{rows,0,details,city}'),'Verified family store city','master export uses cumulative native precedence');
select is((crm_customer_export_batch('20261027-9999-4000-8000-000000000001','20261027-1111-4000-8000-000000000002',gen_random_uuid(),'customer_master',jsonb_build_object('clientId',(select client_id from crm_private.customer_journeys where journey_key='20261027-5555-4000-8000-000000000009')),clock_timestamp(),0,50)#>>'{rows,0,details,city}'),'First city','master export includes FMS-filled effective profile');


select is(crm_apply_customer_event('synthetic.review_first',pg_temp.event('synthetic.review_first','9876543210','20261027-5555-4000-8000-000000000100'))->>'reason','ambiguous_phone','second pending source can be reviewed before another event binds its journey');
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select review_customer_identity('synthetic.review_first',(select client_id from clients where primary_phone is null and primary_name='Synthetic customer' limit 1),'Synthetic pending attribution');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select crm_apply_customer_event('synthetic.bind_after_review',pg_temp.event('synthetic.bind_after_review',null,'20261027-5555-4000-8000-000000000100'));
select is(crm_apply_customer_event('synthetic.review_first',pg_temp.event('synthetic.review_first','9876543210','20261027-5555-4000-8000-000000000100'))->>'reason','journey_identity_conflict','ingestion rechecks a stale review after acquiring the shared journey lock');
select is((select count(*)::integer from crm_customer_workflow_events where event_id='synthetic.review_first'),0,'conflicting pending review writes no contribution');
select is((select count(*)::integer from crm_private.customer_source_identities where source_event_id='synthetic.review_first'),0,'conflicting pending review writes no aliases');
select ok(not has_function_privilege('authenticated','crm_private.native_customer_profile(uuid)','EXECUTE'),'browser cannot bypass active-caller gate through internal native composer');
select ok(not has_function_privilege('service_role','crm_private.effective_customer_profile(uuid)','EXECUTE'),'service transport cannot read internal profiles without the authorized export adapter');


-- Channel attribution and no-phone identifiers remain independent from phone matching.
create temporary table customer_whatsapp_mapping as select jsonb_set(jsonb_set(descriptor,'{channel}','"WHATSAPP"'),'{identityScope}','"synthetic-whatsapp"') descriptor,null::text digest from customer_test_mapping;
update customer_whatsapp_mapping set digest=encode(digest(descriptor::text,'sha256'),'hex');
select crm_register_customer_mapping('20261027-4444-4000-8000-000000000002',descriptor,digest) from customer_whatsapp_mapping;
grant select on customer_whatsapp_mapping to authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select approve_customer_mapping('20261027-4444-4000-8000-000000000002',(select digest from customer_whatsapp_mapping));
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select is(crm_apply_customer_event('synthetic.whatsapp',pg_temp.event('synthetic.whatsapp','+14155552671','20261027-5555-4000-8000-000000000101')||jsonb_build_object('mappingId','20261027-4444-4000-8000-000000000002','mappingDigest',(select digest from customer_whatsapp_mapping)))->>'client_id',(select client_id::text from crm_private.customer_journeys where journey_key='20261027-5555-4000-8000-000000000001'),'WhatsApp enquiry resolves accepted phone alias to existing customer');
select is((select channel from crm_customer_workflow_events where event_id='synthetic.whatsapp'),'WHATSAPP','new journey retains its own channel attribution');
select is(crm_apply_customer_event('synthetic.instagram_only',jsonb_set(pg_temp.event('synthetic.instagram_only',null,'20261027-5555-4000-8000-000000000102'),'{answers}',pg_temp.event('synthetic.instagram_only',null,'20261027-5555-4000-8000-000000000102')->'answers'||jsonb_build_array(jsonb_build_object('fieldKey','instagram','label','Instagram identity','type','text','mode','both','destination','instagram','original','@Synthetic_Only','normalized','@Synthetic_Only'))))->>'outcome','accepted','Instagram-only enquiry creates a persisted no-phone identity');
select ok(exists(select 1 from crm_private.customer_source_identities i join clients c using(client_id) where i.kind='instagram' and i.normalized='synthetic_only' and c.primary_phone is null and c.client_code like 'MKC-%'),'no-phone Instagram identity has a normal customer code and retained scoped alias');

select * from finish();
rollback;
