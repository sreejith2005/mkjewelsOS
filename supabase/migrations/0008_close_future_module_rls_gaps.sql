-- Phase 3A: close read-policy and table-privilege gaps on future modules.
-- Mutations remain owner-side only until audited module RPCs are introduced.

set search_path = public, extensions;

-- Start from an explicit deny posture. service_role intentionally receives no
-- direct access to these future-module tables.
revoke all privileges on table
  form_templates, form_fields, form_links,
  fms_stage_assignees, fms_branch_rules, fms_stage_logs,
  walkin_entries, walkin_uploads, client_timeline, client_followups,
  notification_templates, notification_rules, notification_logs,
  performance_snapshots, export_logs
from public, anon, authenticated, service_role;

grant select on table
  form_templates, form_fields, form_links,
  fms_stage_assignees, fms_branch_rules, fms_stage_logs,
  walkin_entries, walkin_uploads, client_timeline, client_followups,
  notification_templates, notification_rules,
  performance_snapshots, export_logs
to authenticated;

-- Policy joins need only identity/scope columns from their parent tables.
-- Column-level grants keep the parent records themselves out of the Phase 3A
-- table allowlist while allowing PostgreSQL to evaluate the child policies.
grant select (id, tenant_id, branch_id) on table user_profiles to authenticated;
grant select (id, tenant_id, branch_id) on table fms_flows to authenticated;
grant select (id, tenant_id, branch_id) on table fms_instances to authenticated;
grant select (id, tenant_id, branch_id) on table clients to authenticated;

-- These parent policies were previously dormant because authenticated had no
-- matching column privileges. Narrow them before enabling the policy joins.
drop policy if exists flow_select on fms_flows;
create policy flow_select on fms_flows
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id = (select current_tenant_id())
  and (
    (select current_role_level()) in ('super_admin', 'admin')
    or ((select current_role_level()) = 'manager'
      and (branch_id is null or branch_id = (select current_branch_id())))
  )
);

drop policy if exists clients_select on clients;
create policy clients_select on clients
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id = (select current_tenant_id())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm')
);

alter table form_fields enable row level security;
alter table form_links enable row level security;
alter table fms_stage_assignees enable row level security;
alter table fms_branch_rules enable row level security;
alter table fms_stage_logs enable row level security;
alter table walkin_entries enable row level security;
alter table walkin_uploads enable row level security;
alter table client_timeline enable row level security;
alter table client_followups enable row level security;
alter table notification_templates enable row level security;
alter table notification_rules enable row level security;
alter table notification_logs enable row level security;
alter table performance_snapshots enable row level security;
alter table export_logs enable row level security;

-- Forms Library: active tenant templates for the reviewed reader roles only.
drop policy if exists form_templates_select on form_templates;
create policy form_templates_select on form_templates
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id = (select current_tenant_id())
  and is_active is true
  and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm', 'staff')
);

create policy form_fields_select on form_fields
for select to authenticated
using (
  (select current_profile_is_active())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm', 'staff')
  and exists (
    select 1
    from form_templates ft
    where ft.id = form_fields.form_template_id
      and ft.tenant_id = (select current_tenant_id())
      and ft.is_active is true
  )
);

create policy form_links_select on form_links
for select to authenticated
using (
  (select current_profile_is_active())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm', 'staff')
  and exists (
    select 1
    from form_templates ft
    where ft.id = form_links.form_template_id
      and ft.tenant_id = (select current_tenant_id())
      and ft.is_active is true
  )
);

-- FMS builder configuration. Every relationship needed to infer scope is
-- validated in-policy so malformed rows fail closed.
create policy fms_stage_assignees_select on fms_stage_assignees
for select to authenticated
using (
  (select current_profile_is_active())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager')
  and exists (
    select 1
    from fms_stages fs
    join fms_flows ff on ff.id = fs.fms_flow_id
    where fs.id = fms_stage_assignees.fms_stage_id
      and ff.tenant_id = (select current_tenant_id())
      and (
        (select current_role_level()) in ('super_admin', 'admin')
        or ff.branch_id is null
        or ff.branch_id = (select current_branch_id())
      )
      and (
        (
          fms_stage_assignees.assignee_type = 'specific_user'
          and fms_stage_assignees.user_profile_id is not null
          and exists (
            select 1
            from user_profiles assignee
            where assignee.id = fms_stage_assignees.user_profile_id
              and assignee.tenant_id = ff.tenant_id
              and (ff.branch_id is null or assignee.branch_id = ff.branch_id)
              and (
                (select current_role_level()) in ('super_admin', 'admin')
                or ff.branch_id is not null
                or assignee.branch_id = (select current_branch_id())
              )
          )
        )
        or (
          fms_stage_assignees.assignee_type <> 'specific_user'
          and fms_stage_assignees.user_profile_id is null
        )
      )
  )
);

