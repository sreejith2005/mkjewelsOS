-- 0438: review "possibly the same person": same person merges, different people
-- stay apart (a join is separated) and are never joined or flagged again.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; b uuid; d uuid; v_auth uuid; v_id uuid; p record;
begin
  insert into tenants(name, slug) values ('0438 test', 'customer-0438') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK981') returning id into m;
  insert into branches(tenant_id, name, code) values (t, '0438 Store', 'S0438') returning id into b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Sales', 'D0438') returning id into d;
  insert into fx values ('tenant', t), ('mumbai', m);
  for p in select * from (values ('boss', 'super_admin'), ('staff', 'staff')) as x(name, role) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p.name || '-0438@test.local', 'x', now(), now())
    returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, v_auth, b, d, '0438 ' || p.name, 'E0438-' || p.name, p.name || '-0438@test.local', p.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into fx values (p.name, v_auth), (p.name || '_profile', v_id);
  end loop;
end $$;
update customer.source_tables set franchise_code = 'MK981' where source in ('master_sheet', 'software_account_list');

create function pg_temp.sign_in(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from fx where label = p_who), 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', (select id from fx where label = p_who)::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;
create function pg_temp.owner(p_phone text) returns uuid language sql as $$
  select p.client_id from customer.client_phones p
   where p.tenant_id = (select id from fx where label = 'tenant') and p.phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.master(p_phone text, p_name text, p_row integer) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_phone || ':' || p_row, 'sheet_row', p_row,
    'payload', jsonb_build_object('CONTACT NUMBER', p_phone, 'CLIENT NAME', p_name, 'SOURCE OF WALK-IN', 'Sales Register')) $$;
create function pg_temp.account(p_row integer, p_name text, p_mobile text, p_phone text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'row:' || p_row, 'sheet_row', p_row,
    'payload', jsonb_build_object('A/c Name', p_name, 'Group', 'CUSTOMER', 'Mobile', p_mobile, 'Phone', coalesce(p_phone, ''))) $$;

