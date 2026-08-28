create table public.production_demo_data_retirements (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id),
  actor_profile_id uuid not null references public.user_profiles(id),
  state text not null check (state in ('previewed', 'running', 'completed', 'expired')),
  manifest jsonb not null,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  backup_reference text not null check (length(btrim(backup_reference)) between 3 and 500),
  maintenance_acknowledged boolean not null default false,
  expires_at timestamptz not null,
  executed_at timestamptz,
  removed_counts jsonb,
  created_at timestamptz not null default now(),
  check ((state = 'completed') = (executed_at is not null))
);

create unique index production_demo_data_retirements_one_open_per_tenant
  on public.production_demo_data_retirements(tenant_id)
  where state in ('previewed', 'running');

alter table public.production_demo_data_retirements enable row level security;
revoke all on table public.production_demo_data_retirements from public, anon, authenticated, service_role;

create or replace function public.production_demo_data_retirement_actor(p_actor_auth_user_id uuid)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Production demo-data retirement denied' using errcode = '42501';
  end if;

  select * into v_actor
  from public.user_profiles
  where auth_user_id = p_actor_auth_user_id;

  if v_actor.id is null
     or v_actor.user_role <> 'super_admin'
     or v_actor.working_status <> 'active'
     or v_actor.account_status <> 'active'
     or not coalesce(v_actor.is_login_enabled, false) then
    raise exception 'Production demo-data retirement denied' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

