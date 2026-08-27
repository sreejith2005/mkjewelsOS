# Production Demo Data Retirement Design

## Status and decision

This design is approved in principle by the MK Jewels operator on 2026-08-27.
It is a controlled, one-time retirement of demo operational data before live
use. It does not remove an application section, navigation item, database
schema object, user, branch, department, Availability record, CRM record, or
production configuration that the operator has asked to retain.

No destructive action is authorised until the live preflight inventory has
been produced and the operator has approved its exact per-table counts.

## Goals

- Remove data created for application testing and demonstrations.
- Preserve the organisation and staff setup so existing people can start work
  without re-invitation or reconfiguration.
- Preserve CRM completely because it is unrelated to this reset.
- Keep an auditable, recoverable cutover rather than using a database reset,
  bulk browser deletion, or ad-hoc SQL console commands.

## Explicit retention boundary

The reset must not alter these records or their Storage objects:

- `auth.users`, `user_profiles`, user hierarchy/history, employee login and
  role state;
- `tenants`, `branches`, `departments`, `user_availability`, and
  `buddy_assignments`;
- `dropdown_masters`, dropdown category registry, tenant section controls,
  global Settings, notification provider configuration, and user preferences;
- all CRM tables and their Storage/document objects, including clients,
  walk-ins, contact aliases/assignments, interactions/timeline, follow-ups,
  CRM documents, custom fields, migration/import/sync/checkpoint/identity
  review records, and source mappings;
- `audit_logs`. The cutover must add an immutable audit event identifying the
  operator, tenant, approved manifest fingerprint, backup reference, and
  aggregate removed counts. Existing audit rows are retained.

The live preflight must additionally enumerate `resignations` and any
post-0103 tables not covered by this document. They default to **retain** and
require an explicit written scope amendment before deletion.

## Operational-data retirement boundary

The reset removes only records within the target tenant, in dependency order:

1. Task execution and imported-demo state: task attachments and their private
   objects, watchers, assignees, checklists, comments, revisions, instances,
   templates/recurring schedules, import batches/items, and task-created
   notifications/events/deliveries/logs.
2. FMS execution and definitions: evidence objects/rows, instance checklist
   rows, stage assignees/logs/stages, instances, starter assignments, branch
   rules/stage assignees/stages, and FMS flows.
3. Forms: submissions, links, fields, and all form-template versions/families.
   This deliberately includes otherwise-published demo forms.
4. Notification demo configuration and delivery history: templates, rules,
   events, deliveries, notifications, and notification logs. Provider
   configuration remains.
5. Reporting/demo operational state: generated exports and their private
   files, export logs, performance snapshots, tenant realtime wake-up events,
   designation daily-checklist definitions and acknowledgements.

The exact manifest is generated from the **live** catalog and foreign-key
relationships. It is not derived solely from these source names; the preflight
will fail closed if it finds a tenant-scoped dependent table that is neither
classified as retained nor classified for removal.

## Safety architecture

Implement a narrowly granted, `SECURITY DEFINER` production-reset RPC and a
separate read-only inventory RPC. Both derive the tenant only from the active
super-admin profile, reject inactive accounts, and never accept an arbitrary
tenant identifier from a client.

The inventory RPC returns table counts, linked Storage paths/counts, retention
classification, foreign-key dependency information, and a deterministic
manifest hash. It does not mutate records. The reset RPC requires that hash
plus a short-lived server-issued confirmation token, validates that the count
snapshot has not changed, writes the audit event in the same transaction, and
uses deterministic child-before-parent deletes. Storage-object deletion is
performed only for manifest-listed non-CRM task/FMS/form/report paths and is
logged separately if it cannot participate in the SQL transaction.

No worker or browser can invoke the reset automatically. Direct `DELETE` or
`TRUNCATE` grants are not added for authenticated users. The capability is
removed or permanently disabled after the successful cutover, leaving the
audited migration history intact.

## Cutover protocol

1. Identify and record the exact hosted production project, approved Git SHA,
   operator, maintenance window, and a recovery owner.
2. Pause recurring-task, deadline, notification-outbox, report-export, CRM
   sync, and other mutation-capable scheduled workers. Put the UI into a
   short, read-only maintenance window so counts cannot drift.
3. Take a provider-supported backup and test its restoration in staging. Store
   only a non-secret backup reference in the release record.
4. Run the inventory RPC. Review the table-by-table retained/removed counts,
   Storage paths, and manifest hash with the operator. Any unexpected CRM,
   identity, organisation, Availability, configuration, audit, or unclassified
   table count stops the procedure.
5. Rehearse the exact migration/RPC on staging with safe representative data,
   then prove retained login/profile/Availability/CRM behaviour and empty
   operational modules.
6. Obtain final written approval that includes the production manifest hash and
   count report. Run the reset exactly once.
7. Verify post-reset counts, relevant Storage prefixes, the cutover audit row,
   staff sign-in, retained CRM counts/documents, empty Tasks/FMS/Forms/
   Notifications/Reports modules, and no recurrence/worker recreation.
8. Re-enable workers, monitor the agreed window, and record outcome, deployed
   SHA, final counts, and backup/restore path. A failure is handled by worker
   containment plus the rehearsed restoration or a forward corrective change,
   never schema-history rewrites.

## Validation and acceptance criteria

- pgTAP covers allowed super-admin execution and denials for anonymous,
  inactive, non-super-admin, cross-tenant, stale-manifest, invalid-token, and
  re-run callers.
- Local test data demonstrates exact dependency deletion and zero retained-table
  changes; no direct authenticated delete privilege is introduced.
- A staging rehearsal verifies Storage scoping, audit write, idempotency lock,
  worker pause/re-enable behaviour, and rendered authenticated UI results.
- Production verification uses the approved inventory counts as the only
  deletion expectation and records actual post-run counts separately.

## Non-goals

- Removing routes, sections, permissions, schema history, migrations, users,
  branches, Availability, CRM, or general app configuration.
- Deleting or rewriting historic audit records.
- Using `supabase db reset`, seeding, a browser loop, raw console deletion, or
  an unreviewed service-role script against production.
