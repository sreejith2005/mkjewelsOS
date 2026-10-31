-- Client Database paging (20261006000100): browse_clients_page pages through every match with
-- a total count, leaves out unvisited lead clients only when asked, and browse_clients keeps
-- its contract. Synthetic fixtures; counts are scoped to the fixture search text.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures: one branch, one salesperson with CRM access, 205 clients, one lead
-- ---------------------------------------------------------------------------
insert into branches(id, name) values ('20261006-0000-4000-8000-00000000000a', 'Paging Branch A');
insert into users(id, name, email, role, branch_id, active) values
('20261006-1111-4000-8000-000000000001', 'Paging Sales A', 'paging-1@example.invalid', 'salesperson', '20261006-0000-4000-8000-00000000000a', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select gen_random_uuid(), u.email, u.id, u.id, true from users u where u.email = 'paging-1@example.invalid';

insert into clients(primary_name, primary_phone, last_branch_id)
select 'Pagingfixture ' || lpad(i::text, 3, '0'), '9188' || lpad(i::text, 6, '0'), '20261006-0000-4000-8000-00000000000a'
from generate_series(1, 205) i;
insert into leads(id, phone_number, name, created_by, branch_id) values
('20261006-4444-4000-8000-000000000001', '9188999999', 'Pagingfixture Lead', '20261006-1111-4000-8000-000000000001', '20261006-0000-4000-8000-00000000000a');

create function pg_temp.act_as(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_sub)::text, true),
         set_config('request.jwt.claim.sub', p_sub, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;

select is((select count(*)::int from clients where primary_name like 'Pagingfixture%'), 206, 'fixture: 205 clients plus the lead''s client');

-- ---------------------------------------------------------------------------
-- Paging and total
-- ---------------------------------------------------------------------------
\ir fixtures/crm_master_options.sql
set local role authenticated;
select pg_temp.act_as('20261006-1111-4000-8000-000000000001');

select is((select count(*)::int from browse_clients_page('Pagingfixture', null, 0, 200, true)), 200, 'page 1 holds 200 clients');
select is((select distinct total_count::int from browse_clients_page('Pagingfixture', null, 0, 200, true)), 205, 'every row carries the total of all matches');
select is((select count(*)::int from browse_clients_page('Pagingfixture', null, 200, 200, true)), 5, 'page 2 holds the remaining 5');
select is((select distinct total_count::int from browse_clients_page('Pagingfixture', null, 200, 200, true)), 205, 'page 2 carries the same total');
select is((select count(distinct client_id)::int from (
  select client_id from browse_clients_page('Pagingfixture', null, 0, 200, true)
  union all select client_id from browse_clients_page('Pagingfixture', null, 200, 200, true)) pages), 205,
  'the two pages together list every client once');
select is((select count(*)::int from browse_clients_page('Pagingfixture', null, 0, 1000, true)), 200, 'one page never exceeds 200 rows');
select is((select primary_name from browse_clients_page('Pagingfixture', null, 0, 200, true) limit 1), 'Pagingfixture 001', 'rows keep the browse order');

-- ---------------------------------------------------------------------------
-- Unvisited lead clients
-- ---------------------------------------------------------------------------
select is((select distinct total_count::int from browse_clients_page('Pagingfixture', null, 0, 200, false)), 206, 'without the exclusion the lead''s client is counted');
select is((select count(*)::int from browse_clients_page('Pagingfixture Lead', null, 0, 200, true)), 0, 'with the exclusion an unvisited lead client is left out');
select is((select count(*)::int from browse_clients_page('Pagingfixture Lead', null, 0, 200, false)), 1, 'without the exclusion it is listed');

-- ---------------------------------------------------------------------------
-- Search still narrows the total
-- ---------------------------------------------------------------------------
select is((select total_count::int from browse_clients_page('+91 91880 00042', null, 0, 200, true)), 1, 'phone search counts one match');
select is((select primary_name from browse_clients_page('Pagingfixture 042', null, 0, 200, true)), 'Pagingfixture 042', 'name search finds the client');

-- ---------------------------------------------------------------------------
-- browse_clients keeps its contract
-- ---------------------------------------------------------------------------
select is((select count(*)::int from browse_clients('Pagingfixture', null, 0, 1000)), 200, 'browse_clients still caps one call at 200');
select is((select count(*)::int from browse_clients('Pagingfixture', null, 200, 200)), 6, 'browse_clients still lists unvisited lead clients');
select is((select count(*)::int from browse_clients('Pagingfixture', 0, 1000)), 200, 'the 3-argument browse_clients still works');
select is(
  (select array_agg(client_id) from browse_clients('Pagingfixture', null, 0, 200)),
  (select array_agg(client_id) from browse_clients_page('Pagingfixture', null, 0, 200, false)),
  'browse_clients returns the same rows in the same order');

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
select pg_temp.act_as('20261006-1111-4000-8000-0000000000ff');
select is((select count(*)::int from browse_clients_page('Pagingfixture', null, 0, 200, true)), 0, 'a session without CRM access sees no clients');
reset role;

set local role anon;
select throws_ok($$select * from browse_clients_page('Pagingfixture', null, 0, 200, true)$$, '42501', null, 'anon cannot call browse_clients_page');
reset role;

select * from finish();
rollback;
