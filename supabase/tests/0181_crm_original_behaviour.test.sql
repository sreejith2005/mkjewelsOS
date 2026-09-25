-- Port of the original CRM database contract tests
-- (sreejith-crm/web-app/tests/database-foundation.test.ts) against schema crm.
-- Same inputs, same expected outputs, same order. Harness adaptations, all identity
-- or harness related and marked "port:" below:
--   * each original CRM user (3xxxxxxx-...) is linked to a JewelOS profile whose Auth
--     user id is axxxxxxx-...; tests act as that Auth user, and assertions that expect
--     the acting user still expect the CRM user id (proving the identity bridge);
--   * Storage objects live in crm-legacy-documents and are owned by the Auth user id;
--   * pgTAP runs in one transaction, so CURRENT_TIMESTAMP does not advance between
--     statements; where the original relied on separate transactions for ordering the
--     fixture timestamp is advanced explicitly;
--   * the original re-execution of the one-time 20260725170000 data normalization is
--     not ported: that statement is data repair, not part of the ported final schema.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into tenants(id, name, slug) values ('01811000-0000-4000-8000-000000000001', 'CRM original behaviour', 'crm-0181');
insert into branches(id, tenant_id, name, code) values ('01812000-0000-4000-8000-000000000001', '01811000-0000-4000-8000-000000000001', 'CRM 0181 HQ', 'C181HQ');
insert into departments(id, tenant_id, branch_id, name, code) values ('01813000-0000-4000-8000-000000000001', '01811000-0000-4000-8000-000000000001', '01812000-0000-4000-8000-000000000001', 'HQ', 'C181HQ');

-- port: replaces "INSERT INTO users (id,name,email,role,branch_id)". Creates the CRM user
-- and a linked, active JewelOS profile (super_admin / manager / crm) in a JewelOS branch
-- linked to the CRM branch.
create function pg_temp.crm_user(p_id uuid, p_name text, p_email text, p_role crm.user_role, p_branch uuid)
returns void language plpgsql as $$
declare
  v_tenant constant uuid := '01811000-0000-4000-8000-000000000001';
  v_auth uuid := ('a' || substr(p_id::text, 2))::uuid;
  v_profile uuid := ('c' || substr(p_id::text, 2))::uuid;
  v_jewelos_branch uuid := '01812000-0000-4000-8000-000000000001';
  v_department uuid := '01813000-0000-4000-8000-000000000001';
begin
  if p_branch is not null then
    select jewelos_branch_id into v_jewelos_branch from crm.branches where id = p_branch;
    if v_jewelos_branch is null then
      v_jewelos_branch := ('b' || substr(p_branch::text, 2))::uuid;
      insert into public.branches(id, tenant_id, name, code) values (v_jewelos_branch, v_tenant, 'Port ' || p_branch, 'P' || substr(md5(p_branch::text), 1, 10));
      update crm.branches set jewelos_branch_id = v_jewelos_branch where id = p_branch;
    end if;
    v_department := ('d' || substr(p_branch::text, 2))::uuid;
    insert into public.departments(id, tenant_id, branch_id, name, code)
    values (v_department, v_tenant, v_jewelos_branch, 'Port', 'D' || substr(md5(p_branch::text), 1, 10))
    on conflict (id) do nothing;
  end if;
  insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_auth, 'authenticated', 'authenticated', 'crm-port-' || p_id || '@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now());
  insert into public.user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
  values (v_profile, v_auth, v_tenant, v_jewelos_branch, v_department, p_name, '0000018100', 'crm-port-' || p_id || '@example.invalid', 'CP-' || p_id,
    case p_role when 'super_admin' then 'super_admin' when 'branch_manager' then 'manager' else 'crm' end::public.user_role, 'active', 'active', true, '{}');
  insert into crm.users(id, name, email, role, branch_id, jewelos_profile_id) values (p_id, p_name, p_email, p_role, p_branch, v_profile);
end $$;

select set_config('request.jwt.claim.role', 'authenticated', true);

-- ===========================================================================
-- Phase 0 database guarantees
-- ===========================================================================
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'crm' and table_name = 'referral_calling_history' and column_name in ('followup_date', 'next_followup_date', 'source', 'request_key')),
  array['followup_date', 'next_followup_date', 'request_key', 'source'], 'referral calling history has the idempotency columns');
select ok(to_regprocedure('crm.save_referral_followup(uuid,text,text,date,text,text,uuid)') is not null, 'save_referral_followup with request key exists');

-- ingests a legacy payload through the canonical walk-in write path
-- port: the original ran as the database owner; here a service_role JWT, the only caller the port allows.
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000900', 'Legacy Ingest Branch');
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('t.legacy', (select row_to_json(r)::text from crm.submit_legacy_walkin_visit('{"branch_id":"10000000-0000-4000-8000-000000000900","primary_name":"Legacy Asha","primary_phone":"+91 90000 90000","did_buy":true,"seen_categories":["Ring"]}'::jsonb) r), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select ok(current_setting('t.legacy')::json ->> 'client_id' is not null, 'legacy ingest returns the client');
select is((select client_timeline_id::text from crm.visit_forms where client_timeline_id = (current_setting('t.legacy')::json ->> 'timeline_id')::uuid), current_setting('t.legacy')::json ->> 'timeline_id', 'legacy ingest writes the visit form');
select ok(exists (select 1 from crm.users where email = 'legacy-ingest+10000000-0000-4000-8000-000000000900@internal.invalid'), 'legacy ingest actor exists');

-- normalizes phone keys and prevents duplicate client phone entries
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000001', 'Phone Test Branch');
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id) values
('20000000-0000-4000-8000-000000000001', 'Client A', '9876543210', '10000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002', 'Client B', '9876543211', '10000000-0000-4000-8000-000000000001');
select throws_ok($$insert into crm.client_phone_index(phone, client_id) values ('9876543210', '20000000-0000-4000-8000-000000000002')$$, '23505', null, 'duplicate phone key rejected');
select is((select phone::text from crm.client_phone_index where client_id = '20000000-0000-4000-8000-000000000001'), '9876543210', 'phone key normalized');

-- recalculates total_visits after each new timeline event
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000002', 'Rollup Test Branch');
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id) values ('20000000-0000-4000-8000-000000000003', 'Rollup Client', '9000000001', '10000000-0000-4000-8000-000000000002');
insert into crm.client_timeline(client_id, event_date, buy_status, branch_id) values
('20000000-0000-4000-8000-000000000003', '2026-07-22T10:00:00Z', 'NO', '10000000-0000-4000-8000-000000000002'),
('20000000-0000-4000-8000-000000000003', '2026-07-23T10:00:00Z', 'YES', '10000000-0000-4000-8000-000000000002');
select is((select row(total_visits, total_purchase_visits, total_non_purchase_visits)::text from crm.clients where client_id = '20000000-0000-4000-8000-000000000003'), '(2,1,1)', 'rollups recalculated');

-- deduplicates category arrays before timeline rollups and audit logging
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000009', 'Category Guard Branch');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000009', 'Category Guard Client', '9000000009');
insert into crm.client_timeline(client_id, event_date, buy_status, branch_id, seen_categories, bought_categories, order_categories)
values ('20000000-0000-4000-8000-000000000009', '2026-07-24T10:00:00Z', 'YES', '10000000-0000-4000-8000-000000000009', array['Ring','Ring','Bangle'], array['Chain','Chain'], array['Pendant','Pendant']);
select is((select row(seen_categories, bought_categories, order_categories)::text from crm.client_timeline where client_id = '20000000-0000-4000-8000-000000000009'), '("{Ring,Bangle}",{Chain},{Pendant})', 'timeline categories deduplicated');
select is((select row(last_seen_categories, last_bought_categories, last_order_categories)::text from crm.clients where client_id = '20000000-0000-4000-8000-000000000009'), '("{Ring,Bangle}",{Chain},{Pendant})', 'client categories deduplicated');

