-- Walk-in ingest RPCs (20261005000200): service_role only; branch lookup; idempotency by the
-- Sheet's REFERENCE NUMBER (also against the original import); ledger and audit without
-- customer values. The success path with a real form payload is covered end to end through
-- the Edge Function. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(has_function_privilege('service_role', 'public.legacy_walkin_ingest_submit(uuid,text,text,jsonb,jsonb,text)', 'execute'), 'the ingest function can submit');
select ok(has_function_privilege('service_role', 'public.consume_legacy_walkin_ingest_rate_limit(text)', 'execute'), 'the ingest function can rate-limit');
select ok(not has_function_privilege('authenticated', 'public.legacy_walkin_ingest_submit(uuid,text,text,jsonb,jsonb,text)', 'execute'), 'staff cannot call the ingest RPC');
select ok(not has_function_privilege('anon', 'public.legacy_walkin_ingest_log_attempt(uuid,text,jsonb,text,text,jsonb)', 'execute'), 'anon cannot write the ledger');
select ok(not has_function_privilege('service_role', 'crm_private.record_legacy_walkin_attempt(uuid,text,jsonb,text,text,jsonb)', 'execute'), 'the ledger helper is internal');
select ok(not has_table_privilege('service_role', 'crm_private.walkin_ingest_keys', 'select'), 'idempotency keys are internal');

insert into branches(id, name) values ('20261006-0000-4000-8000-00000000000a', 'Ingest Test Branch');
insert into clients(client_id, primary_name, primary_phone, last_branch_id)
values ('20261006-0000-4000-8000-0000000000c1', 'Synthetic Imported Client', '9100000101', '20261006-0000-4000-8000-00000000000a');
insert into client_timeline(id, client_id, event_date, branch_id, reference_number)
values ('20261006-0000-4000-8000-0000000000e1', '20261006-0000-4000-8000-0000000000c1', '2026-08-17 06:00+05:30', '20261006-0000-4000-8000-00000000000a', 'SHEET-REF-0001');

create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
grant execute on function pg_temp.as_service() to service_role;

set local role service_role;
select pg_temp.as_service();
select is(public.legacy_walkin_ingest_submit('20261006-0000-4000-8000-0000000000f1', '203.0.113.9', 'No Such Branch',
  '{"primary_name":"Synthetic"}'::jsonb, '{"formDataObj":{"client_name":"Synthetic"}}'::jsonb, repeat('a', 64)) ->> 'code',
  'INVALID_BRANCH', 'an unknown branch is INVALID_BRANCH');
select is(public.legacy_walkin_ingest_submit('20261006-0000-4000-8000-0000000000f2', null, 'ingest test branch',
  '{"primary_name":"Synthetic","additional_fields":{"legacy_reference_number":" sheet-ref-0001 "}}'::jsonb, '{}'::jsonb, repeat('b', 64)),
  jsonb_build_object('code', 'ALREADY_INGESTED', 'clientId', '20261006-0000-4000-8000-0000000000c1',
    'timelineId', '20261006-0000-4000-8000-0000000000e1', 'referenceNumber', 'SHEET-REF-0001'),
  'a reference number from the original import is ALREADY_INGESTED with the existing ids');
select is(public.legacy_walkin_ingest_submit('20261006-0000-4000-8000-0000000000f3', null, 'Ingest Test Branch',
  '{"primary_name":"Synthetic","additional_fields":{"legacy_reference_number":"SHEET-REF-0001"}}'::jsonb, '{}'::jsonb, repeat('c', 64)) ->> 'code',
  'ALREADY_INGESTED', 'repeating it is still ALREADY_INGESTED');
select is(public.legacy_walkin_ingest_submit('20261006-0000-4000-8000-0000000000f4', null, 'Ingest Test Branch',
  '{"primary_name":"Synthetic","additional_fields":{"legacy_reference_number":"SHEET-REF-0002"}}'::jsonb, '{}'::jsonb, repeat('d', 64)) ->> 'code',
  'INGEST_FAILED', 'an unusable payload with a new reference is INGEST_FAILED (no visit, no key)');
select lives_ok($$select public.legacy_walkin_ingest_log_attempt('20261006-0000-4000-8000-0000000000f5', null, '{}'::jsonb, null, 'rate_limited', '{"code":"RATE_LIMITED"}'::jsonb)$$,
  'the function can log an early outcome');
select throws_ok($$select public.legacy_walkin_ingest_log_attempt('20261006-0000-4000-8000-0000000000f6', null, '{}'::jsonb, null, 'made_up', '{}'::jsonb)$$,
  '22023', null, 'an unknown outcome is refused');
reset role;

select is((select count(*)::int from client_timeline where client_id = '20261006-0000-4000-8000-0000000000c1'), 1, 'no second visit is saved for a known reference');
select is((select count(*)::int from crm_private.walkin_ingest_keys where source_reference = 'SHEET-REF-0001'), 1, 'the imported reference is remembered once');
select is((select count(*)::int from crm_private.walkin_ingest_keys where source_reference = 'SHEET-REF-0002'), 0, 'a failed submission leaves no key');
select is((select array_agg(outcome::text order by created_at, outcome) from legacy_walkin_ingest_attempts
  where request_id::text like '20261006-0000-4000-8000-0000000000f%'),
  array['duplicate', 'duplicate', 'failed', 'invalid_branch', 'rate_limited'], 'every outcome is in the ledger');
select ok(not exists (select 1 from crm_private.audit_logs where action = 'crm.legacy_walkin_ingest_attempt'
  and details::text ilike '%synthetic%'), 'ingest audit rows carry no customer values');
select is((select count(*)::int from crm_private.audit_logs where action = 'crm.legacy_walkin_ingest_attempt'
  and details ->> 'request_id' like '20261006-0000-4000-8000-0000000000f%'), 5, 'each logged outcome is audited');

-- The gate's ingest branch: service_role AND an ingest system user, nothing else.
insert into users(id, name, email, role, branch_id, active) values
('20261006-0000-4000-8000-0000000000a1', 'Legacy Apps Script Ingestion', 'legacy-ingest+test@internal.invalid', 'salesperson', '20261006-0000-4000-8000-00000000000a', true),
('20261006-0000-4000-8000-0000000000a2', 'Ungranted Person', 'ungranted@example.invalid', 'salesperson', '20261006-0000-4000-8000-00000000000a', true);
set local role service_role;
select pg_temp.as_service();
select set_config('request.jwt.claim.sub', '20261006-0000-4000-8000-0000000000a1', true);
select is(current_crm_user_id(), '20261006-0000-4000-8000-0000000000a1'::uuid, 'service_role acting as the ingest user resolves');
select set_config('request.jwt.claim.sub', '20261006-0000-4000-8000-0000000000a2', true);
select is(current_crm_user_id(), null, 'service_role acting as an ordinary ungranted user does not resolve');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', '{"role":"authenticated"}', true),
  set_config('request.jwt.claim.sub', '20261006-0000-4000-8000-0000000000a1', true);
select is(current_crm_user_id(), null, 'a browser session for the ingest user does not resolve');
reset role;

select * from finish();
rollback;
