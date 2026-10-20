# On-demand duties and complete schedule generation (2026-10-20)

## Problem

The task bulk import recognises every frequency in the owner's sheet, but two
groups of imported work never reach an employee.

Production evidence (read-only counts, 2026-10-20):

| Live templates | Count | Reached employees in the last 7 days |
| --- | --- | --- |
| `as_required` (As Required, Per Customer, As Applicable, Per Not-Bought Customer, After ...) | 1,140 | none: inactive by design, no date |
| Active daily | 969 | 922 |
| Active weekly | 64 | 48 |
| Active monthly / yearly | 47 / 7 | as expected for their period |

1. **Event-driven duties are invisible.** The importer turns event-driven labels
   into inactive `as_required` templates that create nothing until a manager
   presses Run Now in Recurring / To-Do. Run Now is limited to one occurrence per
   template per day (`idx_task_instances_template_scheduled_date`), which cannot
   represent "per customer". Task Control shows these rows as INACTIVE with a
   disabled Activate button.
2. **The cron generator stops at 1,000 templates.** `generate-recurring-tasks`
   reads active templates through PostgREST without paging, so the default
   1,000-row cap drops the rest. Of the active templates after row 1,000 in heap
   order, 46 of 71 daily templates produced nothing in a week; within the first
   1,000, 897 of 898 did. The few late rows that did appear came from the
   per-user `ensure-my-recurring-tasks` path, which runs only when the employee
   opens Tasks.

## Decisions

### A. Event-driven work becomes standing "on-demand duties"

An `as_required` template that is assigned to an employee is a **standing duty**:
it has no calendar date, is never overdue, and does not count against the
employee until an occurrence exists.

- **Employees see their duties.** Tasks > My Tasks shows an **As needed** panel
  listing the viewer's duties with the sheet's trigger label ("Per Customer",
  "As Required", ...), how many were done today, and a **Start** button.
- **Start (employee).** When the event happens (a customer walks in, a visit
  ends), the employee taps Start. That creates one ordinary task occurrence
  assigned to them, due today, which they complete as usual (checklist, upload,
  form, verification all unchanged). It is not alerted to themselves.
- **Assign now (manager/admin).** In Task Control > Templates and in
  Recurring / To-Do, an `as_required` row offers **Assign now** in place of the
  impossible Activate / one-per-day Run now. It creates the same occurrence for
  the duty's employee, who receives the normal "New task assigned" alert.
- Several occurrences per day are allowed (one per customer). A server cap of
  50 occurrences per duty per Kolkata day stops accidental floods.
- Default due time: today at the duty's due time when that is at least 30
  minutes away, otherwise 23:59 today (Asia/Kolkata).

Rejected alternatives: converting event-driven labels into daily tasks (floods
employees with cards for work that may not occur, and corrupts on-time scores);
leaving them manager-only (employees still cannot see their responsibilities).

### B. The sheet's trigger label is kept

`task_templates.trigger_label` stores the original sheet label for `as_required`
rows. New imports send it. The business fingerprint is unchanged, so uploading
the same sheet again replays existing rows and fills a missing label without
creating duplicates. Rows without a label display "As needed".

### C. The cron generator pages through every active template

`generate-recurring-tasks` reads templates in ordered 1,000-row pages until a
short page is returned. No database change is needed for this fix.

## Contracts (migration 0293)

- `task_templates.trigger_label text` (nullable, 1-80 characters).
- `task_instances.on_demand boolean not null default false`; the per-day unique
  index excludes on-demand rows, and `create_recurring_todo_instance` ignores
  them when checking for an existing scheduled occurrence.
- `start_on_demand_task_with_audit(p_template_id uuid) returns uuid`
  (authenticated): `assert_module_enabled('checklist_tasks')`; active actor;
  live, assigned `as_required` template in the actor's tenant. The duty's own
  employee may start it for themselves; anyone else needs
  `tasks.assign_others`, an admin role, and (for managers) the template's
  branch. Writes `task_on_demand_started` to `audit_logs` in the same
  transaction.
- `get_my_on_demand_duties() returns jsonb` (authenticated): the caller's own
  live, assigned duties with today's started/open counts.
- `emit_task_notification_event` skips the alert for a self-started on-demand
  occurrence.
- `get_task_template_directory` projects `trigger_label`.
- `commit_task_bulk_import_chunk_v0104` accepts `trigger_label` and backfills it
  on replay.

No RLS policy, grant to `anon`, Storage, or existing RPC signature changes.

## Surfaces

- Tasks > My Tasks: As needed panel (web, also inside the Android shell).
- Task Control > Templates: status ON DEMAND, frequency shows the trigger
  label, Assign now replaces Activate for `as_required` rows.
- Recurring / To-Do: Assign now replaces Run now for `as_required` rows.
- Ask Kiara app help: Tasks entry explains As needed / Start / Assign now.

## Rollout

Migration 0293 and the `generate-recurring-tasks` deploy go first; the web
merge follows (the import whitelist must accept `trigger_label` before the
client sends it). No APK: the Android app is the web shell.
