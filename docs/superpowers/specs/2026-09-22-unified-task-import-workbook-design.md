# Unified Task Import Workbook Design

Date: 2026-09-22
Status: Implemented locally

## Goal

Replace the current technical four-sheet download with one readable task-import
worksheet that an administrator can use as the durable copy-paste target for
operational task lists. The downloaded format and the upload parser must share
one schema definition so a future format change cannot update one without the
other.

The importer must continue accepting the existing formats while adding direct
support for the six-column `All Employees Work list - FINAL CLEAN TASK.csv`.
Every valid source row must become either assigned work or an Assigning Left
record without weakening the existing authorization, audit, idempotency, or
resumability contracts.

## Current failure

The current Download format action creates four worksheets: `Read Me`, `Tasks`,
`Checklist Items`, and `Reference Data`. The Tasks sheet contains 22 technical
snake-case headers, while checklist items live on another sheet. The workbook
has no useful column widths or visual distinction between required and optional
fields. It is technically oriented and is not a practical copy-paste template.

The new operational CSV contains 2,294 rows and these six headers:

1. `EMPLOYEE NAME`
2. `DESIGNATION`
3. `MAIN TASK`
4. `TASK TYPE`
5. `TASK FREQUENCY`
6. `KRA`

The parser currently recognizes only the canonical workbook or the earlier
18-column CSV. It therefore sends the six-column file through canonical
validation and reports missing `task_key`, `task_mode`, `title`, and
`planned_at` for every row.

## Chosen approach

Create one business-facing worksheet and normalize every supported source
format into the existing `TaskImportDraftRow` contract. Do not make header
matching fuzzy: each supported format has an explicit header signature and an
explicit adapter. This remains predictable, testable, and safe while still
supporting old files.

The alternatives were rejected:

- Flattening the existing canonical workbook into one sheet would retain the
  technical columns and would still be difficult to populate from operational
  source lists.
- Accepting arbitrary or approximately matched headers would risk silently
  mapping a changed column to the wrong business field.

## Downloaded workbook contract

The workbook contains one worksheet named `Tasks`. Row 1 contains the headers
and row 2 contains one realistic, importable example. There are no instruction
or reference worksheets.

The columns, in order, are:

1. `EMPLOYEE NAME`
2. `EMPLOYEE EMAIL`
3. `MAIN TASK`
4. `TASK DESCRIPTION`
5. `TASK TYPE`
6. `TASK FREQUENCY`
7. `CHECKPOINTS`
8. `KRA`
9. `CORE TASK`
10. `DEPARTMENT`
11. `BRANCH NAME`
12. `TASK START DATE`
13. `START TIME`
14. `DUE TIME`
15. `PRIORITY`
16. `EVIDENCE REQUIRED`
17. `VERIFICATION REQUIRED`
18. `VERIFIER`
19. `BUDDY ALLOWED`
20. `ACTIVE`

`MAIN TASK` is the only universally required cell. Other fields are optional
or conditionally used:

- `EMPLOYEE NAME` and `EMPLOYEE EMAIL` resolve the assignee. Email wins when
  it uniquely identifies an active in-tenant account. Otherwise the existing
  saved-alias and safe name matching flow applies. A missing or unresolved
  identity goes to Assigning Left.
- `TASK TYPE` accepts `TASK`, `CHECK LIST`, or `CHECKLIST`; blank means `TASK`.
- `TASK FREQUENCY` accepts the normalized values below; blank means manual
  `As Required` work.
- `CHECKPOINTS` is a newline-separated list stored as task checklist items.
  It keeps checklist content on the same worksheet.
- `KRA` maps to the task category when a matching active category exists.
  A missing or unmatched KRA does not invent a category.
- `DEPARTMENT` and `BRANCH NAME` are optional organization hints. The server
  continues deriving scope from a resolved assignee first and applying its
  existing authorized fallback for unresolved work.
- `TASK START DATE` may be blank and then uses the import-level start date.
- `START TIME` and `DUE TIME` may be blank and then use the applicable timing
  preset selected on the import page.
- `PRIORITY` defaults to `medium`.
- `EVIDENCE REQUIRED` and `VERIFICATION REQUIRED` default to `No`.
- `VERIFIER` is used only when verification is required. The existing manager
  fallback and unresolved-verifier behavior remain intact.
