-- Google Sheet <-> CRM sync (20261006000300 + 20261006000400): access, push per tab
-- (insert / match / update / skip), dry run, MKC identity conflicts, no echo, the outbox,
-- pull and ack, Sheet-wins (cell-level for CLIENT DATABASE MASTER, record-level elsewhere),
-- families, referrals and their history without duplicates, lead clients kept out of the
-- Sheet, and the health block. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into branches(id, name) values ('20261009-0000-4000-8000-00000000000a', 'Bandra Sync');
insert into users(id, name, email, role, branch_id, active) values
('20261009-1111-4000-8000-000000000001', 'Sync Admin', 'sync-1@example.invalid', 'super_admin', null, true),
('20261009-1111-4000-8000-000000000002', 'Sync Sales', 'sync-2@example.invalid', 'salesperson', '20261009-0000-4000-8000-00000000000a', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select gen_random_uuid(), u.email, u.id, u.id, true from users u where u.email like 'sync-%@example.invalid';
insert into crm_allocation(branch_id, crm_name, active, crm_user_id)
values ('20261009-0000-4000-8000-00000000000a', 'SYNC SALES', true, '20261009-1111-4000-8000-000000000002');
insert into clients(client_id, client_code, primary_name, primary_phone, last_branch_id) values
('20261009-2222-4000-8000-0000000000b1', 'MKC-200901', 'Synthetic Crm Person', '9187700001', '20261009-0000-4000-8000-00000000000a');

-- Fixture writes are web-app-style writes; start the outbox empty.
delete from crm_private.sheet_sync_outbox;

create function pg_temp.svc(p_action text, p_payload jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return public.crm_sheet_sync(p_action, p_payload);
end $$;
grant execute on function pg_temp.svc(text, jsonb) to service_role;
create function pg_temp.act_as(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_sub)::text, true),
         set_config('request.jwt.claim.sub', p_sub, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;
create function pg_temp.client(p_code text) returns clients language sql security definer as $$
  select * from clients where client_code = p_code;
$$;
create function pg_temp.pending(p_tab text) returns integer language sql security definer as $$
  select count(*)::int from crm_private.sheet_sync_outbox where tab = p_tab and status = 'pending';
$$;
create function pg_temp.open_error(p_key text) returns text language sql security definer as $$
  select reason from crm_private.sheet_sync_errors where row_key = p_key and resolved_at is null;
$$;
create function pg_temp.outbox_reason(p_name text) returns text language sql security definer as $$
  select o.reason from crm_private.sheet_sync_outbox o join clients c on c.client_id = o.record_id
  where c.primary_name = p_name and o.tab = 'CLIENT DATABASE MASTER';
$$;
grant execute on function pg_temp.client(text), pg_temp.pending(text), pg_temp.open_error(text), pg_temp.outbox_reason(text) to authenticated, service_role;
create function pg_temp.master_row(p_code text, p_city text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('CLIENT ID', p_code, 'PHONE KEY', '9187700100', 'NAME KEY', 'SYNTHETIC SHEET CLIENT',
    'PRIMARY NAME', 'SYNTHETIC SHEET CLIENT', 'PRIMARY PHONE', '9187700100', 'CITY', p_city, 'PINCODE', '400050',
    'CLIENT POTENTIAL CATEGORY', 'HOT LEAD', 'DOB', '1990-02-03', 'TOTAL VISITS', '7') || p_extra
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.crm_sheet_sync('pull', '{}')$$, '42501', null, 'anon cannot call the sync');
reset role;
set local role authenticated;
select pg_temp.act_as('20261009-1111-4000-8000-000000000001');
select throws_ok($$select public.crm_sheet_sync('pull', '{}')$$, '42501', null, 'staff, even a super admin, cannot call the sync');
reset role;

set local role service_role;
create temp table run as select (pg_temp.svc('run_start', '{"mode":"import"}') ->> 'run_id')::uuid as id;

-- ---------------------------------------------------------------------------
-- CLIENT DATABASE MASTER
-- ---------------------------------------------------------------------------
select is(pg_temp.svc('push', jsonb_build_object('run_id', (select id from run), 'tab', 'CLIENT DATABASE MASTER', 'dry_run', true,
  'rows', jsonb_build_array(jsonb_build_object('key', 'MKC-103599', 'hash', 'h0', 'values', pg_temp.master_row('MKC-103599', 'MUMBAI'))))) -> 'counts',
  '{"inserted": 1}'::jsonb, 'dry run: the client would be inserted');
select is((pg_temp.client('MKC-103599')).client_id, null::uuid, 'dry run: nothing was written');

select is(pg_temp.svc('push', jsonb_build_object('run_id', (select id from run), 'tab', 'CLIENT DATABASE MASTER',
  'rows', jsonb_build_array(jsonb_build_object('key', 'mkc-103500', 'hash', 'h1', 'values', pg_temp.master_row('MKC-103500', 'MUMBAI'))))) -> 'counts',
  '{"inserted": 1}'::jsonb, 'a new Sheet client is inserted');
select is((pg_temp.client('MKC-103500')).city::text, 'MUMBAI', 'with the Sheet''s values');
select is((pg_temp.client('MKC-103500')).client_potential_category::text, 'Hot Lead', 'the potential category is matched ignoring case');
select is((pg_temp.client('MKC-103500')).dob, '1990-02-03'::date, 'dates are parsed');
select is((pg_temp.client('MKC-103500')).total_visits, 0, 'visit statistics are not copied: the CRM derives them');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'CLIENT DATABASE MASTER',
  'rows', jsonb_build_array(jsonb_build_object('key', 'MKC-103500', 'hash', 'h1', 'values', pg_temp.master_row('MKC-103500', 'MUMBAI'))))) -> 'counts',
  '{"matched": 1}'::jsonb, 'an unchanged row is matched without a write');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'CLIENT DATABASE MASTER',
  'rows', jsonb_build_array(jsonb_build_object('key', 'MKC-103500', 'hash', 'h2', 'values', pg_temp.master_row('MKC-103500', 'THANE'))))) -> 'counts',
  '{"updated": 1}'::jsonb, 'a changed row is updated');
