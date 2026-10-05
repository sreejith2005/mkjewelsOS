-- Walk-in outbox (20261005000400): one coalesced event per queue entry; snapshot resolves
-- the salesperson through the roster link (managers as fallback) and carries no phone;
-- service-role claim/finish with requeue, backoff and dead events. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(not has_function_privilege('authenticated', 'public.crm_sync_claim_events(integer)', 'execute'), 'staff cannot claim sync events');
select ok(has_function_privilege('service_role', 'public.crm_sync_claim_events(integer)', 'execute'), 'the delivery worker can claim');
select ok(not has_table_privilege('service_role', 'crm_private.sync_outbox', 'select'), 'the outbox is internal');

insert into branches(id, name, jewelos_branch_id) values ('20261009-0000-4000-8000-00000000000a', 'Outbox Branch', '20261009-0000-4000-8000-0000000000fa'::uuid);
insert into users(id, name, email, role, branch_id, active) values
('20261009-1111-4000-8000-000000000001', 'Outbox Sales', 'outbox-1@example.invalid', 'salesperson', '20261009-0000-4000-8000-00000000000a', true),
('20261009-1111-4000-8000-000000000002', 'Outbox Manager', 'outbox-2@example.invalid', 'branch_manager', '20261009-0000-4000-8000-00000000000a', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, active) values
('20261009-2222-4000-8000-000000000001', 'outbox-1@example.invalid', '20261009-1111-4000-8000-000000000001', true),
('20261009-2222-4000-8000-000000000002', 'outbox-2@example.invalid', '20261009-1111-4000-8000-000000000002', true);
insert into crm_allocation(branch_id, crm_name, active, crm_user_id) values ('20261009-0000-4000-8000-00000000000a', 'OUTBOX SALES', true, '20261009-1111-4000-8000-000000000001');
insert into clients(client_id, primary_name, primary_phone, last_branch_id) values ('20261009-3333-4000-8000-000000000001', 'Synthetic Outbox Client', '9199000301', '20261009-0000-4000-8000-00000000000a');

insert into entry_queue(id, token, client_name, mobile, branch_id, assigned_crm_name, status, client_id) values
('20261009-4444-4000-8000-000000000001', 'OUTBOX-1', 'Synthetic Outbox Client', '9199000301', '20261009-0000-4000-8000-00000000000a', 'Outbox  sales', 'pending', '20261009-3333-4000-8000-000000000001'),
('20261009-4444-4000-8000-000000000002', 'OUTBOX-2', 'Synthetic Unknown', '9199000302', '20261009-0000-4000-8000-00000000000a', 'NOT ON ROSTER', 'pending', null);
update entry_queue set remark = 'only a remark' where id = '20261009-4444-4000-8000-000000000001';
update entry_queue set assigned_crm_name = 'OUTBOX SALES' where id = '20261009-4444-4000-8000-000000000001';

select is((select count(*)::int from crm_private.sync_outbox where aggregate_id::text like '20261009-4444-%'), 2, 'one coalesced event per queue entry');

create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
grant execute on function pg_temp.as_service() to service_role;
set local role service_role;
select pg_temp.as_service();
create temporary table claimed on commit drop as select * from public.crm_sync_claim_events(200);
reset role;
grant select on claimed to service_role;

select is((select snapshot ->> 'assignee_jewelos_user_id' from claimed where aggregate_id = '20261009-4444-4000-8000-000000000001'),
  '20261009-2222-4000-8000-000000000001', 'the queue salesperson resolves to their JewelOS person through the roster');
select is((select snapshot ->> 'client_code' from claimed where aggregate_id = '20261009-4444-4000-8000-000000000001'),
  (select client_code from clients where client_id = '20261009-3333-4000-8000-000000000001'), 'the snapshot carries the MKC');
select is((select snapshot ->> 'jewelos_branch_id' from claimed where aggregate_id = '20261009-4444-4000-8000-000000000001'),
  '20261009-0000-4000-8000-0000000000fa', 'and the mapped JewelOS branch');
select is((select snapshot ->> 'assignee_jewelos_user_id' from claimed where aggregate_id = '20261009-4444-4000-8000-000000000002'), null,
  'a name not on the roster does not resolve');
select is((select snapshot -> 'manager_jewelos_user_ids' from claimed where aggregate_id = '20261009-4444-4000-8000-000000000002'),
  '["20261009-2222-4000-8000-000000000002"]'::jsonb, 'the branch managers are offered instead');
select ok(not exists (select 1 from claimed where snapshot::text ~ '91990003'), 'snapshots carry no phone');

update entry_queue set status = 'complete' where id = '20261009-4444-4000-8000-000000000001';
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_finish_event((select event_id from claimed where aggregate_id = '20261009-4444-4000-8000-000000000001'), true), 'requeued',
  'completion during delivery keeps the event open');
select is(public.crm_sync_finish_event((select event_id from claimed where aggregate_id = '20261009-4444-4000-8000-000000000002'), false, 'http_500'), 'retry',
  'a failure is retried');
select is((select (snapshot ->> 'completed')::boolean from public.crm_sync_claim_events(200) where aggregate_id = '20261009-4444-4000-8000-000000000001'), true,
  'the requeued event now carries the completion');
reset role;
update crm_private.sync_outbox set attempts = 10 where aggregate_id = '20261009-4444-4000-8000-000000000002';
update crm_private.sync_outbox set claimed_at = now() where aggregate_id = '20261009-4444-4000-8000-000000000002';
create temporary table dead_event on commit drop as select id from crm_private.sync_outbox where aggregate_id = '20261009-4444-4000-8000-000000000002';
grant select on dead_event to service_role;
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_finish_event((select id from dead_event), false, 'http_500'), 'dead',
  'the tenth failure is dead');
reset role;
select is((select count(*)::int from crm_private.audit_logs where action = 'crm.sync_event_dead' and record_id = '20261009-4444-4000-8000-000000000002'), 1, 'a dead event is audited');

select * from finish();
rollback;
