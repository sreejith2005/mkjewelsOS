-- ============================================================================
-- JewelOS — Core Schema (Phase 0/1)
-- Target: Supabase Postgres
-- Convention: every business table carries tenant_id / branch_id / department_id
-- (where applicable) + created_by / updated_by / created_at / updated_at.
-- RLS enforces tenant/branch/role isolation at the DB layer — never trust the
-- frontend to filter.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Supabase installs extension-owned functions in the extensions schema.
set search_path = public, extensions;

-- ============================================================================
-- ENUMS
-- ============================================================================

create type user_role as enum (
  'super_admin','admin','manager','hr','crm','staff','doer','housekeeping'
);

create type working_status as enum (
  'active','inactive','on_leave','half_day','resigned'
);

create type task_type as enum ('checklist','fms','delegation');
create type task_status as enum (
  'pending','in_progress','in_review','completed','rejected','blocked','overdue'
);
create type task_priority as enum ('high','medium','low');

create type fms_flow_status as enum ('draft','published','archived');
create type fms_step_type as enum (
  'task','approval','form','notification','branch','parallel_start','parallel_join','end'
);
create type fms_instance_status as enum ('active','completed','cancelled','on_hold','overdue');
create type fms_completion_rule as enum ('all_doers','any_doer','manager_approval');
create type fms_join_rule as enum ('all','any','specific');

create type availability_status as enum ('present','absent','half_day','remote');

-- ============================================================================
-- ORG HIERARCHY: Tenant → Branch → Department → User
-- ============================================================================

create table tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  logo_url text,
  currency text default 'INR',
  timezone text default 'Asia/Kolkata',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table branches (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text not null,
  address text, city text, state text, pincode text,
  manager_id uuid, -- fk to user_profiles, added after that table exists
  is_active boolean default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, code)
);

create table departments (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  name text not null,
  code text not null,
  head_id uuid, -- fk to user_profiles
  is_active boolean default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- user_profiles wraps Supabase auth.users 1:1. ONLY the fields the client
-- explicitly asked for — no extra profile fields.
create table user_profiles (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id),
  department_id uuid not null references departments(id),
  employee_name text not null,
  designation_id uuid, -- references dropdown_masters(id) where master_type='designation'
  personal_mobile text not null,
  official_mobile text,
  email text not null unique,
  week_off text[] not null default '{}',           -- values from dropdown_masters
  user_role user_role not null default 'staff',
  employee_code text not null unique,
  buddy_id uuid references user_profiles(id),
  working_status working_status not null default 'active',
  is_login_enabled boolean default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table branches add constraint fk_branch_manager
  foreign key (manager_id) references user_profiles(id);
alter table departments add constraint fk_dept_head
  foreign key (head_id) references user_profiles(id);

-- Super-admin editable master data for every dropdown in the app.
create table dropdown_masters (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references tenants(id) on delete cascade,
  master_type text not null,   -- 'branch','department','designation','working_status',
                                -- 'week_off','task_status','task_priority','fms_status',
                                -- 'resignation_reason','crm_source','client_status', etc.
  label text not null,
  value text not null,
  sort_order int default 0,
  is_active boolean default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, master_type, value)
);

-- ============================================================================
-- RESIGNATION / DEBOARDING
-- ============================================================================