select is((pg_temp.client('MKC-103500')).city::text, 'THANE', 'with the new value');
select is(pg_temp.pending('CLIENT DATABASE MASTER'), 0, 'Sheet writes never reach the outbox (no echo)');

select is(pg_temp.svc('push', jsonb_build_object('tab', 'CLIENT DATABASE MASTER',
  'rows', jsonb_build_array(jsonb_build_object('key', 'MKC-103500', 'hash', 'h3',
    'values', pg_temp.master_row('MKC-103500', 'THANE') || '{"PRIMARY NAME":"SOMEONE ELSE","NAME KEY":"SOMEONE ELSE","PRIMARY PHONE":"9187799999","PHONE KEY":"9187799999"}')))) -> 'counts',
  '{"skipped_mkc_identity_conflict": 1}'::jsonb, 'an MKC that now names a different person is skipped');
select is(pg_temp.open_error('MKC-103500'), 'mkc_identity_conflict', 'and recorded as an open error');
set local role service_role;
select throws_ok($$select count(*) from crm_private.sheet_sync_errors$$, '42501', null, 'the sync tables are private even to the service role');

select is(pg_temp.svc('push', jsonb_build_object('tab', 'CLIENT DATABASE MASTER',
  'rows', jsonb_build_array(jsonb_build_object('key', 'MKC-103501', 'hash', 'h4', 'values',
    '{"CLIENT ID":"MKC-103501","PRIMARY NAME":"SYNTHETIC CRM PERSON","PRIMARY PHONE":"9187700001","CITY":"PUNE","CLIENT POTENTIAL CATEGORY":"MAYBE"}'::jsonb)))) -> 'counts',
  '{"updated": 1, "warning_invalid_potential_category": 1}'::jsonb, 'a CRM client found by phone + name is updated; an unknown category is reported');
select is((select client_code from clients where client_id = '20261009-2222-4000-8000-0000000000b1'), 'MKC-103501', 'and takes the Sheet''s MKC');

-- ---------------------------------------------------------------------------
-- WALKIN DATASET
-- ---------------------------------------------------------------------------
create temp table visit as select jsonb_build_object(
  'primary_name', 'SYNTHETIC SHEET CLIENT', 'primary_phone', '9187700100', 'crm_name', 'SYNC SALES', 'did_buy', false,
  'event_date', '2026-10-01T00:00:00.000Z', 'remark', 'FIRST REMARK', 'seen_categories', '["RINGS"]'::jsonb,
  'additional_fields', '{"visit_status":"ORDER_PLACED"}'::jsonb, 'proof_urls', '{"instagram":"https://example.invalid/p"}'::jsonb) as payload;
