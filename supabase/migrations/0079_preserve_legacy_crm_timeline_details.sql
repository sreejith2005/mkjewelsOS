-- Timeline history is deliberately append-only. Store imported source detail
-- beside the event instead of changing the historical event itself.

create table crm_legacy_timeline_details (
  timeline_id uuid primary key references client_timeline(id) on delete cascade,
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  external_timeline_id text not null check (btrim(external_timeline_id) <> ''),
  visit_form_payload jsonb not null check (jsonb_typeof(visit_form_payload) in ('object', 'null')),
  source_checksum text not null check (source_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_system_id, external_timeline_id)
);
alter table crm_legacy_timeline_details enable row level security;
create policy crm_legacy_timeline_details_read on crm_legacy_timeline_details for select to authenticated using (can_read_crm_client((select client_id from client_timeline where id = timeline_id)));

create or replace function preserve_legacy_crm_timeline_visit_form(
  p_source_key text,
  p_external_id text,
  p_payload jsonb,
  p_source_checksum text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_source_id uuid; v_stage crm_import_records; v_timeline_id uuid; v_tenant_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or btrim(p_external_id) = '' or p_source_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Legacy CRM timeline detail payload is invalid' using errcode = '22023'; end if;
  select id into v_source_id from crm_source_systems where source_key = lower(btrim(p_source_key)) and is_active;
  if v_source_id is null then raise exception 'Legacy CRM source is not active' using errcode = '22023'; end if;
  select * into v_stage from crm_import_records where source_system_id = v_source_id and entity_type = 'timeline' and external_id = btrim(p_external_id);
  if v_stage.id is null or v_stage.target_record_id is null then raise exception 'Legacy CRM timeline source record is not imported' using errcode = '23503'; end if;
  v_timeline_id := v_stage.target_record_id;
  insert into crm_legacy_timeline_details(timeline_id, source_system_id, external_timeline_id, visit_form_payload, source_checksum)
    values(v_timeline_id, v_source_id, btrim(p_external_id), p_payload->'legacy_visit_form', p_source_checksum)
    on conflict(timeline_id) do update set visit_form_payload = excluded.visit_form_payload, source_checksum = excluded.source_checksum, updated_at = now();
  select tenant_id into v_tenant_id from client_timeline where id = v_timeline_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
    values(v_tenant_id, null, 'crm_legacy_timeline_detail_preserved', 'crm_migration', v_timeline_id, jsonb_build_object('external_id', btrim(p_external_id), 'visit_form_preserved', p_payload->'legacy_visit_form' is not null));
  return v_timeline_id;
end $$;

revoke all on function preserve_legacy_crm_timeline_visit_form(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function preserve_legacy_crm_timeline_visit_form(text, text, jsonb, text) to service_role;
