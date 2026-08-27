# Zero-Touch Task Import and Assigning Left Design

Date: 2026-08-27
Status: Approved

## Goal

Import the final MK Jewels checklist CSV without row-by-row technical choices.
Written employee identities are matched automatically when the active tenant has
one exact account. Blank, unmatched, or ambiguous identities do not block the
file: those records enter an admin-only Assigning Left queue and may remain
there or be assigned later.

## Import normalization

- Employee identity never fills down and is never guessed.
- The four visually grouped operational columns `BRANCH NAME`, `START TIME`,
  `DUE TIME`, and `EVIDENCE REQUIRED` fill down only after a prior nonblank
  value exists. The supplied final sheet uses those four blanks together as
  continuation rows.
- A blank `TASK START DATE` uses one import-level start date. The browser
  defaults it to the current `Asia/Kolkata` date and lets the importer change
  it once before import.
- Duplicate validation messages for the same row, field, and reason are
  collapsed. The primary screen shows aggregate counts; the technical report
  remains downloadable.

## Identity and verification

The server resolves assignees in this order: exact active email, then one exact
normalized active employee name. Zero or multiple matches produce no assignee.
The client may preview those outcomes but never becomes the authority.

Verifier labels first use one exact active employee-name match. Otherwise the
resolved assignee's active reporting manager is used. If neither is available,
the record imports with verification pending and remains in Assigning Left.
Verification is never silently disabled.

## Assignment states

Task instances and templates gain `assignment_status`, constrained to
`assigned` or `assigning_left`. Existing records backfill to `assigned`.

- An unassigned one-time instance has no active `task_assignees` row.
- An unassigned recurring/as-required template has no default assignee and is
  inactive, so workers cannot generate occurrences.
- Assigning a one-time instance creates its active original assignee.
- Assigning a template sets its default assignee. A recurring template becomes
  active and materializes its start-date occurrence only when that date is due;
  an as-required template remains inactive and continues to use Run Now.
- Every assignment is authorized and audited in one database transaction.

Only active `super_admin` and `admin` users can list or change Assigning Left.
Managers and ordinary users are denied by the RPC, grants, and RLS-visible task
contracts, independent of frontend routing.

## Repeat uploads

Exact file-hash replay continues to resume the same batch. A new tenant-scoped
metadata registry also stores a SHA-256 business fingerprint for each accepted
canonical row. The fingerprint omits the source row number, source task key,
and client-selected profile IDs, so overlapping records in reordered or renamed
files replay instead of creating duplicates. It includes normalized business
content, schedule, and source identity labels; changing material task content
creates a new record. No title, description, employee name, email, or raw row
payload is stored in the registry.

Fingerprint reservation and task/template creation happen in the same
transactional row savepoint. Concurrent uploads can create at most one record.
Replayed rows count toward batch completion and are reported separately.

## User experience

After upload, the page displays one start-date control and summary cards for:
total rows, automatically assigned, Assigning Left, recurring schedules, and
duplicates skipped after commit. It does not render identity dropdowns or a
thousands-row correction table. Blocking structural issues are grouped by
reason with affected-row counts and a correction report download.

The Tasks workspace gives admins an Assigning Left entry. That page lists the
safe task/template summary and supports individual assignment using the current
tenant-wide searchable assignee source. Ordinary users cannot open the route.

## Compatibility and safety

- The canonical four-sheet workbook flow remains unchanged.
- Applied migrations remain immutable; the change is forward-only.
- Existing assigned work, recurrence, RLS, and audit behavior remains intact.
- The raw uploaded file and row content are not persisted outside the business
  records the import creates.
- Generated database types stay identical in `packages/api-client` and
  `packages/core`.

## Verification

Pure TypeScript tests cover fill-down boundaries, default start dates, issue
deduplication, and deterministic identity previews. pgTAP covers authorization,
unassigned creation, later assignment, recurrence activation, verifier fallback,
cross-file replay, concurrency-safe uniqueness, metadata-only storage, and
audits. Web tests cover the simplified summary and admin queue behavior.
