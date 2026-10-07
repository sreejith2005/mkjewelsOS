-- Every client has a family (20261007001200): a new client gets their own MKF as its main
-- client, companions join the buyer's family with the relation from the form, a person alone
-- in a family can be moved, a removed person gets a new family, empty families are deleted.
-- Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into branches(id, name) values
('20261008-0000-4000-8000-00000000000a', 'Family Branch A');
insert into users(id, name, email, role, branch_id, active) values
('20261008-1111-4000-8000-000000000002', 'Family Sales A', 'family-2@example.invalid', 'salesperson', '20261008-0000-4000-8000-00000000000a', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select gen_random_uuid(), u.email, u.id, u.id, true from users u where u.email like 'family-%@example.invalid';
insert into crm_allocation(branch_id, crm_name, active, crm_user_id)
values ('20261008-0000-4000-8000-00000000000a', 'FAMILY SALES A', true, '20261008-1111-4000-8000-000000000002');

create function pg_temp.act_as(p_user text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '20261008-1111-4000-8000-00000000000' || p_user)::text, true),
         set_config('request.jwt.claim.sub', '20261008-1111-4000-8000-00000000000' || p_user, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;
create function pg_temp.client(p_id text) returns clients language sql security definer as $$
  select * from clients where client_id = ('20261008-2222-4000-8000-0000000000' || p_id)::uuid;
$$;
create function pg_temp.by_name(p_name text) returns clients language sql security definer as $$
  select * from clients where primary_name = p_name;
$$;
create function pg_temp.identity(p_client uuid) returns client_identity language sql security definer as $$
  select * from client_identity where client_id = p_client;
$$;
grant execute on function pg_temp.client(text), pg_temp.by_name(text), pg_temp.identity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A new client gets MKC, MKREF and MKF at once
-- ---------------------------------------------------------------------------
select is((select count(*)::int from clients where household_id is null), 0, 'every existing client has a family (backfill)');
select is((select count(*)::int from households h where not exists (select 1 from clients c where c.household_id = h.id)), 0, 'no family is empty');

set local role authenticated;
select pg_temp.act_as('2');
select lives_ok($$insert into clients(client_id, primary_name, primary_phone, last_branch_id) values
  ('20261008-2222-4000-8000-0000000000b1', 'Family Synthetic Buyer', '9199000801', '20261008-0000-4000-8000-00000000000a')$$,
  'staff still create a client directly');
select throws_ok($$insert into clients(primary_name, primary_phone, household_id) values ('X', '9199000899', (select id from households limit 1))$$,
  '42501', null, 'staff still cannot choose a family');
reset role;

select ok((pg_temp.client('b1')).client_code ~ '^MKC-[0-9]+$', 'the new client has an MKC');
select ok((pg_temp.client('b1')).referral_code ~ '^MKREF-[0-9]+$', 'and an MKREF');
select ok((select household_code ~ '^MKF-[0-9]+$' from households where id = (pg_temp.client('b1')).household_id), 'and an MKF, with no family members yet');
select is((select main_client_id from households where id = (pg_temp.client('b1')).household_id), '20261008-2222-4000-8000-0000000000b1'::uuid,
  'they are the main client of their family');
select is((pg_temp.identity('20261008-2222-4000-8000-0000000000b1')).relation::text, 'Main client', 'relation: Main client');
select is((pg_temp.identity('20261008-2222-4000-8000-0000000000b1')).family_relation::text, 'Main client', 'family relation: Main client');

-- Every creation path: the queue registration of a new person.
set local role authenticated;
select pg_temp.act_as('2');
select lives_ok($$select create_entry_queue('Family Synthetic Queue Client', '9199000802', null, 'FAMILY SALES A', null)$$,
  'a new person registers in the queue');
reset role;
select ok((pg_temp.by_name('Family Synthetic Queue Client')).household_id is not null, 'a client created by queue registration has a family');

-- ---------------------------------------------------------------------------
-- Companions on a later visit join the buyer's family with their relation
-- ---------------------------------------------------------------------------
insert into clients(client_id, primary_name, primary_phone, last_branch_id) values
('20261008-2222-4000-8000-0000000000b2', 'Family Synthetic Known Sister', '9199000803', '20261008-0000-4000-8000-00000000000a');
insert into client_timeline(id, client_id, event_date, branch_id, salesperson_id)
values ('20261008-5555-4000-8000-000000000001', '20261008-2222-4000-8000-0000000000b1', now(), '20261008-0000-4000-8000-00000000000a', '20261008-1111-4000-8000-000000000002');
insert into visit_forms(client_timeline_id, companions) values ('20261008-5555-4000-8000-000000000001',
  '[{"name":"Family Synthetic Wife","mobile":"9199000804","relation":"WIFE"},{"name":"Family Synthetic Son","mobile":"","relation":"SON"},{"name":"Family Synthetic Known Sister","mobile":"9199000803","relation":"SISTER"}]');

select is((select main_client_id from households where id = (pg_temp.client('b1')).household_id), '20261008-2222-4000-8000-0000000000b1'::uuid,
  'the buyer stays the main client');
select is((select count(*)::int from clients where household_id = (pg_temp.client('b1')).household_id), 4,
  'new companions and an existing client alone in their family share the buyer''s MKF');
select is((pg_temp.identity((pg_temp.by_name('Family Synthetic Wife')).client_id)).relation::text, 'WIFE', 'a companion''s relation is the one on the form');
select is((pg_temp.identity((pg_temp.by_name('Family Synthetic Son')).client_id)).family_relation::text, 'SON', 'also without a phone');
select is((pg_temp.identity('20261008-2222-4000-8000-0000000000b2')).relation::text, 'SISTER', 'and for a client who already existed');
select is((pg_temp.identity('20261008-2222-4000-8000-0000000000b1')).relation::text, 'Main client', 'the buyer is still Main client');
select is((select count(*)::int from households h where not exists (select 1 from clients c where c.household_id = h.id)), 0,
  'the families the joiners left behind are deleted');

-- A person whose family has other members is not moved; the buyer alone joins theirs.
insert into clients(client_id, primary_name, primary_phone, last_branch_id) values
('20261008-2222-4000-8000-0000000000b3', 'Family Synthetic Other Buyer', '9199000805', '20261008-0000-4000-8000-00000000000a');
insert into client_timeline(id, client_id, event_date, branch_id, salesperson_id)
values ('20261008-5555-4000-8000-000000000002', '20261008-2222-4000-8000-0000000000b3', now(), '20261008-0000-4000-8000-00000000000a', '20261008-1111-4000-8000-000000000002');
insert into visit_forms(client_timeline_id, companions) values ('20261008-5555-4000-8000-000000000002',
  '[{"name":"Family Synthetic Wife","mobile":"9199000804","relation":"FRIEND"}]');
select is((pg_temp.by_name('Family Synthetic Wife')).household_id, (pg_temp.client('b1')).household_id, 'a person stays in their family');
select is((pg_temp.identity((pg_temp.by_name('Family Synthetic Wife')).client_id)).relation::text, 'WIFE', 'and keeps their relation there');
select is((pg_temp.client('b3')).household_id, (pg_temp.client('b1')).household_id, 'the buyer, alone, joins that family instead');
select is((pg_temp.identity('20261008-2222-4000-8000-0000000000b3')).relation::text, 'Family member', 'without a guessed relation');

-- ---------------------------------------------------------------------------
-- Family RPCs
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('2');
select lives_ok($$select remove_client_from_family('20261008-2222-4000-8000-0000000000b3')$$, 'take a person out of a family');
reset role;
select ok((pg_temp.client('b3')).household_id is not null, 'a removed person has a family');
select isnt((pg_temp.client('b3')).household_id, (pg_temp.client('b1')).household_id, 'a new one');
select is((pg_temp.identity('20261008-2222-4000-8000-0000000000b3')).relation::text, 'Main client', 'of which they are the main client');
set local role authenticated;
select pg_temp.act_as('2');
select is(add_client_to_family('20261008-2222-4000-8000-0000000000b1', '20261008-2222-4000-8000-0000000000b3'), 'joined', 'and add them back');
select lives_ok($$select remove_client_from_family('20261008-2222-4000-8000-0000000000b1')$$, 'the main client can leave too');
reset role;
select is((select main_client_id from households where id = (pg_temp.client('b2')).household_id), null, 'the family they left has no stored main client');
select is((pg_temp.identity('20261008-2222-4000-8000-0000000000b2')).relation::text, 'Main client',
  'so its first member by MKC is shown as main client (the FAMILY DATA rule)');
select is((select count(*)::int from households h where not exists (select 1 from clients c where c.household_id = h.id)), 0, 'no family is empty');

-- A client row can still be deleted (main client reference is cleared, empty family removed).
select lives_ok($$delete from clients where client_id = '20261008-2222-4000-8000-0000000000b1'$$, 'a main client row can be deleted');
select is((select count(*)::int from households h where not exists (select 1 from clients c where c.household_id = h.id)), 0, 'and leaves no empty family');

select * from finish();
rollback;