- `BUDDY ALLOWED` defaults to `Yes`.
- `ACTIVE` defaults to `Yes` for scheduled work. Manual As Required templates
  remain inactive and are launched through Run Now.

The header is frozen and filtered. Columns have bounded readable widths; text
columns wrap. Required and optional headers have distinct token-compatible
styles. Each header has a concise Excel comment explaining accepted values and
its default. The example row uses non-production placeholder identity data and
passes the same parser used for uploaded rows.

## Supported input formats

Upload detection remains exact and supports four contracts:

1. The new one-sheet 20-column downloaded workbook or CSV.
2. The new six-column operational CSV.
3. The earlier 18-column operational CSV.
4. Existing canonical four-sheet workbooks already downloaded by users.

The first three formats normalize through the shared current-sheet flow so
they receive identity preview, Assigning Left, resumable 100-row commits,
business-fingerprint deduplication, and the current result reporting. Existing
canonical workbooks retain their compatibility path; the application no longer
offers that format for new downloads.

Unknown header sets are rejected with one structural error that lists the
recognized formats. Columns are never matched approximately or by position.

## Frequency normalization

Normalization is case-insensitive and treats repeated whitespace, spaces around
slashes, hyphen variants, en dashes, and the multiplication character in `2x`
or `3x` consistently. The original text is never executed or interpreted as an
arbitrary RRULE.

### Daily schedules

These create one task card on each due day:

- `Daily`
- `Daily - Opening`
- `Daily - Morning`
- `Daily - Closing`
- `Daily - T-1`
- `Daily/Ongoing`
- `Daily/As Required`
- `Daily/As Assigned`
- `Daily/As Posted`
- `Daily/As Scheduled`
- `Daily/Per Refill`
- `Daily/Weekly`
- `Daily/Monthly`
- `Throughout Day`

Where a compound label includes Daily, the daily cadence is authoritative. It
does not create duplicate weekly or monthly occurrences.

### Daily schedules with checkpoints

These still create one daily card:

- `2x Daily`: two generated checkpoints.
- `3x Daily`: three generated checkpoints.
- `Morning & Evening`: Morning and Evening checkpoints.
- `Morning & Closing`: Morning and Closing checkpoints.

Generated checkpoint text includes the main task, for example
`Morning: Update customer follow-ups`. A nonblank `CHECKPOINTS` cell overrides
the generated labels. Users can tick checkpoints throughout the day. The
existing completion contract remains unchanged: completing the card closes any
remaining checklist items rather than introducing a new completion gate.

### Weekly schedules

- `Weekly` is anchored to the selected or supplied start-date weekday.
- `Every Monday` runs every Monday.
- `Sunday` runs every Sunday.
- `Monday & Thursday` runs on both weekdays.
- `Monday & Thursday/As Required` uses the same two-day schedule.
- `Weekly/As Required` and `Weekly/As Scheduled` use the weekly cadence
  anchored to the start-date weekday.

### Monthly, interval, and annual schedules

- `Monthly` is anchored to the start-date day of month.
- `1st Monthly` runs on day 1.
- `7th Monthly` runs on day 7.
- `13th Monthly` runs on day 13.
- `Monthly - 1st to 5th` runs once on each of days 1 through 5.
- `1st Week Monthly` creates one card on the first day of each month for the
  first-week activity.
- `Monthly/As Required` and `Monthly/As Scheduled` use the monthly cadence
  anchored to the start-date day.
- `Every 15 Days` uses a daily rule with interval 15 anchored to the start date.
- `Annual` and `Yearly` use a yearly rule anchored to the start month and day.

### Manual event-driven work

These create inactive As Required templates and no speculative calendar
occurrence:

- blank frequency
- `As Required`, `As Required/Ongoing`, `As Scheduled`, `As Assigned`,
  `As Applicable`, and `Ongoing`
- `Campaign-Based` and `Shoot Days`
- every `Per ...` value, including customer, lead, product, receipt, call,
  enquiry, visit, refill, piece/batch, job, issue, bag, parcel, prospect,
  follow-up, interaction, movement, video call, CAM piece, lost lead, and
  not-bought customer variants
- every `After ...` value, including serving, customer visit, shoot, event,
  and visit

