# Current-Sheet Task Bulk Import Design

Date: 2026-08-25
Status: Approved for specification

## Purpose

MK Jewels needs to import one operational CSV containing one-time tasks,
recurring schedules, checklist work, evidence requirements, designated
verifiers, and manually triggered work. The current JewelOS bulk importer
accepts only its fixed canonical headers, permits at most 500 rows, and supports
only a subset of the schedules present in the operational sheet.

This change creates one safe import workflow that understands both the existing
JewelOS workbook and the current 18-column MK Jewels CSV. It keeps the Tasks and
Recurring / To-Do workspaces separate and routes validated records to the
correct contract automatically.

## Product decision

The workspaces remain distinct:

- **Tasks** owns ordinary one-time task instances.
- **Recurring / To-Do** owns recurring and as-required templates and their
  generated instances.
- **Task Bulk Import** is the shared entry point. It classifies, validates,
  previews, and imports both kinds in one workflow.

The product will not merge templates and instances into one management page.
Templates control future generation and activation; instances represent work
that can be started, completed, verified, and audited. Combining those
lifecycles would make ordinary task handling harder to understand and easier to
misconfigure.

## Source formats

The importer continues to accept the canonical four-sheet JewelOS `.xlsx`
workbook. It additionally accepts a CSV whose case-insensitive, whitespace-
normalized headers are:

1. `EMPLOYEE EMAIL`
2. `EMPLOYEE NAME`
3. `DEPARTMENT`
4. `BRANCH NAME`
5. `TASK TYPE`
6. `CORE TASK`
7. `TASK`
8. `TASK DESCRIPTION`
9. `FREQUENCY`
10. `TASK START DATE`
11. `START TIME`
12. `DUE TIME`
13. `PRIORITY`
14. `EVIDENCE REQUIRED`
15. `VERIFICATION REQUIRED`
16. `VERIFIER`
17. `BUDDY ALLOWED`
18. `ACTIVE`

Unknown, duplicate, missing, or reordered legacy headers are reported before
row parsing. Canonical workbook parsing remains backward compatible.

The source file is treated as data only. Spreadsheet formulas, formula-prefixed
strings, control characters, unsupported MIME types, and oversized cells are
rejected. The raw file is never stored in Postgres or Storage.

## Blank-cell and identity rules

Blank values never inherit from a preceding row. The importer does not emulate
merged cells or spreadsheet visual grouping.

A blank optional field remains null. A blank required field is a row-level
validation error. The preview explains the missing field and the accepted
format. No records can be committed until the complete file passes validation.

Employee email is the authoritative assignee identifier. When an employee name
is present without an email, the row remains blocked until the importer chooses
an active in-scope profile in a batch-level identity-mapping panel. The panel
may show exact-name candidates visible to the importer, but it never chooses a
candidate automatically. One confirmed mapping can resolve every row using the
same normalized name.

The same rule applies to `VERIFIER`: email is preferred when the source later
supports it; the current name field requires explicit batch-level mapping to an
active in-scope profile. Ambiguous, inactive, cross-tenant, cross-branch, or
otherwise unauthorized profiles remain blocked. The server revalidates all
confirmed profile IDs at commit time.

`BRANCH NAME` and `DEPARTMENT` are required. They are not inferred from the
assignee. This makes cross-branch mistakes visible and lets the server require
the resolved assignee to match the declared organizational scope.

## Row mapping

Each nonblank CSV row represents one task or one schedule. Rows are not grouped
by `CORE TASK`; the current file reuses core-task labels across employees,
departments, and frequencies.

