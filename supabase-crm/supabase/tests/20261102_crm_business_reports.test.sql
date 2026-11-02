begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Contract surface
select ok(has_function_privilege('authenticated','get_crm_business_report(text,jsonb,integer,integer)','EXECUTE'),'CRM users can preview reports');
select ok(not has_function_privilege('anon','get_crm_business_report(text,jsonb,integer,integer)','EXECUTE'),'anonymous callers cannot read reports');
select ok(not has_function_privilege('authenticated','crm_private.business_report(text,jsonb,integer,integer,timestamptz)','EXECUTE'),'the report core is not callable directly');
select ok(not has_function_privilege('authenticated','crm_customer_export_batch(uuid,uuid,uuid,text,jsonb,timestamptz,integer,integer)','EXECUTE'),'browsers cannot call the export adapter');

-- Synthetic CRM: one branch, a CRM employee, a salesperson, an inactive user and an administrator.
insert into branches(id,name,jewelos_branch_id) values('20261102-0000-4000-8000-000000000001','Synthetic Main','20261102-0000-4000-8000-0000000000aa');
insert into users(id,name,email,role,branch_id,active) values
 ('20261102-1111-4000-8000-000000000001','Synthetic CRM','br-crm@example.invalid','salesperson','20261102-0000-4000-8000-000000000001',true),
 ('20261102-1111-4000-8000-000000000002','Synthetic Sales','br-sales@example.invalid','salesperson','20261102-0000-4000-8000-000000000001',true),
 ('20261102-1111-4000-8000-000000000003','Synthetic Inactive','br-inactive@example.invalid','salesperson','20261102-0000-4000-8000-000000000001',false),
 ('20261102-1111-4000-8000-000000000004','Synthetic Admin','br-admin@example.invalid','super_admin',null,true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id) select id,email,id,id from users where email like 'br-%@example.invalid';
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) select id,'20261102-9999-4000-8000-000000000001',now(),true from users where email like 'br-%@example.invalid';
insert into crm_private.customer_sources values('20261102-9999-4000-8000-000000000001',true,'20261102-1111-4000-8000-000000000004',now());

-- Asha: two Instagram enquiries and one WhatsApp enquiry, then a store visit with a verified purchase.
-- Ravi: a walk-in who did not buy and has an open, overdue follow-up.
insert into clients(client_id,primary_name,primary_phone,primary_phone_country_code,secondary_phone,city,state,last_branch_id,lifecycle_stage) values
 ('20261102-2222-4000-8000-000000000001','Asha Synthetic','9876543210','+91','9123456780','Kochi','Kerala','20261102-0000-4000-8000-000000000001','purchased'),
 ('20261102-2222-4000-8000-000000000002','Ravi Synthetic','9000000002','+91',null,'Thrissur','Kerala','20261102-0000-4000-8000-000000000001','visited');
insert into leads(id,phone_number,name,source_channel,field_values,created_by,branch_id,client_id,created_at) values
 ('20261102-3333-4000-8000-000000000001','9876543210','Asha Synthetic','contacted','{"source_of_lead":"Instagram","product_requirement":"Bridal necklace"}','20261102-1111-4000-8000-000000000001','20261102-0000-4000-8000-000000000001','20261102-2222-4000-8000-000000000001',now()-interval '6 days');
-- Two more enquiries arrive as synced FMS forms (one CRM lead per phone); one journey later completes.
insert into crm_customer_workflow_events(event_id,client_id,source_tenant,journey_key,actor_id,branch_id,occurred_at,kind,channel,workflow,answers,provenance) values
 ('jewelos.form.br1','20261102-2222-4000-8000-000000000001','20261102-9999-4000-8000-000000000001','20261102-6666-4000-8000-000000000001','20261102-1111-4000-8000-000000000001','20261102-0000-4000-8000-000000000001',now()-interval '5 days','form.submitted','Instagram',
  '{"referenceNumber":"FMS-BR-1","stageName":"Start form","status":"completed"}','[{"fieldKey":"need","label":"Requirement","destination":"requirement","normalized":"Bridal necklace","optionLabels":[]}]','{}'),
 ('jewelos.stage.br1','20261102-2222-4000-8000-000000000001','20261102-9999-4000-8000-000000000001','20261102-6666-4000-8000-000000000001','20261102-1111-4000-8000-000000000001','20261102-0000-4000-8000-000000000001',now()-interval '4 days 12 hours','stage.completed','Instagram',
  '{"referenceNumber":"FMS-BR-1","stageName":"Negotiation","instanceStatus":"completed"}','[]','{}'),
 ('jewelos.form.br2','20261102-2222-4000-8000-000000000001','20261102-9999-4000-8000-000000000001','20261102-6666-4000-8000-000000000002','20261102-1111-4000-8000-000000000001','20261102-0000-4000-8000-000000000001',now()-interval '4 days','form.submitted','WhatsApp',
  '{"referenceNumber":"FMS-BR-2","stageName":"Start form","status":"completed"}','[]','{}');
