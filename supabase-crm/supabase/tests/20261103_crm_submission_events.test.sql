begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Saved-submission events for JewelOS FMS start triggers (20261103000200).
select ok(not has_table_privilege('authenticated','crm_private.submission_outbox','SELECT'),'browsers cannot read the submission outbox');
select ok(not has_function_privilege('authenticated','crm_sync_claim_submission_events(integer)','EXECUTE')
  and has_function_privilege('service_role','crm_sync_claim_submission_events(integer)','EXECUTE'),'only the service role claims submission events');

insert into branches(id,name,jewelos_branch_id) values('20261103-0400-4000-8000-00000000000a','Trigger Branch','20261103-0400-4000-8000-0000000000aa');
insert into users(id,name,email,role,branch_id,active) values
('20261103-0400-4000-8000-000000000001','Trigger Seller','trigger-seller@example.invalid','salesperson','20261103-0400-4000-8000-00000000000a',true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active)
values('20261103-0400-4000-8000-0000000000f1','trigger-seller@example.invalid','20261103-0400-4000-8000-000000000001','20261103-0400-4000-8000-000000000001',true);
insert into crm_private.staff_sync_state(jewelos_user_id,snapshot_at,outcome,crm_user_id,selection_department)
values('20261103-0400-4000-8000-0000000000f1',now(),'applied','20261103-0400-4000-8000-000000000001','sales');
\ir fixtures/crm_master_options.psql
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values('20261103-0400-4000-8000-00000000000a','TRIGGER SELLER','20261103-0400-4000-8000-000000000001',true);

create function pg_temp.visit(p_status text,p_client uuid,p_timeline uuid,p_phone text,p_at timestamptz default now()) returns jsonb language sql as $$
  select jsonb_build_object('branch_id','20261103-0400-4000-8000-00000000000a','primary_name','Synthetic Trigger Client','primary_phone',p_phone,
    'proposed_client_id',p_client,'proposed_timeline_id',p_timeline,'event_date',p_at,'crm_name','TRIGGER SELLER','salesperson','Trigger Seller',
    'salesperson_id','20261103-0400-4000-8000-000000000001','visit_status',p_status,'did_buy',p_status='YES',
    'seen_categories',jsonb_build_array('Ring'),'bought_categories',case when p_status='YES' then jsonb_build_array('Ring') else '[]'::jsonb end,
    'not_bought_reasons',case when p_status='NO' then jsonb_build_array('PRICE') else '[]'::jsonb end,
    'product_requirement','Bangles','category_details',jsonb_build_object('seen_count','1','seen_tags',jsonb_build_array('T1')),
    'additional_fields',jsonb_build_object('visit_status',p_status,'salesperson','Trigger Seller'))
$$;
grant execute on function pg_temp.visit(text,uuid,uuid,text,timestamptz) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261103-0400-4000-8000-000000000001',true);
select lives_ok($$select * from submit_walkin_visit(pg_temp.visit('NO','20261103-0400-4000-8000-000000000010','20261103-0400-4000-8000-000000000011','9100840001'))$$,'a not-bought walk-in saves as before');
reset role;
select is((select count(*)::int from crm_private.submission_outbox),0,'nothing is queued before the save commits');
set constraints all immediate;
select is((select count(*)::int from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),1,'the committed visit queues one event');
select is((select payload->'answers'->>'visit_status' from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),'NO','the event carries the visit status');
select is((select payload->'answers'->>'client_bought' from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),'NO','and whether anything was bought');
select is((select payload->>'case_id' from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),
  (select id::text from not_bought_followups where client_id='20261103-0400-4000-8000-000000000010'),'the event names the Not Bought case the CRM created');
select is((select payload->>'staff_jewelos_user_id' from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),'20261103-0400-4000-8000-0000000000f1','the salesperson is resolved to the JewelOS person');
select is((select payload->>'jewelos_branch_id' from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),'20261103-0400-4000-8000-0000000000aa','the branch is the JewelOS branch');
select ok((select not (payload::text ~ '9100840001') from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),'no phone number travels');
select is((select payload->'answers'->>'seen_count' from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),'1','products seen are counted');
select throws_ok($$update crm_private.submission_outbox set payload='{}'::jsonb$$,'42501',null,'an event snapshot cannot change');

-- A later purchase closes the case: one closure event.
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.visit('YES','20261103-0400-4000-8000-000000000010','20261103-0400-4000-8000-000000000012','9100840001'))$$,'a later purchase saves');
reset role;
set constraints all immediate;
select is((select count(*)::int from crm_private.submission_outbox where kind='crm.not_bought_case_closed'),1,'the auto-closed case queues a closure event');
select is((select payload->>'status' from crm_private.submission_outbox where kind='crm.not_bought_case_closed'),'ALREADY PURCHASED FROM MK JEWELS','with the CRM status');
select is((select count(*)::int from crm_private.submission_outbox where kind='crm.walkin_visit_saved'),2,'the purchase visit is its own event');

-- Imports and backfills of old visits never trigger.
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.visit('NO','20261103-0400-4000-8000-000000000020','20261103-0400-4000-8000-000000000021','9100840002',now()-interval '10 days'))$$,'an old visit saves');
reset role;
set constraints all immediate;
select is((select count(*)::int from crm_private.submission_outbox where record_id=(select id from visit_forms where client_timeline_id='20261103-0400-4000-8000-000000000021')),0,'an old visit queues nothing');

-- Delivery contract: claim, retry with backoff, dead after ten attempts.
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temp table claimed as select * from crm_sync_claim_submission_events(10);
select is((select count(*)::int from claimed),3,'every due event is claimed');
select is(crm_sync_finish_submission_event((select min(event_id) from claimed),true,null),'delivered','a delivered event is finished');
select is(crm_sync_finish_submission_event((select min(event_id) from claimed),true,null),'ignored','finishing twice is ignored');
select is(crm_sync_finish_submission_event((select max(event_id) from claimed),false,'http_503'),'retry','a failed event is retried');
select ok((select next_attempt_at>now() from crm_private.submission_outbox where id=(select max(event_id) from claimed)),'with a later attempt time');
update crm_private.submission_outbox set attempts=10,next_attempt_at=now() where id=(select max(event_id) from claimed);
select ok((select count(*)=1 from crm_sync_claim_submission_events(10) where event_id=(select max(event_id) from claimed)),'the retried event is claimed again when due');
select is(crm_sync_finish_submission_event((select max(event_id) from claimed),false,'http_503'),'dead','the eleventh failure is dead');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select * from crm_sync_claim_submission_events(10)$$,'42501',null,'a browser session cannot claim');

select * from finish();
rollback;
