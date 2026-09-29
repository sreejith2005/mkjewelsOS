-- Phase 7 (2026-09-29 owner decision): enumerates the read/write scope of every table in
-- schema crm from 0185_crm_rls_grants.sql, so a future policy change that silently
-- broadens or narrows access fails this test instead of shipping unnoticed. See
-- docs/superpowers/specs/2026-09-25-crm-native-integration-design.md "Authorization model"
-- for the narrative and the same table in prose. Structural (catalog-introspection), not
-- fixture-based: supabase/tests/0183_crm_identity_bridge.test.sql covers the live-role
-- behavioural checks (company-wide client reads, branch-scoped writes, fail-closed roles).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Every base table in schema crm, partitioned into the four scopes the design doc
-- describes. Kept as literal arrays (not a catalog query) so a table renamed, added or
-- removed without updating this file is caught by the "accounted for" check below.
create temporary table t_company_wide (name name) on commit drop;
insert into t_company_wide values
  ('clients'), ('client_timeline'), ('visit_forms'), ('client_phone_index'), ('client_edit_log'),
  ('client_campaign_tags'), ('documents'), ('referrals'), ('referral_calling'),
  ('referral_calling_history'), ('leads'), ('lead_call_history'), ('lead_stage_history'),
  ('not_bought_followups'), ('not_bought_history'), ('campaigns'), ('branches'), ('users'),
  ('lead_form_fields'), ('lead_form_field_options'), ('lookup_relations'),
  ('lookup_source_of_leads'), ('lookup_sugar_options'), ('lookup_beverages'), ('lookup_cities'),
  ('lookup_communities'), ('lookup_gifts'), ('lookup_not_bought_reasons'), ('lookup_pincodes'),
  ('lookup_product_categories'), ('lookup_snacks');

create temporary table t_branch_scoped_read (name name) on commit drop;
insert into t_branch_scoped_read values ('crm_allocation'), ('crm_daily_availability');

create temporary table t_admin_only_read (name name) on commit drop;
insert into t_admin_only_read values ('legacy_walkin_ingest_attempts');

create temporary table t_no_access (name name) on commit drop;
insert into t_no_access values
  ('crm_queue_round_robin'), ('legacy_import_keys'), ('legacy_walkin_ingest_rate_limits');

create temporary table t_branch_scoped_all (name name) on commit drop;
insert into t_branch_scoped_all values ('entry_queue');

-- ---------------------------------------------------------------------------
-- Every table in schema crm is accounted for exactly once above.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(c.relname order by c.relname) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'crm' and c.relkind = 'r'
     and c.relname not in (
       select name from t_company_wide union all select name from t_branch_scoped_read
       union all select name from t_admin_only_read union all select name from t_no_access
       union all select name from t_branch_scoped_all
     )),
  null::name[],
  'every crm base table is classified in exactly one scope bucket (a new/renamed table must be added here)'
);
select is(
  (select array_agg(name order by name) from (
     select name from t_company_wide union all select name from t_branch_scoped_read
     union all select name from t_admin_only_read union all select name from t_no_access
     union all select name from t_branch_scoped_all
   ) x
   where name not in (select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'crm' and c.relkind = 'r')),
  null::name[],
  'no classified table name is stale (renamed or dropped)'
);

-- ---------------------------------------------------------------------------
-- Company-wide read: a PERMISSIVE SELECT policy to authenticated whose condition is
-- role-only (crm.current_user_role() IS NOT NULL), with no branch or super-admin-only
-- predicate. This is the "globally readable" contract from the original's own comment.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(t.name order by t.name) from t_company_wide t
   where not exists (
     select 1 from pg_policies p
     where p.schemaname = 'crm' and p.tablename = t.name and p.cmd = 'SELECT'
       and p.permissive = 'PERMISSIVE' and 'authenticated' = any(p.roles)
       and coalesce(p.qual, '') ~* 'current_user_role'
       and coalesce(p.qual, '') !~* 'is_branch_staff|is_branch_manager|is_super_admin'
   )),
  null::name[],
  'every company-wide table has a role-only (not branch- or admin-restricted) SELECT policy'
);
-- The converse: none of these tables ALSO carry a branch- or admin-only-restricted
-- SELECT policy as their only path (that would make the company-wide grant a dead letter,
-- or mean the classification above is wrong).
select is(
  (select array_agg(t.name order by t.name) from t_company_wide t
   where exists (
     select 1 from pg_policies p
     where p.schemaname = 'crm' and p.tablename = t.name and p.cmd = 'SELECT'
       and p.permissive = 'PERMISSIVE' and 'authenticated' = any(p.roles)
       and coalesce(p.qual, '') ~* 'is_branch_staff|is_branch_manager'
       and coalesce(p.qual, '') !~* 'current_user_role\(\)\s*\)?\s*is not null'
   )),
  null::name[],
  'no company-wide table''s only SELECT path is branch-restricted'
);

