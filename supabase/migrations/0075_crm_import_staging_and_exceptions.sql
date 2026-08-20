-- Durable, administrator-only staging for imported legacy records that cannot
-- yet satisfy JewelOS business invariants. No source record is silently lost.

create table crm_import_records (
  id uuid primary key default extensions.uuid_generate_v4(),
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  entity_type text not null check (entity_type in ('client', 'timeline', 'followup', 'referral', 'document')),
  external_id text not null check (btrim(external_id) <> ''),
  source_checksum text not null check (source_checksum ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  import_status text not null default 'staged' check (import_status in ('staged', 'imported', 'quarantined', 'superseded')),
  target_record_id uuid,
  import_run_id uuid references crm_import_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_system_id, entity_type, external_id)
);

create table crm_import_exceptions (
  id uuid primary key default extensions.uuid_generate_v4(),
  import_record_id uuid not null references crm_import_records(id) on delete cascade,
  exception_code text not null check (exception_code in ('invalid_phone', 'missing_branch', 'duplicate_contact', 'invalid_date', 'missing_reference', 'unsupported_value')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolved_by uuid references user_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(import_record_id, exception_code)
);

create index crm_import_records_source_status_idx on crm_import_records(source_system_id, entity_type, import_status);
create index crm_import_exceptions_status_idx on crm_import_exceptions(status, created_at);
alter table crm_import_records enable row level security;
alter table crm_import_exceptions enable row level security;
create policy crm_import_records_admin_select on crm_import_records for select to authenticated using (current_role_level() in ('super_admin', 'admin'));
create policy crm_import_exceptions_admin_select on crm_import_exceptions for select to authenticated using (current_role_level() in ('super_admin', 'admin'));

comment on table crm_import_records is 'Protected raw source snapshot for idempotent, reviewable CRM migration.';
