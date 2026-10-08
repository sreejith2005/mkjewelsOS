begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into branches(id,name) values
('20261008-0000-4000-8000-000000000001','Continuity A'),
('20261008-0000-4000-8000-000000000002','Continuity B');
insert into users(id,name,email,role,branch_id,active) values
('20261008-1111-4000-8000-000000000001','Continuity Staff','continuity@example.invalid','salesperson','20261008-0000-4000-8000-000000000001',true),
('20261008-1111-4000-8000-000000000002','Continuity Other','continuity-other@example.invalid','salesperson','20261008-0000-4000-8000-000000000002',true),
('20261008-1111-4000-8000-000000000003','Continuity Admin','continuity-admin@example.invalid','super_admin',null,true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id)
select gen_random_uuid(),email,id,id from users where email like 'continuity%@example.invalid';
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at)
select jewelos_user_id,'20261008-9999-4000-8000-000000000001',now() from crm_sso_access_grants g
join users u on u.id=g.legacy_crm_user_id where u.email like 'continuity%@example.invalid';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261008-1111-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','20261008-1111-4000-8000-000000000001',true);
insert into leads(id,phone_number,name,field_values,created_by,branch_id,created_at) values
('20261008-2222-4000-8000-000000000001','9199000881','Continuity Lead','{"dob":"1990-02-03","anniversary":"2015-04-05","beverage":"TEA","sugar":"NO SUGAR","snack":"BISCUIT","custom_answer":"Retain this"}','20261008-1111-4000-8000-000000000001','20261008-0000-4000-8000-000000000001','2026-01-01Z');
select is((select c.dob from clients c join leads l on l.client_id=c.client_id where l.id='20261008-2222-4000-8000-000000000001'),'1990-02-03'::date,'lead DOB maps to its client');
select is((select c.anniversary from clients c join leads l on l.client_id=c.client_id where l.id='20261008-2222-4000-8000-000000000001'),'2015-04-05'::date,'lead anniversary maps to its client');
select is((select c.sugar::text from clients c join leads l on l.client_id=c.client_id where l.id='20261008-2222-4000-8000-000000000001'),'NO SUGAR','lead preference maps to its client');
select is((select field_values->>'custom_answer' from leads where id='20261008-2222-4000-8000-000000000001'),'Retain this','original custom answer remains saved');
select has_function('public','save_crm_lead',array['text','text','jsonb'],'audited lead save exists');
select has_function('public','lookup_client_profile_by_phone',array['text'],'full profile lookup exists');
select has_function('public','browse_crm_records',array['jsonb','integer','integer'],'unified server filtered list exists');
select has_function('public','record_crm_contact',array['uuid','text','text','text','uuid'],'audited contact exists');
insert into leads(id,phone_number,name,field_values,created_by,branch_id) values
('20261008-2222-4000-8000-000000000009','9199000889','Original Field Names','{"date_of_birth":"1992-02-03","anniversary_date":"2016-04-05","community_caste":"JAIN","full_address":"Synthetic address","beverages":"TEA","sugar_option":"LOW SUGAR","snack_option":"NUTS","alternate_name":"Alternate synthetic name","secondary_phone":"not a phone"}','20261008-1111-4000-8000-000000000001','20261008-0000-4000-8000-000000000001');
select is((select sugar::text from clients c join leads l on l.client_id=c.client_id where l.id='20261008-2222-4000-8000-000000000009'),'LOW SUGAR','original sugar_option field maps to client');
select is((select address from clients c join leads l on l.client_id=c.client_id where l.id='20261008-2222-4000-8000-000000000009'),'Synthetic address','original full_address maps to client');
select is((select secondary_phone::text from clients c join leads l on l.client_id=c.client_id where l.id='20261008-2222-4000-8000-000000000009'),null::text,'invalid historical phone cannot block other profile contributions');
select is((select other_names from clients c join leads l on l.client_id=c.client_id where l.id='20261008-2222-4000-8000-000000000009'),array['Alternate synthetic name'],'alternate name retained in profile');
-- Exclude the alias fixture from the browsing-count assertions below.
delete from crm_private.lead_profile_contributions where lead_id='20261008-2222-4000-8000-000000000009';
delete from leads where id='20261008-2222-4000-8000-000000000009';
delete from clients where primary_name='Original Field Names';

