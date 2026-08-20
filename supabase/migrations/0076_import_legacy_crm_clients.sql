-- Idempotent client importer. It preserves every source payload and creates a
-- JewelOS client even when a legacy phone or branch needs later review.

create or replace function import_legacy_crm_client(p_source_key text, p_external_id text, p_payload jsonb, p_source_checksum text, p_import_run_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_source_id uuid; v_stage crm_import_records; v_tenant_id uuid; v_branch_id uuid; v_client_id uuid; v_phone text; v_normalized_phone text; v_billing_phone text; v_normalized_billing_phone text; v_duplicate boolean := false; v_invalid_phone boolean := false; v_missing_branch boolean := false;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or btrim(p_external_id) = '' or p_source_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Legacy CRM import payload is invalid' using errcode = '22023'; end if;
  select id into v_source_id from crm_source_systems where source_key = lower(btrim(p_source_key)) and is_active;
  if v_source_id is null then raise exception 'Legacy CRM source is not active' using errcode = '22023'; end if;
  select * into v_stage from crm_import_records where source_system_id = v_source_id and entity_type = 'client' and external_id = btrim(p_external_id) for update;
  if v_stage.id is not null and v_stage.import_status = 'imported' and v_stage.source_checksum = p_source_checksum and v_stage.target_record_id is not null then return v_stage.target_record_id; end if;
  insert into crm_import_records(source_system_id, entity_type, external_id, source_checksum, payload, import_status, import_run_id)
  values(v_source_id, 'client', btrim(p_external_id), p_source_checksum, p_payload, 'staged', p_import_run_id)
  on conflict(source_system_id, entity_type, external_id) do update set source_checksum = excluded.source_checksum, payload = excluded.payload, import_status = 'staged', target_record_id = null, import_run_id = excluded.import_run_id, updated_at = now()
  returning * into v_stage;
  select tenant_id into v_tenant_id from branches where code = 'AND' limit 1;
  if v_tenant_id is null then raise exception 'JewelOS tenant is unavailable' using errcode = '23503'; end if;
  select mapping.branch_id into v_branch_id from crm_branch_mappings mapping where mapping.source_system_id = v_source_id and mapping.external_branch_id = nullif(btrim(p_payload->>'legacy_branch_id'), '');
  v_missing_branch := v_branch_id is null;
  v_phone := left(coalesce(nullif(btrim(p_payload->>'primary_phone'), ''), 'legacy:' || btrim(p_external_id)), 200);
  v_normalized_phone := normalize_indian_phone(v_phone);
  v_invalid_phone := v_normalized_phone is null;
  v_billing_phone := nullif(left(btrim(coalesce(p_payload->>'billing_phone', '')), 200), '');
  v_normalized_billing_phone := normalize_indian_phone(v_billing_phone);
  if v_normalized_billing_phone = v_normalized_phone then v_normalized_billing_phone := null; v_billing_phone := null; end if;
  if v_normalized_phone is not null then select exists(select 1 from client_contact_aliases where tenant_id = v_tenant_id and normalized_phone = v_normalized_phone and is_active) into v_duplicate; end if;
  if v_duplicate then v_normalized_phone := null; end if;
  insert into clients(tenant_id, branch_id, phone, normalized_phone, billing_phone, normalized_billing_phone, first_name, last_name, email, gender, date_of_birth, anniversary_date, address, city, state, pincode, potential_category, tags, status, created_by, updated_by)
  values(v_tenant_id, v_branch_id, v_phone, v_normalized_phone, v_billing_phone, v_normalized_billing_phone,
    nullif(left(btrim(p_payload->>'primary_name'), 100), ''), nullif(left(array_to_string(coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'other_names', '[]'::jsonb))), '{}'), ', '), 100), ''),
    case when coalesce(p_payload->>'email', '') ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then lower(left(btrim(p_payload->>'email'), 254)) else null end,
    nullif(left(btrim(p_payload->>'gender'), 40), ''), case when coalesce(p_payload->>'dob', '') ~ '^\\d{4}-\\d{2}-\\d{2}' then left(p_payload->>'dob', 10)::date else null end, case when coalesce(p_payload->>'anniversary', '') ~ '^\\d{4}-\\d{2}-\\d{2}' then left(p_payload->>'anniversary', 10)::date else null end,
    nullif(left(btrim(p_payload->>'address'), 4000), ''), nullif(left(btrim(coalesce(p_payload->>'city_other', p_payload->>'city')), 120), ''), nullif(left(btrim(p_payload->>'state'), 100), ''),
    case when coalesce(p_payload->>'pincode', '') ~ '^[1-9][0-9]{5}$' then p_payload->>'pincode' else null end,
    nullif(left(btrim(p_payload->>'client_potential_category'), 120), ''), coalesce(array(select distinct left(lower(btrim(value)), 50) from jsonb_array_elements_text(coalesce(p_payload->'last_seen_categories', '[]'::jsonb)) value limit 20), '{}'), 'active', null, null)
  returning id into v_client_id;
  if v_normalized_phone is not null then insert into client_contact_aliases(tenant_id, client_id, normalized_phone, alias_type, created_by) values(v_tenant_id, v_client_id, v_normalized_phone, 'primary', null); end if;
  if v_normalized_billing_phone is not null then insert into client_contact_aliases(tenant_id, client_id, normalized_phone, alias_type, created_by) values(v_tenant_id, v_client_id, v_normalized_billing_phone, 'billing', null) on conflict do nothing; end if;
  update crm_import_records set import_status = case when v_invalid_phone or v_missing_branch or v_duplicate then 'quarantined' else 'imported' end, target_record_id = v_client_id, updated_at = now() where id = v_stage.id;
  if v_invalid_phone then insert into crm_import_exceptions(import_record_id, exception_code, details) values(v_stage.id, 'invalid_phone', jsonb_build_object('preserved', true)) on conflict do nothing; end if;
  if v_missing_branch then insert into crm_import_exceptions(import_record_id, exception_code, details) values(v_stage.id, 'missing_branch', jsonb_build_object('preserved', true)) on conflict do nothing; end if;
  if v_duplicate then insert into crm_import_exceptions(import_record_id, exception_code, details) values(v_stage.id, 'duplicate_contact', jsonb_build_object('preserved', true)) on conflict do nothing; end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value) values(v_tenant_id, null, 'crm_legacy_client_imported', 'crm_migration', v_client_id, jsonb_build_object('external_id', btrim(p_external_id), 'review_required', v_invalid_phone or v_missing_branch or v_duplicate));
  return v_client_id;
end $$;

revoke all on function import_legacy_crm_client(text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function import_legacy_crm_client(text, text, jsonb, text, uuid) to service_role;
