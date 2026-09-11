-- Granular permissions, dashboard authority, and server-enforced Developer Mode.
--
-- Concepts are deliberately separate:
--   * role                 user_profiles.user_role (unchanged)
--   * dashboard authority  user_access_profiles.dashboard_authority; the
--                          effective role is coalesce(authority, user_role) and
--                          is what every existing role-level rule now sees
--   * permissions          permission_catalog + role / designation / user layers,
--                          resolved only by permission_effective_for()
--   * feature availability tenant_section_controls.section_availability, now
--                          enforced on the server and no longer tied to whether
--                          the Developer Mode control strip is showing
--
-- Existing users keep their behaviour: role defaults are the catalog defaults
-- (equal to the shipped role matrix and role checks) and no rows are created
-- for them. Design: docs/superpowers/plans/2026-09-11-granular-permissions.md.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Catalog and configuration tables
-- ---------------------------------------------------------------------------

create table permission_catalog (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  kind text not null check (kind in ('module', 'action', 'authority', 'protected')),
  page_id text,
  default_roles user_role[] not null,
  sort_order integer not null unique,
  constraint permission_catalog_module_page check ((kind = 'module') = (page_id is not null))
);

-- The web client mirrors this list in packages/core/src/permissions/catalog.ts;
-- catalog.migration.test.ts parses the block below to keep them in parity.
-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('home.view', 'module', 'home', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 10),
('dashboard.view', 'module', 'dashboard', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 20),
('tasks.view', 'module', 'checklist_tasks', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 30),
('tasks.manage_team', 'authority', null, '{super_admin,admin,manager}', 40),
('tasks.view_all', 'authority', null, '{super_admin,admin}', 50),
('recurring_todo.view', 'module', 'recurring_todo', '{super_admin,admin}', 60),
('task_control.view', 'module', 'task_templates', '{super_admin,admin,manager,hr}', 70),
('fms.view', 'module', 'fms_builder', '{super_admin,admin,manager,crm,staff,doer}', 80),
('fms.manage', 'action', null, '{super_admin,admin}', 90),
('forms.view', 'module', 'forms_library', '{super_admin,admin,manager,crm,staff}', 100),
('forms.manage', 'action', null, '{super_admin,admin,manager}', 110),
('crm.view', 'module', 'crm', '{super_admin,admin,manager,crm}', 120),
('notifications.view', 'module', 'notifications', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 130),
('notifications.manage', 'action', null, '{super_admin,admin}', 140),
('users.view', 'module', 'users', '{super_admin,admin,manager,hr}', 150),
('users.manage', 'action', null, '{super_admin,admin}', 160),
('users.delete', 'action', null, '{super_admin}', 170),
('availability.view', 'module', 'availability', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 180),
('availability.manage_others', 'action', null, '{super_admin,admin,manager,hr}', 190),
('reports.view', 'module', 'reports', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 200),
('reports.export', 'action', null, '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 210),
('dropdowns.view', 'module', 'dropdown_master', '{super_admin}', 220),
('dropdowns.manage', 'action', null, '{super_admin}', 230),
('settings.view', 'module', 'settings', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 240),
('settings.manage_organization', 'action', null, '{super_admin,admin}', 250),
('settings.manage_branch', 'action', null, '{super_admin,admin,manager}', 260),
('daily_checklists.manage', 'action', null, '{super_admin,hr}', 270),
('permissions.manage', 'protected', null, '{super_admin}', 280),
('developer_mode.manage', 'protected', null, '{super_admin}', 290);
-- permission-catalog:end

alter table permission_catalog enable row level security;
revoke all on permission_catalog from public, anon, authenticated, service_role;

create table role_permissions (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_role user_role not null,
  permission_key text not null references permission_catalog(key) on delete cascade,
  is_allowed boolean not null,
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_role, permission_key)
);

create table designation_permission_overrides (
  tenant_id uuid not null references tenants(id) on delete cascade,
  designation_id uuid not null references dropdown_masters(id) on delete cascade,
  permission_key text not null references permission_catalog(key) on delete cascade,
  effect text not null check (effect in ('grant', 'deny')),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, designation_id, permission_key)
);
create index idx_designation_permission_overrides_designation on designation_permission_overrides(designation_id);

create table user_permission_overrides (
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  permission_key text not null references permission_catalog(key) on delete cascade,
  effect text not null check (effect in ('grant', 'deny')),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_profile_id, permission_key)
);
create index idx_user_permission_overrides_tenant on user_permission_overrides(tenant_id);