create function pg_temp.lead_client() returns uuid language sql security definer as $$
 select client_id from public.leads where id='20261008-2222-4000-8000-000000000001';
$$;
grant execute on function pg_temp.lead_client() to authenticated;
insert into lead_form_fields(field_key,label,field_type,display_order,is_mandatory) values
('mobile_no','Mobile','text',1,true),('name','Name','text',2,true),('dob','DOB','date',3,false),('anniversary','Anniversary','date',4,false);
set local role authenticated;
select lives_ok($$select public.save_crm_lead('9199000882','Second Lead','{"dob":"1991-01-01"}')$$,'ordinary staff saves through audited RPC');
select is((public.save_crm_lead('+6591234567','Synthetic International Lead','{}')).phone_number::text,'6591234567','international lead is normalized once through the audited save');
select is((select primary_phone::text from public.lookup_client_profile_by_phone('+6591234567')),'6591234567','international lead remains discoverable by the full profile lookup');
reset role;
delete from leads where name='Synthetic International Lead';
delete from clients where primary_name='Synthetic International Lead';
set local role authenticated;
select throws_ok($$select public.save_crm_lead('9199000883','Invalid Lead','{"rogue":"value"}')$$,'22023',null,'unconfigured fields are rejected');
select throws_ok($$select public.save_crm_lead('9199000883','','{}')$$,'22023',null,'required name is enforced at server');
select throws_ok($$select public.save_crm_lead('9199000883','Invalid Date','{"dob":"1991-02-30"}')$$,'22008',null,'impossible dates are rejected');
select is((select anniversary from public.lookup_client_profile_by_phone('9199000881')),'2015-04-05'::date,'phone lookup returns anniversary');
select is((public.browse_crm_records('{"type":"lead"}',0,200)->>'total')::integer,2,'leads are part of one counted dataset');
select is((public.browse_crm_records('{"type":"client"}',0,200)->>'total')::integer,0,'client filter excludes unvisited leads');
select is(jsonb_array_length(public.browse_crm_records('{}',0,1)->'rows'),1,'paging limits include leads');
select is((public.browse_crm_records('{}',100,1)->>'total')::integer,2,'empty page retains the full count');
select is((public.browse_crm_records('{"search":"Second"}',0,200)->>'total')::integer,1,'search applies before total and pagination');
reset role;
insert into clients(client_id,primary_name,total_visits,total_purchase_visits,lifecycle_stage,last_branch_id)
values('20261008-6666-4000-8000-000000000001','Converted purchase fixture',1,1,'visited','20261008-0000-4000-8000-000000000001');
set local role authenticated;
select is((browse_crm_records('{"stage":"purchased"}',0,200)->>'total')::integer,1,'purchase stage uses the canonical identity projection');
select is(browse_crm_records('{"stage":"purchased"}',0,200)->'rows'->0->>'lifecycle_stage','purchased','purchased stage displayed consistently');
reset role;
delete from clients where client_id='20261008-6666-4000-8000-000000000001';
set local role authenticated;
reset role;
insert into clients(primary_name,lifecycle_stage) select 'Bulk browse fixture '||n,'visited' from generate_series(1,305) n;
set local role authenticated;
select is((browse_crm_records('{"search":"Bulk browse fixture"}',200,100)->>'total')::integer,305,'filtered totals include records beyond the first page');
select is(jsonb_array_length(browse_crm_records('{"search":"Bulk browse fixture"}',200,100)->'rows'),100,'server pagination retains full intermediate pages');
select is((browse_crm_records('{"search":"Bulk browse fixture"}',400,100)->>'total')::integer,305,'an empty later page retains its total');
reset role;
delete from clients where primary_name like 'Bulk browse fixture%';
insert into clients(client_id,primary_name,last_branch_id) values('20261008-6666-4000-8000-000000000002','Store source fixture','20261008-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into client_timeline(id,client_id,event_date,branch_id,buy_status) values('20261008-6666-4000-8000-000000000003','20261008-6666-4000-8000-000000000002','2026-09-01Z','20261008-0000-4000-8000-000000000001','YES');
insert into visit_forms(client_timeline_id,source_of_lead) values('20261008-6666-4000-8000-000000000003','INSTAGRAM');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261008-1111-4000-8000-000000000001"}',true);
set local role authenticated;
select is((browse_crm_records('{"source":"INSTAGRAM"}',0,200)->>'total')::integer,1,'source filter includes store clients without a separate lead');
select is((browse_crm_records('{"stage":"purchased"}',0,200)->>'total')::integer,1,'a persisted purchase changes the effective client stage');
reset role;
delete from visit_forms where client_timeline_id='20261008-6666-4000-8000-000000000003';
delete from client_timeline where id='20261008-6666-4000-8000-000000000003';
delete from clients where client_id='20261008-6666-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select record_crm_contact(pg_temp.lead_client(),'THANK_YOU','WHATSAPP','Thank-you sent','20261008-3333-4000-8000-000000000001')$$,'thank-you saved through audited transaction');
select lives_ok($$select record_crm_contact(pg_temp.lead_client(),'THANK_YOU','WHATSAPP','Thank-you sent','20261008-3333-4000-8000-000000000001')$$,'a retry is idempotent');
select is((select count(*)::int from crm_contacts where client_id=pg_temp.lead_client()),1,'retry creates one contact');
select is((select total_visits from clients where client_id=pg_temp.lead_client()),0,'contact never increments visit totals');
select is((select count(*)::int from crm_client_activity where client_id=pg_temp.lead_client() and kind='THANK_YOU'),1,'contact is visible in unified history');
select is((public.browse_crm_records('{}',0,200)->'rows'->0->>'client_id')::uuid,pg_temp.lead_client(),'a recent contact sorts ahead of newer registration');
select throws_ok($$select record_crm_contact(pg_temp.lead_client(),'CALL','PHONE','Different request','20261008-3333-4000-8000-000000000001')$$,'22023',null,'request key cannot be reused with changed contact');
select throws_ok($$insert into crm_contacts(client_id,kind,channel,note,actor_id,branch_id,request_key) values(pg_temp.lead_client(),'CALL','PHONE','Bypass','20261008-1111-4000-8000-000000000001','20261008-0000-4000-8000-000000000001',gen_random_uuid())$$,'42501',null,'direct API contact write is blocked');
select throws_ok($$insert into leads(phone_number,name,created_by,branch_id) values('9199000883','Other branch','20261008-1111-4000-8000-000000000001','20261008-0000-4000-8000-000000000002')$$,'42501',null,'direct API cross-branch lead insertion is blocked');
reset role;
insert into not_bought_followups(id,client_id,branch_id,status,entered_by) values
('20261008-5555-4000-8000-000000000001',pg_temp.lead_client(),'20261008-0000-4000-8000-000000000001','PENDING','20261008-1111-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select save_not_bought_followup('20261008-5555-4000-8000-000000000001','CALL NOT PICKED','NOT PICKED',current_date+7,'No answer')$$,'first follow-up contact saved');
select lives_ok($$select save_not_bought_followup('20261008-5555-4000-8000-000000000001','CALL NOT PICKED','NOT PICKED',current_date+7,'No answer')$$,'another contact with identical outcome saved');
select is((select count(*)::int from not_bought_history where followup_id='20261008-5555-4000-8000-000000000001'),2,'identical follow-up outcomes retain both interactions');
select ok((select latest_interaction_at <= statement_timestamp() from crm_client_activity_summary where client_id=pg_temp.lead_client()),'future follow-up schedule is not last contact');
reset role;
insert into referrals(id,salesperson_id,referral_name,referral_number,branch_id,referred_client_id)
values('20261008-5555-4000-8000-000000000011','20261008-1111-4000-8000-000000000001','Continuity Lead','9199000881','20261008-0000-4000-8000-000000000001',pg_temp.lead_client());
insert into referral_calling(id,referral_id,status,call_response,remark)
values('20261008-5555-4000-8000-000000000012','20261008-5555-4000-8000-000000000011','PENDING','CONNECTED','Earlier call');
-- Administrative conversion carries an old response but is not another call.
update referral_calling set status='CONVERTED TO CLIENT' where id='20261008-5555-4000-8000-000000000012';
select is((select count(*)::integer from crm_client_activity where source_table='referral_calling_history' and client_id=pg_temp.lead_client() and is_contact),0,'automatic referral conversion never fabricates a contact');
set local role authenticated;
select lives_ok($$select save_referral_followup('20261008-5555-4000-8000-000000000012','CONVERTED TO CLIENT','CONNECTED',null,'Earlier call',null,'20261008-5555-4000-8000-000000000013')$$,'explicit contact with unchanged converted outcome is saved');
select is((select count(*)::integer from crm_client_activity where source_table='referral_calling_history' and client_id=pg_temp.lead_client() and is_contact),1,'explicit conversion call retains actual-contact provenance');
select lives_ok($$select save_referral_followup('20261008-5555-4000-8000-000000000012','CONVERTED TO CLIENT','CONNECTED',null,'Earlier call',null,'20261008-5555-4000-8000-000000000013')$$,'referral retry preserves original idempotency contract');
select is((select count(*)::integer from referral_calling_history where referral_calling_id='20261008-5555-4000-8000-000000000012'),2,'referral retry does not create a second contact');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261008-1111-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','20261008-1111-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select record_crm_contact(pg_temp.lead_client(),'CALL','PHONE','Cross branch','20261008-3333-4000-8000-000000000002')$$,'42501',null,'cross-branch contact is denied');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261008-1111-4000-8000-000000000003"}',true);
select set_config('request.jwt.claim.sub','20261008-1111-4000-8000-000000000003',true);
set local role authenticated;
select lives_ok($$select record_crm_contact(pg_temp.lead_client(),'CALL','PHONE','Admin contact','20261008-3333-4000-8000-000000000003')$$,'super admin can record cross-branch contact');
select lives_ok($$select reconcile_crm_lead_profiles(false)$$,'admin can preview historical projection');
select is((reconcile_crm_lead_profiles(true)->>'fields_filled')::int,0,'reconciliation does not overwrite filled profile values');
reset role;
-- A historical conflicting answer is retained; later fill-missing recovery must
-- update provenance without inventing its original registration timestamp.
update leads set field_values=field_values||'{"sugar":"LOW SUGAR"}'::jsonb where id='20261008-2222-4000-8000-000000000001';
set local role authenticated;
select ok((reconcile_crm_lead_profiles(false)->>'fields_conflicting')::integer>=1,'repair preview exposes retained profile conflicts');
reset role;
update clients set sugar=null where client_id=pg_temp.lead_client();
set local role authenticated;
select is((reconcile_crm_lead_profiles(true)->>'fields_filled')::integer,1,'historical answer fills a subsequently empty field');
reset role;
select is((select sugar::text from clients where client_id=pg_temp.lead_client()),'LOW SUGAR','inactive historical answer survives conservative recovery');
select ok((select applied and applied_at is not null from crm_private.lead_profile_contributions where lead_id='20261008-2222-4000-8000-000000000001' and field_key='sugar' and value='"LOW SUGAR"'::jsonb),'later application updates contribution provenance');
select is((select contributed_at from crm_private.lead_profile_contributions where lead_id='20261008-2222-4000-8000-000000000001' and field_key='sugar' and value='"LOW SUGAR"'::jsonb),'2026-01-01Z'::timestamptz,'recovery preserves original source date');
set local role authenticated;
select is((reconcile_crm_lead_profiles(true)->>'fields_filled')::integer,0,'repeated repair is idempotent');
reset role;
update users set active=false where id='20261008-1111-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select record_crm_contact(pg_temp.lead_client(),'CALL','PHONE','Inactive contact',gen_random_uuid())$$,'42501',null,'inactive actor denied');
select is((public.browse_crm_records('{}',0,200)->>'total')::integer,0,'inactive actor cannot browse via direct RPC');
reset role;
set local role anon;
select throws_ok($$select browse_crm_records('{}',0,200)$$,'42501',null,'anonymous list RPC denied');
select throws_ok($$select save_crm_lead('9199000884','Anon','{}')$$,'42501',null,'anonymous lead RPC denied');
reset role;
select * from finish();
rollback;
