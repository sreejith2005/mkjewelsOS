-- 0443: the old CRM is removed from the JewelOS database.
--
-- Owner decisions 2026-11-20: the customer master database (schema customer)
-- is the only customer data; the old CRM screens were removed in #137 (0441).
-- This change removes what is left of the old CRM in this project:
--
-- * schemas crm, crm_private and crm_sync (the CRM ported into JewelOS, and
--   the outbox/inbox that synced JewelOS with the CRM project), with their
--   triggers on shared tables (staff roster, dropdowns, branches, form and FMS
--   customer capture) and the crm-legacy-documents storage policies;
-- * the legacy public CRM tables (clients, client_*, walkin_*, crm_*), the
--   retired Forms -> CRM integration tables (form_customer_mapping_versions,
--   customer_export_layouts) and the crm-documents storage policies;
-- * every function that only served them (93, listed below);
-- * the cron jobs that called the CRM sync functions.
--
-- Shared functions keep working without the CRM part: Dashboard and Home
-- (no CRM counts; Home's crm_followups is an empty list), report v1 (the four
-- crm_* report keys), leave coverage (no CRM follow-ups to move), dropdown
-- protection, demo-data counts, FMS flow removal, form section visibility,
-- the report export worker (customer_* exports refused), franchise changes
-- (no CRM roster resend) and Store Intelligence (customer links stay as
-- history; nothing is synced to a CRM any more).
--
-- Kept on purpose: Store Intelligence's recording_customer_links and
-- recording_crm_outcomes (history), FMS's own CRM hand-over, the 'crm'
-- section switch and crm.view (they now open the Customers page).
--
-- BEFORE APPLYING (owner): take the backup described in the pull request. The
-- files in the storage buckets crm-documents and crm-legacy-documents are not
-- deleted here (Supabase deletes bucket files only through its Storage API);
-- they become unreachable from the app and are deleted from the dashboard
-- after the backup.

create function public._retire_crm_patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0443: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- Replaces the text from p_from (which must occur once) up to, not including,
-- the first p_upto after it.
create function public._retire_crm_splice(p_function regprocedure, p_from text, p_upto text, p_new text)
returns void language plpgsql as $$
declare body text; a integer; b integer; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_from, ''))) / length(p_from);
  if found <> 1 then raise exception '0443: expected 1 match of "%" in %, found %', left(p_from, 80), p_function, found; end if;
  a := strpos(body, p_from);
  b := strpos(substr(body, a + length(p_from)), p_upto);
  if b = 0 then raise exception '0443: "%" not found after "%" in %', left(p_upto, 80), left(p_from, 80), p_function; end if;
  b := a + length(p_from) + b - 1;
  execute substr(body, 1, a - 1) || p_new || substr(body, b);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Shared functions lose their CRM part
-- ---------------------------------------------------------------------------

-- Dashboard: no CRM counts (the client stopped showing them on 2026-10-30).
select public._retire_crm_splice('public.get_dashboard_metrics(jsonb)'::regprocedure,
  E'  if v_actor.user_role in (''super_admin'',''admin'',''manager'',''crm'') then\n',
  E'  if v_actor.user_role in (''super_admin'',''admin'',''manager'',''hr'') then', '');

-- Home: crm_followups stays in the answer as an empty list.
select public._retire_crm_splice('public.get_home_summary(jsonb)'::regprocedure,
  E'  select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.due_date nulls last,q.id),''[]''::jsonb) into v_followups',
  E'  select count(*)::integer into v_unread',
  E'  -- The old CRM follow-ups were removed with the CRM (0443).\n  v_followups:=''[]''::jsonb;\n\n');

-- Report v1: the four crm_* keys (removed from the catalogue on 2026-11-20).
select public._retire_crm_splice('public.report_rows_for_profile_v1(uuid,text,jsonb,integer,integer)'::regprocedure,
  E'  elsif p_report_key=''crm_clients_ownership'' then\n',
  E'  elsif p_report_key=''people_availability'' then', '');

-- Demo-data counts.
select public._retire_crm_patch('public.demo_data_purge_counts(uuid)'::regprocedure,
  E'      ''clients'', (select count(*) from public.clients where tenant_id = v_tenant),\n      ''crm_documents'', (select count(*) from public.crm_documents where tenant_id = v_tenant),\n', '', 1);
select public._retire_crm_patch('public.production_demo_data_retirement_manifest(uuid)'::regprocedure,
  E'      ''clients'', (select count(*) from public.clients where tenant_id = p_tenant_id),\n      ''crm_documents'', (select count(*) from public.crm_documents where tenant_id = p_tenant_id),\n', '', 1);