-- A row exists only while an authority override is set; no row means "inherit
-- the role".
create table user_access_profiles (
  user_profile_id uuid primary key references user_profiles(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  dashboard_authority user_role not null
    check (dashboard_authority in ('staff', 'manager', 'admin', 'super_admin')),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index idx_user_access_profiles_tenant on user_access_profiles(tenant_id);

-- Configuration is read and written only through the audited RPCs below.
alter table role_permissions enable row level security;
alter table designation_permission_overrides enable row level security;
alter table user_permission_overrides enable row level security;
alter table user_access_profiles enable row level security;
revoke all on role_permissions, designation_permission_overrides, user_permission_overrides, user_access_profiles
  from public, anon, authenticated, service_role;

-- Defence in depth: protected and authority permissions can never be stored as
-- configuration, whatever writes the row.
create function assert_configurable_permission()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from permission_catalog where key = new.permission_key and kind in ('module', 'action')) then
    raise exception 'Permission % cannot be configured', new.permission_key using errcode = '22023';
  end if;
  return new;
end $$;

create trigger role_permissions_configurable before insert or update on role_permissions
  for each row execute function assert_configurable_permission();
create trigger designation_permission_overrides_configurable before insert or update on designation_permission_overrides
  for each row execute function assert_configurable_permission();
create trigger user_permission_overrides_configurable before insert or update on user_permission_overrides
  for each row execute function assert_configurable_permission();

-- Clients subscribed to the settings topic reload their access snapshot.
create trigger tenant_realtime_settings_role_permissions after insert or update or delete on role_permissions
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_settings_designation_permissions after insert or update or delete on designation_permission_overrides
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_settings_user_permissions after insert or update or delete on user_permission_overrides
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_settings_user_access after insert or update or delete on user_access_profiles
  for each row execute function emit_realtime_direct_event('settings');

-- ---------------------------------------------------------------------------
-- 2. Dashboard authority feeds the existing role-level authorization
-- ---------------------------------------------------------------------------

create or replace function current_profile()
returns user_profiles
language sql stable security definer
set search_path = public
as $$
  select case
    when a.dashboard_authority is null then p
    else jsonb_populate_record(p, jsonb_build_object('user_role', a.dashboard_authority))
  end
  from user_profiles p
  left join user_access_profiles a on a.user_profile_id = p.id
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function current_role_level()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select coalesce(a.dashboard_authority, p.user_role)
  from user_profiles p
  left join user_access_profiles a on a.user_profile_id = p.id
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

-- Many contracts resolve the actor inline instead of through current_profile().
-- Point those lookups at current_profile() so they see the same effective role.
-- Lookups that lock the row (FOR UPDATE/SHARE) are left untouched.
do $identity$
declare
  f record;
  v_def text;
  v_new text;
  v_count integer := 0;
  v_pattern constant text :=
    '(from\s+)(?:public\.)?user_profiles(\s+(?:as\s+)?(?!where\M)[a-z_][a-z0-9_]*)?(\s+where\s+(?:[a-z_][a-z0-9_]*\.)?auth_user_id\s*=\s*auth\.uid\(\))(?!\s*(?:limit\s+1\s*)?for\s+(?:update|share))';
begin
  for f in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname not in ('current_profile', 'current_role_level', 'current_tenant_id', 'current_branch_id', 'current_profile_is_active', 'is_super_admin')
      and p.prosrc ~* v_pattern
  loop
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def, v_pattern, '\1current_profile()\2\3', 'gi');
    if v_new <> v_def then
      execute v_new;
      v_count := v_count + 1;
    end if;
  end loop;
  raise notice 'Dashboard authority: % actor lookups now read current_profile()', v_count;
end $identity$;

-- ---------------------------------------------------------------------------
-- 3. The single permission resolver
-- ---------------------------------------------------------------------------

-- protected -> Super Admin authority only; authority -> follows the effective
-- role; otherwise user override > designation override > role row > default.
create function permission_effective_for(p_profile_id uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_profile user_profiles;
  v_catalog permission_catalog;
  v_role user_role;
  v_effect text;
  v_allowed boolean;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  select * into v_catalog from permission_catalog where key = p_key;
  if v_profile.id is null or v_catalog.key is null then return false; end if;

  select coalesce((select a.dashboard_authority from user_access_profiles a where a.user_profile_id = v_profile.id), v_profile.user_role)
    into v_role;
  if v_catalog.kind = 'protected' then return v_role = 'super_admin'; end if;
  if v_catalog.kind = 'authority' then return v_role = any(v_catalog.default_roles); end if;

  select o.effect into v_effect from user_permission_overrides o
    where o.user_profile_id = v_profile.id and o.permission_key = p_key;
  if v_effect is not null then return v_effect = 'grant'; end if;

  if v_profile.designation_id is not null then
    select o.effect into v_effect
    from designation_permission_overrides o
    join dropdown_masters d on d.id = o.designation_id and d.is_active
    where o.tenant_id = v_profile.tenant_id and o.designation_id = v_profile.designation_id and o.permission_key = p_key;
    if v_effect is not null then return v_effect = 'grant'; end if;
  end if;

  select r.is_allowed into v_allowed from role_permissions r
    where r.tenant_id = v_profile.tenant_id and r.user_role = v_role and r.permission_key = p_key;
  return coalesce(v_allowed, v_role = any(v_catalog.default_roles));
end $$;

create function has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    current_profile_is_active()
      and permission_effective_for((select id from user_profiles where auth_user_id = auth.uid() limit 1), p_key),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Feature availability (Developer Mode) enforcement
-- ---------------------------------------------------------------------------

-- Legacy sub-pages follow their parent section so old links cannot bypass it.
create function module_enabled(p_page text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce((c.section_availability ->> p_page)::boolean, true)
      and coalesce((c.section_availability ->> case p_page
        when 'fms_tasks' then 'fms_builder'
        when 'task_evidence' then 'task_templates'
        when 'delegation_tasks' then 'checklist_tasks'
        else p_page end)::boolean, true)
    from tenant_section_controls c
    where c.tenant_id = current_tenant_id()
  ), true);