create policy fms_branch_rules_select on fms_branch_rules
for select to authenticated
using (
  (select current_profile_is_active())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager')
  and ((next_stage_id is not null)::integer + (next_flow_id is not null)::integer = 1)
  and exists (
    select 1
    from fms_stages source_stage
    join fms_flows source_flow on source_flow.id = source_stage.fms_flow_id
    where source_stage.id = fms_branch_rules.fms_stage_id
      and source_flow.tenant_id = (select current_tenant_id())
      and (
        (select current_role_level()) in ('super_admin', 'admin')
        or source_flow.branch_id is null
        or source_flow.branch_id = (select current_branch_id())
      )
      and (
        (
          fms_branch_rules.next_stage_id is not null
          and exists (
            select 1 from fms_stages target_stage
            where target_stage.id = fms_branch_rules.next_stage_id
              and target_stage.fms_flow_id = source_flow.id
          )
        )
        or (
          fms_branch_rules.next_flow_id is not null
          and exists (
            select 1
            from fms_flows target_flow
            where target_flow.id = fms_branch_rules.next_flow_id
              and target_flow.tenant_id = source_flow.tenant_id
              and (
                (source_flow.branch_id is not null
                  and (target_flow.branch_id is null or target_flow.branch_id = source_flow.branch_id))
                or (source_flow.branch_id is null
                  and (
                    (select current_role_level()) in ('super_admin', 'admin')
                    or target_flow.branch_id is null
                    or target_flow.branch_id = (select current_branch_id())
                  ))
              )
          )
        )
      )
  )
);

-- FMS history is stage-local for participants; assignment to another stage in
-- the same instance never grants access to this log row.
create policy fms_stage_logs_select on fms_stage_logs
for select to authenticated
using (
  (select current_profile_is_active())
  and exists (
    select 1
    from fms_instance_stages fis
    join fms_instances fi on fi.id = fis.fms_instance_id
    where fis.id = fms_stage_logs.fms_instance_stage_id
      and fi.tenant_id = (select current_tenant_id())
      and (
        (select current_role_level()) in ('super_admin', 'admin')
        or ((select current_role_level()) = 'manager'
          and fi.branch_id = (select current_branch_id()))
        or ((select current_role_level()) in ('crm', 'staff', 'doer')
          and (select (current_profile()).id) = any(fis.assigned_to))
      )
  )
);

-- CRM reads follow visit branch for walk-ins and client branch for client
-- children. The client relationship is always independently tenant-checked.
create policy walkin_entries_select on walkin_entries
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id = (select current_tenant_id())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm')
  and (
    (select current_role_level()) in ('super_admin', 'admin')
    or branch_id = (select current_branch_id())
  )
  and exists (
    select 1 from clients c
    where c.id = walkin_entries.client_id
      and c.tenant_id = walkin_entries.tenant_id
  )
);

create policy walkin_uploads_select on walkin_uploads
for select to authenticated
using (
  (select current_profile_is_active())
  and exists (
    select 1
    from walkin_entries we
    join clients c on c.id = we.client_id and c.tenant_id = we.tenant_id
    where we.id = walkin_uploads.walkin_entry_id
      and we.tenant_id = (select current_tenant_id())
      and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm')
      and (
        (select current_role_level()) in ('super_admin', 'admin')
        or we.branch_id = (select current_branch_id())
      )
  )
);

create policy client_timeline_select on client_timeline
for select to authenticated
using (
  (select current_profile_is_active())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm')
  and exists (
    select 1 from clients c
    where c.id = client_timeline.client_id
      and c.tenant_id = (select current_tenant_id())
      and (
        (select current_role_level()) in ('super_admin', 'admin')
        or c.branch_id = (select current_branch_id())
      )
  )
);

