-- CRM project upgrade (migrations 20261001000100-20261001000500):
-- - the login-bridge identity gate (current_crm_user_id): fail-closed cases;
-- - minimal grants: anon has nothing, authenticated has only the port's grants;
-- - company-wide read and branch-scoped writes through the gate;
-- - audit rows for CRM RPCs and direct writes, with no customer values;
-- - lead call history.
-- Fixtures are synthetic. auth.uid() is the JWT claim 'sub'.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
--   users 01 super_admin, 02 salesperson A, 03 salesperson B (granted, linked)
--         04 salesperson A, grant inactive
--         05 salesperson A, no grant
--         06 salesperson A, grant not yet linked to a session
--         07 salesperson A, CRM user inactive
-- ---------------------------------------------------------------------------
insert into branches(id, name) values
('20261000-0000-4000-8000-00000000000a', 'Upgrade Branch A'),
('20261000-0000-4000-8000-00000000000b', 'Upgrade Branch B');
insert into users(id, name, email, role, branch_id, active)
select ('20261001-0000-4000-8000-00000000000' || n)::uuid, 'Upgrade user ' || n,
  'crm-upgrade-0' || n || '@example.invalid',
  (array['super_admin','salesperson','salesperson','salesperson','salesperson','salesperson','salesperson'])[n]::user_role,
  case n when 1 then null when 3 then '20261000-0000-4000-8000-00000000000b'::uuid else '20261000-0000-4000-8000-00000000000a'::uuid end,
  n <> 7
from generate_series(1, 7) n;
insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id, active)
select ('20261002-0000-4000-8000-00000000000' || n)::uuid, 'crm-upgrade-0' || n || '@example.invalid',
  ('20261001-0000-4000-8000-00000000000' || n)::uuid,
  case when n = 6 then null else ('20261001-0000-4000-8000-00000000000' || n)::uuid end,
  n <> 4
from generate_series(1, 7) n where n <> 5;
insert into clients(client_id, primary_name, primary_phone, last_branch_id) values
('20261003-0000-4000-8000-00000000000a', 'Synthetic Client A', '9100000001', '20261000-0000-4000-8000-00000000000a'),
('20261003-0000-4000-8000-00000000000b', 'Synthetic Client B', '9100000002', '20261000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(p_user text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', '20261001-0000-4000-8000-00000000000' || p_user, true),
         set_config('request.path', '', true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'), 0,
  'anon has no table privileges');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype <> 'event_trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon can execute no public function');
select ok(not has_table_privilege('authenticated', 'public.clients', 'truncate'), 'authenticated cannot truncate clients');
select ok(has_table_privilege('authenticated', 'public.clients', 'select'), 'authenticated keeps select on clients (RLS decides rows)');
select ok(not has_table_privilege('authenticated', 'public.crm_sso_access_grants', 'select'), 'access grants are not readable through the API');
select ok(not has_table_privilege('authenticated', 'public._prisma_migrations', 'select'), 'Prisma history is not readable through the API');
select ok(not has_table_privilege('authenticated', 'crm_private.audit_logs', 'select'), 'audit log is not readable by authenticated');
select ok(has_table_privilege('service_role', 'public.crm_sso_access_grants', 'insert'), 'service_role (login bridge) keeps access to grants');

set local role anon;
select throws_ok($$select count(*) from public.clients$$, '42501', null, 'anon cannot read clients');
select throws_ok($$select * from public.get_my_profile()$$, '42501', null, 'anon cannot call CRM RPCs');
reset role;

-- ---------------------------------------------------------------------------
-- Identity gate
-- ---------------------------------------------------------------------------
\ir fixtures/crm_master_options.sql
set local role authenticated;
select pg_temp.act_as('2');
select is(current_crm_user_id(), '20261001-0000-4000-8000-000000000002'::uuid, 'linked active grant resolves to its CRM user');
select is(current_user_role()::text, 'salesperson', 'role resolves through the gate');
select is((select name from get_my_profile()), 'Upgrade user 2', 'get_my_profile resolves through the gate');
select is((select count(*)::int from clients where client_id::text like '20261003-%'), 2, 'salesperson reads clients company-wide');