This is deliberate: the current system has no durable customer, lead, visit,
campaign, posting, or shoot event attached to these spreadsheet rows. Creating
calendar tasks for those labels would fabricate trigger dates. Authorized
admins can create an occurrence with Run Now when the real event happens.

## Timing presets

Explicit valid row times always win. After parsing a file, the page shows only
the presets required by rows whose times are blank:

- General daily/start and due
- Opening start and due
- Morning start and due
- Closing start and due
- Evening due
- Manual Run Now start and due

The importer cannot continue until every required preset has a valid same-day
start and later due time. Presets are visible and editable; the system does not
silently invent store hours. Multi-checkpoint cards use the earliest relevant
start and latest relevant due time.

## Normalization and persistence flow

One shared schema descriptor owns the ideal headers, order, required/default
metadata, header comments, example values, and normalization keys. The workbook
generator and parser import that descriptor. A test fails if their contracts
drift.

The adapters produce `TaskImportDraftRow` values. Existing identity mapping
then supplies profile IDs and assignment state. Existing client hashing,
reconciliation, batch creation, 100-row chunking, audited database writes, and
business fingerprints remain authoritative.

The implementation does not add a second persistence path, perform browser-side
task inserts, store raw workbook contents, or put authorization decisions in
the template. No schema migration is expected because all selected cadences can
use the current `schedule_kind`, RRULE, template checklist, and task instance
contracts. If implementation proves a database contract must change, work
stops and this design is revised before adding a migration.

## Error handling

Structural errors remain grouped rather than repeated for every row. Row-level
issues identify the physical worksheet row and use business header names.
Unsupported nonblank frequencies are rejected; they are not silently converted
to As Required. Blank frequency alone intentionally means As Required.

Invalid explicit values are not replaced by defaults. For example, malformed
times, unsupported task types, invalid booleans, unsafe formula-prefixed cells,
and a due time not later than its start time remain correction issues.

The 2 MiB and 2,500-source-row limits remain. Adding generated checkpoints does
not expand the number of import rows or distort import totals.

## Compatibility and protected behavior

- Tasks and Recurring / To-Do remain separate workspaces.
- Assignment matching remains server-authorized and never trusts designation,
  role, or client-supplied profile data.
- Blank identities are never filled from surrounding rows.
- Existing RLS, RPC grants, auditing, tenant scope, buddy coverage, verification,
  checklist, evidence, replay, and retry behavior remain unchanged.
- Existing files keep importing through their exact adapters.
- Generated tasks continue to appear through the current web and native task
  feeds. The import screen remains web-only, but native checklist rendering is
  checked because generated checkpoints are cross-surface task data.
- Raw employee/source data is not added to import-history metadata or logs.

## Verification

Development follows red-green TDD. Focused tests cover:

- the one-sheet workbook name, exact column order, example row, comments,
  widths, filter, and frozen header;
- round-tripping the generated example through the upload parser;
- exact detection of the unified 20-column, six-column, legacy 18-column, and
  canonical four-sheet contracts;
- all distinct frequency values observed in the 2,294-row source, including
  punctuation variants;
- RRULEs for weekdays, monthly dates/ranges, annual work, and 15-day intervals;
- automatic and explicit checkpoints without adding import rows;
- required/default field behavior and editable timing presets;
- grouped structural errors and physical source-row references;
- unchanged identity, Assigning Left, fingerprint, chunking, and replay paths;
- existing canonical workbook compatibility;
- web Task Bulk Import rendering and Download format behavior;
- web and native display of imported checkpoint tasks.

The attached operational CSV is used only for local, privacy-safe aggregate and
parser verification. It is not copied into the repository or test fixtures.
Focused core and web suites run first, followed by package typechecks, the web
build, relevant mobile tests if the shared task contract is touched, and
`git diff --check`. Database tests are required only if implementation reveals
a database change; no hosted migration, deployment, or authenticated production
proof is implied by local checks.

## Out of scope

- Automatically wiring Per Customer, Per Lead, campaign, visit, shoot, or other
  event-driven rows to CRM/FMS events.
- Changing task-card completion semantics or requiring every checkpoint before
  completion.
- Replacing the Recurring / To-Do workspace or recurrence generator.
- Importing employee/designation master data from a task file.
- Deploying, applying hosted migrations, or publishing Git changes as part of
  the implementation unless separately requested.