select is(pg_temp.svc('push', jsonb_build_object('tab', 'WALKIN DATASET', 'rows', jsonb_build_array(jsonb_build_object(
  'key', 'MK-WK-ABC-BAN-TA-500', 'hash', 'w1', 'values', '{"BRANCH":"BANDRA SYNC","CRM CLIENT ID":"MKC-103500"}'::jsonb,
  'payload', (select payload from visit))))) -> 'counts', '{"inserted": 1}'::jsonb, 'a Sheet walk-in is inserted');
select is((select c.client_code from client_timeline t join clients c on c.client_id = t.client_id where t.reference_number = 'MK-WK-ABC-BAN-TA-500'), 'MKC-103500',
  'on the client named by CRM CLIENT ID, under the Sheet''s reference');
select is((select buy_status::text from client_timeline where reference_number = 'MK-WK-ABC-BAN-TA-500'), 'ORDER_PLACED', 'with the Sheet''s full status');
select is((select f.instagram_proof_url from visit_forms f join client_timeline t on t.id = f.client_timeline_id where t.reference_number = 'MK-WK-ABC-BAN-TA-500'),
  'https://example.invalid/p', 'and its proof URLs');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'WALKIN DATASET', 'rows', jsonb_build_array(jsonb_build_object(
  'key', 'MK-WK-ABC-BAN-TA-500', 'hash', 'w2', 'values', '{"BRANCH":"BANDRA SYNC","CRM CLIENT ID":"MKC-103500"}'::jsonb,
  'payload', (select payload || '{"remark":"EDITED IN THE SHEET"}' from visit))))) -> 'counts', '{"updated": 1}'::jsonb, 'an edited Sheet walk-in updates the visit');
select is((select count(*)::int from client_timeline where reference_number = 'MK-WK-ABC-BAN-TA-500'), 1, 'without a second visit');
select is((select remark from client_timeline where reference_number = 'MK-WK-ABC-BAN-TA-500'), 'EDITED IN THE SHEET', 'the Sheet''s edit wins');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'WALKIN DATASET', 'rows', jsonb_build_array(jsonb_build_object(
  'key', 'MK-WK-ABC-NOW-TA-501', 'hash', 'w3', 'values', '{"BRANCH":"NOWHERE"}'::jsonb, 'payload', (select payload from visit))))) -> 'counts',
  '{"skipped_branch_unknown": 1}'::jsonb, 'an unknown branch is skipped with a reason');
select is(pg_temp.pending('WALKIN DATASET'), 0, 'Sheet walk-ins never reach the outbox');

-- ---------------------------------------------------------------------------
-- FAMILY DATA
-- ---------------------------------------------------------------------------
select is(pg_temp.svc('push', jsonb_build_object('tab', 'FAMILY DATA', 'rows', jsonb_build_array(
  jsonb_build_object('key', 'MKC-103500', 'hash', 'f1', 'values', '{"MAIN CLIENT ID":"MKC-103500","CLIENT ID":"MKC-103500","FAMILY ID":"MKF-100777","FAMILY":"SYNTHETIC SHEET CLIENT","NUMBER":"919187700100","RELATION":"MAIN CLIENT"}'::jsonb),
  jsonb_build_object('key', 'MKC-103502', 'hash', 'f2', 'values', '{"MAIN CLIENT ID":"MKC-103500","CLIENT ID":"MKC-103502","FAMILY ID":"MKF-100777","FAMILY":"SYNTHETIC SISTER","NUMBER":"+919187700102","RELATION":"SISTER","COMMUNICATION PREFERENCE":"CALL"}'::jsonb)))) -> 'counts',
  '{"updated": 1, "inserted": 1}'::jsonb, 'family rows join the main client and create a new member');
select is((select household_code from households h join clients c on c.household_id = h.id where c.client_code = 'MKC-103502'), 'MKF-100777', 'the Sheet''s MKF is kept');
select is((select m.client_code from households h join clients m on m.client_id = h.main_client_id where h.household_code = 'MKF-100777'), 'MKC-103500', 'the main client is recorded');
select is((pg_temp.client('MKC-103502')).household_relation::text, 'SISTER', 'with the member''s relation');

