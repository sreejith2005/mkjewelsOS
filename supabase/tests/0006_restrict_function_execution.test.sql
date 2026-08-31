begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

-- The linked project has this postgres-owned platform helper, while a fresh
-- local Supabase stack does not. Create it transactionally to reproduce the
-- linked baseline matrix plus the explicitly reviewed Phase 4A Forms functions.
create function rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  null;
end;
$$;

-- Future postgres-owned public functions receive no API-role execution.
select ok(not exists (
  select 1
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where p.oid = 'rls_auto_enable()'::regprocedure
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
), 'future postgres-owned public functions do not grant EXECUTE to PUBLIC');
select ok(not has_function_privilege('anon', 'rls_auto_enable()', 'EXECUTE'), 'future public functions do not default-grant anon');
select ok(not has_function_privilege('authenticated', 'rls_auto_enable()', 'EXECUTE'), 'future public functions do not default-grant authenticated');
select ok(not has_function_privilege('service_role', 'rls_auto_enable()', 'EXECUTE'), 'future public functions do not default-grant service_role');

-- Current application-function matrix, including the linked-only helper above.
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
), 305, 'exactly 305 postgres-owned public application functions exist in the current migration set');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres' and p.prosecdef
), 254, 'exactly 254 public application functions are SECURITY DEFINER in the current migration set');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
), 0, 'anon can execute exactly zero public application functions');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
), 153, 'authenticated can execute exactly 153 reviewed public application functions');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
), 44, 'service_role can execute exactly 44 reviewed public application functions');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('postgres', p.oid, 'EXECUTE')
), 305, 'postgres retains owner execution on every public application function');

-- Exact authenticated allowlist: baseline, Forms, and reviewed FMS entry points.
select ok(has_function_privilege('authenticated', 'current_profile()', 'EXECUTE'), 'authenticated executes current_profile');
select ok(has_function_privilege('authenticated', 'current_role_level()', 'EXECUTE'), 'authenticated executes current_role_level');
select ok(has_function_privilege('authenticated', 'current_tenant_id()', 'EXECUTE'), 'authenticated executes current_tenant_id');
select ok(has_function_privilege('authenticated', 'current_branch_id()', 'EXECUTE'), 'authenticated executes current_branch_id');
select ok(has_function_privilege('authenticated', 'is_super_admin()', 'EXECUTE'), 'authenticated executes is_super_admin');
select ok(has_function_privilege('authenticated', 'current_profile_is_active()', 'EXECUTE'), 'authenticated executes current_profile_is_active');
select ok(has_function_privilege('authenticated', 'is_task_participant(uuid)', 'EXECUTE'), 'authenticated executes is_task_participant');
select ok(has_function_privilege('authenticated', 'is_task_watcher(uuid)', 'EXECUTE'), 'authenticated executes is_task_watcher');
select ok(has_function_privilege('authenticated', 'can_read_task(uuid)', 'EXECUTE'), 'authenticated executes can_read_task');
select ok(has_function_privilege('authenticated', 'is_fms_instance_participant(uuid)', 'EXECUTE'), 'authenticated executes is_fms_instance_participant');
select ok(has_function_privilege('authenticated', 'can_write_task_attachment_object(text)', 'EXECUTE'), 'authenticated executes can_write_task_attachment_object');
select ok(has_function_privilege('authenticated', 'can_read_task_attachment_object(text)', 'EXECUTE'), 'authenticated executes can_read_task_attachment_object');
select ok(has_function_privilege('authenticated', 'can_delete_unrecorded_task_attachment_object(text)', 'EXECUTE'), 'authenticated executes can_delete_unrecorded_task_attachment_object');
select ok(has_function_privilege('authenticated', 'update_user_profile_with_audit(uuid,jsonb)', 'EXECUTE'), 'authenticated executes update_user_profile_with_audit');
select ok(has_function_privilege('authenticated', 'submit_resignation_with_audit(uuid,jsonb,jsonb)', 'EXECUTE'), 'authenticated executes submit_resignation_with_audit');
select ok(has_function_privilege('authenticated', 'review_resignation_with_audit(uuid,text)', 'EXECUTE'), 'authenticated executes review_resignation_with_audit');
select ok(has_function_privilege('authenticated', 'change_dropdown_with_audit(text,uuid,text,text,text,integer,boolean)', 'EXECUTE'), 'authenticated executes change_dropdown_with_audit');
select ok(has_function_privilege('authenticated', 'save_task_template_with_audit(uuid,jsonb)', 'EXECUTE'), 'authenticated executes save_task_template_with_audit');
select ok(has_function_privilege('authenticated', 'create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)', 'EXECUTE'), 'authenticated executes create_delegation_task_with_audit');
select ok(has_function_privilege('authenticated', 'use_task_template_with_audit(uuid,timestamptz)', 'EXECUTE'), 'authenticated executes use_task_template_with_audit');
select ok(has_function_privilege('authenticated', 'update_task_with_audit(uuid,text,uuid,boolean,text)', 'EXECUTE'), 'authenticated executes update_task_with_audit');
select ok(has_function_privilege('authenticated', 'add_task_attachment_with_audit(uuid,text)', 'EXECUTE'), 'authenticated executes add_task_attachment_with_audit');
select ok(has_function_privilege('authenticated', 'delegate_task_with_audit(uuid,uuid,uuid,text)', 'EXECUTE'), 'authenticated executes delegate_task_with_audit');
select ok(has_function_privilege('authenticated', 'revise_task_datetime_with_audit(uuid,timestamptz,text)', 'EXECUTE'), 'authenticated executes revise_task_datetime_with_audit');
select ok(has_function_privilege('authenticated', 'record_availability_with_audit(uuid,date,availability_status,text)', 'EXECUTE'), 'authenticated executes record_availability_with_audit');

