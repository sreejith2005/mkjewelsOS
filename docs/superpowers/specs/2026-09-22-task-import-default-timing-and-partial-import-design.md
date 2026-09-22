# Task Import Default Timing and Partial Import Design

Date: 2026-09-22
Status: Approved design; implementation pending

## Goal

Make operational task imports succeed without asking an administrator to
manually enter the same store-hour timing windows for thousands of rows, while
allowing safe rows to import even when other rows need correction.

The importer must:

- derive a sensible default schedule from the frequency family;
- keep explicit valid row times authoritative;
- create one daily card with checkpoints for multi-occurrence daily labels;
- send blank, unmatched, or ambiguous assignees to Assigning Left;
- import valid rows without importing malformed or ambiguous task data; and
- preserve authorization, audit, resumability, and idempotency.

## Observed failure and root cause

The 2,294-row operational CSV contains 72 distinct written frequency values.
The shared planner already recognizes all 72 values. The correction report is
dominated by timing errors because both web and native initialize the six
timing presets as empty objects. Every row with blank start and due cells then
reports missing timing presets, followed by a derivative due-before-start
error.

The current clients also treat any parser issue as a reason to clear the entire
ready-row set. A single bad row therefore disables every otherwise valid row.
Both clients additionally block import while any written employee name remains
unresolved, even though the database contract safely stores such work with
`assignment_status = 'assigning_left'`.

## Chosen approach

Use shared frequency families with business-hour defaults, then partition the
normalized rows by row-scoped issues before identity mapping and import.

This is preferred over maintaining a second table with 72 exact time entries:
new spellings can map to an existing semantic family without duplicating its
schedule. It is also preferred over the current empty-preset workflow because
the administrator should edit a default only when business hours differ, not
before every import.

## Timing contract

Store hours are 11:00 to 20:00 in India time. Shared defaults are:

| Timing family | Start | Due | Frequency meaning |
| --- | --- | --- | --- |
| opening | 11:00 | 13:00 | opening work |
| morning | 11:00 | 13:00 | morning work |
| general | 11:00 | 13:00 | ordinary one-time, daily, weekly, monthly, quarterly, and annual work |
| evening | 18:00 | 20:00 | evening work |
| closing | 18:00 | 20:00 | closing work |
| full day | 11:00 | 20:00 | event-driven work and work spanning multiple moments in the day |

The existing `manual` preset becomes the full-day 11:00-20:00 window. A new
public preset key is unnecessary. Frequency planning selects start and due
families independently:

- `Daily - Opening` uses opening to opening: 11:00-13:00.
- `Daily - Morning` uses morning to morning: 11:00-13:00.
- `Daily - Closing` uses closing to closing: 18:00-20:00.
- ordinary scheduled frequencies use general to general: 11:00-13:00.
- `Throughout Day`, `2x Daily`, and `3x Daily` start with opening and end with
  closing: 11:00-20:00.
- `Morning & Evening` starts with morning and ends with evening: 11:00-20:00.
- `Morning & Closing` starts with morning and ends with closing: 11:00-20:00.
- blank frequency, As Required, Per Customer, Per Lead, Per Visit, After Visit,
  and the other event-driven labels use manual to manual: 11:00-20:00.

`2x Daily`, `3x Daily`, `Morning & Evening`, and `Morning & Closing` remain one
daily task card with multiple required checkpoints. They do not create multiple
cards.

Both clients initialize timing presets from one shared constant before parsing
a selected file. The controls remain visible for every family used by blank
cells and remain editable. A valid explicit `START TIME` or `DUE TIME` in a row
overrides only that side of the default window. Invalid explicit values remain
blocking row errors; the importer never silently repairs written times.

Unknown frequency text remains a blocking row error. The change does not use
fuzzy frequency matching.

## Row eligibility contract

A shared pure helper partitions normalized draft rows and parser issues into:

- `readyRows`: rows with no error tied to their `source_row`;
- `blockedRows`: rows with one or more errors tied to their `source_row`;
- `blockedSourceRows`: the unique physical source-row numbers; and
- `globalIssues`: errors that cannot safely be assigned to one data row.