select pg_temp.act_as('4');
select is(current_crm_user_id(), null, 'inactive grant: no CRM user');
select is((select count(*)::int from clients), 0, 'inactive grant: sees no clients');
select pg_temp.act_as('5');
select is(current_crm_user_id(), null, 'no grant (for example an old CRM password sign-in): no CRM user');
select is((select count(*)::int from clients), 0, 'no grant: sees no clients');
select pg_temp.act_as('6');
select is(current_crm_user_id(), null, 'grant not yet linked to a session: no CRM user');
select pg_temp.act_as('7');
select is(current_crm_user_id(), null, 'inactive CRM user: no CRM user');
select set_config('request.jwt.claim.sub', '20261009-0000-4000-8000-000000000099', true);
select is(current_crm_user_id(), null, 'unknown session: no CRM user');
reset role;

select throws_ok($$insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id, crm_auth_user_id)
  values ('20261002-0000-4000-8000-000000000005', 'crm-upgrade-05@example.invalid', '20261001-0000-4000-8000-000000000005', '20261001-0000-4000-8000-000000000002')$$,
  '23514', null, 'a grant session must be the CRM user itself');
select throws_ok($$insert into crm_sso_access_grants(jewelos_user_id, work_email, legacy_crm_user_id)
  values ('20261002-0000-4000-8000-000000000005', 'Mixed@Example.invalid', '20261001-0000-4000-8000-000000000005')$$,
  '23514', null, 'work email must be stored normalized');

-- ---------------------------------------------------------------------------
-- Audited RPC (invoker rights) and direct writes
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('2');
select set_config('request.path', '/rpc/create_client_with_phone', true);
select lives_ok($$select create_client_with_phone('Synthetic Upgrade New', '91000 00003', null, null)$$,
  'salesperson creates a client through the invoker-rights RPC');
reset role;
select is((select count(*)::int from crm_private.audit_logs
  where action = 'crm.create_client_with_phone' and actor_crm_user_id = '20261001-0000-4000-8000-000000000002'
    and actor_auth_user_id = '20261001-0000-4000-8000-000000000002'), 1,
  'RPC writes one audit row attributed to the CRM user');
select is((select count(*)::int from crm_private.audit_logs where action = 'crm.clients_insert'
  and actor_crm_user_id = '20261001-0000-4000-8000-000000000002'), 0,
  'the RPC insert is not double-audited as a direct write');

set local role authenticated;
select pg_temp.act_as('1');
insert into lookup_cities(id, label) values ('20261004-0000-4000-8000-000000000001', 'Synthetic City');
select pg_temp.act_as('2');
update clients set city = 'Synthetic City' where client_id = '20261003-0000-4000-8000-00000000000a';
reset role;
select is((select count(*)::int from crm_private.audit_logs where action = 'crm.lookup_cities_insert'
  and record_id = '20261004-0000-4000-8000-000000000001' and actor_crm_user_id = '20261001-0000-4000-8000-000000000001'), 1,
  'super admin direct lookup insert is audited');
select is((select details -> 'changed_columns' from crm_private.audit_logs where action = 'crm.clients_update'
  and record_id = '20261003-0000-4000-8000-00000000000a'), '["city", "profile_updated_by"]'::jsonb,
  'direct client update is audited with column names only');
select is((select profile_updated_by from clients where client_id = '20261003-0000-4000-8000-00000000000a'),
  '20261001-0000-4000-8000-000000000002'::uuid,
  'the original profile-editor trigger records the CRM user (auth.uid() is the CRM user)');
select is((select count(*)::int from crm_private.audit_logs where details::text like '%Synthetic%' or details::text like '%9100000%'), 0,
  'no audit row contains customer values');

-- ---------------------------------------------------------------------------
-- Lead call history
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('2');
select set_config('request.path', '/rpc/create_post_call_lead', true);
select lives_ok($$select create_post_call_lead('9100000004', 'Synthetic Lead', '{}'::jsonb, 'CONNECTED')$$,
  'active staff create a post-call lead');
