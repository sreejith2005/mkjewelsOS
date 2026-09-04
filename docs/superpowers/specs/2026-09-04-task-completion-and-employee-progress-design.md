# Task Completion and Employee Progress Design

Date: 2026-09-04
Status: Approved

## Goal

Make task completion clear and direct: a Task finishes through required private
image evidence, while a Checklist finishes only after every required item is
checked. Keep the personal task board and Home compact and usable, remove the
obsolete Start action, and give authorized leaders accurate task progress by
employee, department, and branch.

## Scope

This work changes the existing task system only. It covers one-time
admin-created tasks, existing recurring/template-compatible task data, the
task board, Home task list, and the role-aware Dashboard. It does not create a
second task type, change FMS stage behavior, or alter historical task records.

### Task board filters and counts

The task board replaces the `All` filter with `Completed`. Its filters are
Pending, Overdue, and Completed. Completed contains only completed tasks;
Pending and Overdue remain mutually exclusive open-work views. The My Tasks
and Delegated heading counts represent open tasks so a completed task no
longer inflates the active-work number. The completed view remains available
for history.

### Explicit completion mode when assigning work

The existing admin task composer gains one required choice: `Task` or
`Checklist`.

- `Task` persists the existing delegation-style task type, forces
  `requires_upload=true`, and has no checklist items. The assignee finishes it
  by uploading an allowed private image; that upload and completion remain
  server-authorized and audited.
- `Checklist` persists the existing checklist task type, forces
  `requires_upload=false`, and exposes the existing multi-item checklist
  editor. All created items are required. The task cannot be completed until
  every required item is checked.

The choice controls task completion only. Existing form, remark, watcher,
priority, deadline, and authorization behavior remains compatible. Existing
tasks remain readable and preserve their historical completion requirements.

### No Start action

The task presentation and client action contract contain no Start control.
Pending tasks may be completed directly according to their stored mode:
uploading valid required evidence for Task, or completing all required
checklist items followed by Complete for Checklist. The database completion
contract remains authoritative, so removing a button never weakens status,
assignee, evidence, or audit checks. Historic `in_progress` data remains
readable and is not rewritten.

### Home task list

Home continues to use its existing compact layout and fixed visual space. Its
My Tasks group renders all open assigned tasks inside a bounded, keyboard- and
touch-scrollable region instead of selecting only the first four. Other Home
groups and their layout stay unchanged.

### Employee progress dashboard

Super Admin, Admin, HR, and Manager receive an employee-progress section on
the existing Dashboard. It uses the selected dashboard date range plus the
existing branch and department filters. It shows Assigned, Completed, and
Remaining for each visible active employee, and compact rollups for each
visible department and branch.

Assigned means tasks assigned in the selected period. Completed means tasks
completed in that period. Remaining means assigned tasks not completed,
including overdue tasks. The reporting RPC applies the existing tenant,
branch, department, active-profile, and role checks before aggregation;
frontend visibility is only presentation. Managers are constrained to their
existing server-authorized scope. Staff and other roles do not receive people
rows.

## Architecture and data contract

A forward migration extends the protected task-creation RPC validation to
derive and persist the selected completion mode consistently. It validates the
payload/checklist pairing, preserves compatible callers such as bulk import,
and writes the existing task audit record in the same transaction. No client
may set an inconsistent combination such as a Checklist requiring upload or a
Task carrying checklist items.

The existing task-update/evidence path remains the authority for task state.
The web client validates image MIME type, extension, and size for usability,
uploads only to the task's private scoped path, and refreshes after the
authoritative completion result. The server continues to validate actor,
active assignment, tenant/path ownership, evidence requirement, and audit
logging before completion.

The same migration replaces the dashboard metrics RPC with a compatible
response that adds a role-scoped `employee_progress` payload. Its aggregates
are set-based and calculated from scoped task assignments, task status, and
organization records. A selected branch/department is validated before use;
the endpoint returns no cross-tenant or unauthorized people data. Generated
database types are regenerated in both checked-in type packages.

## UX and error handling

- The composer explains the selected mode in plain language and only exposes
  checklist-item controls for Checklist.
- Upload errors state the allowed type and size without exposing Storage paths
  or database details.
- Completion controls are disabled while the operation is in progress and
  refreshed after success or a meaningful server error.
- The progress section has loading, empty, and retry states consistent with
  the existing Dashboard. It uses existing date/branch/department controls;
  it adds no unauthorised client-side data source.

## Security and compatibility

- The migration is forward-only and does not change applied migrations.
- Protected task creation, checklist updates, evidence completion, and audit
  writes remain server-side and transactional.
- Private upload validation is defence in depth: client checks are not the
  authorization boundary.
- The people-progress query is tenant- and role-scoped in SQL/RPC, with no
  raw attachment metadata, credentials, or personal contact data in the
  dashboard payload.
- Bulk-import and recurring tasks preserve their stored types and historical
  completion behavior. The obsolete Start UI is removed without rewriting task
  statuses.

## Verification and acceptance criteria

- Focused core tests prove the Pending/Overdue/Completed filters and open
  heading counts.
- Focused composer/card/Home/Dashboard tests prove explicit task modes,
  multi-item checklist gating, no Start action, internal Home scrolling, and
  role-gated progress rendering.
- pgTAP covers valid and invalid mode pairings, task creation authorization,
  checklist/evidence completion constraints, audit output, employee progress
  totals, tenant isolation, inactive-user exclusion, role denials, and
  manager/branch/department scope.
- Local database, focused web tests, type checks, production build, and diff
  checks are reported separately from any browser or hosted proof.