select is((
  with expected(identity) as (
    select unnest(array[
      'current_profile()', 'current_role_level()', 'current_tenant_id()', 'current_branch_id()',
      'is_super_admin()', 'current_profile_is_active()', 'is_task_participant(uuid)',
      'is_task_watcher(uuid)', 'can_read_task(uuid)', 'is_fms_instance_participant(uuid)',
      'can_write_task_attachment_object(text)', 'can_read_task_attachment_object(text)',
      'can_delete_unrecorded_task_attachment_object(text)',
      'update_user_profile_with_audit(uuid,jsonb)',
      'submit_resignation_with_audit(uuid,jsonb,jsonb)', 'review_resignation_with_audit(uuid,text)',
      'change_dropdown_with_audit(text,uuid,text,text,text,integer,boolean)',
      'save_task_template_with_audit(uuid,jsonb)',
      'create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
      'use_task_template_with_audit(uuid,timestamp with time zone)',
      'update_task_with_audit(uuid,text,uuid,boolean,text)',
      'add_task_attachment_with_audit(uuid,text)', 'delegate_task_with_audit(uuid,uuid,uuid,text)',
      'revise_task_datetime_with_audit(uuid,timestamp with time zone,text)',
      'record_availability_with_audit(uuid,date,availability_status,text)',
      'can_manage_form_template(uuid)', 'can_read_form_submission(uuid)',
      'can_access_form_template(uuid)',
      'save_form_draft_with_audit(uuid,jsonb,jsonb)',
      'create_form_revision_with_audit(uuid,jsonb)',
      'publish_form_with_audit(uuid)', 'archive_form_with_audit(uuid)',
      'submit_form_with_audit(uuid,jsonb,text,uuid)',
      'review_form_submission_with_audit(uuid,text,text)',
      'archive_fms_flow_with_audit(uuid,text)', 'can_manage_fms_flow(uuid)',
      'can_read_fms_evidence_object(text)', 'can_read_fms_instance(uuid)',
      'can_start_fms_flow(uuid,uuid,uuid)', 'can_write_fms_evidence_object(text)',
      'cancel_fms_instance_with_audit(uuid,text)', 'claim_fms_stage_with_audit(uuid)',
      'complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)',
      'create_fms_revision_with_audit(uuid)', 'escalate_fms_stage_with_audit(uuid,text)',
      'hold_fms_instance_with_audit(uuid,text)',
      'move_fms_stage_backward_with_audit(uuid,uuid,text,uuid)',
      'publish_fms_flow_with_audit(uuid)',
      'save_fms_context_assignee_default_with_audit(text,uuid)',
      'set_fms_flow_context_with_audit(uuid,text)',
      'reassign_fms_stage_with_audit(uuid,uuid,uuid,text)',
      'register_fms_evidence_with_audit(uuid,text,text,text,bigint)',
      'request_fms_revision_with_audit(uuid,uuid,text,uuid)',
      'resume_fms_instance_with_audit(uuid,text)',
      'review_fms_stage_with_audit(uuid,text,text,uuid)',
      'save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)',
      'start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)',
      'update_fms_checklist_item_with_audit(uuid,boolean)',
      'save_notification_template(uuid,text,text,text,text,text,text,boolean)',
      'archive_notification_template(uuid)',
      'save_notification_rule(uuid,text,text,jsonb,jsonb,jsonb,integer,integer,integer,integer,task_priority,boolean)',
      'set_notification_rule_enabled(uuid,boolean)',
      'archive_notification_rule(uuid)',
      'mark_notification_read(uuid,boolean)',
      'mark_all_notifications_read()',
      'retry_notification_delivery(uuid)',
      'get_notification_provider_availability()',
      'list_notification_delivery_logs(text,text,text,text,timestamp with time zone,timestamp with time zone,integer,integer)',
      'normalize_indian_phone(text)', 'assert_crm_actor()', 'can_read_crm_client(uuid)',
      'lookup_crm_client_by_phone(text)', 'search_crm_clients(jsonb)', 'get_crm_client_detail(uuid)', 'list_crm_followups(jsonb)',
      'create_crm_client(jsonb,uuid)', 'update_crm_client(uuid,jsonb,integer,uuid)',
      'reassign_crm_client(uuid,uuid,uuid,integer,uuid)', 'record_crm_walkin(jsonb,uuid)',
      'merge_crm_clients(uuid,uuid,uuid)', 'log_crm_interaction(uuid,jsonb,uuid)',
      'correct_crm_interaction(uuid,jsonb,uuid)', 'create_crm_followup(uuid,jsonb,uuid)',
      'reschedule_crm_followup(uuid,date,uuid,text,integer,uuid)',
      'complete_crm_followup(uuid,text,integer,uuid)', 'cancel_crm_followup(uuid,text,integer,uuid)',
      'register_crm_document(uuid,text,uuid,text,text,text,bigint,uuid)',
      'remove_crm_document(uuid,text,uuid)', 'get_crm_document_path(uuid)', 'link_crm_record(uuid,text,uuid,uuid)',
      'can_write_crm_document_object(text)', 'can_read_crm_document_object(text)',
      'can_delete_crm_document_object(text)',
      'get_home_summary(jsonb)', 'get_dashboard_metrics(jsonb)', 'get_report_data(text,jsonb)',
      'request_report_export_with_audit(text,jsonb,uuid)',
      'cancel_report_export_with_audit(uuid,uuid)', 'retry_report_export_with_audit(uuid,uuid)',
      'get_report_export_download_url(uuid)', 'can_read_report_export_object(text)',
      'save_user_preferences_with_audit(jsonb)',
      'save_tenant_settings_with_audit(jsonb,integer,uuid)',
      'save_branch_settings_with_audit(uuid,jsonb,integer,uuid)',
      'get_task_template_directory(jsonb)',
      'set_task_template_schedule_with_audit(uuid,date)',
      'delete_task_template_with_audit(uuid)',
      'is_user_week_off_on_date(uuid,date)'
    ]::text[])
  )
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and p.oid::regprocedure::text not in (select identity from expected)
), 45, 'authenticated has exactly 45 reviewed post-dashboard grant additions');