-- Dropdown codes are no longer referenced by CRM clients or walk-ins.
select public._retire_crm_splice('public.protect_dropdown_master_identity()'::regprocedure,
  E'      or exists(select 1 from clients where ',
  E'      or exists(select 1 from task_instances where category_id=old.id)', '');

-- Leave coverage: there are no CRM follow-ups to move or restore.
select public._retire_crm_splice('public.normalize_coverage_notification_event()'::regprocedure,
  E'  elsif new.source_module=''crm'' and new.event_type=''followup_created'' then\n',
  E'  end if;\n  return new;', '');
select public._retire_crm_splice('public.reconcile_all_assignment_coverage_with_audit(uuid,date,text)'::regprocedure,
  E'  for v_followup in select * from client_followups ', E'  for v_stage in select', '');
select public._retire_crm_splice('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure,
  E'  for v_followup in select cf.* from client_followups cf', E'  for v_stage in\n', '');
select public._retire_crm_patch('public.record_availability_range_with_audit(uuid,date,date,availability_status,text)'::regprocedure,
  E'    union all select coverage_resolution from client_followups where coverage_original_assignee_id=p_user_profile_id\n      and coverage_resolved_for_date between p_start_date and p_end_date\n', '', 1);
select public._retire_crm_splice('public.restore_deleted_leave_coverage(uuid,date)'::regprocedure,
  E'  for f in select * from client_followups ', E'  for s in select', '');
select public._retire_crm_patch('public.restore_deleted_leave_coverage(uuid,date)'::regprocedure, ' f client_followups;', '', 1);
select public._retire_crm_splice('public.sync_leave_half_day_tasks(timestamptz)'::regprocedure,
  E'    for v_followup in select * from client_followups f', E'    for v_stage in select', '');
select public._retire_crm_patch('public.sync_leave_half_day_tasks(timestamptz)'::regprocedure, ' v_followup client_followups;', '', 1);

-- Franchise readiness: no legacy CRM clients to count.
select public._retire_crm_patch('public.get_franchise_readiness_report()'::regprocedure,
  E'      ''notifications'', (select count(*) from notifications where tenant_id = a.tenant_id and branch_id is null),\n      ''clients'', (select count(*) from clients where tenant_id = a.tenant_id and branch_id is null)),',
  E'      ''notifications'', (select count(*) from notifications where tenant_id = a.tenant_id and branch_id is null)),', 1);

-- FMS flow removal no longer clears CRM workflow links.
select public._retire_crm_patch('public.remove_fms_flow_rows(uuid)'::regprocedure,
  E'  delete from crm_sync.customer_workflow_links where instance_id = any(v_instances);\n', '', 1);

-- Franchise changes no longer resend the CRM staff roster.
select public._retire_crm_patch('public.assign_branch_franchise_with_audit(uuid,uuid,text,text)'::regprocedure,
  E'  if org_scope_enforced(a.tenant_id) then perform org_resend_crm_roster(a.tenant_id); end if;\n', '', 1);
select public._retire_crm_patch('public.set_franchise_enforcement_with_audit(boolean,text)'::regprocedure,
  E'  if p_enabled is distinct from v_old then perform org_resend_crm_roster(a.tenant_id); end if;\n', '', 1);

-- Store Intelligence: links stay as history; nothing is queued for a CRM.
select public._retire_crm_patch('public.recording_integration_health()'::regprocedure,
  E'  ev as (select e.* from crm_sync.recording_events e join ses on ses.id=e.session_id)',
  E'  ev as (select null::timestamptz as delivered_at, null::timestamptz as rejected_at, null::timestamptz as dead_at, null::timestamptz as held_at, null::timestamptz as created_at where false)', 1);