-- ---------------------------------------------------------------------------
-- Branch-scoped read: crm_allocation / crm_daily_availability. Narrower than the
-- client-family tables above — no company-wide (role-only) SELECT policy exists.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(t.name order by t.name) from t_branch_scoped_read t
   where not exists (
     select 1 from pg_policies p
     where p.schemaname = 'crm' and p.tablename = t.name and p.cmd = 'SELECT'
       and p.permissive = 'PERMISSIVE' and 'authenticated' = any(p.roles)
       and coalesce(p.qual, '') ~* 'is_branch_staff'
   )),
  null::name[],
  'every branch-scoped-read table has an is_branch_staff SELECT policy'
);
select is(
  (select array_agg(t.name order by t.name) from t_branch_scoped_read t
   where exists (
     select 1 from pg_policies p
     where p.schemaname = 'crm' and p.tablename = t.name and p.cmd = 'SELECT'
       and p.permissive = 'PERMISSIVE' and 'authenticated' = any(p.roles)
       and coalesce(p.qual, '') ~* 'current_user_role\(\)\s*\)?\s*is not null'
       and coalesce(p.qual, '') !~* 'is_branch_staff|is_branch_manager|is_super_admin'
   )),
  null::name[],
  'no branch-scoped-read table also carries a role-only company-wide SELECT policy'
);

-- ---------------------------------------------------------------------------
-- entry_queue: FOR ALL, branch-scoped (read and write together).
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(t.name order by t.name) from t_branch_scoped_all t
   where not exists (
     select 1 from pg_policies p
     where p.schemaname = 'crm' and p.tablename = t.name and p.cmd = 'ALL'
       and p.permissive = 'PERMISSIVE' and 'authenticated' = any(p.roles)
       and coalesce(p.qual, '') ~* 'is_branch_staff'
   )),
  null::name[],
  'entry_queue has a single branch-scoped FOR ALL policy'
);

-- ---------------------------------------------------------------------------
-- Admin-only read: legacy_walkin_ingest_attempts.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(t.name order by t.name) from t_admin_only_read t
   where not exists (
     select 1 from pg_policies p
     where p.schemaname = 'crm' and p.tablename = t.name and p.cmd = 'SELECT'
       and p.permissive = 'PERMISSIVE' and 'authenticated' = any(p.roles)
       and coalesce(p.qual, '') ~* 'is_super_admin'
       and coalesce(p.qual, '') !~* 'current_user_role\(\)\s*\)?\s*is not null\s*$'
   )),
  null::name[],
  'every admin-only-read table SELECT policy is gated on is_super_admin, not on role alone'
);

-- ---------------------------------------------------------------------------
-- No direct access for any authenticated role (owner/service-role/definer-function only):
-- crm_queue_round_robin, legacy_import_keys, legacy_walkin_ingest_rate_limits.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(t.name order by t.name) from t_no_access t
   where has_table_privilege('authenticated', 'crm.' || t.name, 'SELECT')),
  null::name[],
  'no-access tables grant no SELECT privilege to authenticated at all'
);
select is(
  (select array_agg(t.name order by t.name) from t_no_access t
   where exists (
     select 1 from pg_policies p
     where p.schemaname = 'crm' and p.tablename = t.name and p.permissive = 'PERMISSIVE'
       and 'authenticated' = any(p.roles)
   )),
  null::name[],
  'no-access tables carry no permissive policy for authenticated of any command'
);

-- ---------------------------------------------------------------------------
-- Every crm table has RLS enabled and the restrictive section-available SELECT gate
-- (already asserted in 0183_crm_identity_bridge.test.sql; repeated here as part of the
-- same enumeration so this file stands alone).
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'crm' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every crm table has RLS enabled');
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'crm' and c.relkind = 'r' and not exists (
     select 1 from pg_policies p where p.schemaname = 'crm' and p.tablename = c.relname
       and p.policyname = c.relname || '_section_available' and p.permissive = 'RESTRICTIVE' and p.cmd = 'SELECT')),
  0, 'every crm table keeps the restrictive section-available SELECT gate regardless of read scope');

-- ---------------------------------------------------------------------------
-- No policy anywhere in schema crm grants anon/PUBLIC anything (belt-and-braces on top
-- of the schema-level revoke already asserted in 0183).
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(distinct p.tablename order by p.tablename) from pg_policies p
   where p.schemaname = 'crm' and (p.roles && array['anon', 'public']::name[])),
  null::name[],
  'no crm policy names anon or public in its roles');