| CSV field | Canonical meaning |
| --- | --- |
| `TASK` | Delegation title; for checklist rows, the generated checklist-item text |
| `CORE TASK` | Preserved operational group label; for checklist rows, the instance title |
| `TASK DESCRIPTION` | Description |
| `TASK TYPE = TASK` | Delegation completion mode |
| `TASK TYPE = CHECK LIST` or `CHECKLIST` | Checklist completion mode |
| `FREQUENCY` | Routing and schedule kind |
| `TASK START DATE` + `START TIME` | First scheduled start in `Asia/Kolkata` |
| `DUE TIME` | Deadline time in `Asia/Kolkata` |
| `PRIORITY` | Existing JewelOS priority, normalized case-insensitively |
| `EVIDENCE REQUIRED` | Whether completion requires an allowed upload |
| `VERIFICATION REQUIRED` | Whether completion enters verification |
| `VERIFIER` | Designated verifier mapping |
| `BUDDY ALLOWED` | Whether profile-level coverage routing is enabled |
| `ACTIVE` | Active or paused template state |

`CORE TASK` is stored in new nullable `core_task_label` columns on templates
and instances. It is not forced into Dropdown Master because the source
contains hundreds of operational labels that are not established task
categories.

Accepted boolean values are `yes/no`, `true/false`, and `1/0`. Blank booleans
are errors in the legacy format because the current sheet defines these fields
explicitly.

## Routing and schedule construction

Frequency is normalized case-insensitively:

| Frequency | Result |
| --- | --- |
| `One Time` or `Once` | Create one ordinary Tasks instance |
| `Daily` | Create an active or paused Recurring / To-Do template |
| `Weekly` | Create a weekly template anchored to the start-date weekday |
| `Monthly` | Create a monthly template anchored to the start-date day |
| `Quarterly` | Create a three-month template anchored to the start date |
| `Yearly` | Create a yearly template anchored to the start month and day |
| `As Required` | Create an inactive manual template with no instance |

Every scheduled frequency except `As Required` requires a start date, start
time, and due time. `As Required` requires start and due times but permits a
blank start date; Run Now supplies its target date. The due time must be later
than the start time on the same business date. Overnight tasks are outside this
import contract and must be created manually until JewelOS has an explicit
cross-date deadline model.

The RRULE mapping is deterministic:

- Daily: `FREQ=DAILY`
- Weekly: `FREQ=WEEKLY;BYDAY=<start weekday>`
- Monthly: `FREQ=MONTHLY;BYMONTHDAY=<start day>`
- Quarterly: `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=<start day>`
- Yearly: `FREQ=YEARLY;BYMONTH=<start month>;BYMONTHDAY=<start day>`

An active recurring template creates its first instance at the supplied start
date and time. A paused template creates no initial instance. An as-required
template is always stored inactive regardless of the source `ACTIVE` value and
can create an instance only through the audited Run Now action. A one-time row
must be active; `ACTIVE = No` is invalid for one-time work.

The source currently contains no explicit one-time frequency. `As Required`
is not silently converted into one-time work because it represents a reusable
manual template rather than an occurrence.

## Task type, evidence, and completion

Task type and evidence are independent:

- A checklist task uses ordered checklist items and checkbox completion.
- A delegation task uses the ordinary task lifecycle.
- `EVIDENCE REQUIRED = Yes` requires a permitted private attachment before
  completion for either mode.
- `EVIDENCE REQUIRED = No` permits completion without an attachment.

This removes the current recurring-work assumption that every delegation task
must require an image. Existing records retain their current requirements.

The legacy CSV has no separate checklist-item sheet. Therefore each legacy
`CHECK LIST` row initially creates a checklist-mode task with one required item
whose text is the row's `TASK` value, while the task instance title is the
`CORE TASK` value when present. This exception is necessary to avoid creating a
checkbox task with no checkbox. The import preview shows both the task title
and its generated checklist item. Canonical workbooks continue to use their
explicit `Checklist Items` sheet and do not use this transformation.

## Start and deadline model

JewelOS currently uses `planned_datetime` as both scheduled time and effective
deadline in several task paths. The source distinguishes `START TIME` from
`DUE TIME`, so a forward migration adds:

