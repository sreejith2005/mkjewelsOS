-- 0188: the service_role contract behind the crm-walkin-ingest Edge Function.
-- Grants are narrow (three RPCs, no table privilege), the ingest is one transaction that
-- writes the ledger and audit rows, a failed visit rolls back alone but is still recorded,
-- and no audit row carries payload values.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into tenants(id, name, slug) values ('01881000-0000-4000-8000-000000000001', 'CRM 0188 tenant', 'crm-0188-one');
insert into branches(id, tenant_id, name, code) values
('01882000-0000-4000-8000-000000000001', '01881000-0000-4000-8000-000000000001', 'JewelOS Bandra 0188', 'C188A');
insert into crm.branches(id, name, active, jewelos_branch_id) values
('01886000-0000-4000-8000-000000000001', 'Ingest Mumbai', true, '01882000-0000-4000-8000-000000000001'),
('01886000-0000-4000-8000-000000000002', 'Ingest Closed', false, null);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(has_schema_privilege('service_role', 'crm', 'USAGE'), 'service_role may use schema crm');
select ok(has_function_privilege('service_role', 'crm.consume_legacy_walkin_ingest_rate_limit(text)', 'EXECUTE'), 'service_role may consume the ingest rate limit');
select ok(has_function_privilege('service_role', 'crm.legacy_walkin_ingest_log_attempt(uuid, text, jsonb, text, text, jsonb)', 'EXECUTE'), 'service_role may log an ingest attempt');
select ok(has_function_privilege('service_role', 'crm.legacy_walkin_ingest_submit(uuid, text, text, jsonb, jsonb, text)', 'EXECUTE'), 'service_role may submit an ingest');
select ok(not has_function_privilege('service_role', 'crm.submit_legacy_walkin_visit(jsonb)', 'EXECUTE'), 'service_role cannot call the visit writer directly');
select ok(not has_function_privilege('service_role', 'crm.submit_walkin_visit(jsonb)', 'EXECUTE'), 'service_role cannot call the walk-in writer directly');
select ok(not has_function_privilege('service_role', 'crm_private.record_legacy_walkin_attempt(uuid, text, jsonb, text, text, jsonb)', 'EXECUTE'), 'the ledger helper is owner-only');
select ok(not exists (
  select 1 from information_schema.role_table_grants where table_schema = 'crm' and grantee = 'service_role'
), 'service_role has no table privilege in schema crm');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'crm' and p.proname in ('legacy_walkin_ingest_log_attempt', 'legacy_walkin_ingest_submit', 'consume_legacy_walkin_ingest_rate_limit')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
), 'no browser role can execute an ingest RPC');

-- ---------------------------------------------------------------------------
-- Ingest as the service role
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

select set_config('t.ok', crm.legacy_walkin_ingest_submit(
  '01880000-0000-4000-8000-000000000001', '203.0.113.7', 'ingest MUMBAI',
  '{"primary_name":"Asha Ingest","primary_phone":"+91 90188 00001","did_buy":true,"seen_categories":["Ring"]}'::jsonb,
  '{"formDataObj":{"branch":"Mumbai"},"filesPayload":[]}'::jsonb, 'hash-ok')::text, true);
select is(current_setting('t.ok')::jsonb ->> 'code', 'INGESTED', 'a valid submission is ingested (branch match is case-insensitive)');
select is(crm.legacy_walkin_ingest_submit(
  '01880000-0000-4000-8000-000000000002', null, 'Ingest MUMBAI',
  '{"primary_name":"Asha Ingest","primary_phone":"+91 90188 00001"}'::jsonb, '{}'::jsonb, null) ->> 'code', 'INGESTED',
  'the same submission again is accepted as a repeat visit (no dedupe, as the original)');
select is((select count(*)::integer from crm.clients where primary_phone like '%90188 00001%' or primary_phone = '9018800001'), 1,
  'a repeat phone reuses the client');
select is((select count(*)::integer from crm.client_timeline where client_id = (current_setting('t.ok')::jsonb ->> 'clientId')::uuid), 2,
  'and adds a second visit');
select is((select outcome || '/' || source_ip from crm.legacy_walkin_ingest_attempts where request_id = '01880000-0000-4000-8000-000000000001'),
  'success/203.0.113.7', 'the success ledger row is written');
select is((select result ->> 'referenceNumber' from crm.legacy_walkin_ingest_attempts where request_id = '01880000-0000-4000-8000-000000000001'),
  current_setting('t.ok')::jsonb ->> 'referenceNumber', 'the ledger keeps the camelCase result');
select is((select count(*)::integer from audit_logs where action = 'crm.legacy_walkin_ingest_attempt'
  and new_value ->> 'request_id' = '01880000-0000-4000-8000-000000000001' and new_value ->> 'outcome' = 'success'
  and tenant_id = '01881000-0000-4000-8000-000000000001'), 1, 'the success is audited against the linked branch tenant');