-- ---------------------------------------------------------------------------
-- REFERRALS, CALLING MASTER, HISTORY
-- ---------------------------------------------------------------------------
reset role;
create temp table ref as select crm_private.sheet_referral_key('Synthetic Friend', '9187700200', 'SYNTHETIC SHEET CLIENT') as raw,
  crm_private.sheet_hashed_key('RK', crm_private.sheet_referral_key('Synthetic Friend', '9187700200', 'SYNTHETIC SHEET CLIENT')) as key;
create temp table hist as select crm_private.sheet_hashed_key('RH', (select raw from ref) || '|2026-10-06 10:00:00|VISIT PLANNED') as key;
grant select on ref, hist to service_role;
set local role service_role;
select is(pg_temp.svc('push', jsonb_build_object('tab', 'REFERRALS', 'rows', jsonb_build_array(jsonb_build_object('key', (select key from ref), 'hash', 'r1',
  'values', '{"TIMESTAMP":"2026-08-20 11:00:00","CRM NAME":"SYNC SALES","SALES PERSON NAME":"NOT ON ROSTER","REFERENCE GIVEN BY CLIENT NAME":"SYNTHETIC SHEET CLIENT","REFERRAL NAME":"SYNTHETIC FRIEND","REFERRAL NUMBER":"9187700200"}'::jsonb)))) -> 'counts',
  '{"inserted": 1}'::jsonb, 'a Sheet referral is inserted');
select is((select given_by_name::text from referrals where referral_number = '9187700200'), 'SYNTHETIC SHEET CLIENT', 'with the referrer''s name');
select is((select c.client_code from referrals r join clients c on c.client_id = r.given_by_client_id where r.referral_number = '9187700200'), 'MKC-103500', 'and the referrer when the name is unique');
select is((select salesperson_id from referrals where referral_number = '9187700200'), '5eee5eee-0000-4000-8000-000000000001'::uuid, 'an unknown salesperson is the sync user');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'REFERRALS CALLING MASTER', 'rows', jsonb_build_array(jsonb_build_object('key', (select key from ref), 'hash', 'c1',
  'values', jsonb_build_object('REFERRAL KEY', (select raw from ref), 'REFERRAL NAME', 'SYNTHETIC FRIEND', 'REFERRAL NUMBER', '9187700200', 'REFERRAL GIVEN BY CLIENT', 'SYNTHETIC SHEET CLIENT',
    'FOLLOW UP STATUS', 'CALL NOT PICKED', 'NEXT FOLLOW UP DATE', '2026-10-10', 'FOLLOW UP COUNT', '2', 'LAST FOLLOW UP REMARK', 'TRY AGAIN', 'ASSIGNED CRM / DOER', 'SYNC SALES'))))) -> 'counts',
  '{"inserted": 1}'::jsonb, 'its calling record is inserted on the same referral');
select is((select count(*)::int from referrals where referral_number = '9187700200'), 1, 'without a second referral');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'REFERRALS CALLING MASTER', 'rows', jsonb_build_array(jsonb_build_object('key', (select key from ref), 'hash', 'c2',
  'values', jsonb_build_object('REFERRAL KEY', (select raw from ref), 'REFERRAL NAME', 'SYNTHETIC FRIEND', 'REFERRAL NUMBER', '9187700200',
    'FOLLOW UP STATUS', 'VISIT PLANNED', 'NEXT FOLLOW UP DATE', '2026-10-12', 'FOLLOW UP COUNT', '3', 'LAST FOLLOW UP REMARK', 'WILL VISIT'))))) -> 'counts',
  '{"updated": 1}'::jsonb, 'a Sheet follow-up updates the calling record');
select is((select count(*)::int from referral_calling_history h join referral_calling rc on rc.id = h.referral_calling_id join referrals r on r.id = rc.referral_id where r.referral_number = '9187700200'), 0,
  'without an automatic CRM history row (the Sheet''s history row comes separately)');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'REFERRALS HISTORY', 'rows', jsonb_build_array(jsonb_build_object('key', (select key from hist), 'hash', 'x1',
  'values', jsonb_build_object('TIMESTAMP', '2026-10-06 10:00:00', 'REFERRAL KEY', (select raw from ref), 'OLD STATUS', 'CALL NOT PICKED', 'NEW STATUS', 'VISIT PLANNED',
    'CALL RESPONSE', 'CONNECTED', 'REMARK', 'WILL VISIT', 'ENTERED BY', 'SYNC SALES', 'SOURCE', 'CRM FOLLOW UP FORM'))))) -> 'counts',
  '{"inserted": 1}'::jsonb, 'a Sheet history row is inserted');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'REFERRALS HISTORY', 'rows', jsonb_build_array(jsonb_build_object('key', (select key from hist), 'hash', 'x2',
  'values', jsonb_build_object('TIMESTAMP', '2026-10-06 10:00:00', 'REFERRAL KEY', (select raw from ref), 'NEW STATUS', 'VISIT PLANNED'))))) -> 'counts',
  '{"matched": 1}'::jsonb, 're-sending it never duplicates it');
