-- Versioned custom CRM fields. Typed CRM identity/contact fields remain in
-- their existing tables; this supports future business fields without
-- reinterpreting historical values.

create table crm_field_definitions (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity_type text not null check (entity_type in ('client', 'walkin', 'followup')),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{2,62}$'),
  active_revision_id uuid,
  is_active boolean not null default true,
  created_by uuid not null references user_profiles(id),
  updated_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_type, field_key)
);

create table crm_field_definition_revisions (
  id uuid primary key default extensions.uuid_generate_v4(),
  definition_id uuid not null references crm_field_definitions(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  field_type text not null check (field_type in ('text', 'number', 'date', 'boolean', 'select', 'multi_select')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  is_required boolean not null default false,
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  created_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  unique (definition_id, revision_number)
);

alter table crm_field_definitions add constraint crm_field_definitions_active_revision_fkey
  foreign key (active_revision_id) references crm_field_definition_revisions(id) deferrable initially deferred;

create table crm_custom_field_values (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  definition_id uuid not null references crm_field_definitions(id) on delete restrict,
  definition_revision_id uuid not null references crm_field_definition_revisions(id) on delete restrict,
  entity_type text not null check (entity_type in ('client', 'walkin', 'followup')),
  record_id uuid not null,
  value jsonb not null,
  created_by uuid not null references user_profiles(id),
  updated_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, definition_id, entity_type, record_id)
);

create index crm_field_definitions_tenant_entity_idx on crm_field_definitions(tenant_id, entity_type, is_active);
create index crm_custom_field_values_record_idx on crm_custom_field_values(tenant_id, entity_type, record_id);

alter table crm_field_definitions enable row level security;
alter table crm_field_definition_revisions enable row level security;
alter table crm_custom_field_values enable row level security;

create policy crm_field_definitions_select on crm_field_definitions for select to authenticated using (tenant_id = current_tenant_id() and current_role_level() in ('super_admin', 'admin', 'manager', 'crm', 'staff'));
create policy crm_field_definition_revisions_select on crm_field_definition_revisions for select to authenticated using (exists (select 1 from crm_field_definitions d where d.id = definition_id and d.tenant_id = current_tenant_id() and current_role_level() in ('super_admin', 'admin', 'manager', 'crm', 'staff')));

create or replace function create_crm_field_definition(p_entity_type text, p_field_key text, p_label text, p_field_type text, p_options jsonb default '[]'::jsonb, p_required boolean default false, p_validation jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_definition_id uuid; v_revision_id uuid;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or v_actor.user_role not in ('super_admin', 'admin') then raise exception 'Only super_admin or admin can create CRM field definitions' using errcode = '42501'; end if;
  if p_entity_type not in ('client', 'walkin', 'followup') or lower(btrim(p_field_key)) !~ '^[a-z][a-z0-9_]{2,62}$' or char_length(btrim(p_label)) not between 1 and 120 then raise exception 'CRM field definition is invalid' using errcode = '22023'; end if;
  if p_field_type not in ('text', 'number', 'date', 'boolean', 'select', 'multi_select') or jsonb_typeof(coalesce(p_options, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_validation, '{}'::jsonb)) <> 'object' then raise exception 'CRM field configuration is invalid' using errcode = '22023'; end if;
  if p_field_type in ('select', 'multi_select') and jsonb_array_length(coalesce(p_options, '[]'::jsonb)) = 0 then raise exception 'Select fields require options' using errcode = '22023'; end if;
  if p_field_type not in ('select', 'multi_select') and jsonb_array_length(coalesce(p_options, '[]'::jsonb)) <> 0 then raise exception 'Only select fields may have options' using errcode = '22023'; end if;
  insert into crm_field_definitions(tenant_id, entity_type, field_key, created_by, updated_by) values(v_actor.tenant_id, p_entity_type, lower(btrim(p_field_key)), v_actor.id, v_actor.id) returning id into v_definition_id;
  insert into crm_field_definition_revisions(definition_id, revision_number, label, field_type, options, is_required, validation, created_by) values(v_definition_id, 1, btrim(p_label), p_field_type, coalesce(p_options, '[]'::jsonb), p_required, coalesce(p_validation, '{}'::jsonb), v_actor.id) returning id into v_revision_id;
  update crm_field_definitions set active_revision_id = v_revision_id where id = v_definition_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value) values(v_actor.tenant_id, v_actor.id, 'crm_field_definition_created', 'crm_configuration', v_definition_id, jsonb_build_object('entity_type', p_entity_type, 'field_key', lower(btrim(p_field_key)), 'revision', 1));
  return v_definition_id;
end $$;

revoke all on function create_crm_field_definition(text, text, text, text, jsonb, boolean, jsonb) from public, anon;
grant execute on function create_crm_field_definition(text, text, text, text, jsonb, boolean, jsonb) to authenticated;
