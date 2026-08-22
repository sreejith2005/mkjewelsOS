# Recurring / To-Do and Central Coverage Design

Date: 2026-08-22
Status: Approved for implementation planning

## Purpose

JewelOS already contains Tasks, Users, Availability, CRM, FMS, recurrence,
notifications, and audit infrastructure, but assignment coverage is fragmented.
The current user profile has one buddy, recurring work applies that one buddy
only during generation, and FMS can store a separate fallback person at each
stage. Marking an employee absent does not consistently update eligible work
that has already been assigned.

This change makes the employee profile the sole source of buddy configuration,
introduces a dedicated Recurring / To-Do List workspace, and applies one
server-authoritative coverage policy to Tasks, Recurring / To-Do work, CRM, and
FMS.

The behavioral reference is `reference-gs-code/code.gs` and
`reference-gs-code/index.html`. Their business concepts are adapted to the
existing strict-TypeScript, React, Supabase, RLS, RPC, and audit architecture;
their Google Sheets storage, custom authentication, and Apps Script execution
patterns are not copied.

## Approved product rules

1. The existing Tasks workspace remains the one-off delegation workspace.
2. Recurrence controls and recurring-template management move out of the Tasks
   composer into a new Recurring / To-Do List section.
3. Buddy configuration exists only on Users:
   - Primary Buddy uses the existing `user_profiles.buddy_id` column for
     backward compatibility.
   - Secondary Buddy uses a new `user_profiles.secondary_buddy_id` column.
   - Reporting Manager uses the existing `reports_to_user_id` column.
4. All task-producing modules use this fallback order:
   original assignee -> primary buddy -> secondary buddy -> reporting manager
   -> coverage required.
5. Automatic reassignment is limited to pending or unclaimed work whose
   effective deadline falls today or tomorrow in `Asia/Kolkata`.
6. In-progress work and work due later than tomorrow are not automatically
   moved. They are flagged for manager review when their assignee is absent.
7. Returning an employee to Present does not automatically pull work back from
   a covering employee. A manager can explicitly reassign it.
8. Every automatic or manual assignment change is server-authorized, audited,
   and notified.
9. Historical assignments and historical module-specific fallback values are
   preserved for traceability. New authoring flows stop writing per-task or
   per-stage buddy configuration.

## Scope

### New Recurring / To-Do List workspace

The new role-aware route and menu item provides:

- personal task board with Today, Overdue, Completed, and Coverage Required
  buckets;
- recurring template create, edit, activate, pause, and safe-delete flows;
- daily, weekly, monthly, quarterly, yearly, one-time, and as-required
  schedules;
- an intentional start date and no required end date;
- checkbox-completion and upload-required work types;
- reusable ordered checklists and progress;
- verification and rejection queues;
- reminders and follow-up history;
- personal completion and on-time performance metrics;
- recurring-template bulk import with parse, validation, preview,
  idempotency, and audited commit stages.

The workspace reuses existing task-instance, attachment, form, notification,
and audit contracts where they are suitable. It does not introduce a second
mock task store.

### Existing Users section

User creation and editing expose Primary Buddy and Secondary Buddy. The
existing Buddy field becomes Primary Buddy. Both choices are validated on the
server and exclude the employee themself. The User details view displays both
buddies and the reporting manager.

The existing eligibility policy remains the baseline: the buddy must be an
active or invited user in the same tenant and department, with the existing
organizational-scope restrictions preserved. The two buddy fields must be
different. A reporting manager remains a distinct final fallback and may not
duplicate either buddy when avoidable; duplicated values are skipped safely by
the resolver rather than attempted twice.

### Existing Availability section

Availability adds date and date-range entry, leave type, reason, and approval
state while retaining fast single-day status controls. Approved Absence is the
coverage-triggering status. Present, Remote, and Half Day remain available for
operational reporting; they do not trigger reassignment under this scope.

An authorized availability write returns a privacy-safe coverage summary:
numbers reassigned to primary, secondary, and manager; numbers blocked; and
numbers flagged for review. It does not return unrelated task contents.

Weekly off continues to make a person unavailable for recurrence generation.
Changing a weekly-off profile remains a Super Admin operation and invokes the
same short-deadline reconciliation for the affected dates.

### Existing Tasks, CRM, and FMS sections

- Tasks keeps explicit assignee selection for one-off delegation but removes
  recurrence controls and any buddy selection. Task creation resolves current
  short-deadline availability before the assignment is committed.
- CRM retains explicit ownership and normal CRM workflow controls. Any CRM
  follow-up or task record with an assignee and deadline participates in the
  common coverage policy. CRM does not store a separate buddy.
- FMS retains its stage assignee rule, handoff, claim, manual reassignment,
  escalation, and review semantics. New FMS authoring removes the
  `fallback_user_profile_id` selector. When a named human stage is activated,
  the common resolver evaluates the named assignee's profile-based coverage.
  Existing published flow versions retain their stored fallback values for
  historical reproducibility, but new revisions do not copy or create them.