create table resignations (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  user_profile_id uuid not null references user_profiles(id),
  resignation_date date not null,
  last_working_date date not null,
  resignation_reason_id uuid references dropdown_masters(id),
  notice_period_served boolean not null,
  handover_completed boolean not null default false,
  handover_given_to uuid references user_profiles(id),
  pending_tasks_reassigned boolean not null default false,
  replacement_buddy_id uuid references user_profiles(id),
  company_assets_returned boolean not null default false,
  official_mobile_returned boolean,
  email_access_remove_date date not null,
  final_settlement_status text,
  hr_remark text,
  manager_approval_status text default 'pending', -- pending/approved/rejected
  super_admin_approval_status text default 'pending',
  created_by uuid, updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- AVAILABILITY / BUDDY SYSTEM
-- ============================================================================

create table user_availability (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  user_profile_id uuid not null references user_profiles(id),
  date date not null,
  status availability_status not null,
  reason text,
  logged_by uuid references user_profiles(id),
  created_at timestamptz default now(),
  unique (user_profile_id, date)
);

create table buddy_assignments (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  original_assignee_id uuid not null references user_profiles(id),
  buddy_id uuid not null references user_profiles(id),
  task_instance_id uuid, -- fk added after task_instances exists
  date date not null,
  escalated_to_manager boolean default false,
  created_at timestamptz default now()
);

-- ============================================================================
-- FORMS ENGINE (built first — FMS steps & tasks reference form_templates)
-- ============================================================================

create table form_templates (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  description text,
  version int not null default 1,
  is_active boolean default true,
  permissions jsonb default '{}',  -- {roles:[...], branches:[...]}
  created_by uuid, updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table form_fields (
  id uuid primary key default uuid_generate_v4(),
  form_template_id uuid not null references form_templates(id) on delete cascade,
  field_name text not null,
  field_type text not null, -- text/number/phone/email/date/datetime/select/multiselect/
                             -- radio/checkbox/textarea/file/rating/section_header/
                             -- user_dropdown/branch_dropdown/department_dropdown
  group_name text,
  is_shown boolean default true,
  is_editable boolean default true,
  is_required boolean default false,
  initial_value text,  -- supports UNIQUEID()/USEREMAIL()/TODAY()/NOW()/
                        -- CURRENT_BRANCH()/CURRENT_DEPARTMENT()/CURRENT_USER()/
                        -- SEQUENCE()/COPY_FROM_PREVIOUS()
  options jsonb,        -- for select/multiselect/radio
  conditional_logic jsonb, -- {show_if_field, operator, value}
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Links a form to ANY module/record — this is how "link form from anywhere" works.
create table form_links (
  id uuid primary key default uuid_generate_v4(),
  form_template_id uuid not null references form_templates(id) on delete cascade,
  linked_module text not null, -- 'checklist_task','fms_stage','delegation_task',
                                -- 'crm_client','crm_followup','meeting','resignation',
                                -- 'dashboard_button'
  linked_reference_id uuid,    -- e.g. a specific fms_stages.id; null = generic module link
  created_by uuid,
  created_at timestamptz default now()
);

create table form_submissions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  form_template_id uuid not null references form_templates(id),
  linked_module text,
  linked_record_id uuid,
  data jsonb not null default '{}',
  submitted_by uuid references user_profiles(id),
  submitted_at timestamptz default now()
);

-- ============================================================================
-- TASK SYSTEM: Checklist / Delegation (FMS tasks live in the fms_* tables below
-- and are surfaced through a unified `v_all_tasks` view — see bottom of file)
-- ============================================================================

create table task_templates (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  title text not null,
  description text,
  task_type task_type not null default 'checklist',
  recurrence_rule text,  -- RRULE string, e.g. FREQ=MONTHLY;BYDAY=1SA
  planned_time time,
  requires_upload boolean default false,
  requires_remark boolean default false,
  requires_form boolean default false,
  form_template_id uuid references form_templates(id),
  is_active boolean default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table task_instances (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  task_template_id uuid references task_templates(id), -- null for one-off delegation
  task_type task_type not null,
  title text not null,
  description text,
  priority task_priority default 'medium',
  status task_status not null default 'pending',
  planned_datetime timestamptz not null,
  revised_datetime timestamptz,        -- delegation only; editable by manager+ only (RLS)
  actual_datetime timestamptz,
  delay_minutes int generated always as (
    case when actual_datetime is not null
      then round(extract(epoch from (actual_datetime - planned_datetime)) / 60)
      else null end
  ) stored,
  source text default 'manual', -- manual/checklist/fms/meeting/crm/form
  source_ref_id uuid,           -- e.g. fms_instance_stage_id
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table buddy_assignments add constraint fk_buddy_task
  foreign key (task_instance_id) references task_instances(id);

create table task_assignees (
  id uuid primary key default uuid_generate_v4(),
  task_instance_id uuid not null references task_instances(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id),
  role_at_task text default 'doer', -- doer/reviewer/approver
  is_original boolean default true, -- false if this row is a buddy-cover reassignment
  completed_at timestamptz,
  unique (task_instance_id, user_profile_id)
);

create table task_checklists (
  id uuid primary key default uuid_generate_v4(),
  task_instance_id uuid not null references task_instances(id) on delete cascade,
  item_text text not null,
  is_required boolean default true,
  is_completed boolean default false,
  completed_by uuid references user_profiles(id),
  completed_at timestamptz,
  sort_order int default 0
);

create table task_comments (
  id uuid primary key default uuid_generate_v4(),
  task_instance_id uuid not null references task_instances(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id),
  comment text not null,
  created_at timestamptz default now()
);

create table task_attachments (
  id uuid primary key default uuid_generate_v4(),
  task_instance_id uuid not null references task_instances(id) on delete cascade,
  file_url text not null,
  uploaded_by uuid references user_profiles(id),
  created_at timestamptz default now()
);

create table task_revisions (
  id uuid primary key default uuid_generate_v4(),
  task_instance_id uuid not null references task_instances(id) on delete cascade,
  old_revised_datetime timestamptz,
  new_revised_datetime timestamptz not null,
  changed_by uuid not null references user_profiles(id),
  reason text,
  created_at timestamptz default now()
);

-- ============================================================================
-- FMS: Flow definitions, stages, transitions, live instances
-- ============================================================================

create table fms_flows (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  name text not null,
  description text,
  status fms_flow_status not null default 'draft',
  trigger_type text default 'manual', -- manual/event_triggered
  is_active boolean default true,
  version int not null default 1,
  usage_count int not null default 0,
  created_by uuid not null,
  published_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table fms_stages (
  id uuid primary key default uuid_generate_v4(),
  fms_flow_id uuid not null references fms_flows(id) on delete cascade,
  name text not null,          -- "What"
  method text,                 -- "How"
  step_type fms_step_type not null default 'task',
  sort_order int not null,
  is_required boolean default true,
  planned_time_rule jsonb not null default '{}',
  -- e.g. {"type":"relative_to_previous","minutes":1440,"business_hours_only":true,
  --       "exclude_week_offs":true,"escalate_after_minutes":2880}
  completion_rule fms_completion_rule default 'any_doer',
  allow_multiple_doers boolean default false,
  requires_upload boolean default false,
  requires_remark boolean default false,
  requires_checklist boolean default false,
  form_template_id uuid references form_templates(id),
  requires_next_doer_handoff boolean default false,
  can_move_backward boolean default false,
  can_reject boolean default false,
  can_request_revision boolean default false,
  can_escalate boolean default false,
  is_parallel_group boolean default false,
  parallel_group_key text,      -- stages sharing this key run concurrently
  join_rule fms_join_rule,      -- set on the joining stage
  join_required_stage_ids uuid[],
  split_to_flow_id uuid references fms_flows(id), -- hand off to another flow
  created_at timestamptz default now()
);

-- Who can be picked as a doer when starting an instance at this stage
-- (Start Stage User Rule — dropdown shows ONLY these users, not everyone).
create table fms_stage_assignees (
  id uuid primary key default uuid_generate_v4(),
  fms_stage_id uuid not null references fms_stages(id) on delete cascade,
  assignee_type text not null, -- specific_user/role/department_head/manager/
                                -- previous_step_doer/reporter
  user_profile_id uuid references user_profiles(id), -- when specific_user
  role_value user_role,                               -- when role
  is_start_stage_entry_user boolean default false
);

-- Branching rules evaluated on stage completion outcome
create table fms_branch_rules (
  id uuid primary key default uuid_generate_v4(),
  fms_stage_id uuid not null references fms_stages(id) on delete cascade,
  condition_field text not null,   -- 'outcome' / form field id / status value
  condition_operator text not null, -- '=', '!=', 'in', etc.
  condition_value text not null,
  next_stage_id uuid references fms_stages(id),
  next_flow_id uuid references fms_flows(id), -- split-FMS target
  label text,
  sort_order int default 0
);

create table fms_instances (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  fms_flow_id uuid not null references fms_flows(id),
  reference_number text not null,
  title text not null,
  status fms_instance_status not null default 'active',
  priority task_priority default 'medium',
  context jsonb not null default '{}', -- carries client_id, order_id, notes, etc.
  related_entity text,
  related_record_id uuid,
  started_by uuid not null references user_profiles(id),
  started_at timestamptz default now(),
  completed_at timestamptz,
  parent_instance_id uuid references fms_instances(id), -- split-FMS lineage
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table fms_instance_stages (
  id uuid primary key default uuid_generate_v4(),
  fms_instance_id uuid not null references fms_instances(id) on delete cascade,
  fms_stage_id uuid not null references fms_stages(id),
  status task_status not null default 'pending',
  assigned_to uuid[] default '{}', -- user_profile_id[]
  next_doer_ids uuid[],            -- logged by current doer before advancing
  planned_datetime timestamptz,
  actual_datetime timestamptz,
  delay_minutes int generated always as (
    case when actual_datetime is not null and planned_datetime is not null
      then round(extract(epoch from (actual_datetime - planned_datetime)) / 60)
      else null end
  ) stored,
  sla_breached boolean default false,
  form_submission_id uuid references form_submissions(id),
  remark text,
  outcome text, -- drives branching
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table fms_stage_logs (
  id uuid primary key default uuid_generate_v4(),
  fms_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  actor_id uuid references user_profiles(id),
  action text not null, -- started/completed/rejected/escalated/reassigned/branch_taken
  details jsonb,
  created_at timestamptz default now()
);

-- ============================================================================
-- CRM
-- ============================================================================

create table clients (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  phone text not null,          -- same phone = same client (dedupe key)
  billing_phone text,
  first_name text, last_name text,
  gender text, address text, city text, state text, pincode text,
  source_id uuid references dropdown_masters(id),
  client_type_id uuid references dropdown_masters(id),
  potential_category text,
  total_visits int default 0,
  last_visit_date date,
  next_visit_date date,
  assigned_crm_id uuid references user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, phone)
);

create table walkin_entries (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  client_id uuid not null references clients(id),
  crm_id uuid references user_profiles(id),
  salesperson_id uuid references user_profiles(id),
  visit_date timestamptz not null default now(),
  client_type_id uuid references dropdown_masters(id),
  product_categories text[],
  product_bought boolean,
  buy_status text,
  not_bought_reason text,
  product_requirement text,
  next_visit_date date,
  potential_category text,
  remark text,
  instagram_asked boolean, google_review_asked boolean, referral_asked boolean,
  companions int default 0,
  created_by uuid,
  created_at timestamptz default now()
);

create table walkin_uploads (
  id uuid primary key default uuid_generate_v4(),
  walkin_entry_id uuid not null references walkin_entries(id) on delete cascade,
  file_url text not null,
  created_at timestamptz default now()
);

create table client_timeline (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  event_type text not null, -- walkin/followup/task/fms/note
  ref_id uuid,
  summary text,
  created_by uuid,
  created_at timestamptz default now()
);

create table client_followups (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  assigned_to uuid references user_profiles(id),
  due_date date not null,
  status text default 'pending',
  notes text,
  created_at timestamptz default now()
);

-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================

create table notification_templates (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references tenants(id),
  event_type text not null,
  channel text not null, -- in_app/email/whatsapp/sms/push
  title_template text not null,
  body_template text not null,
  is_active boolean default true
);

create table notification_rules (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references tenants(id),
  event_type text not null,
  conditions jsonb default '{}',
  channels text[] default '{in_app}',
  template_id uuid references notification_templates(id),
  is_active boolean default true
);

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  user_profile_id uuid not null references user_profiles(id),
  event_type text not null,
  title text not null,
  message text not null,
  link_url text,
  is_read boolean default false,
  read_at timestamptz,
  channel text default 'in_app',
  delivered_status text default 'pending',
  retry_count int default 0,
  created_at timestamptz default now()
);

create table notification_logs (
  id uuid primary key default uuid_generate_v4(),
  notification_id uuid references notifications(id) on delete cascade,
  channel text not null,
  status text not null,
  provider_response jsonb,
  created_at timestamptz default now()
);

-- ============================================================================
-- AUDIT LOG (every sensitive action)
-- ============================================================================

create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references tenants(id),
  actor_user_id uuid references user_profiles(id),
  action text not null,
  module text not null,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

-- ============================================================================
-- REPORTS / MIS
-- ============================================================================

create table performance_snapshots (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  user_profile_id uuid references user_profiles(id),
  period_start date not null,
  period_end date not null,
  tasks_assigned int default 0,
  tasks_completed int default 0,
  on_time_completed int default 0,
  overdue_count int default 0,
  avg_delay_minutes numeric,
  created_at timestamptz default now()
);

create table export_logs (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  user_profile_id uuid references user_profiles(id),
  export_type text not null,
  filters jsonb,
  file_url text,
  created_at timestamptz default now()
);

-- ============================================================================
-- INDEXES (query patterns: date/status/user/branch heavy)
-- ============================================================================

create index idx_task_instances_branch_status on task_instances(branch_id, status);
create index idx_task_instances_planned on task_instances(planned_datetime);
create index idx_task_assignees_user on task_assignees(user_profile_id);
create index idx_fms_instances_branch_status on fms_instances(branch_id, status);
create index idx_fms_instance_stages_status on fms_instance_stages(status);
create index idx_notifications_user_unread on notifications(user_profile_id, is_read);
create index idx_clients_phone on clients(tenant_id, phone);
create index idx_audit_logs_tenant_created on audit_logs(tenant_id, created_at desc);

-- ============================================================================
-- RBAC HELPER FUNCTIONS (used inside RLS policies)
-- ============================================================================

create or replace function current_profile()
returns user_profiles language sql stable security definer as $$
  select * from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_role_level() returns user_role
language sql stable security definer as $$
  select user_role from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_tenant_id() returns uuid
language sql stable security definer as $$
  select tenant_id from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_branch_id() returns uuid
language sql stable security definer as $$
  select branch_id from user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function is_super_admin() returns boolean
language sql stable security definer as $$
  select current_role_level() = 'super_admin';
$$;

-- ============================================================================
-- ROW LEVEL SECURITY — representative policies (repeat pattern per table)
-- ============================================================================

alter table user_profiles enable row level security;
alter table task_instances enable row level security;
alter table fms_flows enable row level security;
alter table fms_instances enable row level security;
alter table dropdown_masters enable row level security;
alter table clients enable row level security;

-- user_profiles: everyone in the tenant can read; only super_admin/admin write
create policy up_select on user_profiles for select
  using (tenant_id = current_tenant_id() or is_super_admin());
create policy up_write on user_profiles for all
  using (is_super_admin() or current_role_level() = 'admin')
  with check (tenant_id = current_tenant_id() or is_super_admin());

-- task_instances: scoped to tenant+branch; staff see only tasks they're
-- assigned to (checked via task_assignees join in a view — see below)
create policy ti_tenant_isolation on task_instances for select
  using (tenant_id = current_tenant_id() or is_super_admin());
create policy ti_write on task_instances for insert with check (
  tenant_id = current_tenant_id() or is_super_admin()
);
create policy ti_update on task_instances for update using (
  tenant_id = current_tenant_id() or is_super_admin()
);

-- fms_flows: everyone can view flows in their tenant; only super_admin edits
-- published flows; admin can insert new (draft) flows only.
create policy flow_select on fms_flows for select
  using (tenant_id = current_tenant_id() or is_super_admin());
create policy flow_insert on fms_flows for insert with check (
  tenant_id = current_tenant_id()
  and current_role_level() in ('super_admin','admin')
);
create policy flow_update on fms_flows for update using (
  is_super_admin()
  or (current_role_level() = 'admin' and status = 'draft' and created_by = current_profile()::text::uuid)
);
create policy flow_delete on fms_flows for delete using (is_super_admin());

-- dropdown_masters: readable by all in tenant; writable ONLY by super_admin
create policy dm_select on dropdown_masters for select
  using (tenant_id = current_tenant_id() or tenant_id is null or is_super_admin());
create policy dm_write on dropdown_masters for all
  using (is_super_admin())
  with check (is_super_admin());

-- clients: branch-scoped
create policy clients_select on clients for select
  using (
    is_super_admin()
    or (tenant_id = current_tenant_id()
        and (current_role_level() in ('super_admin','admin','manager')
             or branch_id = current_branch_id()))
  );

-- NOTE: apply the same three-part pattern (tenant match OR super_admin bypass,
-- then branch/role narrowing) to every remaining table in later migrations:
-- fms_instances, fms_instance_stages, form_submissions, notifications,
-- walkin_entries, resignations, audit_logs, performance_snapshots, etc.
-- This file intentionally shows the pattern on 5 representative tables —
-- Phase 1 build task is to generate the rest mechanically from this template.

-- ============================================================================
-- UNIFIED TASK VIEW (checklist + delegation + FMS-derived tasks in one feed)
-- ============================================================================

create view v_all_tasks as
  select
    ti.id, ti.tenant_id, ti.branch_id, ti.department_id, ti.task_type,
    ti.title, ti.priority, ti.status, ti.planned_datetime, ti.actual_datetime,
    ti.delay_minutes, ti.source, ta.user_profile_id as assignee_id
  from task_instances ti
  join task_assignees ta on ta.task_instance_id = ti.id
  union all
  select
    fis.id, fi.tenant_id, fi.branch_id, null::uuid, 'fms'::task_type,
    fs.name as title, fi.priority, fis.status, fis.planned_datetime,
    fis.actual_datetime, fis.delay_minutes, 'fms'::text,
    unnest(fis.assigned_to) as assignee_id
  from fms_instance_stages fis
  join fms_instances fi on fi.id = fis.fms_instance_id
  join fms_stages fs on fs.id = fis.fms_stage_id;
