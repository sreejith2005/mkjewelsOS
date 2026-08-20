-- Preserve historical CRM authorship without creating or granting access to
-- obsolete employee accounts.

create table crm_legacy_people (
  id uuid primary key default extensions.uuid_generate_v4(),
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  external_person_id text not null check (btrim(external_person_id) <> ''),
  display_name text,
  work_email_hash text check (work_email_hash is null or work_email_hash ~ '^[0-9a-f]{64}$'),
  linked_user_profile_id uuid references user_profiles(id) on delete restrict,
  link_status text not null default 'unlinked' check (link_status in ('unlinked', 'linked', 'review_required')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_system_id, external_person_id)
);

create index crm_legacy_people_linked_profile_idx on crm_legacy_people(linked_user_profile_id) where linked_user_profile_id is not null;
alter table crm_legacy_people enable row level security;
create policy crm_legacy_people_admin_select on crm_legacy_people for select to authenticated using (current_role_level() in ('super_admin', 'admin'));

comment on table crm_legacy_people is 'Historical external CRM authors. Unlinked rows never create JewelOS login access.';