$$;

-- Service-role jobs, cron and unauthenticated calls are not end users and pass;
-- inactive profiles pass here so each contract keeps reporting its own
-- established "active profile required" error.
create function module_accessible(p_page text, p_require_permission boolean default true)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_profile_id uuid; v_key text;
begin
  if auth.uid() is null then return true; end if;
  select id into v_profile_id from user_profiles where auth_user_id = auth.uid() limit 1;
  if v_profile_id is null or not current_profile_is_active() then return true; end if;
  if not module_enabled(p_page) and not permission_effective_for(v_profile_id, 'developer_mode.manage') then
    return false;
  end if;
  if p_require_permission then
    select key into v_key from permission_catalog where page_id = p_page and kind = 'module';
    if v_key is not null then return permission_effective_for(v_profile_id, v_key); end if;
  end if;
  return true;
end $$;

create function assert_module_enabled(p_page text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not module_accessible(p_page, false) then
    raise exception 'This section is currently unavailable' using errcode = '42501',
      hint = 'The section has been disabled in Developer Mode.';
  end if;
end $$;

create function assert_module_access(p_page text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_module_enabled(p_page);
  if not module_accessible(p_page, true) then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
end $$;

-- A disabled section now stays disabled after the control strip is hidden.
-- Tenants whose Developer Mode was off were effectively all-available; make the
-- stored state say so before the stored flags start being enforced.
do $normalize$
declare c tenant_section_controls;
begin
  for c in
    select * from tenant_section_controls
    where not developer_mode_enabled
      and exists (select 1 from jsonb_each(section_availability) e where e.value = 'false'::jsonb)
    for update
  loop
    update tenant_section_controls
      set section_availability = default_section_availability(), settings_version = settings_version + 1, updated_at = now()
      where tenant_id = c.tenant_id;
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (c.tenant_id, null, 'section_availability_normalized', 'developer_controls', c.tenant_id,
      jsonb_build_object('developer_mode_enabled', c.developer_mode_enabled, 'section_availability', c.section_availability, 'settings_version', c.settings_version),
      jsonb_build_object('developer_mode_enabled', c.developer_mode_enabled, 'section_availability', default_section_availability(), 'settings_version', c.settings_version + 1,
        'reason', 'Section flags are enforced independently of Developer Mode from migration 0156; preserved the previously effective state.'));
  end loop;
end $normalize$;

-- ---------------------------------------------------------------------------
-- 5. Wire action permissions into the existing checks (exact-text upgrades,
--    following the 0144 pattern; each fails loudly if the contract changed)
-- ---------------------------------------------------------------------------

create function pg_temp.upgrade_contract(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare f record; v_def text; v_done integer := 0;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = p_name loop
    v_def := pg_get_functiondef(f.oid);
    if position(p_old in v_def) > 0 then
      execute replace(v_def, p_old, p_new);
      v_done := v_done + 1;
    end if;
  end loop;
  if v_done = 0 then
    raise exception 'Authorization contract % could not be upgraded: expected text not found', p_name;
  end if;
end $$;

select pg_temp.upgrade_contract('assert_crm_actor',
  $old$v_actor.user_role not in ('super_admin','admin','manager','crm')$old$,
  $new$not has_permission('crm.view')$new$);

select pg_temp.upgrade_contract('assert_notification_admin',
  $old$v_actor.user_role not in ('super_admin','admin')$old$,
  $new$not has_permission('notifications.manage')$new$);

select pg_temp.upgrade_contract('can_manage_fms_flow',
  $old$and actor.user_role in ('super_admin','admin')$old$,
  $new$and has_permission('fms.manage')$new$);

select pg_temp.upgrade_contract('can_manage_form_template',
  $old$and current_role_level() in ('super_admin','admin','manager')$old$,
  $new$and has_permission('forms.manage')$new$);

select pg_temp.upgrade_contract('save_form_draft_with_audit',
  $old$v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active manager, admin, or super_admin profiles can author forms'$old$,
  $new$not has_permission('forms.manage') then raise exception 'Only active manager, admin, or super_admin profiles can author forms'$new$);

select pg_temp.upgrade_contract('update_user_profile_with_audit',
  $old$v_actor.user_role not in ('super_admin','admin') or not current_profile_is_active()$old$,
  $new$not has_permission('users.manage') or not current_profile_is_active()$new$);
-- Generalised from "an Admin" so a user granted users.manage cannot edit a
-- Super Admin either; identical for the roles that could edit users before.
select pg_temp.upgrade_contract('update_user_profile_with_audit',
  $old$if v_actor.user_role='admin' and v_old.user_role='super_admin' then$old$,
  $new$if v_actor.user_role<>'super_admin' and v_old.user_role='super_admin' then$new$);

select pg_temp.upgrade_contract('prepare_unused_user_deletion',
  $old$v_actor.user_role <> 'super_admin' or not current_profile_is_active()$old$,
  $new$not has_permission('users.delete') or not current_profile_is_active()$new$);
select pg_temp.upgrade_contract('prepare_unused_user_deletion',
  $old$if v_target.id = v_actor.id then raise exception 'You cannot delete your own account'$old$,
  $new$if v_target.user_role = 'super_admin' and v_actor.user_role <> 'super_admin' then raise exception 'Only a super_admin can delete a super_admin account' using errcode='42501'; end if;
  if v_target.id = v_actor.id then raise exception 'You cannot delete your own account'$new$);

select pg_temp.upgrade_contract('save_tenant_settings_with_audit',
  $old$if a.user_role not in ('super_admin','admin') then raise exception 'Tenant settings denied'$old$,
  $new$if not has_permission('settings.manage_organization') then raise exception 'Tenant settings denied'$new$);

select pg_temp.upgrade_contract('save_branch_settings_with_audit',
  $old$if a.user_role not in ('super_admin','admin','manager') then raise exception 'Branch settings denied'$old$,
  $new$if not has_permission('settings.manage_branch') then raise exception 'Branch settings denied'$new$);
-- Anyone below Admin authority stays limited to their own branch.
select pg_temp.upgrade_contract('save_branch_settings_with_audit',
  $old$(a.user_role='manager' and b.id<>a.branch_id)$old$,
  $new$(a.user_role not in ('super_admin','admin') and b.id<>a.branch_id)$new$);

select pg_temp.upgrade_contract('record_availability_with_audit',
  $old$v_actor.user_role in ('super_admin','admin','manager','hr')$old$,
  $new$has_permission('availability.manage_others')$new$);

select pg_temp.upgrade_contract('change_dropdown_with_audit',
  $old$v_actor.user_role <> 'super_admin'$old$,
  $new$not has_permission('dropdowns.manage')$new$);

select pg_temp.upgrade_contract('list_designation_daily_checklists',
  $old$a.user_role not in ('super_admin', 'hr')$old$,
  $new$not has_permission('daily_checklists.manage')$new$);
select pg_temp.upgrade_contract('save_designation_daily_checklist_with_audit',
  $old$a.user_role not in ('super_admin', 'hr')$old$,
  $new$not has_permission('daily_checklists.manage')$new$);

select pg_temp.upgrade_contract('request_report_export_with_audit',
  $old$if not report_allowed_for_role(p_report_key,a.user_role,true) then raise exception 'Report export denied'$old$,
  $new$if not report_allowed_for_role(p_report_key,a.user_role,true) or not has_permission('reports.export') then raise exception 'Report export denied'$new$);

select pg_temp.upgrade_contract('save_section_availability_with_audit',
  $old$if a.user_role <> 'super_admin' then$old$,
  $new$if not has_permission('developer_mode.manage') then$new$);

-- New tenant-scoped tables are retained with their tenant (and cascade with
-- their profiles), so they only need to be classified.
select pg_temp.upgrade_contract('production_demo_data_retirement_manifest',
  $old$'fms_context_assignee_defaults','fms_workflow_mutation_keys','form_submission_files'$old$,
  $new$'fms_context_assignee_defaults','fms_workflow_mutation_keys','form_submission_files',
    'role_permissions','designation_permission_overrides','user_permission_overrides','user_access_profiles'$new$);

-- ---------------------------------------------------------------------------
-- 6. Section gates on the server contracts behind each section
-- ---------------------------------------------------------------------------
-- require_permission = true only where the RPC is used exclusively by that
-- section and every role that can reach the section already holds the
-- permission; shared runtime contracts (tasks, FMS stages, forms, recurring
-- schedules, availability, inbox) that Home and other sections call get the
-- availability gate only, and their own role / action checks keep authorizing.

do $gates$
declare
  g record;
  f record;
  v_def text;
  v_tag text;
  v_body integer;
  v_at integer;
  v_call text;
begin
  for g in
    select * from (values
      ('get_report_data', 'reports', true),
      ('request_report_export_with_audit', 'reports', true),
      ('cancel_report_export_with_audit', 'reports', true),
      ('retry_report_export_with_audit', 'reports', true),
      ('get_report_export_download_url', 'reports', true),
      ('get_dashboard_metrics', 'dashboard', true),
      ('get_home_summary', 'home', true),
      ('cancel_crm_followup', 'crm', false),
      ('complete_crm_followup', 'crm', false),
      ('create_crm_client', 'crm', false),
      ('create_crm_followup', 'crm', false),
      ('get_crm_client_detail', 'crm', false),
      ('get_crm_document_path', 'crm', false),
      ('list_crm_followups', 'crm', false),
      ('log_crm_interaction', 'crm', false),
      ('lookup_crm_client_by_phone', 'crm', false),
      ('merge_crm_clients', 'crm', false),
      ('reassign_crm_client', 'crm', false),
      ('record_crm_walkin', 'crm', false),
      ('register_crm_document', 'crm', false),
      ('remove_crm_document', 'crm', false),
      ('reschedule_crm_followup', 'crm', false),
      ('search_crm_clients', 'crm', false),
      ('update_crm_client', 'crm', false),
      ('get_task_template_directory', 'task_templates', false),
      ('set_task_template_schedule_with_audit', 'task_templates', false),
      ('delete_task_template_with_audit', 'task_templates', false),
      ('get_employee_task_progress', 'task_templates', false),
      ('get_task_evidence_workspace', 'task_templates', false),
      ('get_recurring_todo_workspace', 'recurring_todo', false),
      ('delete_recurring_todo_template_with_audit', 'recurring_todo', false),
      ('send_recurring_followup_with_audit', 'recurring_todo', false),
      ('verify_recurring_task_with_audit', 'recurring_todo', false),
      ('create_manual_task_with_mode_with_audit', 'checklist_tasks', false),
      ('create_delegation_task_with_audit', 'checklist_tasks', false),
      ('delegate_task_with_audit', 'checklist_tasks', false),
      ('update_task_with_audit', 'checklist_tasks', false),
      ('revise_task_datetime_with_audit', 'checklist_tasks', false),
      ('add_task_attachment_with_audit', 'checklist_tasks', false),
      ('complete_uploaded_task_with_audit', 'checklist_tasks', false),
      ('begin_task_bulk_import', 'checklist_tasks', false),
      ('commit_task_bulk_import_chunk', 'checklist_tasks', false),
      ('import_task_bulk_with_audit', 'checklist_tasks', false),
      ('validate_task_bulk_import', 'checklist_tasks', false),
      ('list_assigning_left_tasks', 'checklist_tasks', false),
      ('assign_imported_task_with_audit', 'checklist_tasks', false),
      ('reconcile_task_import_assignments', 'checklist_tasks', false),
      ('save_task_import_identity_alias_with_audit', 'checklist_tasks', false),
      ('list_task_import_identity_candidates', 'checklist_tasks', false),
      ('archive_fms_flow_with_audit', 'fms_builder', false),
      ('claim_fms_stage_with_audit', 'fms_builder', false),
      ('complete_fms_stage_with_audit', 'fms_builder', false),
      ('create_fms_revision_with_audit', 'fms_builder', false),
      ('delete_fms_flow_with_audit', 'fms_builder', false),
      ('escalate_fms_stage_with_audit', 'fms_builder', false),
      ('move_fms_stage_backward_with_audit', 'fms_builder', false),
      ('publish_fms_flow_with_audit', 'fms_builder', false),
      ('reassign_fms_stage_with_audit', 'fms_builder', false),
      ('register_fms_evidence_with_audit', 'fms_builder', false),
      ('request_fms_revision_with_audit', 'fms_builder', false),
      ('restore_fms_flow_with_audit', 'fms_builder', false),
      ('review_fms_stage_with_audit', 'fms_builder', false),
      ('save_fms_context_assignee_default_with_audit', 'fms_builder', false),
      ('save_fms_flow_draft_with_audit', 'fms_builder', false),
      ('set_fms_flow_active_with_audit', 'fms_builder', false),
      ('set_fms_flow_context_with_audit', 'fms_builder', false),
      ('start_fms_instance_with_audit', 'fms_builder', false),
      ('submit_fms_form_and_progress_with_audit', 'fms_builder', false),
      ('update_fms_checklist_item_with_audit', 'fms_builder', false),
      ('start_fms_from_form_submission_with_audit', 'fms_builder', false),
      ('save_form_draft_with_audit', 'forms_library', false),
      ('publish_form_with_audit', 'forms_library', false),
      ('archive_form_with_audit', 'forms_library', false),
      ('create_form_revision_with_audit', 'forms_library', false),
      ('duplicate_form_with_audit', 'forms_library', false),
      ('delete_form_with_audit', 'forms_library', false),
      ('save_published_form_with_audit', 'forms_library', false),
      ('form_deletion_impact', 'forms_library', false),
      ('review_form_submission_with_audit', 'forms_library', false),
      ('mark_notification_read', 'notifications', false),
      ('mark_all_notifications_read', 'notifications', false),
      ('list_notification_delivery_logs', 'notifications', false),
      ('retry_notification_delivery', 'notifications', false),
      ('save_notification_rule', 'notifications', false),
      ('save_notification_template', 'notifications', false),
      ('archive_notification_rule', 'notifications', false),
      ('archive_notification_template', 'notifications', false),
      ('set_notification_rule_enabled', 'notifications', false),
      ('get_notification_provider_availability', 'notifications', false),
      ('update_user_profile_with_audit', 'users', false),
      ('prepare_unused_user_deletion', 'users', false),
      ('record_availability_with_audit', 'availability', false),
      ('record_availability_range_with_audit', 'availability', false),
      ('change_dropdown_with_audit', 'dropdown_master', false),
      ('save_tenant_settings_with_audit', 'settings', false),
      ('save_branch_settings_with_audit', 'settings', false),
      ('save_user_preferences_with_audit', 'settings', false),
      ('list_designation_daily_checklists', 'settings', false),
      ('save_designation_daily_checklist_with_audit', 'settings', false)
    ) as gate(fn, page, require_permission)
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = g.fn) then
      raise exception 'Section gate target public.% does not exist', g.fn;
    end if;
    v_call := format('public.assert_module_%s(%L);', case when g.require_permission then 'access' else 'enabled' end, g.page);
    for f in
      select p.oid, l.lanname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and p.proname = g.fn
    loop
      v_def := pg_get_functiondef(f.oid);
      continue when position('assert_module_' in v_def) > 0;
      v_tag := substring(v_def from '\nAS (\$[A-Za-z_0-9]*\$)');
      if v_tag is null then raise exception 'Section gate target public.% has an unsupported body', g.fn; end if;
      v_body := position(E'\nAS ' || v_tag in v_def) + length(E'\nAS ' || v_tag);
      if f.lanname = 'plpgsql' then
        v_at := regexp_instr(v_def, '\mbegin\M', v_body, 1, 1, 'i');
        if v_at = 0 then raise exception 'Section gate target public.% has no body block', g.fn; end if;
        v_def := substr(v_def, 1, v_at - 1) || E'\n  perform ' || v_call || substr(v_def, v_at);
      elsif f.lanname = 'sql' then
        v_def := substr(v_def, 1, v_body - 1) || E'\n  select ' || v_call || substr(v_def, v_body);
      else
        raise exception 'Section gate target public.% uses unsupported language %', g.fn, f.lanname;
      end if;
      execute v_def;
    end loop;
  end loop;
end $gates$;

-- Tables owned by a single section also refuse reads while it is disabled.
-- Restrictive SELECT policies are ANDed with the existing ones and never widen
-- access; writes already go through the gated contracts above.
do $policies$
declare t record;
begin
  for t in
    select * from (values
      ('clients', 'crm'), ('client_assignments', 'crm'), ('client_contact_aliases', 'crm'),
      ('client_followups', 'crm'), ('client_timeline', 'crm'), ('crm_documents', 'crm'),
      ('crm_custom_field_values', 'crm'), ('crm_field_definitions', 'crm'),
      ('crm_field_definition_revisions', 'crm'), ('walkin_entries', 'crm'), ('walkin_uploads', 'crm'),
      ('export_logs', 'reports'),
      ('notifications', 'notifications'), ('notification_templates', 'notifications'),
      ('notification_rules', 'notifications'), ('notification_deliveries', 'notifications'),
      ('notification_events', 'notifications'), ('notification_logs', 'notifications'),
      ('notification_provider_configuration', 'notifications')
    ) as gate(table_name, page)
  loop
    if to_regclass('public.' || t.table_name) is null then
      raise exception 'Section policy target public.% does not exist', t.table_name;
    end if;
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using ((select public.module_accessible(%L, false)))',
      t.table_name || '_section_available', t.table_name, t.page
    );
  end loop;
end $policies$;

-- ---------------------------------------------------------------------------
-- 7. Access and permission-management contracts
-- ---------------------------------------------------------------------------

-- The signed-in user's own access snapshot. Computed on every call so a
-- permission change is effective on the next request; nothing is cached in the
-- JWT.
create function get_my_access_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_profile user_profiles; v_authority user_role;
begin
  select * into v_profile from user_profiles where auth_user_id = auth.uid() limit 1;
  if v_profile.id is null or not current_profile_is_active() then
    raise exception 'Active profile required' using errcode = '42501';
  end if;
  select dashboard_authority into v_authority from user_access_profiles where user_profile_id = v_profile.id;
  return jsonb_build_object(
    'profile_id', v_profile.id,
    'base_role', v_profile.user_role,
    'dashboard_authority', v_authority,
    'effective_role', coalesce(v_authority, v_profile.user_role),
    'permissions', (select jsonb_object_agg(c.key, permission_effective_for(v_profile.id, c.key)) from permission_catalog c)
  );
end $$;

create function get_permission_admin_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'catalog', (select jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'page_id', c.page_id, 'default_roles', to_jsonb(c.default_roles)) order by c.sort_order) from permission_catalog c),
    'roles', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role'),
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

