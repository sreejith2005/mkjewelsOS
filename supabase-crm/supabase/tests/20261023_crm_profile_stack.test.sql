begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into branches(id,name) values ('20261023-0000-4000-8000-000000000001','Stack A'),('20261023-0000-4000-8000-000000000002','Stack B');
insert into users(id,name,email,role,branch_id,active) values
('20261023-1111-4000-8000-000000000001','Stack Staff','stack@example.invalid','salesperson','20261023-0000-4000-8000-000000000001',true),
('20261023-1111-4000-8000-000000000002','Stack Other','stack-other@example.invalid','salesperson','20261023-0000-4000-8000-000000000002',true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id) select id,email,id,id from users where email like 'stack%@example.invalid';
insert into crm_private.staff_sync_state(jewelos_user_id,snapshot_at,outcome,crm_user_id,selection_department) select id,now(),'applied',id,'sales' from users where email like 'stack%@example.invalid';
\ir fixtures/crm_master_options.psql
insert into clients(client_id,primary_name,primary_phone,gender,country,city,address,dob) values
('20261023-2222-4000-8000-000000000001','Earlier Name','919012348765','FEMALE','India','Older city','Earlier address','1990-02-03'),
('20261023-2222-4000-8000-000000000002','Recent Name','919012348765',null,null,'Newer city',null,null),
('20261023-2222-4000-8000-000000000003','International','659012348765','MALE','Singapore','Foreign city','Foreign address',null),
('20261023-2222-4000-8000-000000000004','No Phone',null,null,null,null,null,null);
insert into clients(client_id,primary_name,primary_phone,address,last_visit_date) values
('20261023-4444-4000-8000-000000000001','Earlier Singapore','+6598765432','Singapore detail','2026-01-01Z'),
('20261023-4444-4000-8000-000000000002','Latest Singapore','+6598765432',null,'2026-02-01Z');
insert into client_timeline(id,client_id,branch_id,event_date,crm_name) values
('20261023-3333-4000-8000-000000000001','20261023-2222-4000-8000-000000000001','20261023-0000-4000-8000-000000000001','2026-01-01Z','Stack Staff'),
('20261023-3333-4000-8000-000000000002','20261023-2222-4000-8000-000000000002','20261023-0000-4000-8000-000000000001','2026-02-01Z','Stack Staff');
update client_timeline set buy_status='YES',salesperson_id='20261023-1111-4000-8000-000000000001',reference_number='STACK-'||id::text where client_id::text like '20261023-2222%';
update clients set billing_phone='+6591234567' where client_id='20261023-2222-4000-8000-000000000001';
insert into visit_forms(client_timeline_id,did_buy,occupation,communication_preference,additional_fields) values
('20261023-3333-4000-8000-000000000001',true,'Business','CALL','{"submitted_fields":{"address":"Earlier address","dob":"1990-02-03","city":"Older city","country":"India","occupation":"Business"}}'),
('20261023-3333-4000-8000-000000000002',true,null,'WHATSAPP MESSAGE','{"submitted_fields":{"address":"","city":"Newer city","communication_preference":"WHATSAPP MESSAGE"}}');
select set_config('request.jwt.claim.sub','20261023-1111-4000-8000-000000000001',true);
set local role authenticated;
select is((select client_id from lookup_client_profile_by_phone('+919012348765')),'20261023-2222-4000-8000-000000000002'::uuid,'phone lookup retains most recently visited identity');
select is((select address from lookup_client_profile_by_phone('+919012348765')),'Earlier address','latest sparse profile carries older address');
select is((select dob from lookup_client_profile_by_phone('+919012348765')),'1990-02-03'::date,'older birth date remains available');
select is((select city from lookup_client_profile_by_phone('+919012348765')),'Newer city','latest nonblank answer wins conflict');
reset role;
update clients set city='' where client_id='20261023-2222-4000-8000-000000000001';
set local role authenticated;
select is((select city from lookup_client_profile_by_phone('+919012348765')),'Newer city','clearing an old answer does not promote it over a newer answer');
select is((select communication_preference from lookup_client_profile_by_phone('+919012348765')),'WHATSAPP MESSAGE','saved latest preference is projected');
select is(get_walkin_profile_defaults('20261023-2222-4000-8000-000000000002')->>'occupation','Business','older occupation prefills a later sparse visit');
reset role;
update visit_forms set additional_fields=additional_fields||'{"beverage_other":"Lime water"}' where client_timeline_id='20261023-3333-4000-8000-000000000001';
set local role authenticated;
select is(get_walkin_profile_defaults('20261023-2222-4000-8000-000000000002')->>'beverage_other','Lime water','saved Other preference detail remains available');
select is((select client_id from get_client_profile('20261023-2222-4000-8000-000000000001')),'20261023-2222-4000-8000-000000000001'::uuid,'profile-by-ID keeps its own identity');
select is((select city from get_client_profile('20261023-2222-4000-8000-000000000001')),'Newer city','profile and prefill share stacking rule');
select is((select address from lookup_client_profile_by_phone('+659012348765')),'Foreign address','country codes do not conflate phones');
select is((select address from lookup_client_profile_by_phone('+6598765432')),'Singapore detail','stored ten-digit international identities stack without acquiring India country code');
select is((select address from get_client_profile('20261023-2222-4000-8000-000000000004')),null::text,'no-phone client does not borrow another profile');
select is((select client_id from create_entry_queue('Different spelling','+919012348765','20261023-0000-4000-8000-000000000001')),'20261023-2222-4000-8000-000000000002'::uuid,'phone registration reuses most recent profile despite different name');
select is((select client_id from create_entry_queue('Earlier Name','+919012348765','20261023-0000-4000-8000-000000000001',null,'20261023-2222-4000-8000-000000000001')),'20261023-2222-4000-8000-000000000001'::uuid,'explicit profile action retains selected identity');
select lives_ok($$select * from submit_walkin_visit('{"client_id":"20261023-2222-4000-8000-000000000002","primary_name":"Recent Name","primary_phone":"+919012348765","branch_id":"20261023-0000-4000-8000-000000000001","event_date":"2026-03-01Z","crm_name":"Stack Staff","salesperson_id":"20261023-1111-4000-8000-000000000001","visit_status":"NO","address":"","city":"Newest city","dob":"","proposed_timeline_id":"20261023-3333-4000-8000-000000000003"}')$$,'sparse walk-in saves through existing audited transaction');
select is((select address from clients where client_id='20261023-2222-4000-8000-000000000002'),'Earlier address','blank answer does not erase known address');
select is((select dob from clients where client_id='20261023-2222-4000-8000-000000000002'),'1990-02-03'::date,'blank answer does not erase birth date');
select is((select billing_phone from clients where client_id='20261023-2222-4000-8000-000000000002'),'6591234567','inherited international billing phone retains its exact digits');
select is((select billing_phone_country_code from clients where client_id='20261023-2222-4000-8000-000000000002'),'65','inherited billing phone retains Singapore country code');
select is((select city from lookup_client_profile_by_phone('+919012348765')),'Newest city','new changed answer wins');
select is((select additional_fields->'submitted_fields'->>'address' from visit_forms where client_timeline_id='20261023-3333-4000-8000-000000000003'),'','original blank submission remains unchanged');
select throws_ok($$select * from submit_walkin_visit('{"client_id":"20261023-2222-4000-8000-000000000002","primary_name":"Recent Name","primary_phone":"+919012348765","branch_id":"20261023-0000-4000-8000-000000000002","visit_status":"NO"}')$$,'42501',null,'cross-branch submission remains denied');
reset role;
select is((select count(*)::integer from clients where client_id::text like '20261023-2222%'),4,'all client records retained and registration creates no duplicate');
select is((select count(*)::integer from client_timeline where client_id::text like '20261023-2222%'),3,'all original visits remain');
select is((select additional_fields->'submitted_fields'->>'address' from visit_forms where client_timeline_id='20261023-3333-4000-8000-000000000001'),'Earlier address','old evidence remains unchanged');
select ok(exists(select 1 from crm_private.audit_logs where action='crm.submit_walkin_visit' and record_id='20261023-3333-4000-8000-000000000003'),'submission remains audited');
set local role authenticated;
select is((select client_id from submit_walkin_visit('{"primary_name":"API spelling","primary_phone":"+919012348765","branch_id":"20261023-0000-4000-8000-000000000001","crm_name":"Stack Staff","salesperson_id":"20261023-1111-4000-8000-000000000001","visit_status":"NO","event_date":"2026-04-01Z"}')),'20261023-2222-4000-8000-000000000002'::uuid,'direct walk-in API without an explicit ID also reuses latest phone identity');
reset role;
select is((select count(*)::integer from clients where primary_phone='919012348765'),2,'direct submission creates no extra client for an existing phone');
update users set active=false where id='20261023-1111-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from get_client_profile('20261023-2222-4000-8000-000000000001')$$,'42501',null,'inactive profile read denied');
reset role;
set local role anon;
select throws_ok($$select * from get_client_profile('20261023-2222-4000-8000-000000000001')$$,'42501',null,'anonymous profile read denied');
reset role;
set local role service_role;
select throws_ok($$select * from get_client_profile('20261023-2222-4000-8000-000000000001')$$,'42501',null,'service role cannot execute browser profile helper');
reset role;
select * from finish();
rollback;
