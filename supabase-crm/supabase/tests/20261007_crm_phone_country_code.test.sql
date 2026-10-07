-- Phone numbers keep their country code (20261007001000): input and stored forms, the
-- country-code columns, every write path (queue, walk-in, client, lead, post-call lead,
-- referral, profile edit), lookups and search, invalid numbers, and the Sheet's last-10-digit
-- PHONE KEY. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Canonical form
-- ---------------------------------------------------------------------------
select is(crm_private.phone_key('9987323456'), '919987323456', 'a 10-digit number without code is Indian');
select is(crm_private.phone_key('09987323456'), '919987323456', 'a leading trunk 0 is dropped');
select is(crm_private.phone_key('919987323456'), '919987323456', 'a 12-digit number keeps all its digits');
select is(crm_private.phone_key('929987323456'), '929987323456', 'another country code is not replaced by 91');
select is(crm_private.phone_key('+91 99873-23456'), '919987323456', 'spaces, dashes and + are removed');
select is(crm_private.phone_key('+65 9123 4567'), '6591234567', 'an international number of 10 digits is stored as digits');
select is(crm_private.stored_phone('6591234567'), '6591234567', 'a stored number reads back as itself (not as Indian)');
select is(crm_private.phone_key(crm_private.as_phone_input('6591234567')), '6591234567', 'a stored number handed on as input stays the same');
select is(crm_private.phone_country('6591234567'), '65', 'the country code is read from the stored number');
select is(crm_private.phone_country('12125550100'), '1', 'one-digit country codes are found');
select is(crm_private.phone_country('971501234567'), '971', 'three-digit country codes are found');
select is((select count(*)::int from crm_private.phone_country_codes a join crm_private.phone_country_codes b
  on a.code <> b.code and b.code like a.code || '%'), 0, 'country codes are prefix-free, so a number has one country');
select is(crm_private.phone_key('00971501234567'), '971501234567', 'a 00 international prefix is dropped');
select is(crm_private.phone_key('12345'), null, 'too short is not a phone');
select is(crm_private.phone_key('1234567890123456'), null, 'more than 15 digits is not a phone');
select is(crm_private.phone_key(null), null, 'no phone is no phone');

