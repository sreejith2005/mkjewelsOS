create table dashboard_saved_views (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),user_profile_id uuid not null references user_profiles(id),
 name text not null check(length(btrim(name)) between 1 and 80),config jsonb not null check(jsonb_typeof(config)='object'),record_version integer not null default 1 check(record_version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index dashboard_saved_views_owner_name on dashboard_saved_views(user_profile_id,lower(name));
alter table dashboard_saved_views enable row level security;
create policy dashboard_saved_views_owner_select on dashboard_saved_views for select to authenticated using (
 tenant_id=(select tenant_id from current_profile()) and user_profile_id=(select id from current_profile()) and module_accessible('dashboard'));
create policy dashboard_saved_views_module_select on dashboard_saved_views as restrictive for select to authenticated using (module_accessible('dashboard'));
revoke all on dashboard_saved_views from anon,authenticated;
grant select on dashboard_saved_views to authenticated;

create or replace function save_dashboard_view_with_audit(p_id uuid default null,p_name text default '',p_config jsonb default '{}',p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles; saved dashboard_saved_views; old_config jsonb; section text;
begin
 perform assert_module_access('dashboard');a:=assert_reporting_actor();
 perform pg_advisory_xact_lock(hashtextextended(a.id::text,302));
 if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_config is null then raise exception 'Invalid saved view' using errcode='22023';end if;
 perform assert_json_keys(p_config,array['version','filter','sections'],'saved view');
 if p_config->>'version' is distinct from '1' or jsonb_typeof(p_config->'filter') is distinct from 'object' or jsonb_typeof(p_config->'sections') is distinct from 'array' or jsonb_array_length(p_config->'sections')>4 then raise exception 'Invalid view configuration' using errcode='22023';end if;
 if not(p_config ?& array['version','filter','sections']) then raise exception 'Incomplete saved view' using errcode='22023';end if;
 perform management_insights_context_v1(p_config->'filter');
 for section in select jsonb_array_elements_text(p_config->'sections') loop
  if section not in ('attention','trend','comparison','modules') then raise exception 'Invalid view section' using errcode='22023';end if;
 end loop;
 if (select count(*) from jsonb_array_elements_text(p_config->'sections'))<>(select count(distinct value) from jsonb_array_elements_text(p_config->'sections')) then raise exception 'Duplicate sections' using errcode='22023';end if;
 if p_id is null then
  if (select count(*) from dashboard_saved_views where user_profile_id=a.id)>=20 then raise exception 'Saved view limit reached' using errcode='22023';end if;
  insert into dashboard_saved_views(tenant_id,user_profile_id,name,config) values(a.tenant_id,a.id,btrim(p_name),p_config) returning * into saved;
 else
  select * into saved from dashboard_saved_views where id=p_id and tenant_id=a.tenant_id and user_profile_id=a.id for update;
  if saved.id is null then raise exception 'Saved view denied' using errcode='42501';end if;
  if p_expected_version is null or p_expected_version<>saved.record_version then raise exception 'Saved view changed; refresh and retry' using errcode='40001';end if;
  old_config:=saved.config;
  update dashboard_saved_views set name=btrim(p_name),config=p_config,record_version=record_version+1,updated_at=now() where id=saved.id returning * into saved;
 end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(a.tenant_id,a.id,'dashboard_view_saved','dashboard',saved.id,old_config,p_config);
 return to_jsonb(saved);
end $$;
create function delete_dashboard_view_with_audit(p_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path=public as $$
declare a user_profiles; saved dashboard_saved_views;
begin
 perform assert_module_access('dashboard');a:=assert_reporting_actor();
 select * into saved from dashboard_saved_views where id=p_id and user_profile_id=a.id and tenant_id=a.tenant_id for update;
 if saved.id is null then raise exception 'Saved view denied' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version<>saved.record_version then raise exception 'Saved view changed; refresh and retry' using errcode='40001';end if;
 delete from dashboard_saved_views where id=saved.id;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value) values(a.tenant_id,a.id,'dashboard_view_deleted','dashboard',saved.id,saved.config);
end $$;
revoke all on function save_dashboard_view_with_audit(uuid,text,jsonb,integer),delete_dashboard_view_with_audit(uuid,integer) from public,anon;
grant execute on function save_dashboard_view_with_audit(uuid,text,jsonb,integer),delete_dashboard_view_with_audit(uuid,integer) to authenticated;

-- Saved layout preferences are retained by the existing demo-retirement contract.
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
    'role_permissions','user_access_profiles','user_permission_overrides','department_permission_overrides','dashboard_saved_views'
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
      'dashboard_saved_views', (select count(*) from public.dashboard_saved_views where tenant_id = p_tenant_id),
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

revoke all on function public.production_demo_data_retirement_manifest(uuid) from public,anon,authenticated,service_role;