- `task_templates.due_time time null`
- `task_instances.due_datetime timestamptz null`

For new imported work, `planned_time`/`planned_datetime` is the scheduled start
and `due_time`/`due_datetime` is the deadline. Existing rows remain compatible:
when `due_datetime` is null, readers and server functions use the existing
planned/revised deadline behavior.

The effective deadline becomes:

`revised_datetime`, then `due_datetime`, then `planned_datetime`.

Overdue state, coverage windows, reports, reminders, notifications, and task
filters use that same server-authoritative order. Historical data is not
rewritten.

## Designated verification

A forward migration adds nullable `verifier_user_profile_id` columns to task
templates and task instances. When verification is required, a designated
verifier is mandatory.

Completion sets verification status to `pending`. The designated verifier may
verify or reject. Active `super_admin` and `admin` users may override the
designated verifier only with a nonblank audit note; managers have no general
override and can act only when designated and within branch scope. Rejection
continues to require a reason.

The verifier is copied from template to each generated instance so later
profile or template edits do not silently change responsibility for existing
work.

## Buddy coverage

`BUDDY ALLOWED` maps to the existing profile-level coverage switch. It never
selects a buddy from the spreadsheet.

- `Yes` permits the server-authoritative original employee, primary buddy,
  secondary buddy, and coverage-required policy currently established by the
  task coverage contract.
- `No` preserves direct assignment to the original employee and bypasses buddy
  substitution for that task or schedule.

The import preview calls out that the supplied file currently disables buddy
coverage for every row. This is informational, not an automatic correction.

## Large-file workflow and idempotency

The browser file limit becomes 2 MiB and the maximum normalized row count
becomes 2,500, which covers the observed 1,932-row source with bounded headroom.
Cell-length and total-payload limits remain enforced.

The complete file is parsed and validated before any write. Validation includes
all rows, identity mappings, tenant/branch/department scope, dates, schedules,
task types, priorities, booleans, verifier authority, and source duplicates.

Commit is resumable rather than one oversized PostgREST transaction:

1. The server creates or resumes a metadata-only `task_import_batches` row
   identified by the canonical file hash.
2. The browser sends at most 100 canonical rows per commit call.
3. Each chunk is revalidated and committed atomically.
4. A new protected `task_import_items` table records batch ID, source row,
   canonical row hash, outcome, and created template/instance IDs. It stores no
   task title, description, email, name, or raw row payload.
5. A unique `(batch_id, source_row)` constraint makes retries idempotent.
6. Re-uploading the unchanged file resumes missing chunks after the browser is
   closed or the network fails.
7. Records created by a completed chunk become visible immediately in their
   destination workspace; the progress screen clearly labels the batch as
   incomplete until every row finishes.
8. The batch becomes `completed` only when every validated row has a completed
   item. A drift failure pauses the batch with a safe issue code and does not
   roll back already committed chunks.

Because the complete file must validate before commit, ordinary source
corrections happen before any partial write. If authorization or roster state
changes during commit, the user fixes that external state and resumes the exact
same canonical file. A batch may be cancelled only before its first chunk.
After any chunk completes, only the exact file can resume it; changing the
source requires a separately approved manual reconciliation because some work
is already live.

The UI explains this boundary before import. Recent history reports requested,
completed, remaining, failed, one-time, recurring, as-required, initial-
instance, and replay counts without displaying source content.

## Database and authorization

All changes are forward-only. Applied migrations, including the current bulk
import and recurring-workspace migrations, remain immutable.

The database change will:

1. Add the template/instance core-label, deadline, and designated-verifier
   columns.
2. Add `task_import_items` with tenant scope, RLS, minimum grants, bounded
   metadata, and supporting indexes.
3. Extend batch outcomes for validating, importing, paused, completed, and
   cancelled states.
4. Add protected validation, begin/resume, chunk-commit, and safe-history RPCs.
5. Update task/template creation and recurrence-generation contracts to carry
   the new fields.
