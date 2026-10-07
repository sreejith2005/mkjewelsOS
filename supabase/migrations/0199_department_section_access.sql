-- Department section defaults extend the existing audited permissions system.
set search_path=public,extensions;

create table department_permission_overrides (
  tenant_id uuid not null references tenants(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  permission_key text not null references permission_catalog(key) on delete cascade,
  effect text not null check(effect in ('grant','deny')),
  updated_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,department_id,permission_key)
);
create index department_permission_overrides_department on department_permission_overrides(department_id);
alter table department_permission_overrides enable row level security;
create policy department_permissions_section_available on department_permission_overrides
  as restrictive for select to authenticated using (module_accessible('settings',false));
revoke all on department_permission_overrides from public,anon,authenticated,service_role;

create function assert_department_section_override()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from departments where id=new.department_id and tenant_id=new.tenant_id) then
    raise exception 'Department not found or not accessible' using errcode='42501';
  end if;
  if not exists(select 1 from permission_catalog where key=new.permission_key and kind='module') then
    raise exception 'Only section permissions can be configured' using errcode='22023';
  end if;
  return new;
end $$;
create trigger department_section_override_valid before insert or update on department_permission_overrides
  for each row execute function assert_department_section_override();
create trigger tenant_realtime_department_permissions after insert or update or delete on department_permission_overrides
  for each row execute function emit_realtime_direct_event('settings');

create or replace function permission_effective_for(p_profile_id uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_profile user_profiles; v_catalog permission_catalog; v_role user_role; v_effect text; v_allowed boolean;
begin
  select * into v_profile from user_profiles where id=p_profile_id;
  select * into v_catalog from permission_catalog where key=p_key;
  if v_profile.id is null or v_catalog.key is null then return false; end if;
  if p_key='availability.apply_leave_exception' then
    select o.effect into v_effect from user_permission_overrides o
    where o.user_profile_id=v_profile.id and o.tenant_id=v_profile.tenant_id and o.permission_key=p_key;
    return coalesce(v_effect='grant',false);
  end if;
  select coalesce((select a.dashboard_authority from user_access_profiles a where a.user_profile_id=v_profile.id),v_profile.user_role) into v_role;
  if v_role='super_admin' then return true; end if;
  if v_catalog.kind='protected' then return false; end if;
  if v_catalog.kind='authority' then return v_role=any(v_catalog.default_roles); end if;
  select o.effect into v_effect from user_permission_overrides o where o.user_profile_id=v_profile.id and o.permission_key=p_key;
  if v_effect is not null then return v_effect='grant'; end if;
  if v_catalog.kind='module' and v_profile.department_id is not null then
    select o.effect into v_effect from department_permission_overrides o
      join departments d on d.id=o.department_id and d.tenant_id=o.tenant_id and d.is_active
    where o.tenant_id=v_profile.tenant_id and o.department_id=v_profile.department_id and o.permission_key=p_key;
    if v_effect is not null then return v_effect='grant'; end if;
  end if;
  if v_profile.designation_id is not null then
    select o.effect into v_effect from designation_permission_overrides o
      join dropdown_masters d on d.id=o.designation_id and d.is_active
    where o.tenant_id=v_profile.tenant_id and o.designation_id=v_profile.designation_id and o.permission_key=p_key;
    if v_effect is not null then return v_effect='grant'; end if;
  end if;
  select r.is_allowed into v_allowed from role_permissions r
  where r.tenant_id=v_profile.tenant_id and r.user_role=v_role and r.permission_key=p_key;
  return coalesce(v_allowed,v_role=any(v_catalog.default_roles));
end $$;

create or replace function public.get_permission_admin_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'catalog', (select jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'page_id', c.page_id, 'default_roles', to_jsonb(c.default_roles)) order by c.sort_order) from permission_catalog c),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'branch_name', b.name) order by b.name, d.name, d.id)
      from departments d left join branches b on b.id=d.branch_id and b.tenant_id=d.tenant_id where d.tenant_id=a.tenant_id and d.is_active), '[]'::jsonb),
    'department_overrides', coalesce((select jsonb_agg(jsonb_build_object('department_id', o.department_id, 'key', o.permission_key, 'effect', o.effect)) from department_permission_overrides o where o.tenant_id=a.tenant_id), '[]'::jsonb),
    'roles', to_jsonb(enum_range(null::public.user_role)),
    'role_permissions', coalesce((select jsonb_agg(jsonb_build_object('role', r.user_role, 'key', r.permission_key, 'allowed', r.is_allowed)) from role_permissions r where r.tenant_id = a.tenant_id), '[]'::jsonb),
    'designations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'value', d.value) order by d.sort_order, d.label)
      from dropdown_masters d where d.master_type = 'designation' and d.is_active and (d.tenant_id = a.tenant_id or d.tenant_id is null)), '[]'::jsonb),
    'designation_overrides', coalesce((select jsonb_agg(jsonb_build_object('designation_id', o.designation_id, 'key', o.permission_key, 'effect', o.effect))
      from designation_permission_overrides o where o.tenant_id = a.tenant_id), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'employee_name', p.employee_name, 'employee_code', p.employee_code, 'user_role', p.user_role,
        'designation_id', p.designation_id, 'account_status', p.account_status, 'dashboard_authority', ua.dashboard_authority,
        'override_count', (select count(*) from user_permission_overrides o where o.user_profile_id = p.id)
      ) order by p.employee_name)
      from user_profiles p left join user_access_profiles ua on ua.user_profile_id = p.id
      where p.tenant_id = a.tenant_id), '[]'::jsonb)
  );
