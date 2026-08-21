begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);

insert into tenants (id, name, slug) values
  ('81000000-0000-0000-0000-000000000001', 'CRM sync test tenant A', 'crm-sync-test-a'),
  ('81000000-0000-0000-0000-000000000002', 'CRM sync test tenant B', 'crm-sync-test-b');
insert into crm_source_systems (id, source_key, display_name, is_active)
values ('81000000-0000-0000-0000-000000000010', 'crm_sync_test', 'CRM sync test source', true);
insert into crm_sync_worker_assertions (id, tenant_id, source_system_id, assertion_hash, scope_pattern, expires_at, revoked_at) values
  ('81000000-0000-0000-0000-000000000101', '81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000010', encode(extensions.digest('worker-a', 'sha256'), 'hex'), 'clients', now() + interval '1 hour', null),
  ('81000000-0000-0000-0000-000000000102', '81000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000010', encode(extensions.digest('worker-b', 'sha256'), 'hex'), 'clients', now() + interval '1 hour', null),
  ('81000000-0000-0000-0000-000000000103', '81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000010', encode(extensions.digest('expired', 'sha256'), 'hex'), 'clients', now() - interval '1 minute', null),
  ('81000000-0000-0000-0000-000000000104', '81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000010', encode(extensions.digest('revoked', 'sha256'), 'hex'), 'clients', now() + interval '1 hour', now());