-- allows cross-branch history reads but rejects a false visit branch
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000003', 'RLS Branch A'), ('10000000-0000-4000-8000-000000000004', 'RLS Branch B');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000001', 'Salesperson', 'salesperson@example.com', 'salesperson', '10000000-0000-4000-8000-000000000003');
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id) values
('20000000-0000-4000-8000-000000000004', 'Own Branch Client', '9000000002', '10000000-0000-4000-8000-000000000003'),
('20000000-0000-4000-8000-000000000005', 'Other Branch Client', '9000000003', '10000000-0000-4000-8000-000000000004');
insert into crm.client_timeline(client_id, event_date, buy_status, branch_id) values ('20000000-0000-4000-8000-000000000005', '2026-07-23T11:00:00Z', 'STORE_VISIT', '10000000-0000-4000-8000-000000000004');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is((select array_agg(client_id order by client_id)::text from crm.clients where client_id in ('20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005')),
  '{20000000-0000-4000-8000-000000000004,20000000-0000-4000-8000-000000000005}', 'salesperson reads clients across branches');
select is((select count(*)::integer from crm.client_timeline where client_id = '20000000-0000-4000-8000-000000000005'), 1, 'salesperson reads other-branch history');
select throws_ok($$insert into crm.client_timeline(client_id, event_date, buy_status, branch_id, salesperson_id) values ('20000000-0000-4000-8000-000000000005', '2026-07-23T12:00:00Z', 'YES', '10000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001')$$, '42501', null, 'false visit branch rejected');
select lives_ok($$insert into crm.client_timeline(client_id, event_date, buy_status, branch_id, salesperson_id) values ('20000000-0000-4000-8000-000000000005', '2026-07-23T12:30:00Z', 'YES', '10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001')$$, 'own visit branch accepted');
reset role;

-- derives canonical event types from representative buy statuses
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000005', 'Event Mapping Branch');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000006', 'Event Mapping Client', '9000000004');
insert into crm.client_timeline(client_id, event_date, buy_status, branch_id, reference_number) values
('20000000-0000-4000-8000-000000000006', '2026-07-23T09:00:00Z', 'ORDER_PLACED_AND_BUYING_NEW_PRODUCT', '10000000-0000-4000-8000-000000000005', 'MAP-1'),
('20000000-0000-4000-8000-000000000006', '2026-07-23T09:01:00Z', 'YES', '10000000-0000-4000-8000-000000000005', 'MAP-2'),
('20000000-0000-4000-8000-000000000006', '2026-07-23T09:02:00Z', 'ORDER_PICKUP', '10000000-0000-4000-8000-000000000005', 'MAP-3'),
('20000000-0000-4000-8000-000000000006', '2026-07-23T09:03:00Z', 'REPAIR_PLACED', '10000000-0000-4000-8000-000000000005', 'MAP-4'),
('20000000-0000-4000-8000-000000000006', '2026-07-23T09:04:00Z', 'PRODUCT_RETURN', '10000000-0000-4000-8000-000000000005', 'MAP-5'),
('20000000-0000-4000-8000-000000000006', '2026-07-23T09:05:00Z', 'NO', '10000000-0000-4000-8000-000000000005', 'MAP-6'),
('20000000-0000-4000-8000-000000000006', '2026-07-23T09:06:00Z', null, '10000000-0000-4000-8000-000000000005', 'MAP-7');
select results_eq($$select reference_number::text, event_type::text from crm.client_timeline where client_id = '20000000-0000-4000-8000-000000000006' order by reference_number$$,
  $$values ('MAP-1', 'UPSALE_VISIT'), ('MAP-2', 'READY_PRODUCT_PURCHASE'), ('MAP-3', 'ORDER_PICKUP_VISIT'), ('MAP-4', 'REPAIR_PLACED_VISIT'), ('MAP-5', 'PRODUCT_RETURN_VISIT'), ('MAP-6', 'NON_PURCHASE_VISIT'), ('MAP-7', 'VISIT')$$,
  'event types derived from buy status');
select is((select row(total_visits, total_purchase_visits, total_non_purchase_visits, total_repair_visits, total_order_visits)::text from crm.clients where client_id = '20000000-0000-4000-8000-000000000006'), '(7,1,2,1,2)', 'rollup buckets match');

-- shares documents globally but restricts deletion to the uploader
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000006', 'Document Branch A'), ('10000000-0000-4000-8000-000000000007', 'Document Branch B');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000002', 'Uploader', 'uploader@example.com', 'salesperson', '10000000-0000-4000-8000-000000000006');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000003', 'Other Staff', 'other-staff@example.com', 'salesperson', '10000000-0000-4000-8000-000000000007');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000007', 'Document Client', '9000000005');
insert into crm.documents(id, client_id, uploaded_by, file_name, storage_path, mime_type) values
('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000002', 'id-proof.pdf',
 '20000000-0000-4000-8000-000000000007/general/60000000-0000-4000-8000-000000000001_id-proof.pdf', 'application/pdf');
-- port: bucket crm-legacy-documents; Storage owner is the uploader's Auth user.
insert into storage.objects(id, bucket_id, name, owner_id) values
('50000000-0000-4000-8000-000000000001', 'crm-legacy-documents', '20000000-0000-4000-8000-000000000007/general/60000000-0000-4000-8000-000000000001_id-proof.pdf', 'a0000000-0000-4000-8000-000000000002');
-- port: emulate a Storage API delete (the API sets this; RLS still decides).
select set_config('storage.allow_delete_query', 'true', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from crm.documents where id = '40000000-0000-4000-8000-000000000001'), 1, 'other staff sees the document');
select is((select count(*)::integer from storage.objects where id = '50000000-0000-4000-8000-000000000001'), 1, 'other staff sees the object');
select lives_ok($$delete from crm.documents where id = '40000000-0000-4000-8000-000000000001'$$, 'other staff document delete runs');
select lives_ok($$delete from storage.objects where id = '50000000-0000-4000-8000-000000000001'$$, 'other staff object delete runs');
reset role;
select is((select count(*)::integer from crm.documents where id = '40000000-0000-4000-8000-000000000001'), 1, 'other staff cannot delete document metadata');
select is((select count(*)::integer from storage.objects where id = '50000000-0000-4000-8000-000000000001'), 1, 'other staff cannot delete the object');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select lives_ok($$delete from crm.documents where id = '40000000-0000-4000-8000-000000000001'$$, 'uploader deletes document metadata');
select lives_ok($$delete from storage.objects where id = '50000000-0000-4000-8000-000000000001'$$, 'uploader deletes the object');
reset role;
select is((select count(*)::integer from crm.documents where id = '40000000-0000-4000-8000-000000000001'), 0, 'uploader document delete took effect');
select is((select count(*)::integer from storage.objects where id = '50000000-0000-4000-8000-000000000001'), 0, 'uploader object delete took effect');
select set_config('storage.allow_delete_query', 'false', true);

-- ===========================================================================
-- Phase 1 client CRM database guarantees
-- ===========================================================================
-- returns an exact phone-matched profile only to active CRM staff
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000099', 'Lookup Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000099', 'Lookup User', 'lookup@example.com', 'salesperson', '10000000-0000-4000-8000-000000000099');
insert into crm.clients(client_id, primary_name, primary_phone, gender, dob, community, address, pincode, last_branch_id)
values ('20000000-0000-4000-8000-000000000099', 'Lookup Client', '9012345099', 'Female', '1990-01-02', 'Nair', 'Main Road', '682001', '10000000-0000-4000-8000-000000000099');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000099', true);
select is((select row(primary_name, gender, pincode)::text from crm.lookup_client_by_phone('+91 90123 45099')), '("Lookup Client",Female,682001)', 'exact phone lookup returns the profile');
select is((select count(*)::integer from crm.lookup_client_by_phone('9012345000')), 0, 'unknown phone returns nothing');
reset role;

-- keeps a salesperson's created client on their own branch and rejects duplicate phones
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000101', 'Phase 1 branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000101', 'Phase 1 salesperson', 'phase1@example.com', 'salesperson', '10000000-0000-4000-8000-000000000101');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000101', true);
select set_config('t.phase1', crm.create_client_with_phone('New Client', '+91 90123-45678', null, null)::text, true);
select is((select row(last_branch_id, primary_phone)::text from crm.clients where client_id = current_setting('t.phase1')::uuid), '(10000000-0000-4000-8000-000000000101,9012345678)', 'created client is on the own branch');
select is((select client_id::text from crm.search_clients('9012345678', 8)), current_setting('t.phase1'), 'search by full phone');
select is((select client_id::text from crm.search_clients('3456', 8)), current_setting('t.phase1'), 'search by partial phone');
select throws_ok($$select crm.create_client_with_phone('Duplicate', '9012345678', null, null)$$, '23505', null, 'duplicate phone rejected');
reset role;

