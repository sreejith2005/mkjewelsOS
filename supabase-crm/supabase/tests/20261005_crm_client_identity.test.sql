-- Client identity (20261005000300): MKREF codes, protected identity columns, optional phone,
-- referral and lead clients (stage lead), referral conversion ignores lead clients, queue
-- registration of a lead client, companions -> family, family RPCs, code search, derived
-- identity columns. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures: branches A and B; super admin 1, salesperson 2 (A), salesperson 3 (B)
-- ---------------------------------------------------------------------------
insert into branches(id, name) values
('20261007-0000-4000-8000-00000000000a', 'Identity Branch A'),
('20261007-0000-4000-8000-00000000000b', 'Identity Branch B');
insert into users(id, name, email, role, branch_id, active) values
('20261007-1111-4000-8000-000000000001', 'Identity Admin', 'identity-1@example.invalid', 'super_admin', null, true),
('20261007-1111-4000-8000-000000000002', 'Identity Sales A', 'identity-2@example.invalid', 'salesperson', '20261007-0000-4000-8000-00000000000a', true),
('20261007-1111-4000-8000-000000000003', 'Identity Sales B', 'identity-3@example.invalid', 'salesperson', '20261007-0000-4000-8000-00000000000b', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select gen_random_uuid(), u.email, u.id, u.id, true from users u where u.email like 'identity-%@example.invalid';
insert into crm_allocation(branch_id, crm_name, active, crm_user_id)
values ('20261007-0000-4000-8000-00000000000a', 'IDENTITY SALES A', true, '20261007-1111-4000-8000-000000000002');

insert into clients(client_id, primary_name, primary_phone, last_branch_id) values
('20261007-2222-4000-8000-0000000000c1', 'Synthetic Main Client', '9199000201', '20261007-0000-4000-8000-00000000000a'),
('20261007-2222-4000-8000-0000000000c2', 'Synthetic Other Family', '9199000202', '20261007-0000-4000-8000-00000000000b');

create function pg_temp.act_as(p_user text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '20261007-1111-4000-8000-00000000000' || p_user)::text, true),
         set_config('request.jwt.claim.sub', '20261007-1111-4000-8000-00000000000' || p_user, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;
create function pg_temp.client(p_id text) returns clients language sql security definer as $$
  select * from clients where client_id = ('20261007-2222-4000-8000-0000000000' || p_id)::uuid;
$$;
create function pg_temp.by_phone(p_phone text) returns clients language sql security definer as $$
  select c.* from clients c join client_phone_index pi on pi.client_id = c.client_id where pi.phone = p_phone;
$$;
grant execute on function pg_temp.client(text), pg_temp.by_phone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Codes and protected columns
-- ---------------------------------------------------------------------------
select ok((pg_temp.client('c1')).referral_code ~ '^MKREF-[0-9]+$', 'a new client gets an MKREF code');
select ok(substring((pg_temp.client('c1')).client_code from 5)::bigint > 200000, 'new MKC codes start above MKC-200000 (apart from the Sheets CRM numbers)');
select isnt((pg_temp.client('c1')).referral_code, (pg_temp.client('c2')).referral_code, 'MKREF codes are unique');
select is((select count(*)::int from clients where referral_code is null), 0, 'every client has an MKREF code');
select is((pg_temp.client('c1')).lifecycle_stage, 'visited', 'clients created by staff start as visited');

set local role authenticated;
select pg_temp.act_as('2');
select lives_ok($$update clients set city = 'Synthetic City' where client_id = '20261007-2222-4000-8000-0000000000c1'$$, 'staff still edit ordinary client fields');
select throws_ok($$update clients set referral_code = 'MKREF-999999' where client_id = '20261007-2222-4000-8000-0000000000c1'$$, '42501', null, 'staff cannot change an MKREF code');
select throws_ok($$update clients set lifecycle_stage = 'lead' where client_id = '20261007-2222-4000-8000-0000000000c1'$$, '42501', null, 'staff cannot change the lifecycle stage');
select throws_ok($$insert into clients(primary_name, primary_phone, referral_code) values ('X', '9199000299', 'MKREF-1')$$, '42501', null, 'staff cannot choose an MKREF code');
select throws_ok($$insert into households default values$$, '42501', null, 'staff cannot create a family directly');
reset role;

-- ---------------------------------------------------------------------------
-- Referrals get a lead client; conversion ignores lead clients
-- ---------------------------------------------------------------------------
insert into referrals(id, salesperson_id, given_by_client_id, referral_name, referral_number, branch_id, relationship)
values ('20261007-3333-4000-8000-000000000001', '20261007-1111-4000-8000-000000000002', '20261007-2222-4000-8000-0000000000c1',
  'Synthetic Referred Friend', '9199000203', '20261007-0000-4000-8000-00000000000a', null);
select ok((select referred_client_id from referrals where id = '20261007-3333-4000-8000-000000000001') is not null, 'a referral gets a client');
select is((pg_temp.by_phone('9199000203')).lifecycle_stage, 'lead', 'the referred person is a lead');
select is((pg_temp.by_phone('9199000203')).referred_by_client_id, '20261007-2222-4000-8000-0000000000c1'::uuid, 'the referrer is stored');
select is((pg_temp.by_phone('9199000203')).referral_relation::text, 'Referral', 'the relation defaults to Referral');
select ok((pg_temp.by_phone('9199000203')).client_code ~ '^MKC-[0-9]+$', 'the referred person has an MKC code');

insert into referrals(id, salesperson_id, given_by_client_id, referral_name, referral_number, branch_id)
values ('20261007-3333-4000-8000-000000000002', '20261007-1111-4000-8000-000000000002', '20261007-2222-4000-8000-0000000000c1',
  'Synthetic Other Family', '9199000202', '20261007-0000-4000-8000-00000000000a');
-- Phone + name identity (20261006000200): the known person is the same phone AND name.
select is((select referred_client_id from referrals where id = '20261007-3333-4000-8000-000000000002'), '20261007-2222-4000-8000-0000000000c2'::uuid,
  'a referral with a known phone and name links to that client');
select is((pg_temp.client('c2')).referred_by_client_id, null, 'an existing client is not re-parented');

insert into referral_calling(referral_id, status) values
('20261007-3333-4000-8000-000000000001', 'PENDING'), ('20261007-3333-4000-8000-000000000002', 'PENDING');
set local role authenticated;
select pg_temp.act_as('2');
select is(reconcile_referral_calling_conversions(), 1, 'only the referral whose client is not a lead converts');
reset role;
select is((select status::text from referral_calling where referral_id = '20261007-3333-4000-8000-000000000001'), 'PENDING', 'the lead referral stays to be called');

-- The referred person registers in the queue: a new client, engaged.
set local role authenticated;
select pg_temp.act_as('2');
select is((select client_type from create_entry_queue('Synthetic Referred Friend', '9199000203', null, 'IDENTITY SALES A', null)), 'new',
  'a lead client registers as a new client');
reset role;
select is((pg_temp.by_phone('9199000203')).lifecycle_stage, 'engaged', 'registration engages the lead');
select ok((select client_is_new from entry_queue where mobile = '9199000203'), 'the queue row is flagged new');
set local role authenticated;
select pg_temp.act_as('2');
select is(reconcile_referral_calling_conversions(), 1, 'once engaged, the referral converts');
reset role;

-- ---------------------------------------------------------------------------
-- Leads get an MKC client at first contact
-- ---------------------------------------------------------------------------
insert into leads(id, phone_number, name, created_by, branch_id) values
('20261007-4444-4000-8000-000000000001', '9199000204', 'Synthetic Instagram Lead', '20261007-1111-4000-8000-000000000002', '20261007-0000-4000-8000-00000000000a'),
('20261007-4444-4000-8000-000000000002', '9199000201', null, '20261007-1111-4000-8000-000000000002', '20261007-0000-4000-8000-00000000000a');
select is((select c.lifecycle_stage from leads l join clients c on c.client_id = l.client_id where l.id = '20261007-4444-4000-8000-000000000001'), 'lead',
  'a new lead gets a lead client');
select is((select client_id from leads where id = '20261007-4444-4000-8000-000000000002'), '20261007-2222-4000-8000-0000000000c1'::uuid,
  'a lead with a known phone links to that client');

-- ---------------------------------------------------------------------------
-- Companions join the family; optional phone
-- ---------------------------------------------------------------------------
insert into client_timeline(id, client_id, event_date, branch_id, salesperson_id)
values ('20261007-5555-4000-8000-000000000001', '20261007-2222-4000-8000-0000000000c1', now(), '20261007-0000-4000-8000-00000000000a', '20261007-1111-4000-8000-000000000002');
insert into visit_forms(client_timeline_id, companions) values ('20261007-5555-4000-8000-000000000001',
  '[{"name":"Synthetic Spouse","mobile":"9199000205","relation":"SPOUSE"},{"name":"Synthetic Child","phone":"","relation":"SON"},{"name":"Synthetic Other Family","phone":"9199000202","relation":"FRIEND"}]');
select ok((pg_temp.client('c1')).household_id is not null, 'the main client now has a family');
select is((select h.household_code ~ '^MKF-[0-9]+$' from households h where h.id = (pg_temp.client('c1')).household_id), true, 'the family has an MKF code');
select is((pg_temp.by_phone('9199000205')).primary_name::text, 'Synthetic Spouse', 'a companion phone sent as mobile (the /crm form) is kept');
select is((select count(*)::int from clients where household_id = (pg_temp.client('c1')).household_id), 4,
  'spouse, child (no phone) and the companion already a client joined the family');
select is((select primary_phone from clients where primary_name = 'Synthetic Child'), null, 'a companion without a phone is a client without a phone');
select ok((select referral_code is not null from clients where primary_name = 'Synthetic Child'), 'and still gets codes');

insert into client_timeline(id, client_id, event_date, branch_id, salesperson_id)
values ('20261007-5555-4000-8000-000000000002', '20261007-2222-4000-8000-0000000000c1', now(), '20261007-0000-4000-8000-00000000000a', '20261007-1111-4000-8000-000000000002');
insert into visit_forms(client_timeline_id, companions) values ('20261007-5555-4000-8000-000000000002', '[{"name":"synthetic  child","phone":"","relation":"SON"}]');
select is((select count(*)::int from clients where primary_name ilike 'synthetic%child'), 1, 'the same companion without a phone is not duplicated on a later visit');

-- A companion who belongs to another family is not moved.
insert into clients(client_id, primary_name, primary_phone, last_branch_id) values
('20261007-2222-4000-8000-0000000000c3', 'Synthetic Second Main', '9199000206', '20261007-0000-4000-8000-00000000000a');
insert into client_timeline(id, client_id, event_date, branch_id, salesperson_id)
values ('20261007-5555-4000-8000-000000000003', '20261007-2222-4000-8000-0000000000c3', now(), '20261007-0000-4000-8000-00000000000a', '20261007-1111-4000-8000-000000000002');
insert into visit_forms(client_timeline_id, companions) values ('20261007-5555-4000-8000-000000000003', '[{"name":"Synthetic Spouse","phone":"9199000205"}]');
select is((pg_temp.by_phone('9199000205')).household_id, (pg_temp.client('c1')).household_id, 'a person stays in their one family');
select is((pg_temp.client('c3')).household_id, (pg_temp.client('c1')).household_id, 'the new main client joins the companion''s family instead');

-- ---------------------------------------------------------------------------
-- Family RPCs
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('3');
select throws_ok($$select remove_client_from_family('20261007-2222-4000-8000-0000000000c3')$$, '42501', null, 'another branch''s staff cannot change this family');
select pg_temp.act_as('2');
select lives_ok($$select remove_client_from_family('20261007-2222-4000-8000-0000000000c3')$$, 'the branch''s staff can take a person out of a family');
select is((pg_temp.client('c3')).household_id, null, 'removed');
select is(add_client_to_family('20261007-2222-4000-8000-0000000000c1', '20261007-2222-4000-8000-0000000000c3'), 'joined', 'and add them back');
reset role;
select is((select count(*)::int from crm_private.audit_logs where action in ('crm.add_client_to_family', 'crm.remove_client_from_family')
  and record_id::text like '20261007-2222-%'), 2, 'family changes are audited');
select ok(not exists (select 1 from crm_private.audit_logs where action like 'crm.%family%' and details::text ilike '%synthetic%'),
  'family audit rows carry no names');

-- ---------------------------------------------------------------------------
-- Search and derived identity columns
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('2');
select is((select array_agg(client_id) from search_clients((pg_temp.client('c1')).client_code)), array['20261007-2222-4000-8000-0000000000c1'::uuid],
  'an MKC code finds exactly that client');
select is((select array_agg(client_id) from search_clients(lower(replace((pg_temp.client('c1')).client_code, '-', ' ')))), array['20261007-2222-4000-8000-0000000000c1'::uuid],
  'codes are matched case- and dash-insensitively');
select is((select count(*)::int from search_clients((select household_code from households where id = (pg_temp.client('c1')).household_id), 20)), 5,
  'an MKF code lists the whole family');
select is((select array_agg(client_id) from search_clients((pg_temp.client('c2')).referral_code)), array['20261007-2222-4000-8000-0000000000c2'::uuid],
  'an MKREF code finds its client');
select is((select count(*)::int from search_clients('MKC-' || substring((pg_temp.client('c1')).client_code from 5) || '0000')), 0,
  'a code-shaped query is never a phone or name search');
select ok(exists (select 1 from search_clients('9199000201') where client_id = '20261007-2222-4000-8000-0000000000c1'), 'phone search still works');
select ok(exists (select 1 from search_clients('Synthetic Main') where client_id = '20261007-2222-4000-8000-0000000000c1'), 'name search still works');

select is((select relation from client_identity where client_id = '20261007-2222-4000-8000-0000000000c1'), 'Main client', 'a main client''s relation');
select is((select referral_id from client_identity where client_id = '20261007-2222-4000-8000-0000000000c1'), (pg_temp.client('c1')).referral_code,
  'a main client''s Referral ID is their own MKREF');
select is((select referral_person_id from client_identity where client_id = '20261007-2222-4000-8000-0000000000c1'), null, 'a main client has no Referral person ID');
select is((select referral_id from client_identity where client_id = (pg_temp.by_phone('9199000203')).client_id), (pg_temp.client('c1')).referral_code,
  'a referred person''s Referral ID is the referrer''s MKREF');
select is((select referral_person_id from client_identity where client_id = (pg_temp.by_phone('9199000203')).client_id), (pg_temp.by_phone('9199000203')).referral_code,
  'a referred person''s Referral person ID is their own MKREF');
select is((select lifecycle_stage from client_identity where client_id = '20261007-2222-4000-8000-0000000000c1'), 'visited', 'the derived stage follows the visits');
reset role;

set local role anon;
select throws_ok($$select count(*) from client_identity$$, '42501', null, 'anon cannot read client identity');
reset role;

select * from finish();
rollback;