select is(crm.legacy_walkin_ingest_submit('01880000-0000-4000-8000-000000000003', null, 'Ingest Closed', '{"primary_name":"X","primary_phone":"9018800003"}'::jsonb, '{}'::jsonb, null) ->> 'code',
  'INVALID_BRANCH', 'an inactive branch is refused');
select is(crm.legacy_walkin_ingest_submit('01880000-0000-4000-8000-000000000004', null, '   ', '{"primary_name":"X","primary_phone":"9018800003"}'::jsonb, '{}'::jsonb, null) ->> 'code',
  'INVALID_BRANCH', 'a blank branch is refused');
select is((select count(*)::integer from crm.legacy_walkin_ingest_attempts where outcome = 'invalid_branch'), 2, 'invalid-branch attempts are recorded');

-- A failing visit rolls back alone and is still recorded.
select is((crm.legacy_walkin_ingest_submit('01880000-0000-4000-8000-000000000005', null, 'Ingest Mumbai',
  '{"primary_name":"Fails","primary_phone":"+91 90188 00005","entry_queue_id":"NO-SUCH-TOKEN"}'::jsonb, '{}'::jsonb, null)) ->> 'code',
  'INGEST_FAILED', 'a failing visit reports INGEST_FAILED');
select is((select count(*)::integer from crm.clients where primary_name = 'Fails'), 0, 'the failed visit left no client behind');
select is((select outcome from crm.legacy_walkin_ingest_attempts where request_id = '01880000-0000-4000-8000-000000000005'), 'failed', 'the failure is in the ledger');
select is((select result::text from crm.legacy_walkin_ingest_attempts where request_id = '01880000-0000-4000-8000-000000000005'), '{"code": "INGEST_FAILED"}', 'the ledger result carries no SQL state');

-- Attempts decided before the database write
select lives_ok($$select crm.legacy_walkin_ingest_log_attempt('01880000-0000-4000-8000-000000000006', '198.51.100.1', '{}'::jsonb, null, 'unauthorized', '{"code":"UNAUTHORIZED"}'::jsonb)$$,
  'an unauthorized attempt is logged');
select is((select count(*)::integer from audit_logs where action = 'crm.legacy_walkin_ingest_attempt' and new_value ->> 'request_id' = '01880000-0000-4000-8000-000000000006'), 0,
  'unauthorized attempts stay out of the tenant audit trail');
select lives_ok($$select crm.legacy_walkin_ingest_log_attempt('01880000-0000-4000-8000-000000000007', null, '{}'::jsonb, null, 'rate_limited', '{"code":"RATE_LIMITED"}'::jsonb)$$, 'a rate-limited attempt is logged');
select is((select count(*)::integer from audit_logs where action = 'crm.legacy_walkin_ingest_attempt' and new_value ->> 'request_id' = '01880000-0000-4000-8000-000000000007'), 1,
  'authenticated-caller attempts are audited');
select throws_ok($$select crm.legacy_walkin_ingest_log_attempt('01880000-0000-4000-8000-000000000008', null, '{}'::jsonb, null, 'made_up', '{}'::jsonb)$$, '22023', null, 'an unknown outcome is rejected');
select throws_ok($$select crm.legacy_walkin_ingest_log_attempt('01880000-0000-4000-8000-000000000001', null, '{}'::jsonb, null, 'failed', '{}'::jsonb)$$, '23505', null, 'a request id is logged once');

-- No audit row carries payload values.
select ok(not exists (
  select 1 from audit_logs where action like 'crm.legacy_walkin_ingest_%'
    and (new_value::text like '%Asha%' or new_value::text like '%9018800%' or new_value::text like '%90188%' or new_value::text like '%Mumbai%')
), 'ingest audit rows hold no names, phones or branch text');

-- Rate limit: 30 per minute, then refused.
select ok((select bool_and(crm.consume_legacy_walkin_ingest_rate_limit('legacy-apps-script')) from generate_series(1, 30)), 'the first 30 requests in a minute are allowed');
select is(crm.consume_legacy_walkin_ingest_rate_limit('legacy-apps-script'), false, 'the 31st is refused');

-- ---------------------------------------------------------------------------
-- Browser roles cannot call any of it
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok($$select crm.legacy_walkin_ingest_submit('01880000-0000-4000-8000-000000000009', null, 'Ingest Mumbai', '{}'::jsonb, '{}'::jsonb, null)$$, '42501', null, 'authenticated cannot submit an ingest');
select throws_ok($$select crm.legacy_walkin_ingest_log_attempt('01880000-0000-4000-8000-000000000009', null, '{}'::jsonb, null, 'failed', '{}'::jsonb)$$, '42501', null, 'authenticated cannot write the ledger');
select throws_ok($$select crm.consume_legacy_walkin_ingest_rate_limit('legacy-apps-script')$$, '42501', null, 'authenticated cannot spend the rate limit');
reset role;
set local role anon;
select throws_ok($$select crm.legacy_walkin_ingest_submit('01880000-0000-4000-8000-000000000009', null, 'Ingest Mumbai', '{}'::jsonb, '{}'::jsonb, null)$$, '42501', null, 'anon cannot submit an ingest');
reset role;

select * from finish();
rollback;