select has_table('public', 'crm_sync_operation_requests', 'operation request idempotency table exists');
select has_function('public', 'begin_crm_sync_run', array['text', 'text', 'uuid', 'jsonb'], 'begin RPC exists');
select has_function('public', 'ingest_crm_source_batch', array['uuid', 'text', 'text', 'jsonb', 'uuid', 'jsonb'], 'ingest RPC exists');
select has_function('public', 'finalize_crm_sync_run', array['uuid', 'jsonb', 'uuid', 'jsonb'], 'finalize RPC exists');
select has_function('public', 'fail_crm_sync_run', array['uuid', 'text', 'uuid', 'jsonb'], 'fail RPC exists');

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select begin_crm_sync_run('crm_sync_test', 'clients', '81000000-0000-0000-0000-000000000201', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, '42501', null, 'anonymous callers cannot begin a worker run');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$select begin_crm_sync_run('crm_sync_test', 'clients', '81000000-0000-0000-0000-000000000201', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, '42501', null, 'authenticated callers cannot begin a worker run');
select throws_ok($$insert into crm_sync_runs(tenant_id, source_system_id, scope_key, request_key, status) values ('81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000010', 'clients', '81000000-0000-0000-0000-000000000201', 'running')$$, '42501', null, 'authenticated callers cannot write sync tables directly');
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok($$select begin_crm_sync_run('crm_sync_test', 'clients', '81000000-0000-0000-0000-000000000201', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'service worker can begin a run using the verified request role and assertion');
reset role;
set local role service_role;
select lives_ok($$select begin_crm_sync_run('crm_sync_test', 'clients', '81000000-0000-0000-0000-000000000201', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'begin replay returns the original run');
reset role;
select is((select count(*)::integer from crm_sync_runs where tenant_id = '81000000-0000-0000-0000-000000000001' and request_key = '81000000-0000-0000-0000-000000000201'), 1, 'begin replay retains one run');
select set_config('test.crm_sync_run_1', (select id::text from crm_sync_runs where request_key = '81000000-0000-0000-0000-000000000201'), true);
select is((select count(*)::integer from audit_logs where action = 'crm_sync_started'), 1, 'begin replay writes one audit event');
set local role service_role;
select throws_ok($$select ingest_crm_source_batch(current_setting('test.crm_sync_run_1')::uuid, 'crm_sync_test', 'clients', '[]'::jsonb, '81000000-0000-0000-0000-000000000202', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, '22023', null, 'empty worker batch is rejected');
select throws_ok($$select ingest_crm_source_batch(current_setting('test.crm_sync_run_1')::uuid, 'crm_sync_test', 'clients', (select jsonb_agg(jsonb_build_object('source_row_key', n::text, 'source_locator', 'sheet:clients', 'source_checksum', lpad(to_hex(n), 64, '0'), 'payload', '{}'::jsonb)) from generate_series(1, 501) n), '81000000-0000-0000-0000-000000000203', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, '22023', null, 'oversized worker batch is rejected');
select lives_ok($$select ingest_crm_source_batch(current_setting('test.crm_sync_run_1')::uuid, 'crm_sync_test', 'clients', '[{"source_row_key":"row-1","source_locator":"sheet:clients","source_checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payload":{}}]'::jsonb, '81000000-0000-0000-0000-000000000204', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'worker can ingest a valid source row');
select lives_ok($$select ingest_crm_source_batch(current_setting('test.crm_sync_run_1')::uuid, 'crm_sync_test', 'clients', '[{"source_row_key":"row-1","source_locator":"sheet:clients","source_checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payload":{}}]'::jsonb, '81000000-0000-0000-0000-000000000204', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'same ingest request is safely replayable');
reset role;
select is((select count(*)::integer from crm_source_records), 1, 'duplicate source row is stored once');
select is((select count(*)::integer from audit_logs where action = 'crm_sync_batch_ingested'), 1, 'ingest replay writes one audit event');
set local role service_role;
select throws_ok($$select ingest_crm_source_batch(current_setting('test.crm_sync_run_1')::uuid, 'crm_sync_test', 'clients', '[{"source_row_key":"cross-tenant","source_locator":"sheet:clients","source_checksum":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","payload":{}}]'::jsonb, '81000000-0000-0000-0000-000000000205', '{"id":"81000000-0000-0000-0000-000000000102","secret":"worker-b"}'::jsonb)$$, '42501', null, 'worker assertion cannot ingest into another tenant run');
select throws_ok($$select begin_crm_sync_run('crm_sync_test', 'clients', '81000000-0000-0000-0000-000000000206', '{"id":"81000000-0000-0000-0000-000000000103","secret":"expired"}'::jsonb)$$, '42501', null, 'expired worker assertion is rejected');
select throws_ok($$select begin_crm_sync_run('crm_sync_test', 'clients', '81000000-0000-0000-0000-000000000207', '{"id":"81000000-0000-0000-0000-000000000104","secret":"revoked"}'::jsonb)$$, '42501', null, 'revoked worker assertion is rejected');
select lives_ok($$select finalize_crm_sync_run(current_setting('test.crm_sync_run_1')::uuid, '{"cursor":"row-1"}'::jsonb, '81000000-0000-0000-0000-000000000208', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'worker can finalize a running run atomically');
select lives_ok($$select finalize_crm_sync_run(current_setting('test.crm_sync_run_1')::uuid, '{"cursor":"row-1"}'::jsonb, '81000000-0000-0000-0000-000000000208', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'same finalize request is safely replayable');
reset role;
select is((select status from crm_sync_runs where request_key = '81000000-0000-0000-0000-000000000201'), 'completed', 'finalize updates run status');
select is((select checkpoint->>'cursor' from crm_sync_checkpoints where run_id = (select id from crm_sync_runs where request_key = '81000000-0000-0000-0000-000000000201')), 'row-1', 'finalize writes checkpoint in same transaction');
select is((select count(*)::integer from audit_logs where action = 'crm_sync_completed'), 1, 'finalize replay writes one audit event');
set local role service_role;
select lives_ok($$select begin_crm_sync_run('crm_sync_test', 'clients', '81000000-0000-0000-0000-000000000209', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'worker can begin a separate run for failed-run coverage');
reset role;
select set_config('test.crm_sync_run_2', (select id::text from crm_sync_runs where request_key = '81000000-0000-0000-0000-000000000209'), true);
set local role service_role;
select lives_ok($$select fail_crm_sync_run(current_setting('test.crm_sync_run_2')::uuid, 'source_unavailable', '81000000-0000-0000-0000-000000000210', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'worker can fail a running run with a safe code');
select lives_ok($$select fail_crm_sync_run(current_setting('test.crm_sync_run_2')::uuid, 'source_unavailable', '81000000-0000-0000-0000-000000000210', '{"id":"81000000-0000-0000-0000-000000000101","secret":"worker-a"}'::jsonb)$$, 'same failed-run request is safely replayable');
reset role;
select is((select status from crm_sync_runs where request_key = '81000000-0000-0000-0000-000000000209'), 'failed', 'failed run remains failed after replay');
select is((select count(*)::integer from audit_logs where action = 'crm_sync_failed'), 1, 'failed-run replay writes one audit event');

select * from finish();
rollback;