create policy client_followups_select on client_followups
for select to authenticated
using (
  (select current_profile_is_active())
  and (select current_role_level()) in ('super_admin', 'admin', 'manager', 'crm')
  and exists (
    select 1 from clients c
    where c.id = client_followups.client_id
      and c.tenant_id = (select current_tenant_id())
      and (
        (select current_role_level()) in ('super_admin', 'admin')
        or c.branch_id = (select current_branch_id())
      )
  )
);

-- Notification delivery logs are backend-only and receive no policy or grant.
create policy notification_templates_select on notification_templates
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id is not null
  and tenant_id = (select current_tenant_id())
  and (select current_role_level()) in ('super_admin', 'admin')
);

create policy notification_rules_select on notification_rules
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id is not null
  and tenant_id = (select current_tenant_id())
  and (select current_role_level()) in ('super_admin', 'admin')
  and (
    template_id is null
    or exists (
      select 1 from notification_templates nt
      where nt.id = notification_rules.template_id
        and nt.tenant_id is not null
        and nt.tenant_id = notification_rules.tenant_id
    )
  )
);

-- Reports: all roles may see their own row; elevated aggregate reads remain
-- tenant/branch constrained. Export history never grants manager peer access.
create policy performance_snapshots_select on performance_snapshots
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id = (select current_tenant_id())
  and (
    user_profile_id = (select (current_profile()).id)
    or (select current_role_level()) in ('super_admin', 'admin')
    or ((select current_role_level()) = 'manager'
      and branch_id = (select current_branch_id()))
  )
);

create policy export_logs_select on export_logs
for select to authenticated
using (
  (select current_profile_is_active())
  and tenant_id = (select current_tenant_id())
  and (
    user_profile_id = (select (current_profile()).id)
    or (select current_role_level()) in ('super_admin', 'admin')
  )
);

-- Policy joins, ordered reads, and foreign-key maintenance.
create index if not exists idx_form_fields_template_sort
  on form_fields(form_template_id, sort_order);
create index if not exists idx_form_links_template_module_reference
  on form_links(form_template_id, linked_module, linked_reference_id);
create index if not exists idx_fms_stage_assignees_stage
  on fms_stage_assignees(fms_stage_id);
create index if not exists idx_fms_stage_assignees_user
  on fms_stage_assignees(user_profile_id);
create index if not exists idx_fms_branch_rules_stage_sort
  on fms_branch_rules(fms_stage_id, sort_order);
create index if not exists idx_fms_branch_rules_next_stage
  on fms_branch_rules(next_stage_id);
create index if not exists idx_fms_branch_rules_next_flow
  on fms_branch_rules(next_flow_id);
create index if not exists idx_fms_stage_logs_instance_stage_created
  on fms_stage_logs(fms_instance_stage_id, created_at desc);
create index if not exists idx_walkin_entries_tenant_branch_visit
  on walkin_entries(tenant_id, branch_id, visit_date desc);
create index if not exists idx_walkin_entries_client
  on walkin_entries(client_id);
create index if not exists idx_walkin_uploads_entry
  on walkin_uploads(walkin_entry_id);
create index if not exists idx_client_timeline_client_created
  on client_timeline(client_id, created_at desc);
create index if not exists idx_client_followups_client_created
  on client_followups(client_id, created_at desc);
create index if not exists idx_client_followups_assigned_to
  on client_followups(assigned_to);
create index if not exists idx_notification_templates_tenant_event_channel_active
  on notification_templates(tenant_id, event_type, channel, is_active);
create index if not exists idx_notification_rules_tenant_event_active
  on notification_rules(tenant_id, event_type, is_active);
create index if not exists idx_notification_rules_template
  on notification_rules(template_id);
create index if not exists idx_notification_logs_notification
  on notification_logs(notification_id);
create index if not exists idx_performance_snapshots_tenant_user_period
  on performance_snapshots(tenant_id, user_profile_id, period_start, period_end);
create index if not exists idx_performance_snapshots_tenant_branch_period
  on performance_snapshots(tenant_id, branch_id, period_start, period_end);
create index if not exists idx_export_logs_tenant_user_created
  on export_logs(tenant_id, user_profile_id, created_at desc);

notify pgrst, 'reload schema';