-- writes exactly one field-level audit row under the authenticated actor
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000102', 'Audit branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000102', 'Audit salesperson', 'audit@example.com', 'salesperson', '10000000-0000-4000-8000-000000000102');
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id) values ('20000000-0000-4000-8000-000000000102', 'Before', '9000000102', '10000000-0000-4000-8000-000000000102');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000102', true);
update crm.clients set primary_name = 'After' where client_id = '20000000-0000-4000-8000-000000000102';
select results_eq($$select field_name::text, old_value::text, new_value::text, edited_by::text from crm.client_edit_log where client_id = '20000000-0000-4000-8000-000000000102'$$,
  $$values ('primary_name', '"Before"', '"After"', '30000000-0000-4000-8000-000000000102')$$, 'one audit row under the CRM actor');
reset role;

-- filters client browsing by a fixed potential tier and audits a profile tier change
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000103', 'Potential branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000103', 'Potential salesperson', 'potential@example.com', 'salesperson', '10000000-0000-4000-8000-000000000103');
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id, client_potential_category) values
('20000000-0000-4000-8000-000000000103', 'Warm client', '9000000103', '10000000-0000-4000-8000-000000000103', 'Warm Lead'),
('20000000-0000-4000-8000-000000000104', 'Hot client', '9000000104', '10000000-0000-4000-8000-000000000103', 'Hot Lead');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000103', true);
select results_eq($$select client_id from crm.browse_clients(null, 'Warm Lead', 0, 51)$$, $$values ('20000000-0000-4000-8000-000000000103'::uuid)$$, 'browse filters by potential tier');
update crm.clients set client_potential_category = 'VIP Lead' where client_id = '20000000-0000-4000-8000-000000000103';
select results_eq($$select field_name::text, old_value::text, new_value::text, edited_by::text from crm.client_edit_log where client_id = '20000000-0000-4000-8000-000000000103' and field_name = 'client_potential_category'$$,
  $$values ('client_potential_category', '"Warm Lead"', '"VIP Lead"', '30000000-0000-4000-8000-000000000103')$$, 'tier change audited');
select throws_like($$update crm.clients set client_potential_category = 'Unapproved Segment' where client_id = '20000000-0000-4000-8000-000000000103'$$, '%must be one of%', 'unknown tier rejected');
reset role;

-- ===========================================================================
-- Phase 2 visit intake guarantees
-- ===========================================================================
-- creates a new client, phone index, timeline, and visit form atomically
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000201', 'Phase Two Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000201', 'Visit User', 'visit@example.com', 'salesperson', '10000000-0000-4000-8000-000000000201');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000201', true);
select set_config('t.p2', (select row_to_json(r)::text from crm.submit_walkin_visit('{"proposed_client_id":"20000000-0000-4000-8000-000000000201","proposed_timeline_id":"40000000-0000-4000-8000-000000000201","branch_id":"10000000-0000-4000-8000-000000000201","primary_name":"Walk In","primary_phone":"+91 90123 45999","did_buy":true,"seen_categories":["Ring"],"documents":[{"storage_path":"20000000-0000-4000-8000-000000000201/40000000-0000-4000-8000-000000000201/50000000-0000-4000-8000-000000000201_proof.jpg","file_name":"proof.jpg","mime_type":"image/jpeg"}]}'::jsonb) r), true);
select ok((current_setting('t.p2')::json ->> 'reference_number') ~ '^PHA-\d{6}-\d{4}$', 'reference number uses the branch prefix');
select is((select phone::text from crm.client_phone_index where client_id = (current_setting('t.p2')::json ->> 'client_id')::uuid), '9012345999', 'phone index created');
select is((select count(*)::integer from crm.visit_forms where client_timeline_id = (current_setting('t.p2')::json ->> 'timeline_id')::uuid), 1, 'visit form created');
select is((select row(client_id, client_timeline_id)::text from crm.documents where storage_path = '20000000-0000-4000-8000-000000000201/40000000-0000-4000-8000-000000000201/50000000-0000-4000-8000-000000000201_proof.jpg'),
  '(20000000-0000-4000-8000-000000000201,40000000-0000-4000-8000-000000000201)', 'document linked to the proposed client and timeline');
reset role;