-- ---------------------------------------------------------------------------
-- Behavioural coverage (owner decision 2026-09-29, gap-fill on top of the live-role
-- fixtures in 0183_crm_identity_bridge.test.sql): company-wide read on the wider
-- client-history family (client_timeline/visit_forms/referrals/leads, not just
-- clients), and branch-scoped read+write on crm_daily_availability for both a
-- salesperson and a branch_manager. Self-contained fixtures (own tenant/branches/
-- ids), kept separate from 0183's so neither file's assertions depend on the other.
-- ---------------------------------------------------------------------------
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('01929300-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'crm-0192-sales-a@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now()),
  ('01929300-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'crm-0192-sales-b@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now()),
  ('01929300-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'crm-0192-manager-a@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now());
insert into tenants(id, name, slug) values ('01929000-0000-4000-8000-000000000001', 'CRM 0192 tenant', 'crm-0192-one');
insert into branches(id, tenant_id, name, code) values
  ('01929100-0000-4000-8000-000000000001', '01929000-0000-4000-8000-000000000001', 'JewelOS 0192 A', 'C192A'),
  ('01929100-0000-4000-8000-000000000002', '01929000-0000-4000-8000-000000000001', 'JewelOS 0192 B', 'C192B');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('01929200-0000-4000-8000-000000000001', '01929000-0000-4000-8000-000000000001', '01929100-0000-4000-8000-000000000001', 'Dept 0192 A', 'C192DA'),
  ('01929200-0000-4000-8000-000000000002', '01929000-0000-4000-8000-000000000001', '01929100-0000-4000-8000-000000000002', 'Dept 0192 B', 'C192DB');
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
values
  ('01929400-0000-4000-8000-000000000001', '01929300-0000-4000-8000-000000000001', '01929000-0000-4000-8000-000000000001', '01929100-0000-4000-8000-000000000001', '01929200-0000-4000-8000-000000000001', 'CRM 0192 Sales A', '0000019200', 'crm-0192-sales-a@example.invalid', 'C192-1', 'crm', 'active', 'active', true, '{}'),
  ('01929400-0000-4000-8000-000000000002', '01929300-0000-4000-8000-000000000002', '01929000-0000-4000-8000-000000000001', '01929100-0000-4000-8000-000000000002', '01929200-0000-4000-8000-000000000002', 'CRM 0192 Sales B', '0000019201', 'crm-0192-sales-b@example.invalid', 'C192-2', 'crm', 'active', 'active', true, '{}'),
  ('01929400-0000-4000-8000-000000000003', '01929300-0000-4000-8000-000000000003', '01929000-0000-4000-8000-000000000001', '01929100-0000-4000-8000-000000000001', '01929200-0000-4000-8000-000000000001', 'CRM 0192 Manager A', '0000019202', 'crm-0192-manager-a@example.invalid', 'C192-3', 'manager', 'active', 'active', true, '{}');
insert into crm.branches(id, name, jewelos_branch_id) values
  ('01929500-0000-4000-8000-000000000001', 'CRM 0192 Branch A', '01929100-0000-4000-8000-000000000001'),
  ('01929500-0000-4000-8000-000000000002', 'CRM 0192 Branch B', '01929100-0000-4000-8000-000000000002');
insert into crm.users(id, name, email, role, branch_id, jewelos_profile_id) values
  ('01929600-0000-4000-8000-000000000001', 'CRM 0192 Sales A', 'crm-0192-u-sales-a@example.invalid', 'salesperson', '01929500-0000-4000-8000-000000000001', '01929400-0000-4000-8000-000000000001'),
  ('01929600-0000-4000-8000-000000000002', 'CRM 0192 Sales B', 'crm-0192-u-sales-b@example.invalid', 'salesperson', '01929500-0000-4000-8000-000000000002', '01929400-0000-4000-8000-000000000002'),
  ('01929600-0000-4000-8000-000000000003', 'CRM 0192 Manager A', 'crm-0192-u-manager-a@example.invalid', 'branch_manager', '01929500-0000-4000-8000-000000000001', '01929400-0000-4000-8000-000000000003');
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id) values
  ('01929700-0000-4000-8000-000000000001', 'CRM 0192 Client A', '9019200001', '01929500-0000-4000-8000-000000000001'),
  ('01929700-0000-4000-8000-000000000002', 'CRM 0192 Client B', '9019200002', '01929500-0000-4000-8000-000000000002');
insert into crm.client_timeline(id, client_id, event_date, buy_status, branch_id, salesperson_id) values
  ('01929800-0000-4000-8000-000000000001', '01929700-0000-4000-8000-000000000001', '2026-09-01T10:00:00Z', 'NO', '01929500-0000-4000-8000-000000000001', '01929600-0000-4000-8000-000000000001'),
  ('01929800-0000-4000-8000-000000000002', '01929700-0000-4000-8000-000000000002', '2026-09-01T10:00:00Z', 'NO', '01929500-0000-4000-8000-000000000002', '01929600-0000-4000-8000-000000000002');