insert into lead_call_history(lead_id,call_response,remark,next_followup_date,entered_by,created_at) values
 ('20261102-3333-4000-8000-000000000001','NOT PICKED','No answer',null,'20261102-1111-4000-8000-000000000001',now()-interval '5 days 23 hours 30 minutes'),
 ('20261102-3333-4000-8000-000000000001','CONNECTED','Will visit Saturday',(now() at time zone 'Asia/Kolkata')::date+2,'20261102-1111-4000-8000-000000000001',now()-interval '5 days 23 hours');
insert into client_timeline(id,client_id,event_date,event_type,buy_status,branch_id,crm_name,salesperson_id,bought_categories,product_requirement) values
 ('20261102-4444-4000-8000-000000000001','20261102-2222-4000-8000-000000000001',now()-interval '2 days','READY_PRODUCT_PURCHASE','YES','20261102-0000-4000-8000-000000000001','Synthetic CRM','20261102-1111-4000-8000-000000000002','{NECKLACE}','Bridal necklace'),
 ('20261102-4444-4000-8000-000000000002','20261102-2222-4000-8000-000000000002',now()-interval '3 days','NON_PURCHASE_VISIT','NO','20261102-0000-4000-8000-000000000001','Synthetic CRM','20261102-1111-4000-8000-000000000002','{}',null);
insert into visit_forms(client_timeline_id,google_review_asked,referrals_asked,did_buy,source_of_lead) values
 ('20261102-4444-4000-8000-000000000001',true,true,true,'Instagram'),('20261102-4444-4000-8000-000000000002',false,null,false,'Walk-in');
-- The NO visit opened a not-bought follow-up automatically; make it overdue and owned by the CRM.
update not_bought_followups set next_followup_date=(now() at time zone 'Asia/Kolkata')::date-1,entered_by='20261102-1111-4000-8000-000000000001' where client_id='20261102-2222-4000-8000-000000000002';
select is((select count(*)::int from not_bought_followups where client_id='20261102-2222-4000-8000-000000000002'),1,'the not-bought visit opened one follow-up');
insert into not_bought_history(followup_id,status,previous_status,call_response,updated_by,created_at) values
 ((select id from not_bought_followups where client_id='20261102-2222-4000-8000-000000000002'),'PENDING',null,'Busy, call later','20261102-1111-4000-8000-000000000001',now()-interval '1 day');

create function pg_temp.as_crm(p_user text) returns void language sql as $$
 select set_config('request.jwt.claim.sub',p_user,true),set_config('request.jwt.claim.role','authenticated',true) $$;