create function get_user_access_breakdown(p_profile_id uuid)
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
      'designation_id', t.designation_id, 'designation_label', v_designation.label, 'account_status', t.account_status),
    'dashboard_authority', v_authority,
    'effective_role', v_role,
    'rows', (select jsonb_agg(jsonb_build_object(
        'key', c.key,
        'role_default', case c.kind
          when 'protected' then v_role = 'super_admin'
          when 'authority' then v_role = any(c.default_roles)
          else coalesce(rp.is_allowed, v_role = any(c.default_roles)) end,
        'role_configured', c.kind in ('module', 'action') and rp.is_allowed is not null,
        'designation', case when c.kind in ('module', 'action') and coalesce(v_designation.is_active, false) then dpo.effect end,
        'user', case when c.kind in ('module', 'action') then upo.effect end,
        'effective', permission_effective_for(t.id, c.key)
      ) order by c.sort_order)
      from permission_catalog c
      left join role_permissions rp on rp.tenant_id = t.tenant_id and rp.user_role = v_role and rp.permission_key = c.key
      left join designation_permission_overrides dpo on dpo.tenant_id = t.tenant_id and dpo.designation_id = t.designation_id and dpo.permission_key = c.key
      left join user_permission_overrides upo on upo.user_profile_id = t.id and upo.permission_key = c.key)
  );