6. Update effective-deadline consumers consistently.
7. Write task, template, verification, import-item, and batch audit events in
   the same transactions as their sensitive writes.

Only active `super_admin`, `admin`, and authorized `manager` profiles may
validate or import. Anonymous, inactive, cross-tenant, cross-branch, and
ordinary-staff paths are denied by the RPCs and RLS. The browser cannot submit
tenant IDs, claim a resolved identity, bypass validation, or write task tables
directly.

## Import workspace

The existing `/tasks/import` route remains the shared workspace and can be
opened from both Tasks and Recurring / To-Do.

The revised workflow is:

1. Upload file.
2. Detect canonical workbook or current-sheet CSV.
3. Resolve batch-level employee/verifier mappings.
4. Validate all rows.
5. Review route counts and blocking issues.
6. Confirm import.
7. Show chunk progress and safe retry/resume controls.
8. Show links to imported Tasks and Recurring / To-Do schedules.

The preview includes source row, destination, task/checklist mode, core label,
title, employee, branch, department, start, deadline, frequency, evidence,
verification, buddy coverage, and active state. It displays at most a bounded
page at once and never renders spreadsheet content as HTML.

Validation issues can be filtered by missing data, identity, schedule, scope,
or unsupported value. The user can export a correction report containing row
numbers, fields, safe reasons, and guidance; it does not include unrelated
profile data.

## Compatibility

- Existing canonical `.xlsx` imports remain accepted.
- Exact replay of a completed canonical or legacy file remains idempotent.
- Existing task and recurring records are not rewritten.
- Existing templates without due times or designated verifiers retain current
  behavior.
- The generated database types in both `packages/api-client` and
  `packages/core` are updated together.
- The recurring worker is updated to populate deadline, verifier, core label,
  evidence, and buddy fields for future instances.

## Error handling

- Parsing and structural failures remain browser-local.
- Identity and authorization failures come from the protected validation RPC
  using privacy-safe messages.
- Import cannot begin while any row is invalid.
- A failed chunk is rolled back completely and can be retried.
- Completed chunks are never duplicated on retry.
- A changed file cannot silently resume an earlier partial batch.
- No failure response contains another tenant's names, emails, task content,
  raw row payload, or secrets.

## Testing and verification

Pure TypeScript tests cover:

- legacy-header detection and normalization;
- no fill-down behavior;
- all frequency mappings and RRULEs;
- start/deadline validation;
- task/checklist and evidence independence;
- identity-mapping requirements;
- 2,500-row and payload bounds;
- canonical hashing and chunk construction;
- unsafe cell rejection;
- backward-compatible canonical workbook parsing.

pgTAP tests cover:

- anonymous, inactive, ordinary-user, cross-tenant, and cross-branch denial;
- manager scope;
- explicit employee and verifier mappings;
- exact designated-verifier enforcement and privileged override auditing;
- validation before import;
- atomic chunk rollback;
- resumable/idempotent chunk replay;
- changed-file resume denial;
- one-time, recurring, paused, yearly, quarterly, and as-required routing;
- first-instance creation;
- core-label, start, deadline, evidence, verification, and buddy persistence;
- effective-deadline compatibility for historical rows;
- metadata-only history and item storage;
- per-record and batch audit behavior.

Web tests cover file detection, identity mapping, issue filtering, route-count
preview, disabled commit, progress, retry, resume, and links to both destination
workspaces. Focused tests, local Supabase reset/pgTAP, database lint, typecheck,
build, and rendered authenticated browser QA are reported separately. Hosted
Supabase, Vercel, and production-data verification require later explicit
release authorization and are not implied by local results.

## Delivery boundaries

This feature changes local source and database contracts only until the user
separately authorizes deployment. It does not edit the supplied CSV, infer its
missing values, modify staff identities, apply a hosted migration, push Git,
or deploy Vercel as part of implementation.