Data rows always begin at physical row 2. An error with a row below 2 is global.
The existing row-limit issue on worksheet row 1 is also global. A global issue
produces no ready rows. Wrong headers, unsupported files, unreadable workbooks,
and over-limit sources therefore continue blocking the complete import.

Row-scoped errors—including an unknown frequency, invalid written time, invalid
boolean, unsupported task type, empty title, or invalid date—exclude only that
row. Multiple issues on one source row still count as one blocked row.

Warnings, if introduced later, do not block a row unless explicitly promoted
to severity `error`.

## Identity and Assigning Left

Identity mapping runs only after parser-based row partitioning. Exact unique
email/name/alias matches are assigned automatically. A blank, unmatched, or
ambiguous assignee is not a parser failure and does not block the row. It is
sent through the existing protected RPC with empty `assignee_profile_id` and
`assignment_status = 'assigning_left'`.

The optional identity-confirmation controls remain available for administrators
who want to resolve a label before import, but unresolved names no longer
disable the import action. No identity is guessed. Assigning Left remains the
place to assign imported work later.

Verifier resolution remains unchanged: an exact explicit verifier is used;
otherwise an assigned employee's active manager may be used by the existing
server contract. Authorization stays server-side.

## Import experience

Web and native show these distinct counts:

- source records;
- ready to import;
- blocked rows;
- assigned automatically; and
- Assigning Left.

When every normalized row is ready, the action reads `Import all N records`.
When only a subset is ready, it reads `Import N valid records`. The action is
disabled only when there are zero ready rows, a global issue exists, or an
import is running.

The correction report continues listing safe field/reason/guidance details for
the blocked rows. It does not include raw task contents or employee data.

The import hashes and begins a batch using only the ready subset. The existing
100-row chunking and RPC validation then process that subset. The completion
message reports the imported subset and reminds the administrator how many
source rows remain blocked.

If corrected rows are uploaded later, existing business fingerprints replay
previously imported rows without duplication and create only newly valid work.

The older canonical four-sheet path retains its existing server-validation
workflow. Partial row eligibility applies to the current shared draft formats:
the one-sheet business workbook, six-column work list, and earlier 18-column
sheet.

## Architecture and persistence

Shared core owns:

- default timing windows;
- frequency-family selection; and
- row eligibility partitioning.

Web and native consume those shared contracts and do not copy the rules.
Existing API/data clients continue calling the same authenticated RPCs.

No database migration is expected. The current server already:

- accepts subsets in batches of 1-100 rows;
- revalidates organization, identity, timing, and row contracts;
- records per-row created, replayed, or rejected outcomes;
- writes audited task/template changes; and
- persists unresolved work as Assigning Left.

No browser or native client gains authorization authority. The source workbook
and raw rows remain transient and are not stored.

## Error and recovery behavior

- Explicit invalid data is never replaced by a default.
- A frequency not in the closed planner is blocked, not guessed.
- Structural failures disable partial import.
- Server rejection of a ready row remains a `partial` batch outcome and appears
  in the existing outcome/correction flow.
- Timing controls can be changed before import, which reparses the retained
  local file with stale-result protection.
- Failed or interrupted chunks remain resumable under the existing batch
  contract.

## Verification

Shared unit tests cover:

- the six default windows;
- all 72 observed frequencies and their selected start/due families;
- 11:00-20:00 event-driven templates;
- one-card checkpoint behavior for multi-occurrence daily labels;
- explicit time override and invalid-explicit-time rejection;
- ready/blocked/global partitioning and issue deduplication; and
- unresolved assignees remaining eligible for Assigning Left.

Web and native tests cover:

- defaults supplied on first parse;
- editable timing overrides and reparsing;
- ready and blocked counts;
- subset button labels and enablement;
- unresolved names not blocking import;
- only ready rows entering hashing, reconciliation, batching, and chunks; and
- correction reports remaining available for blocked rows.

The real 2,294-row source is checked locally using aggregate-only output: source
count, distinct frequency count, ready count, blocked count, required timing
families, and issue groups. Employee names, emails, titles, and raw rows must not
appear in logs, tests, screenshots, Git, or chat.

Run focused tests first, then full core/web/native suites, typechecks, production
build, whitespace checks, and the existing database test that covers protected
chunk import and Assigning Left. Rendered authenticated web/native proof remains
separate from static and unit-test evidence.