-- updates an existing client without duplication and creates its Phase 4 follow-up
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000202', 'Existing Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000202', 'Existing User', 'existing@example.com', 'salesperson', '10000000-0000-4000-8000-000000000202');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000202', 'Existing', '9000000202');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000202', true);
select set_config('t.v1', (select row_to_json(r)::text from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000202","branch_id":"10000000-0000-4000-8000-000000000202","primary_name":"Existing Updated","primary_phone":"9000000202","billing_phone":"9000000202","did_buy":false,"not_bought_reasons":["Price"],"next_visit_date":"2026-08-01","client_potential_category":"Hot Lead"}'::jsonb) r), true);
select set_config('t.v2', (select row_to_json(r)::text from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000202","branch_id":"10000000-0000-4000-8000-000000000202","primary_name":"Existing Updated Again","primary_phone":"9000000202","billing_phone":"9000000202","did_buy":true,"next_visit_date":"2026-08-02","client_potential_category":"Hot Lead"}'::jsonb) r), true);
select is(current_setting('t.v1')::json ->> 'client_id', '20000000-0000-4000-8000-000000000202', 'first visit reuses the client');
select is(current_setting('t.v2')::json ->> 'client_id', '20000000-0000-4000-8000-000000000202', 'second visit reuses the client');
select isnt(current_setting('t.v2')::json ->> 'timeline_id', current_setting('t.v1')::json ->> 'timeline_id', 'each visit gets its own timeline row');
select is((select row(primary_name, client_potential_category, next_visit_date)::text from crm.clients where client_id = '20000000-0000-4000-8000-000000000202'), '("Existing Updated Again","Hot Lead",2026-08-02)', 'profile updated from the latest visit');
select is((select count(*)::integer from crm.client_timeline where client_id = '20000000-0000-4000-8000-000000000202'), 2, 'two timeline rows');
select is((select status::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000202'), 'ALREADY PURCHASED FROM MK JEWELS', 'follow-up auto-closed by the purchase');
select ok((select remark like '%AUTO CLOSED: CLIENT PURCHASED%' from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000202'), 'auto-close remark recorded');
reset role;

-- marks a queue entry complete and rejects a false branch
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000203', 'Queue Branch'), ('10000000-0000-4000-8000-000000000204', 'Other Queue Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000203', 'Queue User', 'queue@example.com', 'salesperson', '10000000-0000-4000-8000-000000000203');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000203', true);
select set_config('t.queue', (select token from crm.create_entry_queue('Queued', '9000000203', '10000000-0000-4000-8000-000000000203', null)), true);
select set_config('t.queue_id', (select id::text from crm.entry_queue where token = current_setting('t.queue')), true);
select lives_ok($$select * from crm.submit_walkin_visit(jsonb_build_object('entry_queue_id', current_setting('t.queue_id'), 'branch_id', '10000000-0000-4000-8000-000000000203', 'primary_name', 'Queued', 'primary_phone', '9000000203', 'did_buy', true))$$, 'queued walk-in submitted');
select is((select status::text from crm.entry_queue where id = current_setting('t.queue_id')::uuid), 'complete', 'queue entry completed');
select throws_like($$select * from crm.submit_walkin_visit('{"branch_id":"10000000-0000-4000-8000-000000000204","primary_name":"Forbidden","primary_phone":"9000000204","did_buy":true}'::jsonb)$$, '%own branch%', 'false branch rejected');
reset role;

-- allows a super admin to register a queue entry for a selected active branch
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000205', 'Admin Queue Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000205', 'Queue Admin', 'queue-admin@example.com', 'super_admin', null);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000205', true);
select is((select client_type from crm.create_entry_queue('Admin Queued', '9000000205', '10000000-0000-4000-8000-000000000205', null) where token is not null), 'new', 'super admin registers for a selected branch');
reset role;

-- ===========================================================================
-- Phase 3 roster and availability guarantees
-- ===========================================================================
-- makes the roster read-only for salespeople, branch-writable for managers, and global for super admins
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000301', 'Roster A'), ('10000000-0000-4000-8000-000000000302', 'Roster B');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000301', 'Sales', 'sales301@example.com', 'salesperson', '10000000-0000-4000-8000-000000000301');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000302', 'Manager', 'manager302@example.com', 'branch_manager', '10000000-0000-4000-8000-000000000301');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000303', 'Admin', 'admin303@example.com', 'super_admin', null);
insert into crm.crm_allocation(branch_id, crm_name) values ('10000000-0000-4000-8000-000000000301', 'Anu');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000301', true);
select is((select crm_name::text from crm.crm_allocation where branch_id = '10000000-0000-4000-8000-000000000301'), 'Anu', 'salesperson reads the own roster');
select throws_ok($$insert into crm.crm_allocation(branch_id, crm_name) values ('10000000-0000-4000-8000-000000000301', 'Blocked')$$, '42501', null, 'salesperson cannot write the roster');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000302', true);
select lives_ok($$insert into crm.crm_daily_availability(branch_id, crm_name, date, is_available) values ('10000000-0000-4000-8000-000000000301', 'Anu', '2026-07-24', false)$$, 'manager records availability');
select throws_ok($$insert into crm.crm_allocation(branch_id, crm_name) values ('10000000-0000-4000-8000-000000000302', 'Wrong branch')$$, '42501', null, 'manager cannot write another branch');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000303', true);
select lives_ok($$insert into crm.crm_allocation(branch_id, crm_name) values ('10000000-0000-4000-8000-000000000302', 'Admin can add')$$, 'super admin writes any branch');
reset role;

-- excludes an explicitly unavailable CRM from today's assigned-CRM dropdown but not another date
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000303', 'Availability Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000304', 'Availability Manager', 'availability@example.com', 'branch_manager', '10000000-0000-4000-8000-000000000303');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000303', 'Historical Client', '9000000303');
insert into crm.crm_allocation(branch_id, crm_name) values ('10000000-0000-4000-8000-000000000303', 'Available CRM'), ('10000000-0000-4000-8000-000000000303', 'Unavailable CRM');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000304', true);
insert into crm.crm_daily_availability(branch_id, crm_name, date, is_available) values ('10000000-0000-4000-8000-000000000303', 'Unavailable CRM', '2026-07-24', false);
select results_eq($$select a.crm_name::text from crm.crm_allocation a left join crm.crm_daily_availability d on d.branch_id = a.branch_id and d.crm_name = a.crm_name and d.date = '2026-07-24' where a.branch_id = '10000000-0000-4000-8000-000000000303' and a.active and coalesce(d.is_available, true) order by a.crm_name$$,
  $$values ('Available CRM')$$, 'unavailable CRM excluded today');
select results_eq($$select a.crm_name::text from crm.crm_allocation a left join crm.crm_daily_availability d on d.branch_id = a.branch_id and d.crm_name = a.crm_name and d.date = '2026-07-25' where a.branch_id = '10000000-0000-4000-8000-000000000303' and a.active and coalesce(d.is_available, true) order by a.crm_name$$,
  $$values ('Available CRM'), ('Unavailable CRM')$$, 'unavailable CRM available another day');
reset role;

-- retains historical timeline and visit-form records after a CRM roster entry is deactivated
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000304', 'History Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000305', 'History Manager', 'history@example.com', 'branch_manager', '10000000-0000-4000-8000-000000000304');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000304', 'Historical Client', '9000000304');
insert into crm.crm_allocation(branch_id, crm_name) values ('10000000-0000-4000-8000-000000000304', 'Historical CRM');
insert into crm.client_timeline(id, client_id, event_date, buy_status, branch_id, crm_name) values ('40000000-0000-4000-8000-000000000304', '20000000-0000-4000-8000-000000000304', '2026-07-23T10:00:00Z', 'YES', '10000000-0000-4000-8000-000000000304', 'Historical CRM');
insert into crm.visit_forms(client_timeline_id) values ('40000000-0000-4000-8000-000000000304');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000305', true);
update crm.crm_allocation set active = false where branch_id = '10000000-0000-4000-8000-000000000304' and crm_name = 'Historical CRM';
select is((select row(t.crm_name, v.client_timeline_id)::text from crm.client_timeline t join crm.visit_forms v on v.client_timeline_id = t.id where t.id = '40000000-0000-4000-8000-000000000304'),
  '("Historical CRM",40000000-0000-4000-8000-000000000304)', 'history retained after deactivation');
reset role;

-- ===========================================================================
-- Legacy roster mutation and queue allocation guarantees
-- ===========================================================================
-- normalizes roster names, rejects normalized duplicates, and resets every branch availability exception after add/update/delete
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000310', 'Parity A'), ('10000000-0000-4000-8000-000000000311', 'Parity B');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000310', 'Parity Manager', 'parity-manager@example.com', 'branch_manager', '10000000-0000-4000-8000-000000000310');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000310', true);
select set_config('t.roster', (select id::text from crm.manage_crm_roster('ADD', null, '10000000-0000-4000-8000-000000000310', '  anu   shah  ', null)), true);
select is((select crm_name::text from crm.crm_allocation where id = current_setting('t.roster')::uuid), 'ANU SHAH', 'roster name normalized');
select throws_ok($$select * from crm.manage_crm_roster('ADD', null, '10000000-0000-4000-8000-000000000310', 'anu shah', null)$$, '23505', null, 'normalized duplicate rejected');
insert into crm.crm_daily_availability(branch_id, crm_name, date, is_available) values ('10000000-0000-4000-8000-000000000310', 'ANU SHAH', '2026-07-24', false), ('10000000-0000-4000-8000-000000000310', 'ANU SHAH', '2026-07-25', false);
select lives_ok($$select * from crm.manage_crm_roster('UPDATE', current_setting('t.roster')::uuid, '10000000-0000-4000-8000-000000000310', 'Moved CRM', '10000000-0000-4000-8000-000000000310')$$, 'roster update');
select is((select count(*)::integer from crm.crm_daily_availability where branch_id = '10000000-0000-4000-8000-000000000310'), 0, 'update resets branch availability');
insert into crm.crm_daily_availability(branch_id, crm_name, date, is_available) values ('10000000-0000-4000-8000-000000000310', 'MOVED CRM', '2026-07-26', false);
select lives_ok($$select * from crm.manage_crm_roster('DELETE', current_setting('t.roster')::uuid, null, null, null)$$, 'roster delete');
select is((select count(*)::integer from crm.crm_daily_availability where branch_id = '10000000-0000-4000-8000-000000000310'), 0, 'delete resets branch availability');
reset role;

-- links a staged proof to the existing client selected by its phone
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000278', 'Staged Proof Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000278', 'Staged Proof User', 'staged@example.com', 'salesperson', '10000000-0000-4000-8000-000000000278');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000278', 'Existing staged proof', '9000000278');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000278', true);
select is((select client_id::text from crm.submit_walkin_visit('{"proposed_client_id":"20000000-0000-4000-8000-000000000279","proposed_timeline_id":"40000000-0000-4000-8000-000000000278","branch_id":"10000000-0000-4000-8000-000000000278","primary_name":"Existing staged proof","primary_phone":"9000000278","did_buy":true,"documents":[{"storage_path":"20000000-0000-4000-8000-000000000279/40000000-0000-4000-8000-000000000278/50000000-0000-4000-8000-000000000278_proof.jpg","file_name":"proof.jpg","mime_type":"image/jpeg"}]}'::jsonb)),
  '20000000-0000-4000-8000-000000000278', 'staged proof resolves to the phone-matched client');
select is((select row(client_id, client_timeline_id)::text from crm.documents where storage_path = '20000000-0000-4000-8000-000000000279/40000000-0000-4000-8000-000000000278/50000000-0000-4000-8000-000000000278_proof.jpg'),
  '(20000000-0000-4000-8000-000000000278,40000000-0000-4000-8000-000000000278)', 'staged proof linked to the existing client');
reset role;