-- Exact service-role allowlist and preservation of recurrence table reads.
select ok(has_function_privilege('service_role', 'invite_profile_with_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,text,uuid)', 'EXECUTE'), 'service_role executes invite_profile_with_audit');
select ok(has_function_privilege('service_role', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'service_role executes create_recurring_task_instance');
select ok(has_function_privilege('service_role', 'process_notification_events(integer)', 'EXECUTE'), 'service_role processes notification events');
select ok(has_function_privilege('service_role', 'claim_notification_deliveries(integer,uuid,integer)', 'EXECUTE'), 'service_role claims notification deliveries');
select ok(has_function_privilege('service_role', 'finish_notification_delivery(uuid,text,text,text,boolean)', 'EXECUTE'), 'service_role finishes notification deliveries');
select ok(has_function_privilege('service_role', 'detect_scheduled_notification_events(integer,timestamp with time zone)', 'EXECUTE'), 'service_role detects scheduled notification events');
select ok(has_function_privilege('service_role', 'detect_crm_followup_events(integer,timestamp with time zone)', 'EXECUTE'), 'service_role detects CRM follow-up events');
select ok(has_function_privilege('service_role', 'claim_report_exports(integer,uuid,integer)', 'EXECUTE'), 'service_role claims report exports');
select ok(has_function_privilege('service_role', 'get_report_export_batch(uuid,integer,integer)', 'EXECUTE'), 'service_role reads bounded export batches');
select ok(has_function_privilege('service_role', 'update_report_export_progress(uuid,uuid,integer,integer)', 'EXECUTE'), 'service_role updates export progress');
select ok(has_function_privilege('service_role', 'finish_report_export(uuid,uuid,text,text,integer,text)', 'EXECUTE'), 'service_role finishes report exports');
select ok(has_function_privilege('service_role', 'claim_report_export_cleanup(integer)', 'EXECUTE'), 'service_role claims expired export cleanup');
select ok(has_function_privilege('service_role', 'mark_report_export_cleaned(uuid)', 'EXECUTE'), 'service_role records export cleanup');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and p.oid::regprocedure::text not in (
      'invite_profile_with_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,text,uuid)',
      'create_recurring_task_instance(uuid,date,jsonb)',
      'process_notification_events(integer)',
      'claim_notification_deliveries(integer,uuid,integer)',
      'finish_notification_delivery(uuid,text,text,text,boolean)',
      'detect_scheduled_notification_events(integer,timestamp with time zone)',
      'detect_crm_followup_events(integer,timestamp with time zone)'
      ,'claim_report_exports(integer,uuid,integer)'
      ,'get_report_export_batch(uuid,integer,integer)'
      ,'update_report_export_progress(uuid,uuid,integer,integer)'
      ,'finish_report_export(uuid,uuid,text,text,integer,text)'
      ,'claim_report_export_cleanup(integer)'
      ,'mark_report_export_cleaned(uuid)'
      ,'is_user_week_off_on_date(uuid,date)'
    )
), 30, 'service_role has exactly 30 reviewed post-dashboard grant additions');
select ok(has_table_privilege('service_role', 'task_templates', 'SELECT'), 'service_role retains task_templates SELECT');
select ok(has_table_privilege('service_role', 'user_profiles', 'SELECT'), 'service_role retains user_profiles SELECT');
select ok(has_table_privilege('service_role', 'user_availability', 'SELECT'), 'service_role retains user_availability SELECT');

