-- Canonical JewelOS mapping registry for controlled CRM migration.
-- No business CRM records are imported or modified by this migration.

create table if not exists crm_source_systems (
  id uuid primary key default extensions.uuid_generate_v4(),
  source_key text not null unique check (source_key ~ '^[a-z][a-z0-9_]{2,62}$'),
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into crm_source_systems (source_key, display_name)
values ('legacy_sreejith_crm', 'Legacy Sreejith CRM')
on conflict (source_key) do nothing;

create table if not exists crm_branch_mappings (
  id uuid primary key default extensions.uuid_generate_v4(),
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  external_branch_id text not null check (btrim(external_branch_id) <> ''),
  branch_id uuid not null references branches(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references user_profiles(id),
  updated_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system_id, external_branch_id),
  unique (source_system_id, branch_id)
);

create table if not exists crm_staff_mappings (
  id uuid primary key default extensions.uuid_generate_v4(),
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  external_staff_id text not null check (btrim(external_staff_id) <> ''),
  user_profile_id uuid not null references user_profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references user_profiles(id),
  updated_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system_id, external_staff_id),
  unique (source_system_id, user_profile_id)
);

create table if not exists crm_import_runs (
  id uuid primary key default extensions.uuid_generate_v4(),
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  entity_type text not null check (entity_type in ('branch', 'staff', 'client', 'timeline', 'followup', 'document')),
  mode text not null check (mode in ('preflight', 'dry_run', 'import', 'reconcile')),
  status text not null check (status in ('started', 'completed', 'failed', 'blocked')),
  source_checksum text,
  summary jsonb not null default '{}'::jsonb,
  started_by uuid not null references user_profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists crm_branch_mappings_branch_idx on crm_branch_mappings(branch_id);
create index if not exists crm_staff_mappings_profile_idx on crm_staff_mappings(user_profile_id);
create index if not exists crm_import_runs_source_created_idx on crm_import_runs(source_system_id, created_at desc);

alter table crm_source_systems enable row level security;
alter table crm_branch_mappings enable row level security;
alter table crm_staff_mappings enable row level security;
alter table crm_import_runs enable row level security;

create policy crm_source_systems_admin_select on crm_source_systems for select to authenticated using (current_role_level() in ('super_admin', 'admin'));
create policy crm_branch_mappings_admin_select on crm_branch_mappings for select to authenticated using (current_role_level() in ('super_admin', 'admin'));
create policy crm_staff_mappings_admin_select on crm_staff_mappings for select to authenticated using (current_role_level() in ('super_admin', 'admin'));
create policy crm_import_runs_admin_select on crm_import_runs for select to authenticated using (current_role_level() in ('super_admin', 'admin'));

create or replace function upsert_crm_branch_mapping(p_source_key text, p_external_branch_id text, p_branch_id uuid, p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_source_id uuid; v_old jsonb; v_id uuid;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or v_actor.user_role not in ('super_admin', 'admin') then raise exception 'Only super_admin or admin can manage CRM branch mappings' using errcode = '42501'; end if;
  if btrim(p_external_branch_id) = '' then raise exception 'external branch ID is required' using errcode = '22023'; end if;
  select id into v_source_id from crm_source_systems where source_key = lower(btrim(p_source_key)) and is_active;
  if v_source_id is null then raise exception 'CRM source is not active' using errcode = '22023'; end if;
  if not exists (select 1 from branches where id = p_branch_id and tenant_id = v_actor.tenant_id and is_active) then raise exception 'target branch is invalid' using errcode = '22023'; end if;
  select to_jsonb(m) into v_old from crm_branch_mappings m where source_system_id = v_source_id and external_branch_id = btrim(p_external_branch_id) for update;
  insert into crm_branch_mappings(source_system_id, external_branch_id, branch_id, metadata, created_by, updated_by)
  values(v_source_id, btrim(p_external_branch_id), p_branch_id, coalesce(p_metadata, '{}'::jsonb), v_actor.id, v_actor.id)
  on conflict(source_system_id, external_branch_id) do update set branch_id = excluded.branch_id, metadata = excluded.metadata, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values(v_actor.tenant_id, v_actor.id, 'crm_branch_mapping_upserted', 'crm_migration', v_id, v_old, (select to_jsonb(m) from crm_branch_mappings m where m.id = v_id));
  return v_id;
end $$;

revoke all on function upsert_crm_branch_mapping(text, text, uuid, jsonb) from public, anon;
grant execute on function upsert_crm_branch_mapping(text, text, uuid, jsonb) to authenticated;

create or replace function upsert_crm_staff_mapping(p_source_key text, p_external_staff_id text, p_user_profile_id uuid, p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_source_id uuid; v_old jsonb; v_id uuid;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or v_actor.user_role not in ('super_admin', 'admin') then raise exception 'Only super_admin or admin can manage CRM staff mappings' using errcode = '42501'; end if;
  if btrim(p_external_staff_id) = '' then raise exception 'external staff ID is required' using errcode = '22023'; end if;
  select id into v_source_id from crm_source_systems where source_key = lower(btrim(p_source_key)) and is_active;
  if v_source_id is null then raise exception 'CRM source is not active' using errcode = '22023'; end if;
  if not exists (select 1 from user_profiles where id = p_user_profile_id and tenant_id = v_actor.tenant_id) then raise exception 'target employee is invalid' using errcode = '22023'; end if;
  select to_jsonb(m) into v_old from crm_staff_mappings m where source_system_id = v_source_id and external_staff_id = btrim(p_external_staff_id) for update;
  insert into crm_staff_mappings(source_system_id, external_staff_id, user_profile_id, metadata, created_by, updated_by)
  values(v_source_id, btrim(p_external_staff_id), p_user_profile_id, coalesce(p_metadata, '{}'::jsonb), v_actor.id, v_actor.id)
  on conflict(source_system_id, external_staff_id) do update set user_profile_id = excluded.user_profile_id, metadata = excluded.metadata, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values(v_actor.tenant_id, v_actor.id, 'crm_staff_mapping_upserted', 'crm_migration', v_id, v_old, (select to_jsonb(m) from crm_staff_mappings m where m.id = v_id));
  return v_id;
end $$;

revoke all on function upsert_crm_staff_mapping(text, text, uuid, jsonb) from public, anon;
grant execute on function upsert_crm_staff_mapping(text, text, uuid, jsonb) to authenticated;
