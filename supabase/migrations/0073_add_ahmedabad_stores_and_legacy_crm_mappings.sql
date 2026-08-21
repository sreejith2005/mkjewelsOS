-- Approved organization alignment: two active Ahmedabad stores and explicit
-- stable-ID mappings for all legacy CRM stores. Exhibition remains distinct.

alter table crm_branch_mappings alter column created_by drop not null;
alter table crm_branch_mappings alter column updated_by drop not null;

do $$
declare v_tenant_id uuid; v_source_id uuid;
begin
  select tenant_id into v_tenant_id from branches where code = 'AND' limit 1;
  -- A pristine local bootstrap intentionally has no production organization
  -- records. The approved hosted alignment remains idempotent when they exist.
  if v_tenant_id is null then return; end if;
  select id into v_source_id from crm_source_systems where source_key = 'legacy_sreejith_crm' and is_active;
  if v_source_id is null then raise exception 'Legacy CRM source registry is unavailable'; end if;

  insert into branches(tenant_id, name, code, is_active)
  values
    (v_tenant_id, 'CG ROAD AHMEDABAD', 'CGA', true),
    (v_tenant_id, 'SINDHU BHAVAN AHMEDABAD', 'SBA', true)
  on conflict(tenant_id, code) do update set name = excluded.name, is_active = true, updated_at = now();

  insert into crm_branch_mappings(source_system_id, external_branch_id, branch_id, metadata, created_by, updated_by)
  select v_source_id, mapping.external_branch_id, branch.id,
    jsonb_build_object('approval', 'organization alignment', 'migration', '0073', 'legacy_name', mapping.legacy_name),
    null, null
  from (values
    ('f0f7e8eb-253a-43be-8b4e-edac629bfb44'::text, 'AND', 'Andheri'),
    ('a8fa827d-5e69-4b41-986e-bd64730552d6'::text, 'BAN', 'Bandra'),
    ('4426c0c7-30b8-4f20-a246-1f9d1d8302f0'::text, 'ZVB', 'Zaveri Bazaar'),
    ('49530982-8243-438d-834a-fca6366fa7b0'::text, 'CGA', 'CG Road Ahmedabad'),
    ('be400905-fd63-4870-bcf7-ba04c6a80981'::text, 'SBA', 'Sindhu Bhavan Ahmedabad')
  ) as mapping(external_branch_id, branch_code, legacy_name)
  join branches branch on branch.tenant_id = v_tenant_id and branch.code = mapping.branch_code
  on conflict(source_system_id, external_branch_id) do update set branch_id = excluded.branch_id, metadata = excluded.metadata, updated_by = null, updated_at = now();

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  select v_tenant_id, null, 'crm_legacy_branch_mapping_approved', 'crm_migration', mapping.id,
    jsonb_build_object('legacy_external_id', mapping.external_branch_id, 'jewelos_branch_id', mapping.branch_id, 'migration', '0073')
  from crm_branch_mappings mapping where mapping.source_system_id = v_source_id;
end $$;