insert into crm.visit_forms(id, client_timeline_id) values
  ('01929900-0000-4000-8000-000000000001', '01929800-0000-4000-8000-000000000001'),
  ('01929900-0000-4000-8000-000000000002', '01929800-0000-4000-8000-000000000002');
insert into crm.referrals(id, salesperson_id, given_by_client_id, referral_name, referral_number, branch_id) values
  ('01929a00-0000-4000-8000-000000000001', '01929600-0000-4000-8000-000000000001', '01929700-0000-4000-8000-000000000001', 'Referral A', '9019200011', '01929500-0000-4000-8000-000000000001'),
  ('01929a00-0000-4000-8000-000000000002', '01929600-0000-4000-8000-000000000002', '01929700-0000-4000-8000-000000000002', 'Referral B', '9019200012', '01929500-0000-4000-8000-000000000002');
insert into crm.leads(id, phone_number, created_by, branch_id) values
  ('01929b00-0000-4000-8000-000000000001', '9019200021', '01929600-0000-4000-8000-000000000001', '01929500-0000-4000-8000-000000000001'),
  ('01929b00-0000-4000-8000-000000000002', '9019200022', '01929600-0000-4000-8000-000000000002', '01929500-0000-4000-8000-000000000002');
insert into crm.crm_daily_availability(id, branch_id, crm_name, date) values
  ('01929c00-0000-4000-8000-000000000001', '01929500-0000-4000-8000-000000000001', 'ANU 0192', '2026-09-01'),
  ('01929c00-0000-4000-8000-000000000002', '01929500-0000-4000-8000-000000000002', 'BINA 0192', '2026-09-01');

set local role authenticated;
select set_config('request.jwt.claim.sub', '01929300-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from crm.client_timeline where id in ('01929800-0000-4000-8000-000000000001', '01929800-0000-4000-8000-000000000002')),
  2, 'salesperson A reads client_timeline of both branches (company-wide read)');
select is((select count(*)::integer from crm.visit_forms where id in ('01929900-0000-4000-8000-000000000001', '01929900-0000-4000-8000-000000000002')),
  2, 'salesperson A reads visit_forms of both branches (company-wide read)');
select is((select count(*)::integer from crm.referrals where id in ('01929a00-0000-4000-8000-000000000001', '01929a00-0000-4000-8000-000000000002')),
  2, 'salesperson A reads referrals of both branches (company-wide read)');
select is((select count(*)::integer from crm.leads where id in ('01929b00-0000-4000-8000-000000000001', '01929b00-0000-4000-8000-000000000002')),
  2, 'salesperson A reads leads of both branches (company-wide read)');
select is((select count(*)::integer from crm.crm_daily_availability where id in ('01929c00-0000-4000-8000-000000000001', '01929c00-0000-4000-8000-000000000002')),
  1, 'salesperson A reads only its own branch''s crm_daily_availability (branch-scoped read)');
select throws_ok($$insert into crm.crm_daily_availability(branch_id, crm_name, date) values ('01929500-0000-4000-8000-000000000001', 'BLOCKED', '2026-09-02')$$,
  '42501', null, 'salesperson cannot write crm_daily_availability at all (branch_manager only)');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '01929300-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from crm.crm_daily_availability where id in ('01929c00-0000-4000-8000-000000000001', '01929c00-0000-4000-8000-000000000002')),
  1, 'branch_manager A reads only its own branch''s crm_daily_availability, not branch B''s');
select lives_ok($$insert into crm.crm_daily_availability(branch_id, crm_name, date) values ('01929500-0000-4000-8000-000000000001', 'MANAGER OWN', '2026-09-02')$$,
  'branch_manager A writes its own branch''s crm_daily_availability');
select throws_ok($$insert into crm.crm_daily_availability(branch_id, crm_name, date) values ('01929500-0000-4000-8000-000000000002', 'MANAGER OTHER', '2026-09-02')$$,
  '42501', null, 'branch_manager A cannot write branch B''s crm_daily_availability');
-- RLS filters branch B's row out of the UPDATE's own view, so it affects 0 rows rather
-- than raising; confirm the no-op directly instead of expecting an error code.
update crm.crm_daily_availability set is_available = false where id = '01929c00-0000-4000-8000-000000000002';
reset role;
select is((select is_available from crm.crm_daily_availability where id = '01929c00-0000-4000-8000-000000000002'),
  true, 'branch B''s crm_daily_availability is unchanged by branch_manager A''s update attempt');

select * from finish();
rollback;