-- ---------------------------------------------------------------------------
-- A. A join made before 0438 on a shared other name, then separated
-- ---------------------------------------------------------------------------
-- A family phone first used by "Asha Rao", now "Vikram Rao"; the real Asha Rao has her own number.
select customer_ingest_store('master_sheet', jsonb_build_array(pg_temp.master('9820038001', 'Asha Rao', 4)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);
update customer.client_names set last_seen_at = now() - interval '1 day' where client_id = pg_temp.owner('9820038001');
select customer.add_client_name(pg_temp.owner('9820038001'), 'Vikram Rao', 'master_sheet', now() + interval '1 day');
select customer_ingest_store('master_sheet', jsonb_build_array(pg_temp.master('9820038002', 'Asha Rao', 5)), '{"next_row": 6}');
select customer_ingest_apply('master_sheet', 100);
-- Asha's billing rows carry the family number; one row of hers has only her own number.
select customer_ingest_store('software_account_list', jsonb_build_array(
  pg_temp.account(2, 'Asha Rao', '9820038002', '9820038001'), pg_temp.account(3, 'Asha Rao', '9820038002', '9820038001'),
  pg_temp.account(4, 'Asha Rao', '9820038002', null), pg_temp.account(5, 'Vikram Rao', '9820038001', null)), '{"next_row": 6}');
select customer_ingest_apply('software_account_list', 100);
create temp table ids as select pg_temp.owner('9820038001') as vikram, pg_temp.owner('9820038002') as asha;
select ok((select vikram from ids) <> (select asha from ids), 'different main names are not joined under the current rule');

-- Recreate what 0436's first rule did on 2026-11-19 (no saved merge record then).
update customer.identity_review set status = 'merged'
 where reason = 'two_phones_two_clients' and (select asha from ids) in (client_a, client_b);
select customer.merge_clients((select vikram from ids), (select asha from ids), 'same_person_two_numbers', null);
delete from customer.merge_records where removed_id = (select asha from ids);
insert into audit_logs (tenant_id, action, module, record_id, new_value)
values ((select id from fx where label = 'tenant'), 'customer_same_person_joined', 'customer', (select vikram from ids),
        jsonb_build_object('removed_client_id', (select asha from ids), 'phone', '919820038001'));
select ok(customer.rebuild_merge_record((select id from fx where label = 'tenant'), (select vikram from ids), (select asha from ids), '919820038001') is not null,
  'a join made before 0438 is rebuilt');
select is((select removed_phones -> 0 ->> 'phone' from customer.merge_records where removed_id = (select asha from ids)), customer.normalize_phone('9820038002'),
  '... with the joined record''s own number');
select is((select cardinality(removed_rows) from customer.merge_records where removed_id = (select asha from ids)), 4,
  '... and every row whose main number is hers (her first row and her 3 billing rows)');
select ok(exists (select 1 from customer.identity_review where reason = 'joined_check' and status = 'open' and client_b = (select asha from ids)),
  '... and it waits for a person''s verdict');

-- Permission.
select pg_temp.sign_in('staff');
select throws_ok('select public.customer_review_list()', '42501', null, 'staff without the permission cannot see the review');
select throws_ok(format('select public.customer_review_decide(%L, false)', (select id from customer.identity_review where reason = 'joined_check' and client_b = (select asha from ids))),
  '42501', null, '... nor decide');

select pg_temp.sign_in('boss');
select ok((public.customer_list_filters(null) ->> 'duplicates_to_review')::integer >= 1, 'the list tells Super Admin how many pairs wait');
select is((select count(*) from jsonb_array_elements(public.customer_review_list()) x where x ->> 'kind' = 'joined'), 1::bigint, 'the joined pair is on the review');
select is((select x -> 'b' ->> 'name' from jsonb_array_elements(public.customer_review_list()) x where x ->> 'kind' = 'joined'), 'Asha Rao',
  '... showing the joined record as it was');

-- Different people: separate.
select is(public.customer_review_decide((select id from customer.identity_review where reason = 'joined_check' and client_b = (select asha from ids)), false) ->> 'result',
  'separated', 'different people: the join is separated');
select is(pg_temp.owner('9820038002'), (select asha from ids), 'her number is hers again');
select is(pg_temp.owner('9820038001'), (select vikram from ids), 'the family number stays with the other record');
select ok((select merged_into_client_id is null and archived_at is null from customer.clients where id = (select asha from ids)), 'her record is back');
select is((select count(*) from customer.ingest_rows where client_id = (select asha from ids)), 4::bigint, 'her 4 sheet rows are hers');
select is((select count(*) from customer.ingest_rows where client_id = (select vikram from ids)), 2::bigint, 'his 2 sheet rows stay his');
select is((select primary_name from customer.clients where id = (select asha from ids)), 'Asha Rao', 'her main name');
select is((select primary_name from customer.clients where id = (select vikram from ids)), 'Vikram Rao', 'his main name');
select ok(exists (select 1 from audit_logs where action = 'customer_separated' and record_id = (select asha from ids)
                  and actor_user_id = (select id from fx where label = 'boss_profile')), 'the separation is audited with who did it');

-- Never joined again, even with more rows.
reset role;
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select customer_ingest_store('software_account_list', jsonb_build_array(pg_temp.account(6, 'Asha Rao', '9820038002', '9820038001')), '{"next_row": 7}');
select customer_ingest_apply('software_account_list', 100);
select ok(pg_temp.owner('9820038001') <> pg_temp.owner('9820038002'), 'people judged different are never joined again');

-- ---------------------------------------------------------------------------
-- B. A flag approved as the same person, and a merge separated exactly
-- ---------------------------------------------------------------------------
select customer_ingest_store('master_sheet', jsonb_build_array(
  pg_temp.master('9820038003', 'Mohan Das', 7), pg_temp.master('9820038004', 'Mohan Das', 8),
  pg_temp.master('9820038005', 'Rita Sen', 9), pg_temp.master('9820038006', 'Rita Sen', 10)), '{"next_row": 11}');
select customer_ingest_apply('master_sheet', 100);
select customer.add_client_name(pg_temp.owner('9820038004'), 'Mohan K Das', 'master_sheet', now() - interval '2 days');
select customer_ingest_store('software_account_list', jsonb_build_array(
  pg_temp.account(7, 'Mohan Das', '9820038003', '9820038004'), pg_temp.account(8, 'Rita Sen', '9820038005', '9820038006')), '{"next_row": 9}');
select customer_ingest_apply('software_account_list', 100);
create temp table ids2 as select pg_temp.owner('9820038003') as mohan1, pg_temp.owner('9820038004') as mohan2,
                                 pg_temp.owner('9820038005') as rita1, pg_temp.owner('9820038006') as rita2;

select pg_temp.sign_in('boss');
select is((select count(*) from jsonb_array_elements(public.customer_review_list()) x where x ->> 'kind' = 'possible'), 2::bigint, 'both flags wait for a verdict');
select is(public.customer_review_decide((select id from customer.identity_review where reason = 'possible_same_person' and status = 'open'
                                          and (select mohan2 from ids2) in (client_a, client_b)), true) ->> 'result', 'merged', 'same person: merged');
select is(pg_temp.owner('9820038003'), pg_temp.owner('9820038004'), '... one customer with both numbers');
select is(public.customer_review_decide((select id from customer.identity_review where reason = 'possible_same_person' and status = 'open'
                                          and (select rita2 from ids2) in (client_a, client_b)), false) ->> 'result', 'kept_separate', 'different people: kept apart');
select ok(not ('possible_duplicate' = any (customer.client_tags((select rita1 from ids2)))), '... and the flag is gone');

-- A merge saved by 0438 separates back exactly, names included.
reset role;
select customer.separate_merge((select id from customer.merge_records where removed_id = (select mohan2 from ids2) and not rebuilt), null);
select is(pg_temp.owner('9820038004'), (select mohan2 from ids2), 'a saved merge separates back');
select is((select string_agg(name, ',' order by name) from customer.client_names where client_id = (select mohan2 from ids2)), 'Mohan Das,Mohan K Das',
  '... with exactly its own names');

select * from finish();
rollback;