end $$;

-- p_permissions: { "<key>": true | false | null }; null restores the default.
create function save_role_permissions_with_audit(p_role user_role, p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; r record; v_old boolean; v_new boolean; v_old_map jsonb := '{}'::jsonb; v_new_map jsonb := '{}'::jsonb;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  if p_role is null or p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    raise exception 'A role and a permission object are required' using errcode = '22023';
  end if;
  for r in select key, value from jsonb_each(p_permissions) loop
    if not exists (select 1 from permission_catalog c where c.key = r.key and c.kind in ('module', 'action')) then
      raise exception 'Permission % cannot be configured', r.key using errcode = '22023';
    end if;
    if jsonb_typeof(r.value) not in ('boolean', 'null') then
      raise exception 'Role permission values must be true, false, or null' using errcode = '22023';
    end if;
    v_new := case when jsonb_typeof(r.value) = 'null' then null else r.value::boolean end;
    select is_allowed into v_old from role_permissions where tenant_id = a.tenant_id and user_role = p_role and permission_key = r.key;
    if v_new is null then
      delete from role_permissions where tenant_id = a.tenant_id and user_role = p_role and permission_key = r.key;
    else
      insert into role_permissions(tenant_id, user_role, permission_key, is_allowed, updated_by)
      values (a.tenant_id, p_role, r.key, v_new, a.id)
      on conflict (tenant_id, user_role, permission_key) do update
        set is_allowed = excluded.is_allowed, updated_by = excluded.updated_by, updated_at = now();
    end if;
    if v_old is distinct from v_new then
      v_old_map := v_old_map || jsonb_build_object(r.key, coalesce(to_jsonb(v_old), '"default"'::jsonb));
      v_new_map := v_new_map || jsonb_build_object(r.key, coalesce(to_jsonb(v_new), '"default"'::jsonb));
    end if;
  end loop;
  if v_new_map <> '{}'::jsonb then
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (a.tenant_id, a.id, 'role_permissions_saved', 'permission_management', null,
      jsonb_build_object('role', p_role, 'permissions', v_old_map),
      jsonb_build_object('role', p_role, 'permissions', v_new_map));
  end if;
  return jsonb_build_object('role', p_role, 'changed', (select count(*) from jsonb_object_keys(v_new_map)));
end $$;

-- p_overrides: { "<key>": "grant" | "deny" | null }; null removes the override.
create function save_designation_permissions_with_audit(p_designation_id uuid, p_overrides jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; d dropdown_masters; r record; v_old text; v_new text; v_old_map jsonb := '{}'::jsonb; v_new_map jsonb := '{}'::jsonb;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  if p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then raise exception 'An override object is required' using errcode = '22023'; end if;
  select * into d from dropdown_masters where id = p_designation_id and master_type = 'designation' and (tenant_id = a.tenant_id or tenant_id is null);
  if d.id is null then raise exception 'Designation not found' using errcode = '23503'; end if;
  for r in select key, value from jsonb_each(p_overrides) loop
    if not exists (select 1 from permission_catalog c where c.key = r.key and c.kind in ('module', 'action')) then
      raise exception 'Permission % cannot be configured', r.key using errcode = '22023';
    end if;
    v_new := case when jsonb_typeof(r.value) = 'null' then null else r.value #>> '{}' end;
    if jsonb_typeof(r.value) not in ('string', 'null') or (v_new is not null and v_new not in ('grant', 'deny')) then
      raise exception 'Override values must be grant, deny, or null' using errcode = '22023';
    end if;
    select effect into v_old from designation_permission_overrides where tenant_id = a.tenant_id and designation_id = d.id and permission_key = r.key;
    if v_new is null then
      delete from designation_permission_overrides where tenant_id = a.tenant_id and designation_id = d.id and permission_key = r.key;
    else
      insert into designation_permission_overrides(tenant_id, designation_id, permission_key, effect, updated_by)
      values (a.tenant_id, d.id, r.key, v_new, a.id)
      on conflict (tenant_id, designation_id, permission_key) do update
        set effect = excluded.effect, updated_by = excluded.updated_by, updated_at = now();
    end if;
    if v_old is distinct from v_new then
      v_old_map := v_old_map || jsonb_build_object(r.key, coalesce(v_old, 'inherit'));
      v_new_map := v_new_map || jsonb_build_object(r.key, coalesce(v_new, 'inherit'));
    end if;
  end loop;
  if v_new_map <> '{}'::jsonb then
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (a.tenant_id, a.id, 'designation_permissions_saved', 'permission_management', d.id,
      jsonb_build_object('designation', d.label, 'permissions', v_old_map),
      jsonb_build_object('designation', d.label, 'permissions', v_new_map));
  end if;
  return jsonb_build_object('designation_id', d.id, 'changed', (select count(*) from jsonb_object_keys(v_new_map)));
end $$;

-- p_dashboard_authority: null (or omitted) inherits the role. p_overrides as
-- above; keys not listed are left unchanged.
create function save_user_access_with_audit(p_profile_id uuid, p_overrides jsonb, p_dashboard_authority text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a user_profiles; t user_profiles; r record;
  v_old_authority user_role; v_new_authority user_role;
  v_old text; v_new text; v_old_map jsonb := '{}'::jsonb; v_new_map jsonb := '{}'::jsonb;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  if p_profile_id is null or p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'A profile and an override object are required' using errcode = '22023';
  end if;
  if p_dashboard_authority is not null and p_dashboard_authority not in ('staff', 'manager', 'admin', 'super_admin') then
    raise exception 'Invalid dashboard authority' using errcode = '22023';
  end if;
  select * into t from user_profiles where id = p_profile_id for update;
  if t.id is null or t.tenant_id <> a.tenant_id then raise exception 'Profile not found or not accessible' using errcode = '42501'; end if;
  if t.id = a.id then
    raise exception 'You cannot change your own access; ask another Super Admin' using errcode = '42501';
  end if;

  select dashboard_authority into v_old_authority from user_access_profiles where user_profile_id = t.id;
  v_new_authority := p_dashboard_authority::user_role;
  if coalesce(v_old_authority, t.user_role) = 'super_admin' and coalesce(v_new_authority, t.user_role) <> 'super_admin'
     and not exists (
       select 1 from user_profiles p left join user_access_profiles ua on ua.user_profile_id = p.id
       where p.tenant_id = t.tenant_id and p.id <> t.id and p.account_status = 'active' and p.is_login_enabled is true
         and coalesce(ua.dashboard_authority, p.user_role) = 'super_admin'
     ) then
    raise exception 'At least one active Super Admin is required' using errcode = '23514';
  end if;
  if v_new_authority is null then
    delete from user_access_profiles where user_profile_id = t.id;
  else
    insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority, updated_by)
    values (t.id, t.tenant_id, v_new_authority, a.id)
    on conflict (user_profile_id) do update
      set dashboard_authority = excluded.dashboard_authority, updated_by = excluded.updated_by, updated_at = now();
  end if;

  for r in select key, value from jsonb_each(p_overrides) loop
    if not exists (select 1 from permission_catalog c where c.key = r.key and c.kind in ('module', 'action')) then
      raise exception 'Permission % cannot be configured', r.key using errcode = '22023';
    end if;
    v_new := case when jsonb_typeof(r.value) = 'null' then null else r.value #>> '{}' end;
    if jsonb_typeof(r.value) not in ('string', 'null') or (v_new is not null and v_new not in ('grant', 'deny')) then
      raise exception 'Override values must be grant, deny, or null' using errcode = '22023';
    end if;
    select effect into v_old from user_permission_overrides where user_profile_id = t.id and permission_key = r.key;
    if v_new is null then
      delete from user_permission_overrides where user_profile_id = t.id and permission_key = r.key;
    else
      insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect, updated_by)
      values (t.id, t.tenant_id, r.key, v_new, a.id)
      on conflict (user_profile_id, permission_key) do update
        set effect = excluded.effect, updated_by = excluded.updated_by, updated_at = now();
    end if;
    if v_old is distinct from v_new then
      v_old_map := v_old_map || jsonb_build_object(r.key, coalesce(v_old, 'inherit'));
      v_new_map := v_new_map || jsonb_build_object(r.key, coalesce(v_new, 'inherit'));
    end if;
  end loop;

  if v_old_authority is distinct from v_new_authority or v_new_map <> '{}'::jsonb then
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (a.tenant_id, a.id, 'user_access_saved', 'permission_management', t.id,
      jsonb_build_object('employee_name', t.employee_name, 'dashboard_authority', coalesce(v_old_authority::text, 'inherit'), 'permissions', v_old_map),
      jsonb_build_object('employee_name', t.employee_name, 'dashboard_authority', coalesce(v_new_authority::text, 'inherit'), 'permissions', v_new_map));
  end if;
  return get_user_access_breakdown(t.id);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Ownership and grants
-- ---------------------------------------------------------------------------

do $grants$
declare f record;
begin
  for f in
    select p.oid::regprocedure as identity
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'assert_configurable_permission', 'permission_effective_for', 'has_permission', 'module_enabled',
      'module_accessible', 'assert_module_enabled', 'assert_module_access', 'get_my_access_context',
      'get_permission_admin_context', 'get_user_access_breakdown', 'save_role_permissions_with_audit',
      'save_designation_permissions_with_audit', 'save_user_access_with_audit'
    )
  loop
    execute format('alter function %s owner to postgres', f.identity);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.identity);
  end loop;
end $grants$;

-- module_accessible is evaluated inside RLS policies, so the querying role needs
-- it; the assert helpers are safe to expose because they only reveal the
-- caller's own access. permission_effective_for stays owner-only because it
-- accepts an arbitrary profile id.
grant execute on function
  has_permission(text),
  module_accessible(text, boolean),
  assert_module_enabled(text),
  assert_module_access(text),
  get_my_access_context(),
  get_permission_admin_context(),
  get_user_access_breakdown(uuid),
  save_role_permissions_with_audit(user_role, jsonb),
  save_designation_permissions_with_audit(uuid, jsonb),
  save_user_access_with_audit(uuid, jsonb, text)
to authenticated;

notify pgrst, 'reload schema';
