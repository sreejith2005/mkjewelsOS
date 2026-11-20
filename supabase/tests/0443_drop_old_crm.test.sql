-- 0443: the old CRM is gone from the JewelOS database; shared functions keep working.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select is((select count(*) from pg_namespace where nspname in ('crm', 'crm_private', 'crm_sync')), 0::bigint, 'the crm, crm_private and crm_sync schemas are gone');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and (c.relname in ('clients', 'client_assignments', 'client_contact_aliases', 'client_followups', 'client_timeline',
                                 'walkin_entries', 'walkin_uploads', 'customer_export_layouts', 'form_customer_mapping_versions')
                   or c.relname like 'crm\_%')), 0::bigint, 'the legacy CRM tables are gone');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname ~ '^(create|update|merge|reassign|search|lookup|get)_crm_|^crm_sync_|^customer_integration_|^recorder_link'), 0::bigint,
  'the old CRM, sync and integration functions are gone');
select is((select count(*) from pg_trigger t where not t.tgisinternal and t.tgname ~ '^crm_(sync|master)_|^customer_(mapping|submission|stage|lifecycle)_'), 0::bigint,
  'no CRM sync trigger is left on a shared table');
select is((select count(*) from pg_policies where schemaname = 'storage' and policyname ~ '^crm_'), 0::bigint, 'the CRM storage policies are gone');
select is((select count(*) from pg_proc where proname ~ '^_retire_crm_'), 0::bigint, 'the migration helpers are gone');

-- Shared functions that read the CRM before.
select ok(pg_get_functiondef('public.get_dashboard_metrics(jsonb)'::regprocedure) !~ 'client_followups|walkin_entries|can_read_crm_client', 'Dashboard has no CRM counts');
select ok(pg_get_functiondef('public.get_home_summary(jsonb)'::regprocedure) ~ 'v_followups:=''\[\]''::jsonb', 'Home keeps crm_followups as an empty list');
select ok(pg_get_functiondef('public.report_rows_for_profile_v1(uuid,text,jsonb,integer,integer)'::regprocedure) !~ 'crm_clients_ownership|client_in_reporting_scope', 'report v1 has no CRM keys');
select ok(pg_get_functiondef('public.reconcile_all_assignment_coverage_with_audit(uuid,date,text)'::regprocedure) !~ 'client_followups'
      and pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure) !~ 'client_followups'
      and pg_get_functiondef('public.sync_leave_half_day_tasks(timestamptz)'::regprocedure) !~ 'client_followups'
      and pg_get_functiondef('public.restore_deleted_leave_coverage(uuid,date)'::regprocedure) !~ 'client_followups'
      and pg_get_functiondef('public.record_availability_range_with_audit(uuid,date,date,availability_status,text)'::regprocedure) !~ 'client_followups'
      and pg_get_functiondef('public.normalize_coverage_notification_event()'::regprocedure) !~ 'client_followups',
  'leave coverage no longer moves CRM follow-ups');
select ok(pg_get_functiondef('public.protect_dropdown_master_identity()'::regprocedure) !~ 'walkin_entries|from clients', 'dropdown protection no longer reads CRM tables');
select ok(pg_get_functiondef('public.assign_branch_franchise_with_audit(uuid,uuid,text,text)'::regprocedure) !~ 'org_resend_crm_roster'
      and pg_get_functiondef('public.set_franchise_enforcement_with_audit(boolean,text)'::regprocedure) !~ 'org_resend_crm_roster',
  'franchise changes no longer resend a CRM roster');
select is(recording_link_sync_state(gen_random_uuid()), 'not_queued', 'Store Intelligence queues nothing for a CRM');
select ok(pg_get_functiondef('public.recording_session_integration(uuid)'::regprocedure) ~ '''can_link'',false', 'Store Intelligence offers no CRM linking');
select is(form_reachable_sections(gen_random_uuid(), '{}'::jsonb), null::text[], 'form section visibility works without crm_sync');

-- The export worker refuses the retired customer exports.
do $$
declare t uuid; b uuid; d uuid; v_auth uuid := gen_random_uuid(); v_profile uuid; v_export uuid;
begin
  insert into tenants(name, slug) values ('0443 test', 'crm-0443') returning id into t;
  insert into branches(tenant_id, name, code) values (t, '0443 Store', 'S0443') returning id into b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Sales', 'D0443') returning id into d;
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_auth, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export-0443@test.local', 'x', now(), now());
  insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
  values (t, v_auth, b, d, '0443 Admin', 'E0443', 'export-0443@test.local', 'super_admin', 'active', 'active', true) returning id into v_profile;
  insert into export_logs(tenant_id, user_profile_id, report_key, status, filter_snapshot, request_key)
  values (t, v_profile, 'customer_master', 'processing', '{}'::jsonb, gen_random_uuid()) returning id into v_export;
  perform set_config('test.export_id', v_export::text, true);
end $$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(format('select get_report_export_batch(%L, 0, 10)', current_setting('test.export_id')), '22023', 'Customer exports were retired with the old CRM (0443)',
  'a customer export is refused');

select * from finish();
rollback;