select public._retire_crm_patch('public.recording_session_integration(uuid)'::regprocedure,
  E'''can_link'',has_permission(''crm.view'') and (s.employee_id=a.id or reviewer),', E'''can_link'',false,', 1);
select public._retire_crm_patch('public.recording_session_integration(uuid)'::regprocedure,
  E'(select e.last_error from crm_sync.recording_events e where e.link_id=live.id and e.event_type=''store_conversation.linked'')', 'null::text', 1);
select public._retire_crm_patch('public.recording_session_integration(uuid)'::regprocedure,
  E'(select e.attempts from crm_sync.recording_events e where e.link_id=live.id and e.event_type=''store_conversation.linked'')', 'null::integer', 1);
select public._retire_crm_patch('public.recording_session_integration(uuid)'::regprocedure,
  E'(select case when e.delivered_at is not null then ''synced'' when e.dead_at is not null then ''failed'' else ''queued'' end\n      from crm_sync.recording_events e where e.link_id=l.id and e.event_type=''store_conversation.unlinked'')', 'null::text', 1);

create or replace function public.recording_link_sync_state(p_link uuid)
returns text language sql stable security definer set search_path = public as $$
  -- Nothing is synced to a CRM since 0443.
  select 'not_queued'::text
$$;

-- Form section visibility (was crm_sync.snapshot_reachable_sections).
create or replace function public.form_reachable_sections(p_template_id uuid, p_answers jsonb)
returns text[] language sql stable set search_path = public as $$
  select case when jsonb_array_length(coalesce(s#>'{template,sections}', '[]')) = 0 then null
              else array(select jsonb_array_elements_text(form_snapshot_active_path(s, p_answers)->'sections')) end
    from (select jsonb_build_object('template', to_jsonb(t), 'fields', coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order, f.id)
            from form_fields f where f.form_template_id = t.id), '[]')) as s
            from form_templates t where t.id = p_template_id) x;
$$;

select public._retire_crm_patch('public.report_field_visible(jsonb,jsonb)'::regprocedure,
  '  -- Same visibility test as the customer sync (crm_sync.capture_customer_submission).',
  '  -- A hidden question (switched off, or its condition not met) is blank in reports.', 1);

-- Export worker: customer_* exports (the Forms -> CRM integration) are refused.
select public._retire_crm_splice('public.get_report_export_batch(uuid,integer,integer)'::regprocedure,
  E' if p_offset<0 or p_limit not between 1 and 1000',
  E'exception when others then',
  E' raise exception ''Customer exports were retired with the old CRM (0443)'' using errcode=''22023'';\n');

-- ---------------------------------------------------------------------------
-- 2. Cron jobs that called the CRM sync functions
-- ---------------------------------------------------------------------------
do $$
declare j record;
begin
  if to_regclass('cron.job') is null then return; end if;
  for j in execute $q$select jobid, jobname from cron.job
     where command ~ '(crm-staff-sync|crm-customer-sync|crm-walkin-ingest|crm-runo-push|crm-sync-receive|detect_crm_followup_events|crm_sync)'$q$ loop
    perform cron.unschedule(j.jobid);
    raise notice '0443: unscheduled cron job % (%)', j.jobid, j.jobname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Storage policies of the two CRM buckets (files are deleted by the owner)
-- ---------------------------------------------------------------------------
drop policy if exists crm_document_objects_select on storage.objects;
drop policy if exists crm_document_objects_insert on storage.objects;
drop policy if exists crm_document_objects_delete on storage.objects;
drop policy if exists crm_legacy_documents_active_staff_read on storage.objects;
drop policy if exists crm_legacy_documents_active_staff_upload on storage.objects;
drop policy if exists crm_legacy_documents_lead_call_recordings_upload on storage.objects;
drop policy if exists crm_legacy_documents_uploader_or_admin_delete on storage.objects;

-- ---------------------------------------------------------------------------
-- 4. Tables and schemas
-- ---------------------------------------------------------------------------
-- The sync triggers on shared tables go with crm_sync (CASCADE drops only
-- those triggers outside the three schemas; checked by the 0443 test).
drop schema crm_sync cascade;
drop schema crm_private cascade;
drop schema crm cascade;

drop table public.client_assignments, public.client_contact_aliases, public.client_followups, public.client_timeline,
  public.clients, public.crm_branch_mappings, public.crm_custom_field_values, public.crm_documents,
  public.crm_field_definition_revisions, public.crm_field_definitions, public.crm_form_binding_versions,
  public.crm_form_bindings, public.crm_identity_review, public.crm_import_exceptions, public.crm_import_records,
  public.crm_import_runs, public.crm_legacy_people, public.crm_legacy_timeline_details, public.crm_mutation_keys,
  public.crm_source_records, public.crm_source_systems, public.crm_staff_mappings, public.crm_sync_checkpoints,
  public.crm_sync_operation_requests, public.crm_sync_runs, public.crm_sync_worker_assertions,
  public.customer_export_layouts, public.form_customer_mapping_versions, public.walkin_entries, public.walkin_uploads;

