-- Adds the legacy visit-form payload to already imported historical events
-- without duplicating timeline history when source detail is enriched later.

create or replace function enrich_legacy_crm_timeline_visit_form(
  p_source_key text,
  p_external_id text,
  p_payload jsonb,
  p_source_checksum text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source_id uuid;
  v_stage crm_import_records;
  v_timeline_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or btrim(p_external_id) = '' or p_source_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'Legacy CRM timeline enrichment payload is invalid' using errcode = '22023';
  end if;
  select id into v_source_id from crm_source_systems where source_key = lower(btrim(p_source_key)) and is_active;
  if v_source_id is null then raise exception 'Legacy CRM source is not active' using errcode = '22023'; end if;
  select * into v_stage from crm_import_records where source_system_id = v_source_id and entity_type = 'timeline' and external_id = btrim(p_external_id) for update;
  if v_stage.id is null or v_stage.target_record_id is null then
    raise exception 'Legacy CRM timeline source record is not imported' using errcode = '23503';
  end if;
  v_timeline_id := v_stage.target_record_id;
  update client_timeline
    set metadata = metadata || jsonb_build_object('legacy_visit_form', p_payload->'legacy_visit_form')
    where id = v_timeline_id;
  update crm_import_records
    set payload = payload || jsonb_build_object('legacy_visit_form', p_payload->'legacy_visit_form'), source_checksum = p_source_checksum, updated_at = now()
    where id = v_stage.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
    select tenant_id, null, 'crm_legacy_timeline_enriched', 'crm_migration', id, jsonb_build_object('external_id', btrim(p_external_id), 'visit_form_preserved', p_payload->'legacy_visit_form' is not null)
    from client_timeline where id = v_timeline_id;
  return v_timeline_id;
end $$;

revoke all on function enrich_legacy_crm_timeline_visit_form(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function enrich_legacy_crm_timeline_visit_form(text, text, jsonb, text) to service_role;