-- Cross-allowlist and owner-only privilege negatives.
select ok(not has_function_privilege('authenticated', 'invite_profile_with_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,text,uuid)', 'EXECUTE'), 'authenticated cannot execute invite_profile_with_audit');
select ok(not has_function_privilege('authenticated', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'authenticated cannot execute create_recurring_task_instance');
select ok(not has_function_privilege('service_role', 'save_task_template_with_audit(uuid,jsonb)', 'EXECUTE'), 'service_role cannot execute authenticated task RPCs');
select ok(not has_function_privilege('anon', 'current_profile()', 'EXECUTE'), 'anon cannot execute current_profile');
select ok(not has_function_privilege('anon', 'save_task_template_with_audit(uuid,jsonb)', 'EXECUTE'), 'anon cannot execute authenticated task RPCs');
select ok(not has_function_privilege('anon', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'anon cannot execute recurrence RPC');

select ok(not has_function_privilege('anon', 'rls_auto_enable()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'rls_auto_enable()', 'EXECUTE')
  and not has_function_privilege('service_role', 'rls_auto_enable()', 'EXECUTE'), 'rls_auto_enable remains owner-only');
select ok(not has_function_privilege('anon', 'normalize_task_checklist(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'normalize_task_checklist(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'normalize_task_checklist(jsonb)', 'EXECUTE'), 'normalize_task_checklist remains owner-only');
select ok(not has_function_privilege('anon', 'is_supported_task_rrule(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'is_supported_task_rrule(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'is_supported_task_rrule(text)', 'EXECUTE'), 'is_supported_task_rrule remains owner-only');
select ok(not has_function_privilege('anon', 'is_user_available_for_task(uuid,date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'is_user_available_for_task(uuid,date)', 'EXECUTE')
  and not has_function_privilege('service_role', 'is_user_available_for_task(uuid,date)', 'EXECUTE'), 'is_user_available_for_task remains owner-only');

-- Permission-denied execution proves Postgres enforces the negative matrix.
set local role anon;
select throws_ok(
  $$select create_recurring_task_instance(null::uuid, current_date, '[]'::jsonb)$$,
  '42501', null, 'anon execution of recurrence RPC is denied'
);
select throws_ok(
  $$select save_task_template_with_audit(null::uuid, '{}'::jsonb)$$,
  '42501', null, 'anon execution of authenticated task RPC is denied'
);
select throws_ok(
  $$select current_profile()$$,
  '42501', null, 'anon execution of policy helpers is denied'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select create_recurring_task_instance(null::uuid, current_date, '[]'::jsonb)$$,
  '42501', null, 'authenticated execution of recurrence RPC is denied'
);
select throws_ok(
  $$select invite_profile_with_audit(null::uuid, null::uuid, '', '', null::uuid, null::uuid, null::uuid, '', '', '{}'::text[], null::user_role, '', null::uuid)$$,
  '42501', null, 'authenticated execution of invitation RPC is denied'
);
reset role;

set local role service_role;
select throws_ok(
  $$select save_task_template_with_audit(null::uuid, '{}'::jsonb)$$,
  '42501', null, 'service_role execution of authenticated task RPC is denied'
);
reset role;

select * from finish();
rollback;