-- ---------------------------------------------------------------------------
-- 5. Functions that only served the old CRM
-- ---------------------------------------------------------------------------
drop function public.apply_crm_followup_coverage();
drop function public.assert_active_crm_dropdown(p_id uuid, p_tenant uuid, p_type text, p_required boolean);
drop function public.assert_crm_actor();
drop function public.assert_crm_branch_user(p_user_id uuid, p_tenant_id uuid, p_branch_id uuid, p_purpose text);
drop function public.assert_crm_sync_worker(p_source_key text, p_scope_key text, p_assertion jsonb);
drop function public.begin_crm_sync_run(p_source_key text, p_scope_key text, p_request_key uuid, p_worker_assertion jsonb);
drop function public.can_delete_crm_document_object(p_name text);
drop function public.can_read_crm_client(p_client_id uuid);
drop function public.can_read_crm_document_object(p_name text);
drop function public.can_write_crm_document_object(p_name text);
drop function public.cancel_crm_followup(p_followup_id uuid, p_reason text, p_expected_version integer, p_request_key uuid);
drop function public.clear_crm_form_binding(p_purpose text, p_expected_version_id uuid);
drop function public.client_in_reporting_scope(p_actor user_profiles, p_client_id uuid, p_context jsonb);
drop function public.complete_crm_followup(p_followup_id uuid, p_outcome text, p_expected_version integer, p_request_key uuid);
drop function public.correct_crm_interaction(p_interaction_id uuid, p_correction jsonb, p_request_key uuid);
drop function public.create_crm_client(p_input jsonb, p_request_key uuid);
drop function public.create_crm_field_definition(p_entity_type text, p_field_key text, p_label text, p_field_type text, p_options jsonb, p_required boolean, p_validation jsonb);
drop function public.create_crm_followup(p_client_id uuid, p_input jsonb, p_request_key uuid);
drop function public.crm_form_binding_actor();
drop function public.crm_form_binding_immutable();
drop function public.crm_form_published_definition(p_tenant uuid, p_family uuid);
drop function public.crm_sync_apply_submission_event(p_event_id text, p_payload jsonb);
drop function public.crm_sync_apply_walkin(p_event_id text, p_snapshot jsonb);
drop function public.crm_sync_claim_customer_events(p_limit integer);
drop function public.crm_sync_claim_customer_mappings(p_limit integer);
drop function public.crm_sync_claim_recording_events(p_limit integer);
drop function public.crm_sync_claim_recording_outcome_checks(p_limit integer);
drop function public.crm_sync_claim_staff_events(p_limit integer);
drop function public.crm_sync_finish_customer_event(p_id uuid, p_lease uuid, p_result jsonb, p_error text);
drop function public.crm_sync_finish_recording_event(p_id uuid, p_lease uuid, p_result jsonb, p_error text);
drop function public.crm_sync_finish_staff_event(p_event_id bigint, p_ok boolean, p_error text);
drop function public.crm_sync_health();
drop function public.crm_sync_record_customer_mapping(p_mapping_id uuid, p_outcome text);
drop function public.crm_sync_record_operation(p_tenant_id uuid, p_assertion_id uuid, p_run_id uuid, p_operation text, p_request_key uuid, p_fingerprint text, p_response jsonb);
drop function public.crm_sync_record_recording_outcomes(p_tenant uuid, p_results jsonb);
drop function public.crm_sync_replay_operation(p_tenant_id uuid, p_assertion_id uuid, p_run_id uuid, p_operation text, p_request_key uuid, p_fingerprint text);
drop function public.crm_sync_request_fingerprint(p_operation text, p_payload jsonb);
drop function public.crm_sync_staff_roster();
drop function public.customer_export_options(p_flow uuid);
drop function public.customer_integration_health();
drop function public.customer_integration_overview();
drop function public.detect_crm_followup_events(p_limit integer, p_now timestamp with time zone);
drop function public.enrich_legacy_crm_timeline_visit_form(p_source_key text, p_external_id text, p_payload jsonb, p_source_checksum text);
drop function public.export_customer_stage_answers(p_filters jsonb, p_before timestamp with time zone, p_before_id uuid, p_limit integer);
drop function public.fail_crm_sync_run(p_run_id uuid, p_safe_error_code text, p_request_key uuid, p_worker_assertion jsonb);
drop function public.finalize_crm_sync_run(p_run_id uuid, p_checkpoint jsonb, p_request_key uuid, p_worker_assertion jsonb);
drop function public.fms_trigger_reconcile_crm_case(p_tenant uuid, p_case uuid, p_status text, p_event_id text);
drop function public.get_crm_client_detail(p_client_id uuid);
drop function public.get_crm_client_fms_runs(p_crm_client_id uuid);
drop function public.get_crm_document_path(p_document_id uuid);
drop function public.get_crm_form_bindings();
drop function public.get_crm_sync_checkpoint(p_source_key text, p_scope_key text, p_worker_assertion jsonb);
drop function public.get_customer_export_layouts();
drop function public.get_fms_customer_link(p_instance_id uuid);
drop function public.get_fms_customer_sync_status(p_instance_id uuid);
drop function public.get_form_customer_mapping(p_template_id uuid);
drop function public.import_legacy_crm_client(p_source_key text, p_external_id text, p_payload jsonb, p_source_checksum text, p_import_run_id uuid);
drop function public.import_legacy_crm_timeline(p_source_key text, p_external_id text, p_client_external_id text, p_payload jsonb, p_source_checksum text, p_import_run_id uuid);
drop function public.ingest_crm_source_batch(p_run_id uuid, p_source_key text, p_scope_key text, p_rows jsonb, p_request_key uuid, p_worker_assertion jsonb);
drop function public.link_crm_record(p_client_id uuid, p_module text, p_record_id uuid, p_request_key uuid);
drop function public.list_crm_followups(p_filter jsonb);
drop function public.log_crm_interaction(p_client_id uuid, p_input jsonb, p_request_key uuid);
drop function public.lookup_crm_client_by_phone(p_phone text);
drop function public.merge_crm_clients(p_survivor_id uuid, p_duplicate_id uuid, p_request_key uuid);
drop function public.notify_crm_followup_assignment();
drop function public.org_resend_crm_roster(p_tenant_id uuid);
drop function public.preserve_legacy_crm_timeline_visit_form(p_source_key text, p_external_id text, p_payload jsonb, p_source_checksum text);
drop function public.prevent_crm_timeline_mutation();
drop function public.reassign_crm_client(p_client_id uuid, p_assigned_crm_id uuid, p_branch_id uuid, p_expected_version integer, p_request_key uuid);
drop function public.reconcile_customer_submissions(p_mapping_id uuid, p_ids uuid[], p_apply boolean, p_expected_digest text);
drop function public.record_crm_walkin(p_input jsonb, p_request_key uuid);
drop function public.recorder_link_customer(p_session_id uuid, p_customer_ref text);
drop function public.recorder_linkable_walkins();
drop function public.recording_enqueue_crm_event(l recording_customer_links, p_type text, p_reason text);
drop function public.recording_insert_link(s recorder_sessions, p_actor uuid, p_kind text, p_target uuid, p_basis text, p_candidates integer, p_code text, p_name text, p_source text, p_request uuid, p_replaces uuid, p_reason text);
drop function public.recording_link_crm_customer(p_session_id uuid, p_target jsonb, p_request_key uuid, p_reason text);
drop function public.recording_retry_crm_sync(p_session_id uuid);
drop function public.recording_unlink_crm_customer(p_session_id uuid, p_reason text);
drop function public.refresh_crm_client_rollups(p_client_id uuid);
drop function public.register_crm_document(p_client_id uuid, p_parent_type text, p_parent_id uuid, p_storage_path text, p_original_filename text, p_mime_type text, p_size_bytes bigint, p_request_key uuid);
drop function public.remove_crm_document(p_document_id uuid, p_reason text, p_request_key uuid);
drop function public.request_customer_export(p_key text, p_filters jsonb, p_request_key uuid);
drop function public.reschedule_crm_followup(p_followup_id uuid, p_due_date date, p_assigned_to uuid, p_reason text, p_expected_version integer, p_request_key uuid);
drop function public.retry_customer_events(p_ids uuid[]);
drop function public.save_crm_form_binding(p_purpose text, p_form_family_id uuid, p_field_map jsonb, p_expected_version_id uuid);
drop function public.save_customer_export_layout(p_name text, p_configuration jsonb);
drop function public.save_form_customer_mapping(p_template_id uuid, p_config jsonb);
drop function public.save_historical_customer_mapping(p_submission_id uuid, p_config jsonb);
drop function public.search_crm_clients(p_filter jsonb);
drop function public.sync_crm_contacts(p_client_id uuid, p_actor uuid);
drop function public.update_crm_client(p_client_id uuid, p_changes jsonb, p_expected_version integer, p_request_key uuid);
drop function public.upsert_crm_branch_mapping(p_source_key text, p_external_branch_id text, p_branch_id uuid, p_metadata jsonb);
drop function public.upsert_crm_staff_mapping(p_source_key text, p_external_staff_id text, p_user_profile_id uuid, p_metadata jsonb);

drop function public._retire_crm_patch(regprocedure, text, text, integer);
drop function public._retire_crm_splice(regprocedure, text, text, text);