create or replace function public.production_demo_data_retirement_manifest(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_manifest jsonb;
  v_unclassified text[];
  v_classified constant text[] := array[
    'audit_logs','branches','buddy_assignments','client_assignments','client_contact_aliases',
    'client_followups','client_timeline','clients','crm_branch_mappings','crm_custom_field_values',
    'crm_documents','crm_field_definition_revisions','crm_field_definitions','crm_identity_review',
    'crm_import_exceptions','crm_import_records','crm_import_runs','crm_legacy_people',
    'crm_legacy_timeline_details','crm_migration_registry','crm_source_records','crm_source_systems',
    'crm_staff_mappings','crm_sync_checkpoints','crm_sync_operation_requests','crm_sync_runs',
    'crm_sync_worker_assertions','crm_mutation_keys','departments','dropdown_master_categories','dropdown_masters',
    'export_logs','fms_flows','fms_instance_checklist_items','fms_starter_assignments',
    'form_submissions','form_templates','notification_deliveries','notification_events','notification_logs',
    'notification_provider_configuration','notification_rules','notification_templates','notifications',
    'performance_snapshots','production_demo_data_retirements','resignations','settings_mutation_keys',
    'task_import_batches','task_import_items','task_import_row_registry','task_instances','task_templates',
    'task_watchers',
    'tenant_realtime_events','tenant_section_controls','user_availability','user_organization_history',
    'user_preferences','user_profiles','username_login_rate_limits','walkin_entries','walkin_uploads',
    'daily_checklist_acknowledgements','designation_daily_checklists','fms_evidence',
    'fms_instance_stage_assignees','fms_instances'
  ];
begin
  select array_agg(c.relname order by c.relname)
  into v_unclassified
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname <> all(v_classified);

  if coalesce(cardinality(v_unclassified), 0) <> 0 then
    raise exception 'Production demo-data retirement manifest has unclassified tenant tables: %', array_to_string(v_unclassified, ', ')
      using errcode = 'P0001';
  end if;

  v_manifest := jsonb_build_object(
    'removal_counts', jsonb_build_object(
      'task_attachments', (select count(*) from public.task_attachments a join public.task_instances t on t.id = a.task_instance_id where t.tenant_id = p_tenant_id),
      'task_watchers', (select count(*) from public.task_watchers w join public.task_instances t on t.id = w.task_instance_id where t.tenant_id = p_tenant_id),
      'task_assignees', (select count(*) from public.task_assignees a join public.task_instances t on t.id = a.task_instance_id where t.tenant_id = p_tenant_id),
      'task_checklists', (select count(*) from public.task_checklists c join public.task_instances t on t.id = c.task_instance_id where t.tenant_id = p_tenant_id),
      'task_comments', (select count(*) from public.task_comments c join public.task_instances t on t.id = c.task_instance_id where t.tenant_id = p_tenant_id),
      'task_revisions', (select count(*) from public.task_revisions r join public.task_instances t on t.id = r.task_instance_id where t.tenant_id = p_tenant_id),
      'task_import_items', (select count(*) from public.task_import_items where tenant_id = p_tenant_id),
      'task_import_batches', (select count(*) from public.task_import_batches where tenant_id = p_tenant_id),
      'task_instances', (select count(*) from public.task_instances where tenant_id = p_tenant_id),
      'task_templates', (select count(*) from public.task_templates where tenant_id = p_tenant_id),
      'fms_evidence', (select count(*) from public.fms_evidence where tenant_id = p_tenant_id),
      'fms_instances', (select count(*) from public.fms_instances where tenant_id = p_tenant_id),
      'fms_flows', (select count(*) from public.fms_flows where tenant_id = p_tenant_id),
      'form_submissions', (select count(*) from public.form_submissions where tenant_id = p_tenant_id),
      'form_templates', (select count(*) from public.form_templates where tenant_id = p_tenant_id),
      'notification_deliveries', (select count(*) from public.notification_deliveries where tenant_id = p_tenant_id),
      'notification_events', (select count(*) from public.notification_events where tenant_id = p_tenant_id),
      'notifications', (select count(*) from public.notifications where tenant_id = p_tenant_id),
      'notification_logs', (select count(*) from public.notification_logs where tenant_id = p_tenant_id),
      'notification_rules', (select count(*) from public.notification_rules where tenant_id = p_tenant_id),
      'notification_templates', (select count(*) from public.notification_templates where tenant_id = p_tenant_id),
      'export_logs', (select count(*) from public.export_logs where tenant_id = p_tenant_id),
      'performance_snapshots', (select count(*) from public.performance_snapshots where tenant_id = p_tenant_id),
      'tenant_realtime_events', (select count(*) from public.tenant_realtime_events where tenant_id = p_tenant_id),
      'daily_checklist_acknowledgements', (select count(*) from public.daily_checklist_acknowledgements where tenant_id = p_tenant_id),
      'designation_daily_checklists', (select count(*) from public.designation_daily_checklists where tenant_id = p_tenant_id)
    ),
    'retained_counts', jsonb_build_object(
      'user_profiles', (select count(*) from public.user_profiles where tenant_id = p_tenant_id),
      'branches', (select count(*) from public.branches where tenant_id = p_tenant_id),
      'departments', (select count(*) from public.departments where tenant_id = p_tenant_id),
      'user_availability', (select count(*) from public.user_availability where tenant_id = p_tenant_id),
      'clients', (select count(*) from public.clients where tenant_id = p_tenant_id),
      'crm_documents', (select count(*) from public.crm_documents where tenant_id = p_tenant_id),
      'audit_logs', (select count(*) from public.audit_logs where tenant_id = p_tenant_id)
    )
  );
  return v_manifest;
end;
$$;

create or replace function public.preview_production_demo_data_retirement(
  p_actor_auth_user_id uuid,
  p_backup_reference text,
  p_maintenance_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.user_profiles;
  v_manifest jsonb;
  v_operation public.production_demo_data_retirements;
begin
  v_actor := public.production_demo_data_retirement_actor(p_actor_auth_user_id);
  if nullif(btrim(p_backup_reference), '') is null or length(btrim(p_backup_reference)) > 500 or not p_maintenance_acknowledged then
    raise exception 'A backup reference and maintenance acknowledgement are required' using errcode = '22023';
  end if;

  update public.production_demo_data_retirements
  set state = 'expired'
  where tenant_id = v_actor.tenant_id and state = 'previewed' and expires_at <= now();

  v_manifest := public.production_demo_data_retirement_manifest(v_actor.tenant_id);
  insert into public.production_demo_data_retirements(
    tenant_id, actor_profile_id, state, manifest, manifest_hash, backup_reference, maintenance_acknowledged, expires_at
  ) values (
    v_actor.tenant_id, v_actor.id, 'previewed', v_manifest,
    encode(digest(v_manifest::text, 'sha256'), 'hex'), btrim(p_backup_reference), true, now() + interval '20 minutes'
  ) returning * into v_operation;

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'manifest_hash', v_operation.manifest_hash,
    'expires_at', v_operation.expires_at,
    'removal_counts', v_operation.manifest->'removal_counts',
    'retained_counts', v_operation.manifest->'retained_counts'
  );
end;
$$;

create or replace function public.execute_production_demo_data_retirement(
  p_actor_auth_user_id uuid,
  p_operation_id uuid,
  p_manifest_hash text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.user_profiles;
  v_operation public.production_demo_data_retirements;
  v_manifest jsonb;
  v_removed jsonb;
begin
  v_actor := public.production_demo_data_retirement_actor(p_actor_auth_user_id);
  select * into v_operation from public.production_demo_data_retirements where id = p_operation_id for update;
  if v_operation.id is null or v_operation.tenant_id <> v_actor.tenant_id or v_operation.actor_profile_id <> v_actor.id then
    raise exception 'Production demo-data retirement operation is unavailable' using errcode = '42501';
  end if;
  if v_operation.state <> 'previewed' or v_operation.expires_at <= now() then
    raise exception 'Production demo-data retirement preview has expired or completed' using errcode = '23514';
  end if;
  if p_manifest_hash <> v_operation.manifest_hash or p_confirmation <> 'RETIRE DEMO DATA' then
    raise exception 'Production demo-data retirement confirmation is invalid' using errcode = '22023';
  end if;
  v_manifest := public.production_demo_data_retirement_manifest(v_actor.tenant_id);
  if encode(digest(v_manifest::text, 'sha256'), 'hex') <> v_operation.manifest_hash then
    raise exception 'Production demo-data retirement data changed after preview' using errcode = '23514';
  end if;

  update public.production_demo_data_retirements set state = 'running' where id = v_operation.id;
  delete from public.task_import_items where tenant_id = v_actor.tenant_id;
  delete from public.task_import_batches where tenant_id = v_actor.tenant_id;
  delete from public.task_instances where tenant_id = v_actor.tenant_id;
  delete from public.task_templates where tenant_id = v_actor.tenant_id;
  delete from public.fms_instances where tenant_id = v_actor.tenant_id;
  delete from public.fms_flows where tenant_id = v_actor.tenant_id;
  delete from public.form_submissions where tenant_id = v_actor.tenant_id;
  delete from public.form_templates where tenant_id = v_actor.tenant_id;
  delete from public.notification_deliveries where tenant_id = v_actor.tenant_id;
  delete from public.notification_events where tenant_id = v_actor.tenant_id;
  delete from public.notifications where tenant_id = v_actor.tenant_id;
  delete from public.notification_logs where tenant_id = v_actor.tenant_id;
  delete from public.notification_rules where tenant_id = v_actor.tenant_id;
  delete from public.notification_templates where tenant_id = v_actor.tenant_id;
  delete from public.export_logs where tenant_id = v_actor.tenant_id;
  delete from public.performance_snapshots where tenant_id = v_actor.tenant_id;
  delete from public.tenant_realtime_events where tenant_id = v_actor.tenant_id;
  delete from public.daily_checklist_acknowledgements where tenant_id = v_actor.tenant_id;
  delete from public.designation_daily_checklists where tenant_id = v_actor.tenant_id;

  v_removed := v_operation.manifest->'removal_counts';
  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'production_demo_data_retired', 'production_demo_data_retirements', v_operation.id,
    jsonb_build_object('manifest_hash', v_operation.manifest_hash, 'backup_reference', v_operation.backup_reference, 'removed_counts', v_removed));
  update public.production_demo_data_retirements
  set state = 'completed', executed_at = now(), removed_counts = v_removed
  where id = v_operation.id;

  return jsonb_build_object('operation_id', v_operation.id, 'removed_counts', v_removed);
end;
$$;

revoke all on function public.production_demo_data_retirement_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.production_demo_data_retirement_manifest(uuid) from public, anon, authenticated, service_role;
revoke all on function public.preview_production_demo_data_retirement(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.execute_production_demo_data_retirement(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.preview_production_demo_data_retirement(uuid, text, boolean) to service_role;
grant execute on function public.execute_production_demo_data_retirement(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