create function pg_temp.r(p_key text,p_filters jsonb default '{}') returns jsonb language sql as $$
 select get_crm_business_report(p_key,jsonb_build_object('from',to_char((now() at time zone 'Asia/Kolkata')::date-30,'YYYY-MM-DD'),'to',to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD'))||p_filters,0,100) $$;
create function pg_temp.pick(p_report jsonb,p_key text,p_value text) returns jsonb language sql as $$
 select r from jsonb_array_elements(p_report->'rows') r where r->>p_key=p_value limit 1 $$;
grant execute on function pg_temp.as_crm(text),pg_temp.r(text,jsonb),pg_temp.pick(jsonb,text,text) to authenticated;

select pg_temp.as_crm('20261102-1111-4000-8000-000000000001');
set local role authenticated;

-- Customer Master: one row per customer even with three enquiries.
select is((get_crm_business_report('customer_report_master','{}',0,100)->>'total')::int,2,'one master row per customer');
select is(pg_temp.pick(get_crm_business_report('customer_report_master','{}',0,100),'name','Asha Synthetic')->>'first_source','Instagram','first enquiry source comes from the earliest enquiry');
select is(pg_temp.pick(get_crm_business_report('customer_report_master','{}',0,100),'name','Asha Synthetic')->>'latest_source','Instagram','latest source includes the walk-in form answer');
select is(pg_temp.pick(get_crm_business_report('customer_report_master','{}',0,100),'name','Asha Synthetic')->>'purchase_status','Buyer','a verified purchase makes a buyer');
select is(pg_temp.pick(get_crm_business_report('customer_report_master','{}',0,100),'name','Ravi Synthetic')->>'purchase_status','Non-Buyer/Prospect','a store visit without purchase is not a buyer');
select is(pg_temp.pick(get_crm_business_report('customer_report_master','{}',0,100),'name','Asha Synthetic')->>'primary_phone','+91 9876543210','phone keeps its country code as text');
select ok(pg_temp.pick(get_crm_business_report('customer_report_master','{}',0,100),'name','Asha Synthetic')->>'customer_id' ~ '^MKC-[0-9]+$','customers carry their MKC ID');
select is(pg_temp.pick(get_crm_business_report('customer_report_master','{}',0,100),'name','Ravi Synthetic')->>'next_followup',to_char((now() at time zone 'Asia/Kolkata')::date-1,'YYYY-MM-DD'),'the open follow-up date is shown');
select is((get_crm_business_report('customer_report_master','{"purchaseClass":"Buyer"}',0,100)->>'total')::int,1,'purchase classification filters the master');
select is((get_crm_business_report('customer_report_master','{"source":"WhatsApp"}',0,100)->>'total')::int,1,'any recorded enquiry source matches the source filter');
select is((get_crm_business_report('customer_report_master','{"customerType":"lead"}',0,100)->>'total')::int,0,'customer type filter separates leads from clients');
select is((get_crm_business_report('customer_report_master','{}',0,1)->'rows'->0->>'name'),'Ravi Synthetic','the most recently contacted customer comes first');

-- Customer 360
select throws_ok($$select get_crm_business_report('customer_report_journey','{}',0,25)$$,'22023','Choose a customer first','the journey needs a customer');
select is((select string_agg(r->>'event_type',',' order by n) from jsonb_array_elements(get_crm_business_report('customer_report_journey','{"clientId":"20261102-2222-4000-8000-000000000001"}',0,100)->'rows') with ordinality x(r,n)),
 'Lead registered,Lead call,Lead call,Form submitted,FMS stage completed,Form submitted,Ready Product Purchase','the journey lists each recorded action once, oldest first');
select ok(pg_temp.pick(get_crm_business_report('customer_report_journey','{"clientId":"20261102-2222-4000-8000-000000000001"}',0,100),'event_type','Ready Product Purchase')->>'details' like '%Asked: Google review, Referrals%',
 'engagement asks are folded into their visit instead of separate rows');
select is(pg_temp.pick(get_crm_business_report('customer_report_journey','{"clientId":"20261102-2222-4000-8000-000000000001"}',0,100),'event_type','Ready Product Purchase')->>'employee','Synthetic Sales','the visit names its salesperson');
select is((select jsonb_agg(r->>'customer_id') from jsonb_array_elements(find_crm_report_customers('Asha'))r)->>0,(select client_code from clients where primary_name='Asha Synthetic'),'customers can be found by name');
select is(jsonb_array_length(find_crm_report_customers((select client_code from clients where primary_name='Ravi Synthetic'))),1,'customers can be found by MKC ID');

-- Leads and follow-ups
select is((pg_temp.r('customer_report_leads')->>'total')::int,3,'each CRM lead and each FMS journey is one enquiry');
select is(pg_temp.pick(pg_temp.r('customer_report_leads'),'record_id','lead:20261102-3333-4000-8000-000000000001')->>'last_call_response','CONNECTED','the latest call response is shown');
select is((get_crm_business_report('customer_report_followups','{}',0,25)->>'total')::int,2,'open not-bought and lead follow-ups are listed');
select is((get_crm_business_report('customer_report_followups','{"status":"overdue"}',0,25)->>'total')::int,1,'overdue follow-ups are selected');
select is((get_crm_business_report('customer_report_followups','{"status":"done"}',0,25)->>'total')::int,0,'nothing is done yet');

-- Lead source and conversion
select is(pg_temp.pick(pg_temp.r('customer_report_sources'),'source','Instagram')->>'total_enquiries','2','two Instagram enquiries');
select is(pg_temp.pick(pg_temp.r('customer_report_sources'),'source','Instagram')->>'unique_leads','1','from one unique lead');
select is(pg_temp.pick(pg_temp.r('customer_report_sources'),'source','Instagram')->>'store_visitors','1','who later visited a store');
select is(pg_temp.pick(pg_temp.r('customer_report_sources'),'source','Instagram')->>'verified_buyers','1','and made a verified purchase');
select is(pg_temp.pick(pg_temp.r('customer_report_sources'),'source','Instagram')->>'buyer_rate','100.0','buyer rate is per unique lead');
select is((pg_temp.r('customer_report_sources')->'summary'->>'enquiries')::int,3,'enquiry totals reconcile with the lead records');
select ok(pg_temp.pick(pg_temp.r('customer_report_sources'),'source','Walk-in') is null,'a walk-in visit is not counted as an enquiry');

-- CRM and salesperson performance
select is(pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'lead_calls','2','every lead call attempt counts');
select is(pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'connected_calls','1','only CONNECTED calls are connected');
select is(pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'visits_attended','2','visits are credited to the CRM named on them');
select is(pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'customers_converted','1','conversion counts verified purchases only');
select is(pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'google_reviews_asked','1','engagement asks come from the visit form');
select is(pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'followups_overdue','1','overdue follow-ups are current');
select is(pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'leads_registered','1','leads registered');
select is(pick_fms.v,'1','customer FMS steps completed by the CRM employee') from (select pg_temp.pick(pg_temp.r('customer_report_crm_staff'),'employee','Synthetic CRM')->>'fms_stages_completed' v) pick_fms;
select is(pg_temp.pick(pg_temp.r('customer_report_sources'),'source','Instagram')->>'fms_completed','1','a completed FMS journey is counted for its source');
select is(pg_temp.pick(pg_temp.r('customer_report_sales'),'salesperson','Synthetic Sales')->>'verified_buyers','1','a salesperson is credited with verified purchases only');
select is(pg_temp.pick(pg_temp.r('customer_report_sales'),'salesperson','Synthetic Sales')->>'not_bought','1','not-bought visits are counted separately');
select is(pg_temp.pick(pg_temp.r('customer_report_sales'),'salesperson','Synthetic Sales')->>'conversion_rate','50.0','conversion = verified buyers / customers attended');
select is((pg_temp.r('customer_report_sales',jsonb_build_object('employeeId','20261102-1111-4000-8000-000000000001'))->>'total')::int,0,'the employee filter narrows the salesperson report');
select throws_ok($$select get_crm_business_report('customer_report_sales','{}',0,25)$$,'22023','Choose a date range','performance needs a period');
select throws_ok($$select get_crm_business_report('customer_report_master','{"unknown":"x"}',0,25)$$,'22023',null,'unknown filters are rejected');
select ok(jsonb_array_length(get_crm_business_report_options()->'branches')>=1,'filter choices include CRM branches');
reset role;

-- Inactive CRM users and anonymous callers are refused.
select pg_temp.as_crm('20261102-1111-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select get_crm_business_report('customer_report_master','{}',0,25)$$,'42501','Active CRM access required','an inactive CRM user cannot read reports');
reset role;

-- Exports: the adapter re-checks the CRM administrator grant when the job runs.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
select is((crm_customer_export_batch('20261102-9999-4000-8000-000000000001','20261102-1111-4000-8000-000000000004',gen_random_uuid(),'customer_report_master','{}',now(),0,500)->>'total')::int,2,
 'a CRM administrator export returns every matching customer');
select ok(not (crm_customer_export_batch('20261102-9999-4000-8000-000000000001','20261102-1111-4000-8000-000000000004',gen_random_uuid(),'customer_report_followups','{}',now(),0,500) ? 'summary'),'exports carry rows only');
select throws_ok($$select crm_customer_export_batch('20261102-9999-4000-8000-000000000001','20261102-1111-4000-8000-000000000001',gen_random_uuid(),'customer_report_master','{}',now(),0,500)$$,
 '42501','CRM export administrator required','a non-administrator cannot export customer data');
select is((crm_customer_export_batch('20261102-9999-4000-8000-000000000001','20261102-1111-4000-8000-000000000004',gen_random_uuid(),'customer_report_leads',
 jsonb_build_object('from',to_char((now() at time zone 'Asia/Kolkata')::date-30,'YYYY-MM-DD'),'to',to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD')),now()-interval '4 days 12 hours',0,500)->>'total')::int,2,
 'an export snapshot excludes records created after it was requested');

select * from finish();
rollback;