## Architecture

### Shared coverage decision model

Pure TypeScript logic in `packages/core` defines the input profile,
availability state, date window, and deterministic result. It supports these
result codes:

- `original`
- `primary_buddy`
- `secondary_buddy`
- `reporting_manager`
- `coverage_required`
- `manager_review`
- `not_in_window`

The TypeScript implementation is used by worker code and presentation tests.
Postgres remains authoritative for writes. The protected database resolver
implements the same decision table and re-validates every candidate against
tenant, account, working-status, date, and availability constraints.

Candidate IDs are de-duplicated before evaluation. A candidate who is absent,
inactive, resigned, on weekly off, cross-tenant, or otherwise ineligible is
skipped. The resolver never chains through the buddy's buddies; fallback is
based only on the original employee's configured primary, secondary, and
manager.

### Database contracts

A forward-only migration will:

1. Add `user_profiles.secondary_buddy_id` as a self-referencing nullable UUID.
2. Add or update constraints/triggers so primary and secondary buddies are
   valid, distinct, non-self, tenant-safe, and within the approved
   organizational scope.
3. Add an assignment-resolution function that returns the effective assignee
   and resolution code for an original employee and business date.
4. Add a reconciliation RPC for an employee/date change. It locates eligible
   module records due today or tomorrow in Kolkata, applies module adapters in
   the same transaction, writes audits, creates notifications, and returns
   aggregate counts.
5. Update authorized task creation, recurring generation, CRM assignment, FMS
   stage activation, and availability RPCs to call the central resolver.
6. Add coverage metadata where existing records cannot already distinguish
   original and effective ownership. Metadata must include original assignee,
   effective assignee, resolution level, resolved date, and reason without
   overwriting historical audit evidence.
7. Add supporting indexes for user/date/status/deadline reconciliation queries.
8. Preserve existing `buddy_assignments` and FMS fallback columns for history;
   deprecate them from new authoring rather than destructively deleting data.

RLS remains enabled on every tenant table. Browser roles receive only the
minimum RPC execution privileges required. No client can choose a claimed
coverage result and bypass server validation.

### Reconciliation eligibility

The reconciliation window is calculated in `Asia/Kolkata`, regardless of the
browser timezone. A record is automatically movable only when all conditions
hold:

- its current effective assignee is the employee being marked absent;
- its deadline date is today or tomorrow;
- its status is pending, assigned, queued, or the module's equivalent
  unclaimed state;
- it is not completed, cancelled, rejected into a terminal state, on hold, or
  already in progress;
- no covering employee has already begun work;
- the caller is authorized to change availability for that employee.

Eligible records are moved to the first available candidate. Records outside
the window are unchanged. In-progress records inside the window receive a
manager-review flag and notification but retain ownership. When no candidate
is available, eligible work receives a coverage-required state and is shown to
authorized managers without being falsely assigned to an absent person.

Repeated reconciliation is idempotent. The same availability state and target
record cannot create duplicate assignment events or notifications.

### Module adapters

The central policy does not force unrelated modules into one physical task
table. Each adapter translates the common decision into the module's existing
contract:

- delegation/checklist task adapter updates active task participants while
  retaining the original participant;
- recurring adapter supplies authoritative assignments to
  `create_recurring_task_instance` and reconciles already-created eligible
  instances;
- CRM adapter updates the canonical CRM follow-up/task assignee and CRM audit
  trail;
- FMS adapter updates the active instance stage's `assigned_to` set and FMS
  stage log without changing the published stage definition.

All adapters produce the same coverage event shape for reporting and
notification presentation.

## Recurring / To-Do behavior

Templates are schedules, not daily work records. Generation creates at most
one task instance per template and target date using a durable uniqueness key.
Creating a new active template creates its first due instance immediately when
appropriate; the protected scheduled worker creates future instances.

The reference frequency concepts map to RFC 5545 rules already supported by
JewelOS:

- Daily -> `FREQ=DAILY`
- Weekly -> selected weekday rule
- Monthly -> selected day-of-month rule
- Quarterly -> three-month interval rule
- Yearly -> selected month/day rule
- One Time -> single occurrence
- As Required -> inactive schedule template used for authorized manual
  instantiation

If the original employee is on weekly off, no recurring instance is generated
for that employee on that date. If the employee is absent, an instance is
generated for the first valid fallback. If no fallback exists, the instance is
created as Coverage Required so managers can see and repair the operational
gap.

Unfinished work from previous dates remains visible as Overdue. Completed and
awaiting-verification work is not moved by coverage reconciliation. Safe
template deletion preserves completed instances, verification records,
attachments, forms, audits, and history while cancelling or removing only
eligible future/unstarted work according to the final RPC contract.

Checkbox work can complete in a single action after mandatory checklist and
required-form validation. Upload work requires at least one successfully
recorded attachment before completion. Verification-required work transitions
to Awaiting Verification and supports Verified or Rejected with a required
rejection reason.

