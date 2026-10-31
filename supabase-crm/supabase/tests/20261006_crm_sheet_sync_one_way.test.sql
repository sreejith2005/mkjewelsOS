-- One-way mode (20261006000500, the default until the owner approves two-way): web-app writes
-- are not queued for the Sheet, pull / ack hand out nothing, and the CRM tells the read-only
-- script which fingerprints it already holds (applied rows and rows skipped for a lasting
-- reason). Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into branches(id, name) values ('20261010-0000-4000-8000-00000000000a', 'One Way Branch');
insert into users(id, name, email, role, branch_id, active) values
('20261010-1111-4000-8000-000000000002', 'One Way Sales', 'oneway-2@example.invalid', 'salesperson', '20261010-0000-4000-8000-00000000000a', true);
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select gen_random_uuid(), u.email, u.id, u.id, true from users u where u.email = 'oneway-2@example.invalid';
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
create function pg_temp.queued() returns integer language sql security definer as $$
  select count(*)::int from crm_private.sheet_sync_outbox;
$$;
grant execute on function pg_temp.queued() to authenticated, service_role;

select is(crm_private.sheet_two_way(), false, 'one-way is the default');

set local role service_role;
select is(pg_temp.svc('push', jsonb_build_object('tab', 'CLIENT DATABASE MASTER', 'rows', jsonb_build_array(
  jsonb_build_object('key', 'MKC-103801', 'hash', 'one-1', 'values', '{"CLIENT ID":"MKC-103801","PRIMARY NAME":"SYNTHETIC ONE WAY","PRIMARY PHONE":"9187600001"}'::jsonb),
  jsonb_build_object('key', 'MKC-103802', 'hash', 'one-2', 'values', '{"CLIENT ID":"MKC-103802"}'::jsonb)))) -> 'counts',
  '{"inserted": 1, "skipped_no_phone_no_name": 1}'::jsonb, 'Sheet rows still reach the CRM');
select is(pg_temp.svc('hashes', '{"tab":"CLIENT DATABASE MASTER"}') -> 'hashes' ->> 'MKC-103801', 'one-1', 'the CRM reports the fingerprint of an applied row');
select is(pg_temp.svc('hashes', '{"tab":"CLIENT DATABASE MASTER"}') -> 'hashes' ->> 'MKC-103802', 'one-2', 'and of a row skipped for a lasting reason');
select throws_ok($$select pg_temp.svc('hashes', '{"tab":"SOMETHING ELSE"}')$$, '22023', null, 'an unknown tab is refused');
reset role;

set local role authenticated;
select pg_temp.act_as('20261010-1111-4000-8000-000000000002');
update clients set city = 'ONE WAY CITY' where client_code = 'MKC-103801';
select lives_ok($$select submit_walkin_visit(jsonb_build_object('branch_id', '20261010-0000-4000-8000-00000000000a',
  'primary_name', 'Synthetic One Way Walkin', 'primary_phone', '9187600003'))$$, 'staff keep working in the web app');
reset role;
select is(pg_temp.queued(), 0, 'web-app writes are not queued for the Sheet');

set local role service_role;
select is(pg_temp.svc('pull', '{}'), '{"changes": [], "two_way": false}'::jsonb, 'pull hands out nothing');
select is(pg_temp.svc('ack', '{"results": []}') -> 'two_way', 'false'::jsonb, 'ack does nothing');
create temp table run as select (pg_temp.svc('run_start', '{"mode":"import"}') ->> 'run_id')::uuid as id;
select ok(not (pg_temp.svc('run_finish', jsonb_build_object('run_id', (select id from run), 'status', 'finished')) ? 'crm_only_queued'),
  'the import queues nothing for the Sheet');
select is(pg_temp.queued(), 0, 'the queue stays empty');
reset role;

select * from finish();
rollback;
