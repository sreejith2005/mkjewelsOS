-- Imports historic CRM visits as JewelOS walk-in timeline history. The source
-- classification and raw fields remain in the protected migration snapshot.

create or replace function import_legacy_crm_timeline(
  p_source_key text,
  p_external_id text,
  p_client_external_id text,
  p_payload jsonb,
  p_source_checksum text,
  p_import_run_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source_id uuid;
  v_stage crm_import_records;
  v_client_id uuid;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_timeline_id uuid;
  v_missing_branch boolean := false;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or btrim(p_external_id) = '' or btrim(p_client_external_id) = '' or p_source_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'Legacy CRM timeline import payload is invalid' using errcode = '22023';
  end if;

  select id into v_source_id from crm_source_systems where source_key = lower(btrim(p_source_key)) and is_active;
  if v_source_id is null then raise exception 'Legacy CRM source is not active' using errcode = '22023'; end if;

  select * into v_stage from crm_import_records
    where source_system_id = v_source_id and entity_type = 'timeline' and external_id = btrim(p_external_id) for update;
  if v_stage.id is not null and v_stage.import_status = 'imported' and v_stage.source_checksum = p_source_checksum and v_stage.target_record_id is not null then
    return v_stage.target_record_id;
  end if;

  insert into crm_import_records(source_system_id, entity_type, external_id, source_checksum, payload, import_status, import_run_id)
  values(v_source_id, 'timeline', btrim(p_external_id), p_source_checksum, p_payload, 'staged', p_import_run_id)
  on conflict(source_system_id, entity_type, external_id) do update
    set source_checksum = excluded.source_checksum, payload = excluded.payload, import_status = 'staged', target_record_id = null, import_run_id = excluded.import_run_id, updated_at = now()
  returning * into v_stage;

  select target_record_id into v_client_id from crm_import_records
    where source_system_id = v_source_id and entity_type = 'client' and external_id = btrim(p_client_external_id);
  if v_client_id is null then
    update crm_import_records set import_status = 'quarantined', updated_at = now() where id = v_stage.id;
    insert into crm_import_exceptions(import_record_id, exception_code, details)
      values(v_stage.id, 'missing_reference', jsonb_build_object('reference_type', 'client', 'preserved', true)) on conflict do nothing;
    return null;
  end if;

  select tenant_id into v_tenant_id from clients where id = v_client_id;
  select branch_id into v_branch_id from crm_branch_mappings
    where source_system_id = v_source_id and external_branch_id = nullif(btrim(p_payload->>'legacy_branch_id'), '');
  v_missing_branch := v_branch_id is null;

  insert into client_timeline(tenant_id, branch_id, client_id, event_type, subject, outcome, summary, created_by, occurred_at, metadata)
  values(
    v_tenant_id,
    v_branch_id,
    v_client_id,
    'walkin',
    coalesce(nullif(left(btrim(p_payload->>'subject'), 200), ''), 'Legacy visit'),
    nullif(left(btrim(p_payload->>'legacy_buy_status'), 4000), ''),
    nullif(left(btrim(p_payload->>'remark'), 4000), ''),
    null,
    case when coalesce(p_payload->>'occurred_at', '') ~ '^\d{4}-\d{2}-\d{2}T' then (p_payload->>'occurred_at')::timestamptz else now() end,
    p_payload || jsonb_build_object('migration_source', 'legacy_sreejith_crm', 'legacy_timeline_id', btrim(p_external_id), 'legacy_event_type', p_payload->>'legacy_event_type')
  ) returning id into v_timeline_id;

  update crm_import_records set import_status = case when v_missing_branch then 'quarantined' else 'imported' end, target_record_id = v_timeline_id, updated_at = now() where id = v_stage.id;
  if v_missing_branch then
    insert into crm_import_exceptions(import_record_id, exception_code, details)
      values(v_stage.id, 'missing_branch', jsonb_build_object('preserved', true)) on conflict do nothing;
  end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
    values(v_tenant_id, null, 'crm_legacy_timeline_imported', 'crm_migration', v_timeline_id, jsonb_build_object('external_id', btrim(p_external_id), 'review_required', v_missing_branch));
  return v_timeline_id;
end $$;

revoke all on function import_legacy_crm_timeline(text, text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function import_legacy_crm_timeline(text, text, text, jsonb, text, uuid) to service_role;