reset role;

-- ---------------------------------------------------------------------------
-- Web-app changes, pull and ack, Sheet wins
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('20261009-1111-4000-8000-000000000002');
update clients set city = 'NAVI MUMBAI' where client_code = 'MKC-103500';
reset role;
select is(pg_temp.pending('CLIENT DATABASE MASTER'), 1, 'a web-app edit is queued for the Sheet');
set local role service_role;
create temp table pulled as select pg_temp.svc('pull', '{"limit": 50}') -> 'changes' as changes;
select is((select c -> 'values' from pulled, jsonb_array_elements(changes) c where c ->> 'tab' = 'CLIENT DATABASE MASTER'),
  '{"CITY": "NAVI MUMBAI"}'::jsonb, 'the pull hands only the changed cell');
select is((select c -> 'base' from pulled, jsonb_array_elements(changes) c where c ->> 'tab' = 'CLIENT DATABASE MASTER'),
  '{"CITY": "THANE"}'::jsonb, 'with the value the Sheet had');
select is(pg_temp.svc('ack', jsonb_build_object('results', (select jsonb_agg(jsonb_build_object('id', c -> 'id', 'outcome', 'applied')) from pulled, jsonb_array_elements(changes) c))) -> 'counts' ->> 'applied',
  (select jsonb_array_length(changes)::text from pulled), 'the script confirms what it wrote');
select is(pg_temp.svc('pull', '{}') -> 'changes', '[]'::jsonb, 'a confirmed change is not handed out again');
reset role;

set local role authenticated;
select pg_temp.act_as('20261009-1111-4000-8000-000000000002');
update clients set city = 'VASHI' where client_code = 'MKC-103500';
reset role;
set local role service_role;
select is(pg_temp.svc('push', jsonb_build_object('tab', 'CLIENT DATABASE MASTER', 'rows', jsonb_build_array(jsonb_build_object('key', 'MKC-103500', 'hash', 'h5',
  'values', pg_temp.master_row('MKC-103500', 'NAVI MUMBAI') || '{"PINCODE":"400703"}')))) -> 'counts',
  '{"updated": 1}'::jsonb, 'a Sheet edit to another cell of the same client is applied');
select is((pg_temp.client('MKC-103500')).pincode::text, '400703', 'the Sheet''s cell arrives');
select is((pg_temp.client('MKC-103500')).city::text, 'VASHI', 'the web-app cell the Sheet did not change survives');
select is((select c -> 'values' from jsonb_array_elements(pg_temp.svc('pull', '{}') -> 'changes') c where c ->> 'tab' = 'CLIENT DATABASE MASTER'),
  '{"CITY": "VASHI"}'::jsonb, 'and is still handed to the Sheet');
select is(pg_temp.svc('push', jsonb_build_object('tab', 'CLIENT DATABASE MASTER', 'rows', jsonb_build_array(jsonb_build_object('key', 'MKC-103500', 'hash', 'h6',
  'values', pg_temp.master_row('MKC-103500', 'SHEET CITY') || '{"PINCODE":"400703"}')))) -> 'counts',
  '{"updated": 1}'::jsonb, 'the Sheet changes the same cell first');
select is((pg_temp.client('MKC-103500')).city::text, 'SHEET CITY', 'Sheet wins: its value replaces the web-app value');
select is((select c -> 'values' from jsonb_array_elements(pg_temp.svc('pull', '{}') -> 'changes') c where c ->> 'tab' = 'CLIENT DATABASE MASTER'),
  null::jsonb, 'and nothing is left to send back');
reset role;

-- A web-app referral follow-up, then a Sheet change to the same calling record first.
set local role authenticated;
select pg_temp.act_as('20261009-1111-4000-8000-000000000002');
update referrals set branch_id = '20261009-0000-4000-8000-00000000000a' where referral_number = '9187700200';
select lives_ok($$select save_referral_followup((select rc.id from referral_calling rc join referrals r on r.id = rc.referral_id where r.referral_number = '9187700200'),
  'INTERESTED - NEED FOLLOW UP', 'CONNECTED', '2026-10-20', 'WANTS A CATALOGUE', null, gen_random_uuid())$$, 'staff save a referral follow-up');