-- uses absent exceptions as available and assigns queue entries round-robin only from today's available roster
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000312', 'Round Robin');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000312', 'Round Robin Manager', 'round-robin@example.com', 'branch_manager', '10000000-0000-4000-8000-000000000312');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000312', true);
select lives_ok($$select * from crm.manage_crm_roster('ADD', null, '10000000-0000-4000-8000-000000000312', 'CRM ONE', null)$$, 'first CRM added');
select lives_ok($$select * from crm.manage_crm_roster('ADD', null, '10000000-0000-4000-8000-000000000312', 'CRM TWO', null)$$, 'second CRM added');
reset role;
-- port: the original added these in separate transactions, so CRM TWO was created later.
update crm.crm_allocation set created_at = created_at + interval '1 second' where branch_id = '10000000-0000-4000-8000-000000000312' and crm_name = 'CRM TWO';
set local role authenticated;
select set_config('t.rr1', (select token from crm.create_entry_queue('First', '9000000312', '10000000-0000-4000-8000-000000000312', null, null)), true);
select set_config('t.rr2', (select token from crm.create_entry_queue('Second', '9000000313', '10000000-0000-4000-8000-000000000312', null, null)), true);
select is((select assigned_crm_name::text from crm.entry_queue where token = current_setting('t.rr1')), 'CRM ONE', 'first registration goes to CRM ONE');
select is((select assigned_crm_name::text from crm.entry_queue where token = current_setting('t.rr2')), 'CRM TWO', 'second registration goes to CRM TWO');
insert into crm.crm_daily_availability(branch_id, crm_name, date, is_available) values ('10000000-0000-4000-8000-000000000312', 'CRM ONE', (current_timestamp at time zone 'Asia/Kolkata')::date, false);
select set_config('t.rr3', (select token from crm.create_entry_queue('Third', '9000000314', '10000000-0000-4000-8000-000000000312', null, null)), true);
select is((select assigned_crm_name::text from crm.entry_queue where token = current_setting('t.rr3')), 'CRM TWO', 'unavailable CRM skipped');
reset role;

-- keeps roster writes manager/super-admin-only while queue reads remain branch-scoped
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000313', 'Security A'), ('10000000-0000-4000-8000-000000000314', 'Security B');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000313', 'Security Sales', 'security-sales@example.com', 'salesperson', '10000000-0000-4000-8000-000000000313');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000314', 'Security Admin', 'security-admin@example.com', 'super_admin', null);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000313', true);
select throws_like($$select * from crm.manage_crm_roster('ADD', null, '10000000-0000-4000-8000-000000000313', 'Blocked', null)$$, '%branch manager access%', 'salesperson cannot add to the roster');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000314', true);
select lives_ok($$select * from crm.manage_crm_roster('ADD', null, '10000000-0000-4000-8000-000000000314', 'Admin CRM', null)$$, 'super admin adds to any roster');
reset role;

