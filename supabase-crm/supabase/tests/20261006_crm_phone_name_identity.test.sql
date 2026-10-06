-- Phone + name identity (20261006000200): one phone may belong to several clients; queue
-- registration, walk-ins, leads and referrals match phone + name as the Sheet does; web-app
-- visits get Sheet-style references; CRM families are numbered from MKF-500001. Synthetic data.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into branches(id, name) values ('20261008-0000-4000-8000-00000000000a', 'Bandra Identity');
insert into users(id, name, email, role, branch_id, active) values
('20261008-1111-4000-8000-000000000002', 'Pn Sales A', 'pn-2@example.invalid', 'salesperson', '20261008-0000-4000-8000-00000000000a', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select gen_random_uuid(), u.email, u.id, u.id, true from users u where u.email = 'pn-2@example.invalid';
insert into crm_allocation(branch_id, crm_name, active, crm_user_id)
values ('20261008-0000-4000-8000-00000000000a', 'PN SALES A', true, '20261008-1111-4000-8000-000000000002');

insert into clients(client_id, client_code, primary_name, primary_phone, last_branch_id, last_visit_date) values
('20261008-2222-4000-8000-0000000000a1', 'MKC-103901', 'Synthetic Husband', '9188100001', '20261008-0000-4000-8000-00000000000a', now() - interval '10 days'),
('20261008-2222-4000-8000-0000000000a2', 'MKC-103902', 'Synthetic Wife', '9188100001', '20261008-0000-4000-8000-00000000000a', now() - interval '2 days'),
('20261008-2222-4000-8000-0000000000a3', 'MKC-103903', 'Synthetic Single', '9188100003', '20261008-0000-4000-8000-00000000000a', null);

create function pg_temp.act_as(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_sub)::text, true),
         set_config('request.jwt.claim.sub', p_sub, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;
create function pg_temp.clients_on(p_phone text) returns integer language sql security definer as $$
  select count(*)::int from client_phone_index where phone = p_phone;
$$;
grant execute on function pg_temp.clients_on(text) to authenticated;

-- ---------------------------------------------------------------------------
-- One phone, several clients
-- ---------------------------------------------------------------------------
select is(pg_temp.clients_on('9188100001'), 2, 'two clients share one phone');
select is(crm_private.name_key('  Synthetic   wife!! '), 'SYNTHETIC WIFE', 'name key: upper case, letters and digits, single spaces');
select is(crm_private.match_client('+91 91881 00001', 'synthetic wife'), '20261008-2222-4000-8000-0000000000a2'::uuid, 'phone + name finds the right person');
select is(crm_private.match_client('9188100001', 'Synthetic Son'), null::uuid, 'phone + an unknown name matches nobody');
select is(crm_private.match_client('9188100001', null), null::uuid, 'a shared phone without a name matches nobody');
select is(crm_private.match_client('9188100003', null), '20261008-2222-4000-8000-0000000000a3'::uuid, 'a phone of one client matches without a name');
select is(crm_private.match_client(null, 'Synthetic Single'), '20261008-2222-4000-8000-0000000000a3'::uuid, 'a unique name matches without a phone');

set local role authenticated;
select pg_temp.act_as('20261008-1111-4000-8000-000000000002');

select is((select client_type from create_entry_queue('Synthetic Wife', '9188100001', null, null, null)), 'existing', 'queue: same phone and name is the existing client');
select is((select client_id from create_entry_queue('Synthetic Wife', '9188100001', null, null, null)), '20261008-2222-4000-8000-0000000000a2'::uuid, 'queue: it is the matching person, not the other one on the phone');
select is((select client_type from create_entry_queue('Synthetic Son', '9188100001', null, null, null)), 'new', 'queue: same phone, new name is a new client');
select is(pg_temp.clients_on('9188100001'), 3, 'the new client shares the phone');
select is((select primary_name::text from lookup_client_by_phone('9188100001')), 'Synthetic Wife', 'lookup by phone picks the most recently visited client');

-- ---------------------------------------------------------------------------
-- Walk-ins and references
-- ---------------------------------------------------------------------------
select is((select client_id from submit_walkin_visit(jsonb_build_object(
  'branch_id', '20261008-0000-4000-8000-00000000000a', 'primary_name', 'Synthetic Husband', 'primary_phone', '9188100001',
  'crm_name', 'Tanya Kedare', 'did_buy', false))), '20261008-2222-4000-8000-0000000000a1'::uuid,
  'a web-app walk-in is recorded on the phone + name client');
select matches((select reference_number from client_timeline where client_id = '20261008-2222-4000-8000-0000000000a1' order by event_date desc limit 1),
  '^MK-WK-CRM-BAN-TK-[0-9]+$', 'a web-app walk-in gets a Sheet-style reference');
select is((select reference_number from submit_walkin_visit(jsonb_build_object(
  'branch_id', '20261008-0000-4000-8000-00000000000a', 'primary_name', 'Synthetic Wife', 'primary_phone', '9188100001',
  'did_buy', true, 'additional_fields', jsonb_build_object('legacy_reference_number', 'mk-nwk-qax-ban-qa-99101')))),
  'MK-NWK-QAX-BAN-QA-99101', 'a visit from the Sheet keeps the Sheet''s reference');
select isnt(
  (select reference_number from submit_walkin_visit(jsonb_build_object('branch_id', '20261008-0000-4000-8000-00000000000a', 'primary_name', 'Synthetic Single', 'primary_phone', '9188100003', 'crm_name', 'Solo'))),
  (select reference_number from submit_walkin_visit(jsonb_build_object('branch_id', '20261008-0000-4000-8000-00000000000a', 'primary_name', 'Synthetic Single', 'primary_phone', '9188100003', 'crm_name', 'Solo'))),
  'two web-app references are never equal');
select matches((select reference_number from client_timeline where client_id = '20261008-2222-4000-8000-0000000000a3' order by reference_number limit 1),
  '^MK-WK-CRM-BAN-SO-[0-9]+$', 'a one-word CRM name gives its first two letters');
reset role;

-- ---------------------------------------------------------------------------
-- Leads, referrals and families
-- ---------------------------------------------------------------------------
insert into leads(id, phone_number, name, created_by, branch_id) values
('20261008-4444-4000-8000-000000000001', '9188100003', null, '20261008-1111-4000-8000-000000000002', '20261008-0000-4000-8000-00000000000a'),
('20261008-4444-4000-8000-000000000002', '9188100001', null, '20261008-1111-4000-8000-000000000002', '20261008-0000-4000-8000-00000000000a');
select is((select client_id from leads where id = '20261008-4444-4000-8000-000000000001'), '20261008-2222-4000-8000-0000000000a3'::uuid, 'a nameless lead on a one-client phone links to that client');
select isnt((select client_id from leads where id = '20261008-4444-4000-8000-000000000002'), '20261008-2222-4000-8000-0000000000a1'::uuid, 'a nameless lead on a shared phone does not guess a client');

insert into referrals(id, salesperson_id, given_by_client_id, referral_name, referral_number, branch_id) values
('20261008-3333-4000-8000-000000000001', '20261008-1111-4000-8000-000000000002', '20261008-2222-4000-8000-0000000000a3', 'Synthetic Husband', '9188100001', '20261008-0000-4000-8000-00000000000a'),
('20261008-3333-4000-8000-000000000002', '20261008-1111-4000-8000-000000000002', '20261008-2222-4000-8000-0000000000a3', 'Synthetic Daughter', '9188100001', '20261008-0000-4000-8000-00000000000a');
select is((select referred_client_id from referrals where id = '20261008-3333-4000-8000-000000000001'), '20261008-2222-4000-8000-0000000000a1'::uuid, 'a referral with a known phone and name links to that client');
select isnt((select referred_client_id from referrals where id = '20261008-3333-4000-8000-000000000002'), '20261008-2222-4000-8000-0000000000a1'::uuid, 'a referral with a known phone and a new name is a new client');

insert into households default values;
select ok((select max(substring(household_code from 5)::bigint) from households) > 500000, 'CRM families are numbered above MKF-500000');

select * from finish();
rollback;