-- ---------------------------------------------------------------------------
-- Fixtures: one branch, staff member 2 on the CRM roster
-- ---------------------------------------------------------------------------
insert into branches(id, name) values ('20261008-0000-4000-8000-00000000000a', 'Phone Branch A');
insert into users(id, name, email, role, branch_id, active) values
('20261008-1111-4000-8000-000000000002', 'Phone Sales A', 'phone-2@example.invalid', 'salesperson', '20261008-0000-4000-8000-00000000000a', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select gen_random_uuid(), u.email, u.id, u.id, true from users u where u.email = 'phone-2@example.invalid';
insert into crm_allocation(branch_id, crm_name, active, crm_user_id)
values ('20261008-0000-4000-8000-00000000000a', 'PHONE SALES A', true, '20261008-1111-4000-8000-000000000002');

create function pg_temp.act_as_staff() returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '20261008-1111-4000-8000-000000000002')::text, true),
         set_config('request.jwt.claim.sub', '20261008-1111-4000-8000-000000000002', true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.act_as_staff() to authenticated;
create function pg_temp.phone_of(p_client uuid) returns text language sql security definer as $$
  select primary_phone::text from clients where client_id = p_client;
$$;
create function pg_temp.indexed(p_phone text) returns uuid language sql security definer as $$
  select client_id from client_phone_index where phone = p_phone;
$$;
create function pg_temp.cc_of(p_client uuid) returns text language sql security definer as $$
  select primary_phone_country_code from clients where client_id = p_client;
$$;
grant execute on function pg_temp.phone_of(uuid), pg_temp.indexed(text), pg_temp.cc_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Write paths
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as_staff();

create temp table q91 as select * from create_entry_queue('Synthetic Indian Client', '9987323456', null, 'PHONE SALES A', null);
create temp table q92 as select * from create_entry_queue('Synthetic Pakistan Client', '+92 99873 23456', null, 'PHONE SALES A', null);
select is(pg_temp.phone_of((select client_id from q91)), '919987323456', 'queue registration stores 91 + the number');
select is(pg_temp.phone_of((select client_id from q92)), '929987323456', 'queue registration keeps the chosen country code');
select is(pg_temp.cc_of((select client_id from q92)), '92', 'the client country code column is set');
select is(pg_temp.cc_of((select client_id from q91)), '91', 'an Indian number gets 91');
select isnt((select client_id from q91), (select client_id from q92), 'the same national number in two countries is two clients');
select is((select mobile::text from entry_queue where id = (select id from q92)), '929987323456', 'the queue row keeps the country code');
select is((select country_code from entry_queue where id = (select id from q92)), '92', 'the queue row has its country code column');
select is(pg_temp.indexed('929987323456'), (select client_id from q92), 'the phone index holds the full number');
select throws_ok($$select create_entry_queue('Synthetic Short', '12345', null, 'PHONE SALES A', null)$$, '23514', null,
  'queue registration rejects a number that is not a phone');

select is(pg_temp.phone_of(create_client_with_phone('Synthetic UAE Client', '+971 50 123 4567', null, null)), '971501234567',
  'a new client keeps its country code');
select throws_ok($$select create_client_with_phone('Synthetic Short', '98765', null, null)$$, '23514', null,
  'a new client needs a valid phone');

create temp table walkin as select * from submit_walkin_visit(jsonb_build_object(
  'branch_id', '20261008-0000-4000-8000-00000000000a', 'primary_name', 'Synthetic Singapore Client',
  'primary_phone', '+65 9123 4567', 'billing_phone', '+65 9123 4567', 'reference_phone', '98200 12345', 'crm_name', 'PHONE SALES A', 'did_buy', true));
select is(pg_temp.phone_of((select client_id from walkin)), '6591234567', 'a walk-in keeps the country code (not taken as Indian)');
select is(pg_temp.cc_of((select client_id from walkin)), '65', 'and records Singapore');
select is((select billing_phone::text from clients where client_id = (select client_id from walkin)), '6591234567', 'the billing phone is stored the same way');
select is((select billing_phone_country_code from clients where client_id = (select client_id from walkin)), '65', 'with its own country code');
select is(pg_temp.indexed('6591234567'), (select client_id from walkin), 'the short international number is indexed as stored');
select is((select reference_phone::text from visit_forms where client_timeline_id = (select timeline_id from walkin)), '919820012345',
  'a reference phone without code is stored as Indian');
select is((select reference_phone_country_code from visit_forms where client_timeline_id = (select timeline_id from walkin)), '91',
  'with its country code');

insert into leads(phone_number, name, created_by) values ('+44 7700 900123', 'Synthetic UK Lead', '20261008-1111-4000-8000-000000000002');
select is((select phone_number::text from leads where name = 'Synthetic UK Lead'), '447700900123', 'a lead keeps its country code');
select is((select country_code from leads where name = 'Synthetic UK Lead'), '44', 'the lead country code column is set');
update leads set country_code = '91' where name = 'Synthetic UK Lead';
select is((select country_code from leads where name = 'Synthetic UK Lead'), '44', 'the country code cannot be set apart from the number');
select throws_ok($$insert into leads(phone_number, created_by) values ('123', '20261008-1111-4000-8000-000000000002')$$, '23514', null,
  'a lead needs a valid phone');
select is((create_post_call_lead('9100000077', 'Synthetic Call Lead', '{}'::jsonb, 'CONNECTED')).phone_number::text, '919100000077',
  'a post-call lead without code is stored as Indian');

select is((create_manual_referral((select client_id from q91), 'Synthetic US Referral', '+1 212 555 0100', null, null)).referral_number::text,
  '12125550100', 'a referral keeps its country code');
select is((select country_code from referrals where referral_name = 'Synthetic US Referral'), '1', 'the referral country code column is set');

update clients set secondary_phone = '+91 98200 55555' where client_id = (select client_id from q91);
update clients set city = 'Synthetic City', primary_phone = primary_phone where client_id = (select client_id from walkin);
select is(pg_temp.phone_of((select client_id from walkin)), '6591234567', 'saving a profile with an unchanged short number keeps it');
select is((select secondary_phone::text from clients where client_id = (select client_id from q91)), '919820055555', 'a profile edit stores the canonical form');
select is(pg_temp.indexed('919820055555'), (select client_id from q91), 'the edited phone is indexed');
reset role;
select is((select c.primary_phone::text from clients c join referrals r on r.referred_client_id = c.client_id where r.referral_name = 'Synthetic US Referral'),
  '12125550100', 'the referred person gets the same number (a stored number is not re-read)');
select is((select count(*)::int from clients where primary_phone ~ '^[0-9]{10}$' and primary_phone_country_code = '91'), 0,
  'no Indian number is stored without its code');
set local role authenticated;
select pg_temp.act_as_staff();

-- ---------------------------------------------------------------------------
-- Lookups and search
-- ---------------------------------------------------------------------------
select is((select client_id from lookup_client_by_phone('9987323456')), (select client_id from q91), 'a 10-digit lookup finds the Indian client');
select is((select client_id from lookup_client_by_phone('+92 9987323456')), (select client_id from q92), 'a lookup with a country code finds that country''s client');
select is((select client_id from search_clients('9987323456', 1)), (select client_id from q91), 'search by the 10 digits ranks the Indian number first');
select is((select client_id from search_clients('+92 99873 23456', 1)), (select client_id from q92), 'search with a country code finds that client');
select ok(exists(select 1 from search_clients('9123 4567', 5) where client_id = (select client_id from walkin)), 'search by part of a foreign number works');
select ok(exists(select 1 from browse_clients_page('929987323456', null, 0, 50) where client_id = (select client_id from q92)), 'the client list searches the full number');
select ok(exists(select 1 from browse_clients_page('2125550100', null, 0, 50) where primary_phone = '12125550100'), 'the client list finds a foreign national number');
reset role;

-- ---------------------------------------------------------------------------
-- The Sheet's PHONE KEY stays its last 10 digits (Code.gs)
-- ---------------------------------------------------------------------------
select is((select "PHONE KEY" from crm_private.sheet_client_database_master where _record_id = (select client_id from q91)), '9987323456',
  'the Sheet phone key is unchanged');
select is((select "PRIMARY PHONE" from crm_private.sheet_client_database_master where _record_id = (select client_id from q91)), '919987323456',
  'the Sheet primary phone carries the country code');
select is((select "FINAL NUMBER" from crm_private.sheet_walkin_dataset where _record_id = (select timeline_id from walkin)), '6591234567',
  'the Sheet final number is the stored number (no 91 added to a short foreign number)');

select * from finish();
rollback;