reset role;
select is(pg_temp.pending('REFERRALS HISTORY'), 1, 'its history row is queued for the Sheet');
select is(pg_temp.pending('REFERRALS CALLING MASTER'), 1, 'and the calling record');
set local role service_role;
select is(pg_temp.svc('push', jsonb_build_object('tab', 'REFERRALS CALLING MASTER', 'rows', jsonb_build_array(jsonb_build_object('key', (select key from ref), 'hash', 'c3',
  'values', jsonb_build_object('REFERRAL KEY', (select raw from ref), 'REFERRAL NAME', 'SYNTHETIC FRIEND', 'REFERRAL NUMBER', '9187700200',
    'FOLLOW UP STATUS', 'NOT INTERESTED', 'FOLLOW UP COUNT', '4', 'LAST FOLLOW UP REMARK', 'CHANGED IN SHEET'))))) -> 'counts',
  '{"updated": 1, "superseded_by_sheet": 1}'::jsonb, 'a Sheet change to the same record cancels the waiting web-app change');
select is((select rc.status::text from referral_calling rc join referrals r on r.id = rc.referral_id where r.referral_number = '9187700200'), 'NOT INTERESTED', 'Sheet wins');
select is((select c ->> 'op' from jsonb_array_elements(pg_temp.svc('pull', '{}') -> 'changes') c where c ->> 'tab' = 'REFERRALS HISTORY'), 'append',
  'the web-app history row is still added to the Sheet');
reset role;

-- A web-app walk-in is appended with its Sheet-style reference; a lead never reaches the Sheet.
set local role authenticated;
select pg_temp.act_as('20261009-1111-4000-8000-000000000002');
select lives_ok($$select submit_walkin_visit(jsonb_build_object('branch_id', '20261009-0000-4000-8000-00000000000a',
  'primary_name', 'Synthetic Web Walkin', 'primary_phone', '9187700300', 'crm_name', 'Sync Sales'))$$, 'staff record a walk-in in the web app');
reset role;
insert into leads(phone_number, name, created_by, branch_id) values ('9187700400', 'Synthetic Lead Only', '20261009-1111-4000-8000-000000000002', '20261009-0000-4000-8000-00000000000a');
set local role service_role;
create temp table pulled2 as select pg_temp.svc('pull', '{"limit": 200}') -> 'changes' as changes;
select matches((select c ->> 'key' from pulled2, jsonb_array_elements(changes) c where c ->> 'tab' = 'WALKIN DATASET'), '^MK-WK-CRM-BAN-SS-[0-9]+$',
  'the web-app walk-in is appended under its Sheet-style reference');
select is((select c -> 'values' ->> 'CLIENT NAME' from pulled2, jsonb_array_elements(changes) c where c ->> 'tab' = 'WALKIN DATASET'), 'SYNTHETIC WEB WALKIN',
  'with the Sheet''s columns');
select is((select count(*)::int from pulled2, jsonb_array_elements(changes) c where c -> 'values' ->> 'PRIMARY NAME' = 'Synthetic Lead Only'), 0,
  'a lead client is not added to CLIENT DATABASE MASTER');
select is(pg_temp.outbox_reason('Synthetic Lead Only'), 'not_in_sheet_scope',
  'its queue entry closes as out of scope');

select is((select (pg_temp.svc('run_finish', jsonb_build_object('run_id', (select id from run), 'status', 'finished')) ? 'crm_only')), true, 'the import reports CRM-only clients');
reset role;
select is((select counts -> 'push' -> 'CLIENT DATABASE MASTER' ->> 'inserted' from crm_private.sheet_sync_runs where id = (select id from run)), '2',
  'the run log sums its batches (dry run included)');

-- ---------------------------------------------------------------------------
-- Health
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('20261009-1111-4000-8000-000000000001');
select ok((public.crm_sync_health() -> 'sheet') ? 'waiting_for_sheet', 'the health view has the Google Sheet block');
select pg_temp.act_as('20261009-1111-4000-8000-000000000002');
select throws_ok($$select public.crm_sync_health()$$, '42501', null, 'only a super admin sees sync health');
reset role;

select * from finish();
rollback;