end $$;
create or replace function get_user_access_breakdown(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles; t user_profiles; v_authority user_role; v_role user_role; v_designation dropdown_masters;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  select * into t from user_profiles where id = p_profile_id;
  if t.id is null or t.tenant_id <> a.tenant_id then raise exception 'Profile not found or not accessible' using errcode = '42501'; end if;
  select dashboard_authority into v_authority from user_access_profiles where user_profile_id = t.id;
  v_role := coalesce(v_authority, t.user_role);
  select * into v_designation from dropdown_masters where id = t.designation_id;
  return jsonb_build_object(
    'profile', jsonb_build_object('id', t.id, 'employee_name', t.employee_name, 'employee_code', t.employee_code, 'base_role', t.user_role,
      'department_id', t.department_id, 'department_name', (select name from departments where id=t.department_id and tenant_id=t.tenant_id), 'designation_id', t.designation_id, 'designation_label', v_designation.label, 'account_status', t.account_status),
    'dashboard_authority', v_authority,
    'effective_role', v_role,
    'rows', (select jsonb_agg(jsonb_build_object(
        'key', c.key,
        'role_default', case c.kind
          when 'protected' then v_role = 'super_admin'
          when 'authority' then v_role = any(c.default_roles)
          else coalesce(rp.is_allowed, v_role = any(c.default_roles)) end,
        'role_configured', c.kind in ('module', 'action') and rp.is_allowed is not null,
        'department', case when c.kind='module' and coalesce(dep.is_active,false) then dept.effect end,
        'designation', case when c.kind in ('module', 'action') and coalesce(v_designation.is_active, false) then dpo.effect end,
        'user', case when c.kind in ('module', 'action') then upo.effect end,
        'effective', permission_effective_for(t.id, c.key)
      ) order by c.sort_order)
      from permission_catalog c
      left join departments dep on dep.id=t.department_id and dep.tenant_id=t.tenant_id
      left join department_permission_overrides dept on dept.department_id=t.department_id and dept.tenant_id=t.tenant_id and dept.permission_key=c.key
      left join role_permissions rp on rp.tenant_id = t.tenant_id and rp.user_role = v_role and rp.permission_key = c.key
      left join designation_permission_overrides dpo on dpo.tenant_id = t.tenant_id and dpo.designation_id = t.designation_id and dpo.permission_key = c.key
      left join user_permission_overrides upo on upo.user_profile_id = t.id and upo.permission_key = c.key)
  );
end $$;


-- A module-only wrapper preserves authority while holding the same profile lock
-- used by the existing audited access writer (including lockout safeguards).
create function save_user_section_access_with_audit(p_profile_id uuid,p_overrides jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles; t user_profiles; r record; v_authority text;
begin
  a:=assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode='42501'; end if;
  perform assert_module_access('users');
  if p_overrides is null or jsonb_typeof(p_overrides)<>'object' then raise exception 'An override object is required' using errcode='22023'; end if;
  select * into t from user_profiles where id=p_profile_id for update;
  if t.id is null or t.tenant_id<>a.tenant_id then raise exception 'Profile not found or not accessible' using errcode='42501'; end if;
  for r in select key from jsonb_each(p_overrides) loop
    if not exists(select 1 from permission_catalog where key=r.key and kind='module') then
      raise exception 'Only section permissions can be configured' using errcode='22023';
    end if;
  end loop;
  select dashboard_authority::text into v_authority from user_access_profiles where user_profile_id=t.id;
  return save_user_access_with_audit(t.id,p_overrides,v_authority);
end $$;

create function save_department_permissions_with_audit(p_department_id uuid,p_overrides jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles; d departments; r record; v_old text; v_new text;
  v_old_map jsonb:='{}'::jsonb; v_new_map jsonb:='{}'::jsonb;
begin
  a:=assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode='42501'; end if;
  perform assert_module_access('settings');
  if p_overrides is null or jsonb_typeof(p_overrides)<>'object' then raise exception 'An override object is required' using errcode='22023'; end if;
  select * into d from departments where id=p_department_id and tenant_id=a.tenant_id and is_active for update;
  if d.id is null then raise exception 'Department not found or not accessible' using errcode='42501'; end if;
  for r in select key,value from jsonb_each(p_overrides) loop
    if not exists(select 1 from permission_catalog where key=r.key and kind='module') then
      raise exception 'Only section permissions can be configured' using errcode='22023';
    end if;
    v_new:=case when jsonb_typeof(r.value)='null' then null else r.value #>> '{}' end;
    if jsonb_typeof(r.value) not in ('string','null') or (v_new is not null and v_new not in ('grant','deny')) then
      raise exception 'Override values must be grant, deny, or null' using errcode='22023';
    end if;
    select effect into v_old from department_permission_overrides where tenant_id=a.tenant_id and department_id=d.id and permission_key=r.key;
    if v_old is not distinct from v_new then continue; end if;
    if v_new is null then
      delete from department_permission_overrides where tenant_id=a.tenant_id and department_id=d.id and permission_key=r.key;
    else
      insert into department_permission_overrides(tenant_id,department_id,permission_key,effect,updated_by)
      values(a.tenant_id,d.id,r.key,v_new,a.id)
      on conflict(tenant_id,department_id,permission_key) do update set effect=excluded.effect,updated_by=excluded.updated_by,updated_at=now();
    end if;
    v_old_map:=v_old_map || jsonb_build_object(r.key,coalesce(v_old,'inherit'));
    v_new_map:=v_new_map || jsonb_build_object(r.key,coalesce(v_new,'inherit'));
  end loop;
  if v_new_map<>'{}'::jsonb then
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'department_permissions_saved','permission_management',d.id,
      jsonb_build_object('department_name',d.name,'permissions',v_old_map),
      jsonb_build_object('department_name',d.name,'permissions',v_new_map));
  end if;
  return get_permission_admin_context();
end $$;
revoke all on function assert_department_section_override() from public,anon,authenticated,service_role;
revoke all on function save_user_section_access_with_audit(uuid,jsonb),save_department_permissions_with_audit(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function save_user_section_access_with_audit(uuid,jsonb),save_department_permissions_with_audit(uuid,jsonb) to authenticated;

-- Classify new permission configuration as retained, preserving the existing retirement gate.
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
    'fms_instance_stage_assignees','fms_instances',
    'fms_context_assignee_defaults','fms_workflow_mutation_keys','form_submission_files',
    'leave_requests','task_import_identity_aliases','designation_permission_overrides',
    'role_permissions','user_access_profiles','user_permission_overrides','department_permission_overrides'
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
      'form_submission_files', (select count(*) from public.form_submission_files where tenant_id = p_tenant_id),
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
      'department_permission_overrides', (select count(*) from public.department_permission_overrides where tenant_id = p_tenant_id),
      'departments', (select count(*) from public.departments where tenant_id = p_tenant_id),
      'user_availability', (select count(*) from public.user_availability where tenant_id = p_tenant_id),
      'leave_requests', (select count(*) from public.leave_requests where tenant_id = p_tenant_id),
      'task_import_identity_aliases', (select count(*) from public.task_import_identity_aliases where tenant_id = p_tenant_id),
      'designation_permission_overrides', (select count(*) from public.designation_permission_overrides where tenant_id = p_tenant_id),
      'role_permissions', (select count(*) from public.role_permissions where tenant_id = p_tenant_id),
      'user_access_profiles', (select count(*) from public.user_access_profiles where tenant_id = p_tenant_id),
      'user_permission_overrides', (select count(*) from public.user_permission_overrides where tenant_id = p_tenant_id),
      'clients', (select count(*) from public.clients where tenant_id = p_tenant_id),
      'crm_documents', (select count(*) from public.crm_documents where tenant_id = p_tenant_id),
      'audit_logs', (select count(*) from public.audit_logs where tenant_id = p_tenant_id)
    )
  );
  return v_manifest;
end;
$$;

revoke all on function public.production_demo_data_retirement_manifest(uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