select set_config('request.path', '', true);
select is((select count(*)::int from lead_call_history where entered_by = '20261001-0000-4000-8000-000000000002'), 1,
  'the first call record is created with the lead');
select throws_ok($$insert into lead_call_history(lead_id, call_response, entered_by)
  select id, 'NOT PICKED', '20261001-0000-4000-8000-000000000003' from leads where phone_number = '919100000004'$$,
  '42501', null, 'staff cannot record a call as someone else');
select lives_ok($$insert into lead_call_history(lead_id, call_response, entered_by)
  select id, 'NOT PICKED', '20261001-0000-4000-8000-000000000002' from leads where phone_number = '919100000004'$$,
  'staff record their own follow-up call');
select pg_temp.act_as('5');
select throws_ok($$select create_post_call_lead('9100000005', 'Synthetic Lead 2', '{}'::jsonb, 'CONNECTED')$$,
  '42501', null, 'no grant: cannot create a post-call lead');
reset role;
select is((select count(*)::int from crm_private.audit_logs where action = 'crm.create_post_call_lead'), 1,
  'post-call lead creation is audited');

-- ---------------------------------------------------------------------------
-- Storage: crm-documents (20261001000600)
-- ---------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'crm-documents'), false, 'crm-documents bucket is private');
-- The Storage API sets this for its own deletes (storage.protect_delete); the RLS policies decide which rows.
select set_config('storage.allow_delete_query', 'true', true);

set local role authenticated;
select pg_temp.act_as('2');
select lives_ok($$insert into storage.objects(bucket_id, name, owner_id) values ('crm-documents',
  '20261003-0000-4000-8000-00000000000a/general/20261005-0000-4000-8000-000000000001_proof.jpg', '20261001-0000-4000-8000-000000000002')$$,
  'staff upload a document at the original path, as themselves');
select lives_ok($$insert into storage.objects(bucket_id, name, owner_id) values ('crm-documents',
  'lead-calls/20261005-0000-4000-8000-0000000000aa/20261005-0000-4000-8000-0000000000bb_call.m4a', '20261001-0000-4000-8000-000000000002')$$,
  'staff upload a call recording under lead-calls/');
select throws_ok($$insert into storage.objects(bucket_id, name, owner_id) values ('crm-documents', 'anything/else.jpg', '20261001-0000-4000-8000-000000000002')$$,
  '42501', null, 'upload outside the original path shapes is refused');
select throws_ok($$insert into storage.objects(bucket_id, name, owner_id) values ('crm-documents',
  '20261003-0000-4000-8000-00000000000a/general/20261005-0000-4000-8000-000000000002_x.jpg', '20261001-0000-4000-8000-000000000003')$$,
  '42501', null, 'upload as another user is refused');

select pg_temp.act_as('3');
select is((select count(*)::int from storage.objects where bucket_id = 'crm-documents'), 2, 'another branch''s staff read documents company-wide');
delete from storage.objects where bucket_id = 'crm-documents' and name like '%_proof.jpg';
select pg_temp.act_as('5');
select is((select count(*)::int from storage.objects where bucket_id = 'crm-documents'), 0, 'no grant: sees no documents');
select throws_ok($$insert into storage.objects(bucket_id, name, owner_id) values ('crm-documents',
  '20261003-0000-4000-8000-00000000000a/general/20261005-0000-4000-8000-000000000003_x.jpg', '20261001-0000-4000-8000-000000000005')$$,
  '42501', null, 'no grant: cannot upload');
select pg_temp.act_as('1');
select is((select count(*)::int from storage.objects where name like '%_proof.jpg'), 1, 'a non-uploader salesperson could not delete the document');
delete from storage.objects where bucket_id = 'crm-documents' and name like '%_proof.jpg';
select is((select count(*)::int from storage.objects where name like '%_proof.jpg'), 0, 'super admin deletes any document');
reset role;

select * from finish();
rollback;
