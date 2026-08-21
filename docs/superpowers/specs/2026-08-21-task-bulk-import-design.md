# Task Bulk Import Design

## Goal

Replace the current CSV-only task-import modal with a dedicated Bulk Import
workspace. Authorized task managers can download an Excel workbook, prepare
one-time and recurring tasks, validate the workbook, review row-level results,
and atomically import the validated batch.

The workbook must open in Excel and be importable into Google Sheets without a
Google account connection. Source workbook bytes and cell values are not stored
after the browser session; task records, validation summaries, batch metadata,
and audit records remain durable.

## Scope and access

Only active `super_admin`, `admin`, and `manager` profiles may view, validate,
or import tasks. Server-side rules remain authoritative:

- tenant boundaries always apply;
- managers can only resolve branches and departments they may manage;
- all doers and watchers must be active, login-enabled, and in authorized
  tenant/branch scope;
- super admins and admins can inspect tenant-wide import history; managers can
  inspect their own batches plus only data within their permitted branch scope.

## Import workspace

Selecting **Bulk Import** opens `/tasks/import` rather than a modal. The page
has these sections:

1. **Header and actions**: title, short explanation, Download format, Upload
   workbook, and a return-to-tasks action.
2. **Workflow rail**: Download, Fill, Upload, Validate, Review & Import.
3. **Workbook guidance**: supported formats (`.xlsx`, `.csv` for the simple
   Tasks sheet), 500 task/schedule limit, required fields, dates in India time,
   and semicolon-separated email lists where supported.
4. **Validation results**: totals for submitted rows, valid rows, errors,
   warnings, one-time tasks, recurring schedules, and initial instances.
   Errors list the workbook sheet, human row number, field, value-safe message,
   and corrective action. Import cannot be enabled while any error exists.
5. **Import preview**: first valid rows with task mode, title, scope, doer,
   planned time/schedule, priority, and checklist count.
6. **Recent imports**: batch time, importer, file label, requested/valid/error
   counts, one-time task count, recurring schedule count, initial-instance
   count, outcome, and idempotent replay state. Opening a batch shows only
   summary metadata and safe validation details, never workbook contents.

## Workbook contract

Download format produces one `.xlsx` workbook with four sheets.

### Read Me

Explains every field, uses local India date/time examples, describes the
validate-first workflow, and states that all rows must be valid before import.

### Tasks

One row represents a one-time task or one recurring schedule. Required headers
are fixed and case-insensitive, so no user mapping screen is needed:

`task_key`, `task_mode`, `title`, `description`, `priority`, `branch`,
`department`, `category`, `primary_doer_email`, `doer_emails`,
`watcher_emails`, `planned_at`, `recurrence_kind`, `recurrence_interval`,
`weekly_days`, `monthly_day`, `monthly_nth`, `monthly_weekday`, `ends_on`,
`requires_upload`, `requires_remark`, `published_form`.

- `task_mode` is `one_time` or `recurring`.
- One-time tasks require `planned_at` and one or more `doer_emails`; watchers
  are optional.
- Recurring rows require exactly one `primary_doer_email`, a start date/time in
  `planned_at`, and a supported recurrence definition. They cannot have
  watchers or multiple doers because the existing recurring task contract has
  one named default assignee.
- `recurrence_kind` is `daily`, `weekly`, `monthly_day`, or `monthly_nth`.
  Weekly rows require `weekly_days` (`MON;WED`, for example); monthly-day rows
  require `monthly_day`; nth-weekday rows require `monthly_nth` and
  `monthly_weekday`. `recurrence_interval` defaults to 1. `ends_on` is
  optional.
- `published_form` resolves an authorized published form by its unambiguous
  name. A form requirement is enabled only when this value is present.

### Checklist Items

Headers: `task_key`, `item_text`, `required`.

Many checklist items may belong to a task key. Each key must exist once in the
Tasks sheet. `required` defaults to `yes`. Blank rows are ignored.

### Reference Data

Contains the importer-visible branch, department, category, active employee
email, and published-form reference values. It is guidance only; the server
re-resolves every value and never trusts the workbook reference sheet.

## Validation and import transaction

The browser rejects unsupported extension, MIME mismatch, files over 1 MiB,
formula-bearing strings in import fields, more than 500 task/schedule rows,
unknown sheets, duplicate headers, and malformed cells. It parses Excel
workbooks and creates a canonical import payload.

The **Validate sheet** action sends the canonical payload to an authenticated,
non-persisting validation RPC. That RPC checks all values and task rules in the
same scope as import: roles, branch/department ownership, people, form,
category, dates, recurrence rules, participant conflicts, checklist keys, and
manager restrictions. The result is a bounded structured report without raw
source content.

The **Import all tasks** action is enabled only after a successful validation
of the unchanged canonical payload. The import RPC performs the same complete
validation again and creates the entire batch in one transaction. If any row
is invalid, no one-time task, recurring template, initial instance, checklist,
or batch record is created.

One-time rows use the existing audited delegation-task creation contract.
Recurring rows use the existing audited recurring-template contract and create
the first scheduled task instance. An SHA-256 digest of the canonical payload
prevents accidental duplicate import; repeating a completed payload returns
its existing batch summary rather than creating extra tasks.

## Persistence and audit

`task_import_batches` becomes an import summary record, adding a constrained
outcome, file label, task-mode totals, validation totals, and validation time.
It stores canonical headers and summary counts, not workbook files or raw cell
values. One audit event records a successful batch with its totals, and task
creation/template creation continues to use the existing per-record audit
contracts.

The migration adds the least privileges needed, updates RLS, and exposes only
an authorized recent-batch read path. It does not grant direct task-table
writes to the browser.

## Error handling

Validation errors are actionable and row-specific without revealing data from
profiles outside the caller's scope. Network failures preserve the local
workbook so the user can retry. A failed import leaves no partial records.
Workbook data is never rendered as HTML or evaluated as spreadsheet formulas.

## Testing

- Unit tests cover fixed-header workbook parsing, all task modes, recurrence
  mapping, checklist joins, email-list parsing, invalid dates/rules, unsafe
  cells, and canonical hashing.
- Database contract tests cover unauthenticated/unauthorized denial,
  tenant/branch isolation, manager scope, complete validation, atomic rollback,
  recurring template plus first-instance creation, idempotent replay, batch
  history visibility, and audit rows.
- Web tests cover the format download, upload rejection, validation reporting,
  disabled import on error, valid-preview/import action, and recent-history
  rendering.
- Typecheck, focused unit tests, database tests, and rendered browser QA verify
  the final behavior. Automated validation and rendered QA are reported
  separately.