## UI design

The new section follows existing JewelOS design tokens and responsive shell
patterns. It does not copy the reference app's colors or custom authentication
shell.

The landing view prioritizes employee work:

- bucket tabs and counts;
- search and date filters;
- compact task cards showing original owner, effective assignee, coverage
  reason, deadline, checklist progress, completion requirements, and status;
- contextual Start, checklist, upload, complete, fill-form, and reminder
  actions based on server-derived capability;
- a manager-only Coverage Required view.

Managers receive separate Template, Verification, Follow-Up, Performance, and
Import views within the section. Existing Notifications and Reports/Audit open
their canonical sections rather than being duplicated.

Availability shows the affected employee's Primary Buddy, Secondary Buddy,
and Manager beside the status controls. Before saving an approved absence, it
shows that pending today/tomorrow work will be reconciled. After saving, it
shows the aggregate result and highlights Coverage Required or Manager Review
counts.

## Authorization, auditing, and privacy

- Frontend role checks are presentation only.
- All sensitive writes use security-definer RPCs with explicit active-profile,
  tenant, role, and scope checks.
- Availability writers keep the existing authorized-role rules. An ordinary
  employee cannot approve their own absence unless the existing policy
  explicitly permits it; unapproved requests do not trigger reassignment.
- User buddy edits use the existing audited user-management pathway.
- Assignment events, availability changes, template mutations, verification,
  reminders, imports, and manual repairs write `audit_logs` in the same
  transaction as the business mutation.
- Notifications contain operational metadata but no unnecessary personal
  contact data or raw import rows.
- Bulk-import errors remain row-scoped and redact passwords, credentials, and
  personal contact data from logs.

## Failure handling

- An invalid buddy configuration is rejected at write time with a specific,
  user-safe message.
- If reconciliation of any module fails, the availability write and assignment
  mutations roll back together; the UI does not claim the employee was safely
  covered.
- Coverage Required is a valid operational outcome, not a server error.
- Manager Review is a non-destructive warning for in-progress or otherwise
  unsafe-to-move work.
- Worker retries are idempotent and report per-template failures without
  exposing task contents.
- UI reads fail visibly and offer retry. No local mock fallback is introduced.

## Migration and compatibility

The migration is append-only. Existing `buddy_id` values become Primary Buddy
without data rewriting. `secondary_buddy_id` begins null. Existing task
instances, CRM work, FMS definitions, FMS instances, buddy assignment records,
and audit history remain intact.

Generated Supabase types are refreshed in both shared locations. Call sites
are migrated in a safe order so the database accepts both the current deployed
web bundle and the new bundle during rollout. The Edge recurrence worker is
updated only after the database supports secondary buddy and manager result
codes.

Production database migration, Edge Function deployment, secret changes, and
web deployment are separate approval-gated operations and are not implied by
source implementation.

## Test strategy

### Pure domain tests

- original available;
- primary chosen when original absent;
- secondary chosen when original and primary unavailable;
- manager chosen when both buddies unavailable;
- duplicate candidates skipped;
- all candidates unavailable -> Coverage Required;
- today/tomorrow boundary in Kolkata;
- later deadline -> Not In Window;
- in-progress -> Manager Review;
- weekly off, inactive, resigned, remote, half-day, and missing availability;
- RFC recurrence coverage for every supported frequency.

### Database and authorization tests

- buddy constraints and cross-tenant rejection;
- ordinary, manager, HR, Admin, Super Admin, inactive, and unauthenticated
  availability writes;
- RLS and minimum grants;
- each module adapter's eligible and ineligible statuses;
- audit and notification atomicity;
- repeated reconciliation idempotency;
- blocked coverage visibility;
- historical FMS fallback and task records preserved;
- recurring generation uniqueness and service-role-only creation;
- safe template deletion and import validation.

### Web tests

- recurrence controls absent from the one-off Tasks composer;
- Primary and Secondary Buddy fields in user create/edit;
- no FMS fallback-person editor;
- availability range and reconciliation summary;
- recurring workspace buckets, templates, verification, follow-up,
  performance, and import states;
- role-aware navigation and mutation capability;
- loading, error, empty, Coverage Required, and Manager Review states.

### Verification gates

Run focused tests first, followed by local Supabase reset and pgTAP when Docker
is available, core and web tests, monorepo typecheck, web/monorepo build, and
`git diff --check`. Hosted Supabase, Edge Function, cron, and browser proof are
reported separately and are not inferred from local checks.

## Non-goals

- Rebuilding Supabase authentication from the Apps Script reference.
- Copying Google Sheets as a database or introducing client-side mock storage.
- Automatically moving in-progress work.
- Automatically returning covered work when the original employee becomes
  present.
- Chaining through a buddy's own buddy hierarchy.
- Deleting historical assignments, completed work, FMS versions, or audits.
- Deploying or applying production changes without a separate explicit
  production authorization.