-- ===========================================================================
-- Phase 4 not-bought follow-up guarantees
-- (original helper createNotBoughtVisit(branch, user, client, suffix, eventDate))
-- ===========================================================================
-- auto-creates one legacy-NO follow-up at form-save time with traceability and the legacy due date
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000401', 'Followup Branch 401');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000401', 'Followup User 401', 'followup-401@example.com', 'salesperson', '10000000-0000-4000-8000-000000000401');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000401', 'Followup Client 401', '9000004401');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000401', true);
select set_config('t.nb401', (select timeline_id::text from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000401","branch_id":"10000000-0000-4000-8000-000000000401","primary_name":"Followup Client 401","primary_phone":"9000004401","did_buy":false,"not_bought_reasons":["Price"],"event_date":"2026-07-20T10:00:00Z"}'::jsonb)), true);
select is((select row(status, next_followup_date, remark, branch_id, source_timeline_id, source_visit_form_id is not null)::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000401'),
  '(PENDING,2026-07-20,Price,10000000-0000-4000-8000-000000000401,' || current_setting('t.nb401') || ',t)', 'legacy NO follow-up created with traceability');
reset role;

-- merges a later eligible not-bought visit into the one open follow-up and logs a system history entry
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000402', 'Followup Branch 402');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000402', 'Followup User 402', 'followup-402@example.com', 'salesperson', '10000000-0000-4000-8000-000000000402');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000402', 'Followup Client 402', '9000004402');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000402', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000402","branch_id":"10000000-0000-4000-8000-000000000402","primary_name":"Followup Client 402","primary_phone":"9000004402","did_buy":false,"not_bought_reasons":["Price"],"event_date":"2026-07-20T10:00:00Z"}'::jsonb)$$, 'first not-bought visit');
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000402","branch_id":"10000000-0000-4000-8000-000000000402","primary_name":"Followup Client 402","primary_phone":"9000004402","did_buy":false,"not_bought_reasons":["Need more options"],"next_visit_date":"2026-08-04","event_date":"2026-07-21T10:00:00Z"}'::jsonb)$$, 'second not-bought visit');
select is((select row(followup_count, next_followup_date, source_timeline_id is not null)::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000402'), '(0,2026-08-04,t)', 'merged into the open follow-up');
select results_eq($$select h.call_response, h.remark like '%CLIENT VISITED AGAIN AND STILL NOT BOUGHT%' from crm.not_bought_history h join crm.not_bought_followups f on f.id = h.followup_id where f.client_id = '20000000-0000-4000-8000-000000000402'$$,
  $$values ('CLIENT REVISITED - STILL NOT BOUGHT'::text, true)$$, 'merge logged as system history');
reset role;

-- automatically closes the active follow-up and writes system history after a later MK Jewels purchase
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000412', 'Followup Branch 412');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000412', 'Followup User 412', 'followup-412@example.com', 'salesperson', '10000000-0000-4000-8000-000000000412');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000412', 'Followup Client 412', '9000004412');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000412', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000412","branch_id":"10000000-0000-4000-8000-000000000412","primary_name":"Followup Client 412","primary_phone":"9000004412","did_buy":false,"not_bought_reasons":["Price"],"event_date":"2026-07-20T10:00:00Z"}'::jsonb)$$, 'not-bought visit');
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000412","branch_id":"10000000-0000-4000-8000-000000000412","primary_name":"Followup Client 412","primary_phone":"9000004412","did_buy":true,"additional_fields":{"visit_status":"YES"},"event_date":"2026-07-22T10:00:00Z"}'::jsonb)$$, 'purchase visit');
select is((select row(status, next_followup_date, followup_count)::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000412'), '("ALREADY PURCHASED FROM MK JEWELS",,0)', 'follow-up auto-closed');
select results_eq($$select h.call_response, h.remark like '%AUTO CLOSED: CLIENT PURCHASED%' from crm.not_bought_history h join crm.not_bought_followups f on f.id = h.followup_id where f.client_id = '20000000-0000-4000-8000-000000000412'$$,
  $$values ('AUTO CLOSED - CLIENT PURCHASED IN LATER VISIT'::text, true)$$, 'auto-close logged as system history');
reset role;

-- allows a new follow-up after a converted follow-up and another not-bought visit
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000403', 'Followup Branch 403');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000403', 'Followup User 403', 'followup-403@example.com', 'salesperson', '10000000-0000-4000-8000-000000000403');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000403', 'Followup Client 403', '9000004403');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000403', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000403","branch_id":"10000000-0000-4000-8000-000000000403","primary_name":"Followup Client 403","primary_phone":"9000004403","did_buy":false,"not_bought_reasons":["Price"],"event_date":"2026-07-20T10:00:00Z"}'::jsonb)$$, 'not-bought visit');
select lives_ok($$select crm.update_not_bought_followup((select id from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000403'), 'converted', 'Converted in store', null)$$, 'follow-up converted');
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000403","branch_id":"10000000-0000-4000-8000-000000000403","primary_name":"Followup Client 403","primary_phone":"9000004403","did_buy":false,"event_date":"2026-07-22T10:00:00Z"}'::jsonb)$$, 'another not-bought visit');
-- port: both rows share the transaction timestamp, so compare as a bag instead of by created_at.
select bag_eq($$select status::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000403'$$, $$values ('converted'), ('PENDING')$$, 'new follow-up after a converted one');
reset role;

-- logs every call outcome with old and new status plus the acting user
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000404', 'Followup Branch 404');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000404', 'Followup User 404', 'followup-404@example.com', 'salesperson', '10000000-0000-4000-8000-000000000404');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000404', 'Followup Client 404', '9000004404');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000404', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000404","branch_id":"10000000-0000-4000-8000-000000000404","primary_name":"Followup Client 404","primary_phone":"9000004404","did_buy":false,"not_bought_reasons":["Price"],"event_date":"2026-07-20T10:00:00Z"}'::jsonb)$$, 'not-bought visit');
select lives_ok($$select crm.update_not_bought_followup((select id from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000404'), 'interested', 'Will visit Saturday', null)$$, 'call outcome saved');
select results_eq($$select h.previous_status::text, h.status::text, h.call_response, h.remark, h.updated_by::text from crm.not_bought_history h join crm.not_bought_followups f on f.id = h.followup_id where f.client_id = '20000000-0000-4000-8000-000000000404'$$,
  $$values ('PENDING', 'pending', 'interested', 'Will visit Saturday', '30000000-0000-4000-8000-000000000404')$$, 'history records the CRM actor');
reset role;

-- saves a historical follow-up with no source visit form through the single legacy form contract
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000409', 'Historical Followup Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000409', 'Historical Followup User', 'historical-followup@example.com', 'salesperson', '10000000-0000-4000-8000-000000000409');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000409', 'Historical Followup Client', '9000000409');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000409', true);
insert into crm.not_bought_followups(client_id, status, entered_by, branch_id) values ('20000000-0000-4000-8000-000000000409', 'PENDING', '30000000-0000-4000-8000-000000000409', '10000000-0000-4000-8000-000000000409');
select is((select row(status, call_response, remark, next_followup_date)::text from crm.save_not_bought_followup((select id from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000409'), 'IN PROCESS', 'CONNECTED', '2026-07-30', 'Called client')),
  '("IN PROCESS",CONNECTED,"Called client",2026-07-30)', 'historical follow-up saved through the legacy contract');
reset role;

-- keeps follow-ups globally readable but restricts writes to the originating branch and super admin
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000405', 'Followup Branch 405');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000405', 'Followup User 405', 'followup-405@example.com', 'salesperson', '10000000-0000-4000-8000-000000000405');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000405', 'Followup Client 405', '9000004405');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000405', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000405","branch_id":"10000000-0000-4000-8000-000000000405","primary_name":"Followup Client 405","primary_phone":"9000004405","did_buy":false,"not_bought_reasons":["Price"],"event_date":"2026-07-20T10:00:00Z"}'::jsonb)$$, 'not-bought visit');
reset role;
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000406', 'Followup Branch B');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000406', 'Other Branch', 'followup-406@example.com', 'salesperson', '10000000-0000-4000-8000-000000000406');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000407', 'Followup Admin', 'followup-admin@example.com', 'super_admin', null);
select set_config('t.f405', (select id::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000405'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000406', true);
select is((select id::text from crm.not_bought_followups where id = current_setting('t.f405')::uuid), current_setting('t.f405'), 'other branch reads the follow-up');
select throws_like($$select crm.save_not_bought_followup(current_setting('t.f405')::uuid, 'PENDING', 'CONNECTED', '2026-08-01', 'Blocked')$$, '%own branch%', 'other branch cannot save');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000405', true);
select lives_ok($$select crm.save_not_bought_followup(current_setting('t.f405')::uuid, 'PENDING', 'CONNECTED', '2026-08-01', 'Owner')$$, 'origin branch saves');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000407', true);
select lives_ok($$select crm.save_not_bought_followup(current_setting('t.f405')::uuid, 'CALL NOT PICKED', 'NOT PICKED', null, null)$$, 'super admin saves');
reset role;

-- identifies an open follow-up as overdue when its next follow-up date has passed
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000407', 'Followup Branch 407');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000408', 'Followup User 407', 'followup-407@example.com', 'salesperson', '10000000-0000-4000-8000-000000000407');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000407', 'Followup Client 407', '9000004407');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000408', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000407","branch_id":"10000000-0000-4000-8000-000000000407","primary_name":"Followup Client 407","primary_phone":"9000004407","did_buy":false,"not_bought_reasons":["Price"],"event_date":"2020-01-01T10:00:00Z"}'::jsonb)$$, 'old not-bought visit');
select ok((select next_followup_date < current_date and status not in ('closed', 'converted') from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000407'), 'follow-up overdue');
reset role;

-- ===========================================================================
-- Phase 5 referral calling guarantees
-- (original helper createReferralVisit(branch, user, client, suffix, eventDate))
-- ===========================================================================
-- auto-creates exactly one referral and pending call from a referral-captured visit
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000501', 'Referral Branch 501');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000501', 'Referral User 501', 'referral-501@example.com', 'salesperson', '10000000-0000-4000-8000-000000000501');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000501', 'Referral Client 501', '9000005501');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000501', true);
select set_config('t.r501', (select timeline_id::text from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000501","branch_id":"10000000-0000-4000-8000-000000000501","primary_name":"Referral Client 501","primary_phone":"9000005501","did_buy":true,"event_date":"2026-07-20T10:00:00Z","reference_name":"Captured Referral 501","reference_phone":"9876500501","engagement":{"referrals":{"asked":true}}}'::jsonb)), true);
select results_eq($$select r.referral_name::text, r.referral_number::text, r.branch_id::text, r.source_timeline_id::text, r.source_visit_form_id is not null, c.status::text, c.next_followup_date::text from crm.referrals r join crm.referral_calling c on c.referral_id = r.id where r.given_by_client_id = '20000000-0000-4000-8000-000000000501'$$,
  $$values ('Captured Referral 501', '9876500501', '10000000-0000-4000-8000-000000000501', current_setting('t.r501'), true, 'PENDING', '2026-07-21')$$, 'one referral and pending call created');
reset role;

-- atomically creates a referral calling row for every valid walk-in referral payload
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000509', 'Walk-in referral payload branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000509', 'Walk-in referral payload user', 'walkin-referral-payload@example.com', 'salesperson', '10000000-0000-4000-8000-000000000509');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000509', 'Walk-in referral giver', '9000000509');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000509', true);
select set_config('t.r509', (select timeline_id::text from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000509","branch_id":"10000000-0000-4000-8000-000000000509","primary_name":"Walk-in referral giver","primary_phone":"9000000509","did_buy":true,"event_date":"2026-07-24T10:00:00Z","engagement":{"referrals":{"asked":true}},"additional_fields":{"referrals":[{"name":"Payload Referral One","mobile":"+91 98765 00509"},{"name":"Payload Referral Two","mobile":"98765 10509"}]}}'::jsonb)), true);
select results_eq($$select r.referral_name::text, r.referral_number::text, r.source_timeline_id::text, r.source_visit_form_id is not null, c.status::text, c.next_followup_date::text from crm.referrals r join crm.referral_calling c on c.referral_id = r.id where r.given_by_client_id = '20000000-0000-4000-8000-000000000509' order by r.referral_name$$,
  $$values ('Payload Referral One', '9876500509', current_setting('t.r509'), true, 'PENDING', '2026-07-27'), ('Payload Referral Two', '9876510509', current_setting('t.r509'), true, 'PENDING', '2026-07-27')$$, 'every payload referral gets a calling row');
reset role;

-- rolls back the complete walk-in when a supplied referral is incomplete
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000510', 'Walk-in referral rollback branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000510', 'Walk-in referral rollback user', 'walkin-referral-rollback@example.com', 'salesperson', '10000000-0000-4000-8000-000000000510');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000510', true);
select throws_like($$select * from crm.submit_walkin_visit('{"branch_id":"10000000-0000-4000-8000-000000000510","primary_name":"Rollback walk-in referral","primary_phone":"9000000510","did_buy":true,"additional_fields":{"referrals":[{"name":"Incomplete referral","mobile":"123"}]}}'::jsonb)$$,
  '%referral requires a name and 10-digit phone%', 'incomplete referral rejected');
select is((select count(*)::integer from crm.client_phone_index where phone = '9000000510'), 0, 'whole walk-in rolled back');
reset role;

-- creates a manual referral with null visit source fields and the same pending calling shape
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000502', 'Referral Branch 502');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000502', 'Referral User 502', 'referral-502@example.com', 'salesperson', '10000000-0000-4000-8000-000000000502');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000502', 'Referral Client 502', '9000005502');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000502', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000502","branch_id":"10000000-0000-4000-8000-000000000502","primary_name":"Referral Client 502","primary_phone":"9000005502","did_buy":true,"event_date":"2026-07-20T10:00:00Z","reference_name":"Captured Referral 502","reference_phone":"9876500502","engagement":{"referrals":{"asked":true}}}'::jsonb)$$, 'referral visit');
select set_config('t.m502', (select id::text from crm.create_manual_referral('20000000-0000-4000-8000-000000000502', 'Manual Referral', '91234 56789', 'CRM A', null)), true);
select results_eq($$select r.source_timeline_id, r.source_visit_form_id, r.crm_name::text, c.status::text from crm.referrals r join crm.referral_calling c on c.referral_id = r.id where r.id = current_setting('t.m502')::uuid$$,
  $$values (null::uuid, null::uuid, 'CRM A', 'PENDING')$$, 'manual referral shape');
reset role;

-- does not create a second open calling record for the same normalized referral name and number
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000503', 'Referral Branch 503');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000503', 'Referral User 503', 'referral-503@example.com', 'salesperson', '10000000-0000-4000-8000-000000000503');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000503', 'Referral Client 503', '9000005503');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000503', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000503","branch_id":"10000000-0000-4000-8000-000000000503","primary_name":"Referral Client 503","primary_phone":"9000005503","did_buy":true,"event_date":"2026-07-20T10:00:00Z","reference_name":"Captured Referral 503","reference_phone":"9876500503","engagement":{"referrals":{"asked":true}}}'::jsonb)$$, 'referral visit');
select lives_ok($$select crm.create_manual_referral('20000000-0000-4000-8000-000000000503', 'Duplicate Name', '99887 76655', null, null)$$, 'first manual referral');
select lives_ok($$select crm.create_manual_referral('20000000-0000-4000-8000-000000000503', ' duplicate name ', '+91 99887 76655', null, null)$$, 'duplicate manual referral');
select is((select count(*)::integer from crm.referral_calling c join crm.referrals r on r.id = c.referral_id where lower(trim(r.referral_name)) = 'duplicate name' and r.referral_number = '9988776655'), 1, 'one open calling record');
reset role;

-- logs each referral outcome with previous and new status plus the acting user
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000504', 'Referral Branch 504');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000504', 'Referral User 504', 'referral-504@example.com', 'salesperson', '10000000-0000-4000-8000-000000000504');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000504', 'Referral Client 504', '9000005504');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000504', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000504","branch_id":"10000000-0000-4000-8000-000000000504","primary_name":"Referral Client 504","primary_phone":"9000005504","did_buy":true,"event_date":"2026-07-20T10:00:00Z","reference_name":"Captured Referral 504","reference_phone":"9876500504","engagement":{"referrals":{"asked":true}}}'::jsonb)$$, 'referral visit');
select set_config('t.c504', (select c.id::text from crm.referral_calling c join crm.referrals r on r.id = c.referral_id where r.given_by_client_id = '20000000-0000-4000-8000-000000000504'), true);
select lives_ok($$select crm.update_referral_calling(current_setting('t.c504')::uuid, 'interested', 'Will visit Saturday', null)$$, 'referral outcome saved');
select results_eq($$select previous_status::text, status::text, call_response, remark, updated_by::text from crm.referral_calling_history where referral_calling_id = current_setting('t.c504')::uuid$$,
  $$values ('PENDING', 'pending', 'interested', 'Will visit Saturday', '30000000-0000-4000-8000-000000000504')$$, 'referral history records the CRM actor');
reset role;

-- keeps referrals globally readable but restricts call updates to the owning branch and super admin
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000505', 'Referral Branch 505');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000505', 'Referral User 505', 'referral-505@example.com', 'salesperson', '10000000-0000-4000-8000-000000000505');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000505', 'Referral Client 505', '9000005505');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000505', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000505","branch_id":"10000000-0000-4000-8000-000000000505","primary_name":"Referral Client 505","primary_phone":"9000005505","did_buy":true,"event_date":"2026-07-20T10:00:00Z","reference_name":"Captured Referral 505","reference_phone":"9876500505","engagement":{"referrals":{"asked":true}}}'::jsonb)$$, 'referral visit');
reset role;
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000506', 'Referral Other Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000506', 'Other', 'referral-other@example.com', 'salesperson', '10000000-0000-4000-8000-000000000506');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000507', 'Referral Admin', 'referral-admin@example.com', 'super_admin', null);
select set_config('t.c505', (select c.id::text from crm.referral_calling c join crm.referrals r on r.id = c.referral_id where r.given_by_client_id = '20000000-0000-4000-8000-000000000505'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000506', true);
select is((select id::text from crm.referral_calling where id = current_setting('t.c505')::uuid), current_setting('t.c505'), 'other branch reads the referral call');
select throws_like($$select crm.update_referral_calling(current_setting('t.c505')::uuid, 'no_response', null, null)$$, '%own branch%', 'other branch cannot update');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000505', true);
select lives_ok($$select crm.update_referral_calling(current_setting('t.c505')::uuid, 'no_response', null, null)$$, 'owning branch updates');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000507', true);
select lives_ok($$select crm.update_referral_calling(current_setting('t.c505')::uuid, 'converted', null, null)$$, 'super admin updates');
reset role;

-- identifies an open referral calling record as overdue when its next follow-up date has passed
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000508', 'Referral Branch 508');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000508', 'Referral User 508', 'referral-508@example.com', 'salesperson', '10000000-0000-4000-8000-000000000508');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000508', 'Referral Client 508', '9000005508');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000508', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000508","branch_id":"10000000-0000-4000-8000-000000000508","primary_name":"Referral Client 508","primary_phone":"9000005508","did_buy":true,"event_date":"2020-01-01T10:00:00Z","reference_name":"Captured Referral 508","reference_phone":"9876500508","engagement":{"referrals":{"asked":true}}}'::jsonb)$$, 'old referral visit');
select ok((select c.next_followup_date < current_date and c.status not in ('closed', 'converted') from crm.referral_calling c join crm.referrals r on r.id = c.referral_id where r.given_by_client_id = '20000000-0000-4000-8000-000000000508'), 'referral call overdue');
reset role;

-- ===========================================================================
-- Phase 6 dashboard global-read guarantee
-- ===========================================================================
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000601', 'Dashboard A'), ('10000000-0000-4000-8000-000000000602', 'Dashboard B');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000601', 'Dashboard Sales', 'dash-sales@example.com', 'salesperson', '10000000-0000-4000-8000-000000000601');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000602', 'Dashboard Manager', 'dash-manager@example.com', 'branch_manager', '10000000-0000-4000-8000-000000000602');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000603', 'Dashboard Admin', 'dash-admin@example.com', 'super_admin', null);
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000601', 'Dashboard Client', '9000000601');
insert into crm.client_timeline(client_id, event_date, buy_status, branch_id) values
('20000000-0000-4000-8000-000000000601', '2026-07-24T10:00:00Z', 'YES', '10000000-0000-4000-8000-000000000601'),
('20000000-0000-4000-8000-000000000601', '2026-07-24T11:00:00Z', 'NO', '10000000-0000-4000-8000-000000000602');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000601', true);
select is((select count(*)::integer from crm.client_timeline where client_id = '20000000-0000-4000-8000-000000000601' and event_date >= '2026-07-24' and event_date < '2026-07-25'), 2, 'salesperson sees the full day');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000602', true);
select is((select count(*)::integer from crm.client_timeline where client_id = '20000000-0000-4000-8000-000000000601' and event_date >= '2026-07-24' and event_date < '2026-07-25'), 2, 'manager sees the full day');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000603', true);
select is((select count(*)::integer from crm.client_timeline where client_id = '20000000-0000-4000-8000-000000000601' and event_date >= '2026-07-24' and event_date < '2026-07-25'), 2, 'super admin sees the full day');
reset role;

-- ===========================================================================
-- legacy queue alignment
-- ===========================================================================
-- links a referral to the one canonical phone match or creates a minimal client when absent
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000801', 'Conversion Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000801', 'Converter', 'converter@example.com', 'salesperson', '10000000-0000-4000-8000-000000000801');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000801', 'Giver', '9000000801'), ('20000000-0000-4000-8000-000000000802', 'Known referral', '9888888801');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000801', true);
select set_config('t.found', (select id::text from crm.create_manual_referral('20000000-0000-4000-8000-000000000801', 'Known referral', '9888888801', 'CRM', null)), true);
select is((select crm.convert_referral_to_client((select id from crm.referral_calling where referral_id = current_setting('t.found')::uuid))::text), '20000000-0000-4000-8000-000000000802', 'referral linked to the existing phone match');
select set_config('t.absent', (select id::text from crm.create_manual_referral('20000000-0000-4000-8000-000000000801', 'New referral', '9888888802', 'CRM', null)), true);
select set_config('t.created', crm.convert_referral_to_client((select id from crm.referral_calling where referral_id = current_setting('t.absent')::uuid))::text, true);
select is((select row(primary_name, primary_phone)::text from crm.clients where client_id = current_setting('t.created')::uuid), '("New referral",9888888802)', 'minimal client created for an unknown referral');
reset role;

-- ===========================================================================
-- Client Database/Profile queue parity
-- ===========================================================================
-- searches every legacy name and phone source, caps at 200 newest visits, and attaches the selected existing client to its queue
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000901', 'Client Database Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000901', 'Client Database User', 'client-db@example.com', 'salesperson', '10000000-0000-4000-8000-000000000901');
insert into crm.clients(client_id, primary_name, other_names, primary_phone, secondary_phone, billing_phone, other_known_phones)
values ('20000000-0000-4000-8000-000000000901', 'Primary Anita', array['A. N.'], '9000000901', '9000000902', '9000000903', array['9000000904']);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000901', true);
select results_eq(format($$select client_id::text from crm.browse_clients(%L::text, null::text, 0, 200)$$, q), $$values ('20000000-0000-4000-8000-000000000901')$$, 'browse finds the client by ' || q)
from unnest(array['Primary', 'A. N.', '+91 90000 00901', '9000000902', '9000000903', '9000000904']) q;
reset role;
select ok(position('LIMIT LEAST(GREATEST(result_limit, 1), 200)' in pg_get_functiondef('crm.browse_clients(text,text,integer,integer)'::regprocedure)) > 0, 'client database caps at 200');
select ok(position('ORDER BY client.last_visit_date DESC NULLS LAST' in pg_get_functiondef('crm.browse_clients(text,text,integer,integer)'::regprocedure)) > 0, 'client database orders by newest visit');
set local role authenticated;
select set_config('t.q901', (select row_to_json(r)::text from crm.create_entry_queue('Ignored name', '9999999999', '10000000-0000-4000-8000-000000000901', null, '20000000-0000-4000-8000-000000000901') r), true);
select is(current_setting('t.q901')::json ->> 'client_id', '20000000-0000-4000-8000-000000000901', 'queue attached to the selected client');
select is((select row(client_name, mobile, client_id)::text from crm.entry_queue where id = (current_setting('t.q901')::json ->> 'id')::uuid), '("Primary Anita",9000000901,20000000-0000-4000-8000-000000000901)', 'queue uses the selected client identity');
reset role;

-- keeps same-name and same-phone referrals separate when the referral giver differs
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000599', 'Referral giver dedupe branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000599', 'Referral giver dedupe user', 'referral-giver-dedupe@example.com', 'salesperson', '10000000-0000-4000-8000-000000000599');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000599', 'First Referral Giver', '9000000599'), ('20000000-0000-4000-8000-000000000598', 'Different Referral Giver', '9000000598');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000599', true);
select lives_ok($$select crm.create_manual_referral('20000000-0000-4000-8000-000000000599', 'Same Referral', '99887 76654', null, null)$$, 'first giver referral');
select lives_ok($$select crm.create_manual_referral('20000000-0000-4000-8000-000000000598', ' same referral ', '+91 99887 76654', null, null)$$, 'second giver referral');
select is((select count(*)::integer from crm.referral_calling c join crm.referrals r on r.id = c.referral_id where lower(trim(r.referral_name)) = 'same referral' and r.referral_number = '9988776654'), 2, 'different givers keep separate calls');
reset role;

-- matches every literal legacy eligibility branch and keeps sync source-evidence-only
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000410', 'Eligibility Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000410', 'Eligibility User', 'eligibility@example.com', 'salesperson', '10000000-0000-4000-8000-000000000410');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000410', true);
select lives_ok(format($$select * from crm.submit_walkin_visit(%L::jsonb)$$, jsonb_build_object('branch_id', '10000000-0000-4000-8000-000000000410', 'primary_name', 'Eligibility ' || s, 'primary_phone', '9000000' || s, 'did_buy', false,
    'seen_categories', seen, 'repair_or_order_approach', approach, 'additional_fields', jsonb_build_object('visit_status', visit_status), 'category_details', jsonb_build_object('seen_tags', tags))), 'eligibility visit ' || s)
from (values ('4101', 'REPAIR_PLACED', 'YES', '["Ring"]'::jsonb, '[]'::jsonb), ('4102', 'ORDER_PICKUP', 'YES', '[]', '["Bangle tag"]'), ('4103', 'REPAIR_PICKUP', 'NO', '["Ring"]', '[]'),
  ('4104', 'ORDER_PLACED', 'YES', '[]', '[]'), ('4105', 'STORE_VISIT', 'YES', '["Ring"]', '[]')) v(s, visit_status, approach, seen, tags);
select is((select count(*)::integer from crm.not_bought_followups where branch_id = '10000000-0000-4000-8000-000000000410'), 2, 'only the two literal legacy branches create follow-ups');
select is(crm.sync_not_bought_followups(), 0, 'sync adds nothing already covered');
reset role;
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000410', 'Source-less historic', '9000000410');
set local role authenticated;
insert into crm.not_bought_followups(client_id, status, entered_by, branch_id) values ('20000000-0000-4000-8000-000000000410', 'HISTORICAL', '30000000-0000-4000-8000-000000000410', '10000000-0000-4000-8000-000000000410');
select is((select row(source_timeline_id, source_visit_form_id)::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000410'), '(,)', 'historical follow-up keeps null source links');
reset role;

-- validates the canonical save contract, increments once, logs immutable history, and authorizes origin staff
insert into crm.branches(id, name) values ('10000000-0000-4000-8000-000000000411', 'Save Contract Branch');
select pg_temp.crm_user('30000000-0000-4000-8000-000000000411', 'Save Contract User', 'save-contract@example.com', 'salesperson', '10000000-0000-4000-8000-000000000411');
insert into crm.clients(client_id, primary_name, primary_phone) values ('20000000-0000-4000-8000-000000000411', 'Save Contract Client', '9000000411');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000411', true);
select lives_ok($$select * from crm.submit_walkin_visit('{"client_id":"20000000-0000-4000-8000-000000000411","branch_id":"10000000-0000-4000-8000-000000000411","primary_name":"Save Contract Client","primary_phone":"9000000411","did_buy":false,"not_bought_reasons":["Price"]}'::jsonb)$$, 'not-bought visit');
select set_config('t.f411', (select id::text from crm.not_bought_followups where client_id = '20000000-0000-4000-8000-000000000411'), true);
select lives_ok($$select crm.save_not_bought_followup(current_setting('t.f411')::uuid, 'VISIT PLANNED', 'CONNECTED', '2026-08-01', 'Will visit')$$, 'follow-up saved');
select is((select row(followup_count, status)::text from crm.not_bought_followups where id = current_setting('t.f411')::uuid), '(1,"VISIT PLANNED")', 'count incremented once');
select throws_like($$select crm.save_not_bought_followup(current_setting('t.f411')::uuid, 'PENDING', 'CONNECTED', '2026-08-02', null)$$, '%remark is required%', 'remark required unless done');
select results_eq($$select previous_status::text, status::text, updated_by::text from crm.not_bought_history where followup_id = current_setting('t.f411')::uuid$$,
  $$values ('PENDING', 'VISIT PLANNED', '30000000-0000-4000-8000-000000000411')$$, 'history row under the CRM actor');
reset role;
select throws_like($$delete from crm.not_bought_history where followup_id = current_setting('t.f411')::uuid$$, '%immutable%', 'history is immutable even for the owner');

-- ===========================================================================
-- Port addition: every mutating RPC above wrote a JewelOS audit row
-- ===========================================================================
select ok((select count(*) from audit_logs where module = 'crm' and action = 'crm.submit_walkin_visit') >= 20, 'walk-in submissions are audited');
select results_eq($$select distinct action from audit_logs where module = 'crm' and action in (
    'crm.create_client_with_phone', 'crm.create_entry_queue', 'crm.manage_crm_roster', 'crm.assign_next_available_crm',
    'crm.update_not_bought_followup', 'crm.save_not_bought_followup', 'crm.sync_not_bought_followups',
    'crm.create_manual_referral', 'crm.update_referral_calling', 'crm.convert_referral_to_client',
    'crm.submit_legacy_walkin_visit', 'crm.consume_legacy_walkin_ingest_rate_limit') order by 1$$,
  $$values ('crm.assign_next_available_crm'), ('crm.convert_referral_to_client'), ('crm.create_client_with_phone'), ('crm.create_entry_queue'),
    ('crm.create_manual_referral'), ('crm.manage_crm_roster'), ('crm.save_not_bought_followup'), ('crm.submit_legacy_walkin_visit'),
    ('crm.sync_not_bought_followups'), ('crm.update_not_bought_followup'), ('crm.update_referral_calling')$$,
  'each exercised mutating RPC wrote its audit action');
select is((select count(*)::integer from audit_logs where module = 'crm' and action like 'crm.%' and new_value ->> 'crm_user_id' is null and action <> 'crm.submit_legacy_walkin_visit'), 0,
  'audit rows carry the acting CRM user');

select * from finish();
rollback;
