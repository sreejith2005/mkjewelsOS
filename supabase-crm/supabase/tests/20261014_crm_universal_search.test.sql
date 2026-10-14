-- Synthetic records only; every fixture is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into branches(id,name) values ('20261014-0000-4000-8000-000000000001','Search Branch');
insert into users(id,name,email,role,branch_id,active) values
 ('20261014-1111-4000-8000-000000000001','Search Staff','search-staff@example.invalid','salesperson','20261014-0000-4000-8000-000000000001',true),
 ('20261014-1111-4000-8000-000000000002','Search Inactive','search-inactive@example.invalid','salesperson','20261014-0000-4000-8000-000000000001',false);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active)
select gen_random_uuid(),email,id,id,true from users where id in ('20261014-1111-4000-8000-000000000001','20261014-1111-4000-8000-000000000002');
insert into clients(client_id,primary_name,primary_phone,other_names,last_branch_id) values
 ('20261014-2222-4000-8000-000000000001','Li','9198000411',array['Synthetic Alternate'],'20261014-0000-4000-8000-000000000001');
insert into clients(client_id,primary_name,primary_phone,last_branch_id) values
 ('20261014-2222-4000-8000-000000000002','Synthetic International Contact','+1 9198000411','20261014-0000-4000-8000-000000000001');
insert into client_timeline(client_id,event_date,branch_id,salesperson_id,reference_number) values
 ('20261014-2222-4000-8000-000000000001',now(),'20261014-0000-4000-8000-000000000001','20261014-1111-4000-8000-000000000001','SEARCH-REFERENCE-EXACT');
insert into leads(phone_number,name,created_by,branch_id) values
 ('9198000412','Synthetic Social Lead','20261014-1111-4000-8000-000000000001','20261014-0000-4000-8000-000000000001');
insert into referrals(salesperson_id,given_by_client_id,referral_name,referral_number,branch_id) values
 ('20261014-1111-4000-8000-000000000001','20261014-2222-4000-8000-000000000001','Synthetic Referral Prospect','9198000413','20261014-0000-4000-8000-000000000001');
-- The source names can differ from the canonical name after a later correction.
update leads set name='Synthetic Saved Inquiry Alias' where name='Synthetic Social Lead';
update referrals set referral_name='Synthetic Saved Referral Alias' where referral_name='Synthetic Referral Prospect';
-- An old exact-name profile must remain visible ahead of many recent partial matches.
update clients set last_visit_date='2000-01-01' where client_id='20261014-2222-4000-8000-000000000001';
insert into clients(primary_name,last_visit_date,last_branch_id)
select 'Li Similar '||n,now(),'20261014-0000-4000-8000-000000000001' from generate_series(1,12)n;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261014-1111-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','20261014-1111-4000-8000-000000000001',true);
select ok(exists(select 1 from search_clients('Li',8) where client_id='20261014-2222-4000-8000-000000000001'),'exact names remain visible ahead of recent partial matches');
select is((select count(*)::int from search_clients('+1 9198000411',8)),1,'complete international phone does not match another country');
select is((select client_id from search_clients('+1 9198000411',8) limit 1),'20261014-2222-4000-8000-000000000002'::uuid,'exact international phone ranks its own contact first');
select is((browse_crm_records_page('{"search":"+1 9198000411"}',0,50)->>'total')::int,1,'paged results preserve country-aware phone matching');
select is((select count(*)::int from search_clients('Li',8) where client_id='20261014-2222-4000-8000-000000000001'),1,'short names have a searchable profile');
select is((select count(*)::int from search_clients('Synthetic Alternate',8)),1,'alternate client names resolve once');
select is((select count(*)::int from search_clients('SEARCH-REFERENCE-EXACT',8)),1,'visit reference opens its client');
select is((browse_crm_records_page('{"search":"SEARCH-REFERENCE-EXACT"}',0,50)->>'total')::int,1,'all-results page uses the same reference match');
select is((select count(*)::int from search_clients('Synthetic Saved Inquiry Alias',8)),1,'saved inquiry names resolve to the existing lead profile');
select is((select count(*)::int from search_clients('Synthetic Saved Referral Alias',8)),1,'saved referral names resolve to the existing prospect profile');
select is((select count(*)::int from search_clients('8000411',8)),2,'partial phones preserve both matching people across countries');
select is((browse_crm_records_page('{"search":"8000411"}',0,50)->>'total')::int,2,'all-results page retains every partial phone match');
select is((select count(*)::int from search_clients('   Synthetic   Alternate   ',8)),1,'spacing and case normalization are consistent');
select is((select count(*)::int from search_clients('',8)),0,'empty search never returns everyone');
select is((select count(*)::int from search_clients((select replace(client_code,'-','') from clients where client_id='20261014-2222-4000-8000-000000000001'),8)),1,'compact MKC codes remain supported');
select is((select count(*)::int from search_clients((select household_code from client_identity where client_id='20261014-2222-4000-8000-000000000001'),8)),1,'MKF identifies the family profile');
select is((select count(*)::int from search_clients((select referral_code from clients where client_id='20261014-2222-4000-8000-000000000001'),8)),1,'MKREF identifies the profile');
reset role;
set local role anon;
select throws_ok($$select * from search_clients('Li',8)$$,'42501',null,'anonymous search is denied');
select throws_ok($$select browse_crm_records_page('{}',0,50)$$,'42501',null,'anonymous all-results is denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261014-1111-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','20261014-1111-4000-8000-000000000002',true);
select is((select count(*)::int from search_clients('Li',8)),0,'inactive profile receives no search results');
reset role;
select * from finish();
rollback;
