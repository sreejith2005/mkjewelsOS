begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

insert into tenants (id, name, slug)
values ('83000000-0000-0000-0000-000000000001', 'CRM checkpoint test tenant', 'crm-checkpoint-test');
insert into crm_source_systems (id, source_key, display_name, is_active)
values ('83000000-0000-0000-0000-000000000010', 'crm_checkpoint_test', 'CRM checkpoint test source', true);
insert into crm_sync_worker_assertions (id, tenant_id, source_system_id, assertion_hash, scope_pattern, expires_at)
values ('83000000-0000-0000-0000-000000000101', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000010', encode(extensions.digest('checkpoint-worker', 'sha256'), 'hex'), 'clients', now() + interval '1 hour');

select has_function('public', 'get_crm_sync_checkpoint', array['text', 'text', 'jsonb'], 'checkpoint read RPC exists');

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select get_crm_sync_checkpoint('crm_checkpoint_test', 'clients', '{"id":"83000000-0000-0000-0000-000000000101","secret":"checkpoint-worker"}'::jsonb)$$, '42501', null, 'anonymous callers cannot read worker checkpoints');
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(get_crm_sync_checkpoint('crm_checkpoint_test', 'clients', '{"id":"83000000-0000-0000-0000-000000000101","secret":"checkpoint-worker"}'::jsonb), '{"checkpoint":null}'::jsonb, 'worker receives an explicit empty checkpoint');
reset role;

insert into crm_sync_runs (id, tenant_id, source_system_id, scope_key, request_key, status)
values ('83000000-0000-0000-0000-000000000201', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000010', 'clients', '83000000-0000-0000-0000-000000000202', 'completed');
insert into crm_sync_checkpoints (tenant_id, source_system_id, scope_key, checkpoint, run_id)
values ('83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000010', 'clients', '{"cursor":"row-42"}'::jsonb, '83000000-0000-0000-0000-000000000201');

set local role service_role;
select is(get_crm_sync_checkpoint('crm_checkpoint_test', 'clients', '{"id":"83000000-0000-0000-0000-000000000101","secret":"checkpoint-worker"}'::jsonb)->'checkpoint', '{"cursor":"row-42"}'::jsonb, 'worker receives only its scoped checkpoint');
select throws_ok($$select get_crm_sync_checkpoint('crm_checkpoint_test', 'other', '{"id":"83000000-0000-0000-0000-000000000101","secret":"checkpoint-worker"}'::jsonb)$$, '42501', null, 'worker assertion cannot read an unapproved scope');
reset role;

select * from finish();
rollback;
