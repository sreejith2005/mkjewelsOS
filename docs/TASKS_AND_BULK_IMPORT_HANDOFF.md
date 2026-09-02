# JewelOS Tasks and Bulk Import — Complete Context and Handoff

Last updated: 2 September 2026 (Asia/Kolkata)

Authoritative repository: `C:\Users\MIS\Downloads\MKJewelOS\jewelos`

Current source checkpoint when this document was written: `4fccac3` on `main`

## 1. Why this document exists

This is the durable context document for future work on the JewelOS **Tasks**, **Recurring / To-Do**, **Task Bulk Import**, and **Assigning Left** surfaces. It records:

- what the business originally needed;
- what was learned from the final 1,932-row task sheet;
- the product and technical decisions that were approved;
- what was implemented and why;
- the failures encountered and the fixes applied;
- the correct meaning of the different task/import counts;
- the current architecture and safety constraints;
- the next approved design: expandable task details;
- a concrete implementation and verification plan for that next change.

Future agents and developers should read this document together with `AGENTS.md`, `PROJECT_HANDOFF.md`, and the current source. This document is a historical and product-intent reference; the current migrations, database contract, tests, and source remain authoritative if implementation has changed since the checkpoint above.

## 2. Original business problem

MK Jewels maintains a large operational task sheet containing one-time work, recurring work, checklist work, evidence rules, verifier rules, and tasks with or without named employees. The sheet is still updated over time, so the importer must accept repeated and overlapping uploads safely.

The main goals established during this work were:

1. Import the final sheet without making an administrator answer thousands of technical questions.
2. Automatically route one-time work and recurring schedules to the correct internal contracts.
3. Keep the normal Tasks experience simple for employees.
4. Let admins manage recurring definitions separately without exposing that technical management surface to ordinary users.
5. Assign rows with recognizable employee names automatically.
6. Keep rows with blank, unknown, or genuinely ambiguous names safely unassigned in **Assigning Left**.
7. Allow Assigning Left work to remain unassigned indefinitely or be assigned later.
8. Prevent duplicate task creation across retries and future overlapping uploads.
9. Make imports resumable and safe for thousands of rows.
10. Preserve descriptions and operational sheet details so employees can understand the underlying work.

## 3. Final source-sheet contract

The source examined during this work contained **1,932 data rows** and these **18 columns**:

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

Important source observations:

- `CORE TASK` is an operational grouping label and is not unique.
- A CSV row represents one task or one recurring/as-required schedule; rows must not be grouped merely because they have the same core-task label.
- The file visually groups some values. The final approved parser may carry forward only `BRANCH NAME`, `START TIME`, `DUE TIME`, and `EVIDENCE REQUIRED` after a preceding nonblank value. Employee identity never fills down.
- Blank `TASK START DATE` cells use the single import-level **Start schedules from** date.
- Blank employee names remain unassigned. They are not guessed or inherited.
- Formulas, formula-prefixed strings, control characters, unexpected headers, unsafe cells, unsupported schedules, and invalid values must be rejected safely.
- The raw spreadsheet is not stored in Postgres or Storage. Only the resulting business records and privacy-safe import metadata are persisted.

## 4. Product architecture decision

The approved design deliberately keeps task instances and recurring definitions separate:

- **Tasks** contains actionable task instances: one-time tasks and generated occurrences of recurring schedules.
- **Recurring / To-Do** contains schedule templates that control future task generation, activation, recurrence, and Run Now behavior.
- **Task Bulk Import** is the shared intelligent entry point. It determines the correct destination automatically.
- **Assigning Left** is an admin-only queue for imported instances/templates that could not be assigned safely.

The Tasks and Recurring / To-Do pages were not merged because an actionable task and a schedule template have different lifecycles. Combining them would make routine completion harder to understand and schedule management easier to misuse.

### Role-facing behavior

- `super_admin` and `admin` can manage Recurring / To-Do and Assigning Left.
- Managers and ordinary employee roles do not receive the Recurring / To-Do navigation item.
- Ordinary employees see their actionable work in Tasks, including occurrences created by recurring schedules.
- For non-admin users, Tasks separates work into:
  - **My Tasks**: personal/recurring/checklist work assigned to the viewer.
  - **Delegated**: delegation-type work assigned to the viewer by another person.
- The frontend role split is usability only. RLS and protected RPCs remain the permission boundary.

## 5. Frequency routing rules

The importer normalizes frequencies case-insensitively:

| Sheet frequency | Destination and behavior |
| --- | --- |
| `One Time` / `Once` | Create one ordinary task instance in Tasks |
| `Daily` | Create a recurring template and its initial due instance when active |
| `Weekly` | Weekly template anchored to the start-date weekday |
| `Monthly` | Monthly template anchored to the start-date day |
| `Quarterly` | Three-month recurrence anchored to the start date |
| `Yearly` | Yearly recurrence anchored to the start month/day |
| `As Required` | Create an inactive manual template; create no occurrence until Run Now |

The deterministic recurrence mappings are:

- Daily: `FREQ=DAILY`
- Weekly: `FREQ=WEEKLY;BYDAY=<start weekday>`
- Monthly: `FREQ=MONTHLY;BYMONTHDAY=<start day>`
- Quarterly: `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=<start day>`
- Yearly: `FREQ=YEARLY;BYMONTH=<start month>;BYMONTHDAY=<start day>`

Start time and due time represent different concepts:

- `planned_datetime` / `planned_time` is the scheduled start.
- `due_datetime` / `due_time` is the deadline.
- The effective deadline order is: revised datetime, then due datetime, then planned datetime.
- Dates and recurrence evaluation use `Asia/Kolkata`.
- The current import contract requires a same-day due time later than the start time; overnight tasks remain outside this importer.

## 6. Task type and completion behavior

- `TASK TYPE = TASK` creates delegation-mode work.
- `TASK TYPE = CHECK LIST` or `CHECKLIST` creates checklist-mode work.
- For every legacy row, `TASK` becomes the task title. For checklist rows, `CORE TASK` remains the operational grouping label and `TASK` also remains the required checklist item.
- Evidence requirement is independent of task type.
- Evidence-required tasks expose **Upload** as their primary action; successful upload is followed by completion through the existing audited flow.
- Required-form tasks must complete their linked form before task completion.
- The task card keeps Complete visible for eligible ordinary tasks; Start and Delegate were intentionally removed from the direct card actions.
- Server-side mutation and completion rules remain authoritative regardless of which buttons are visible.

## 7. How bulk import evolved

### 7.1 Initial technical importer

The first bulk-import implementation used a canonical multi-sheet workbook and explicit identity mappings. It provided strong validation but was too technical for the final operational CSV and asked the user to resolve a large number of employee/verifier mappings manually.

The early importer established important security foundations:

- protected server-side validation/import RPCs;
- RLS and audited writes;
- canonical hashing and idempotency;
- formula/control-character rejection;
- bounded files and rows;
- no raw task content in import history metadata.

### 7.2 Current 18-column CSV support

The current-sheet work added support for the exact 18-column CSV, 2 MiB files, and up to 2,500 records. It introduced:

- legacy-header detection and normalization;
- all supported frequency mappings;
- separate start and deadline fields;
- `core_task_label` persistence;
- designated verifier persistence;
- evidence and buddy-coverage fields;
- resumable 100-row chunks;
- metadata-only `task_import_items` tracking;
- `(batch_id, source_row)` retry idempotency;
- routing to task instances or recurring/as-required templates.

The relevant foundational migrations are:

- `0100_task_deadlines_verifiers_and_evidence.sql`
- `0101_resumable_current_sheet_task_import.sql`
- `0103_recurring_task_catchup_schedule.sql`

### 7.3 The 12,186-correction failure

When the final sheet was first uploaded, the interface reported **12,186 corrections required**, including repeated messages that `TASK START DATE` was required or invalid. This was unacceptable because the sheet intentionally had many blank start-date cells and the UI repeated equivalent technical errors thousands of times.

The approved usability correction was:

- provide one import-level **Start schedules from** date;
- use it for scheduled rows whose start date is blank;
- group equivalent errors and report the number of affected rows;
- keep a downloadable technical correction report for genuinely invalid source data;
- remove the thousands-row correction table from the main experience.

### 7.4 Zero-touch importing and Assigning Left

The zero-touch design simplified the workflow to:

1. Select the final sheet.
2. Choose one fallback schedule start date.
3. Review simple totals.
4. Import all valid records.

It added `assignment_status` with two values:

- `assigned`
- `assigning_left`

Rules:

- An unassigned one-time task has no active task assignee.
- An unassigned recurring/as-required template has no default assignee and remains inactive.
- Assigning an imported recurring template later can activate/materialize it according to its schedule.
- As Required templates remain manual even after assignment.
- Only active admins can list and mutate Assigning Left.
- Every later assignment is authorized and audited in one database transaction.

Migration `0104_zero_touch_task_import_and_assigning_left.sql` introduced the durable queue, cross-file business fingerprints, protected list/assignment RPCs, and related authorization.

### 7.5 Repeat uploads and duplicate prevention

Two levels of idempotency are important:

1. The exact canonical file hash resumes/replays the same batch.
2. A tenant-scoped business fingerprint prevents the same business row from being recreated in a reordered, renamed, or overlapping later file.

The business fingerprint excludes source row number, source task key, and client-selected profile IDs. It includes normalized business content, scheduling information, and source identity labels. Fingerprint reservation and record creation happen transactionally so concurrent uploads cannot create two records for the same fingerprint.

The registry stores identifiers and hashes, not task titles, descriptions, employee names, emails, or raw row payloads.

### 7.6 The “0 imported / 1,129 left” failure

One upload reported:

> 0 new records imported, 0 duplicates skipped, and 1,129 left for later assignment.

The recent-import record simultaneously showed 1,932 requested, 0 created, and 1,932 rejected. The import path was not treating server-rejected chunks and retry/resume outcomes clearly enough.

The corrections included:

- retrying rejected imports safely after the server-side organization fallback fix;
- keeping chunk outcomes explicit (`created`, `replayed`, `rejected`, and cumulative Assigning Left);
- showing a danger result when rows are rejected rather than a misleading success message;
- recognizing completed-file replay without creating duplicates;
- preserving 100-row resumability.

Migration `0105_retry_import_org_fallback.sql` and commit `6f24178` were part of this correction.

### 7.7 Complete import totals and Assigning Left count

After a successful retry, the import correctly reported 1,932 created records and 1,129 waiting in Assigning Left. However, the Assigning Left page did not visibly state how many records remained.

Commit `642264d` added an explicit count at the top of the queue, with the total updating after assignments.

### 7.8 Why Tasks showed 503 instead of 1,932

The following counts measure different things:

- **Total records** counts normalized spreadsheet rows.
- **Assigned automatically** counts import rows whose assignee was resolved.
- **Assigning Left** counts import rows/templates still missing an assignee.
- **Recurring schedules** counts rows routed to recurring definitions.
- **Tasks page counts** count visible actionable task instances in the selected task tab/status/date scope.

A recurring template is not itself an actionable task card. It produces task instances according to its start date, active state, assignment state, and recurrence. As Required templates produce no instance until Run Now. The Tasks page also defaults to current pending/overdue work rather than acting as an all-time import ledger. Therefore 1,932 imported source records—or even 803 assigned schedules—must not be expected to equal the number of cards visible in Tasks on one day.

Future UI copy must keep these units explicit. Import success should link separately to Tasks, Recurring / To-Do, and Assigning Left rather than implying that every imported row must immediately appear as a task card.

### 7.9 Large-feed Bad Request failures

Loading hundreds of tasks originally generated oversized PostgREST `in (...)` requests for task checklists, attachments, and form submissions. This surfaced as:

- `Load task checklists: Bad Request`
- `Load task form submissions: Bad Request`

The fixes were:

- batch task-detail identifiers instead of issuing one oversized request (`d2e916d`);
- reduce detail batches from 200 IDs to 50 IDs (`288c929`);
- query form submissions only for tasks that actually require a linked form (`f76d2b9`).

Future task-detail work must preserve these batching limits and must not introduce a per-card query or return to one enormous identifier filter.

### 7.10 The 803-versus-1,203 identity gap

The final sheet preview initially showed:

- 1,932 total rows
- 803 assigned automatically
- 1,129 Assigning Left

Manual inspection suggested that approximately 1,203 rows contained recognizable employees and about 729 had no employee. The gap existed because the original matcher was intentionally strict:

- a stale spreadsheet email could prevent a valid name fallback;
- exact full-name matching failed when the sheet omitted a middle name;
- duplicate roster names could not be selected safely;
- no durable alias existed to remember an administrator’s one-time correction;
- records already imported into Assigning Left were not reconciled merely because later matching improved.

Migration `0130_task_import_identity_aliases.sql` and commit `4fccac3` corrected this safely:

1. Try a unique active exact email match.
2. If that does not resolve, try a saved tenant-scoped import alias.
3. Try one unique normalized exact employee-name match.
4. Try one unique first-name + last-name match, permitting omitted middle names.
5. If still unresolved or ambiguous, keep the row in Assigning Left.

The UI now groups unresolved written names and asks for one confirmation per distinct label—not one question per task row. An admin’s selection is stored as an audited tenant-scoped alias and reused in later uploads. Repeat upload reconciliation can assign already-created Assigning Left records when their identity is now resolvable, without duplicating tasks.

The preview now distinguishes:

- **Total records**
- **Names written**
- **Assigned automatically**
- **Assigning Left**
- how many rows across how many distinct written names need one confirmation;
- how many rows contain no employee name and will remain in Assigning Left.

Important: the code intentionally does not promise that every written name will resolve. A unique, active, login-enabled in-tenant account—or an explicit admin-confirmed alias—is still required. The expected 1,203/729 split must be verified against the live roster and final aliases, not hardcoded.

## 8. Current import user experience

The current Task Bulk Import page is intended to show:

- a file picker for the final CSV or canonical workbook;
- one **Start schedules from** date;
- compact readiness totals;
- a grouped correction summary only for structural problems;
- a one-time confirmation panel for unresolved written employee labels;
- a single **Import all records** action;
- a clear outcome distinguishing created, replayed/skipped, rejected, reconciled, and Assigning Left work;
- recent import history;
- links back to Tasks and Assigning Left.

It must not:

- render thousands of identity dropdowns;
- treat blank names as errors;
- guess a blank employee from surrounding rows;
- persist raw spreadsheet data in import metadata;
- silently disable verification;
- create duplicates on retries or overlapping later uploads;
- show a green success message when database rows were rejected.

## 9. Current task-feed behavior

`TasksPage.tsx` owns task-page orchestration. It:

- loads assigned/current/overdue work;
- prepares due recurring instances without blocking the initial persisted feed;
- separates My Tasks and Delegated for ordinary users;
- loads required forms;
- derives status counts and mutation capability;
- refreshes after task actions and relevant realtime events.

`TaskCard.tsx` owns task presentation and action gating. It currently:

- shows title, status, assignee, effective task date/time, priority, category, and checklist progress in the collapsed card;
- uses the card header as an expand/collapse button;
- shows description, checklist items, evidence upload, required form action, completion remark, and permitted revision controls when expanded;
- keeps upload-required completion and direct completion behavior intact.

The current checkout presents the full authorized operational context in the expanded card, including department, branch, core task, explicit start/deadline labels, schedule frequency, verification information, buddy rule, and schedule state. Employee email and internal import/database identifiers remain intentionally hidden.

## 10. Deployed state at this checkpoint

The latest completed identity fix at commit `4fccac3` was reported as:

- pushed to GitHub `main`;
- migration `0130_task_import_identity_aliases.sql` applied to linked hosted Supabase;
- local focused/full web verification: 282 tests passed;
- web build passed;
- local pgTAP for migration 0130: 12/12 passed;
- linked migration parity and dry-run were clean;
- Vercel deployment reached Ready and the production alias returned HTTP 200.

Proof boundaries:

- The checks above prove source/test/build/migration/deployment states only at that release point.
- Hosted pgTAP did not run because the linked hosted database did not expose the pgTAP `plan(integer)` helper.
- An HTTP 200 and Vercel Ready do not prove the authenticated task/import workflow.
- Exact live identity totals after aliases and the rendered signed-in workflow still require authenticated browser verification.
- The unrelated untracked `artifacts/` directory was deliberately not modified or committed.

## 11. High-value files and ownership

| Concern | Authoritative files |
| --- | --- |
| Tasks workspace and tabs | `apps/web/src/pages/TasksPage.tsx` |
| Task card presentation/actions | `apps/web/src/features/tasks/TaskCard.tsx` |
| Task feed loading/batching | `apps/web/src/features/tasks/api.ts` |
| Task status/feed rules | `packages/core/src/taskFeed.ts` |
| Task import domain rules | `packages/core/src/taskImport.ts` |
| Final-sheet normalization | `apps/web/src/features/tasks/import/legacySheet.ts` |
| Identity preview/resolution | `apps/web/src/features/tasks/import/identityMappings.ts` |
| Import page | `apps/web/src/pages/TaskBulkImportPage.tsx` |
| Import readiness totals | `apps/web/src/features/tasks/import/ImportReadinessSummary.tsx` |
| One-time name confirmation | `apps/web/src/features/tasks/import/IdentityConfirmationPanel.tsx` |
| Assigning Left list | `apps/web/src/features/tasks/import/AssigningLeftPanel.tsx` |
| Import API calls | `apps/web/src/features/tasks/import/api.ts` |
| Current unified task-feed view | `supabase/migrations/0100_task_deadlines_verifiers_and_evidence.sql` (historical definition) |
| Zero-touch/Assigning Left contract | `supabase/migrations/0104_zero_touch_task_import_and_assigning_left.sql` |
| Retry/fallback correction | `supabase/migrations/0105_retry_import_org_fallback.sql` |
| Identity aliases/reconciliation | `supabase/migrations/0130_task_import_identity_aliases.sql` |
| Generated DB types | `packages/api-client/src/database.types.ts` and `packages/core/src/database.types.ts` |
| Role/menu rules | `packages/core/src/roleMenu.ts` |

Every listed implementation file has a corresponding focused test or database contract test that should be updated alongside behavioral changes.

## 12. Non-negotiable constraints for future work

1. Work only in the nested `jewelos` repository.
2. Preserve unrelated dirty/untracked user or Claude changes.
3. Never edit an applied migration; add the next forward migration.
4. Keep RLS/protected RPC authorization as the real permission boundary.
5. Audit sensitive imports, identity aliases, assignments, task mutations, and schedule mutations transactionally.
6. Keep task instances and recurring templates separate.
7. Do not infer or fill down employee identity.
8. Do not hardcode roster mappings. Use Users-backed profile IDs or audited import aliases.
9. Keep exact-file and cross-file idempotency intact.
10. Keep import metadata free of task descriptions, names, emails, and raw rows.
11. Preserve 2 MiB / 2,500-row / 100-row-chunk bounds unless a separately reviewed performance change updates both browser and server contracts.
12. Preserve 50-ID task-detail batching; do not add per-card network requests.
13. Update API-client and core generated database types together when schema/view/RPC output changes.
14. Keep local, GitHub, hosted Supabase, Vercel, and authenticated browser evidence separate.
15. Stage only named paths and run a credential/PII-safe staged diff review before pushing.

## 13. Next requested change: expandable full task details

### Status

Implemented in the current checkout. Local verification and hosted/release proof must still be reported separately for each subsequent change.

### User requirement

Employees and admins currently see a task title but cannot always understand the underlying work. The user wants the full description and all useful sheet details available after clicking the task, without bloating the collapsed task list.

### Approved interaction direction

- Keep the task list compact by default.
- Retain the existing expandable card interaction.
- Add an explicit **View details** / **Hide details** label so expansion is discoverable.
- Show meaningful operational fields in the expanded area.
- Omit blank optional fields instead of rendering empty rows.
- For a missing description, explicitly say **No description provided** because description is the main requested information.
- Do not display database UUIDs, raw import fingerprints, source-row metadata, or other technical fields.
- Keep all current completion, upload, checklist, form, and revision actions working.
- Make the control keyboard accessible with `aria-expanded` and `aria-controls`.
- Keep the layout useful on mobile and desktop.
- Load all detail data as part of the bounded task feed; never fetch once per expanded card.

### Details to show

The expanded details should present, when applicable:

| Display label | Source/meaning |
| --- | --- |
| Description | `TASK DESCRIPTION`; show fallback when blank |
| Assigned to | Resolved current assignee name(s) |
| Branch | Imported/current branch name |
| Department | Imported/current department name |
| Task type | Task or Checklist; FMS remains explicitly identified |
| Core task | `CORE TASK` operational group |
| Frequency | One Time, Daily, Weekly, Monthly, Quarterly, Yearly, or As Required |
| Start | Start date and start time in India locale/timezone |
| Due | Due date and due time; revised deadline must be clearly identified when present |
| Priority | Normalized task priority |
| Evidence | Required / Not required, plus uploaded state when relevant |
| Verification | Required / Not required and current verification state |
| Verifier | Resolved verifier name when available |
| Buddy coverage | Allowed / Not allowed |
| Schedule state | Active / Paused where the task came from a recurring/as-required template |
| Status | Pending, In Progress, Overdue, Completed, or Coverage required |
| Checklist | Existing checklist items and completion state |

Employee email should remain an identity/import aid, not routine task-card content. Internal IDs and raw recurrence rules should not be displayed. Convert schedule kinds and recurrence rules into plain-language frequency labels.

## 14. Expandable task-details implementation plan

> Execute this plan inline when explicitly approved. Use test-driven development and verification-before-completion. If another agent executes it, that agent must first read this document, `AGENTS.md`, `PROJECT_HANDOFF.md`, and the production playbook before any hosted or GitHub action.

**Goal:** Let every authorized task viewer open a compact task card and understand the full business context without increasing collapsed-list density or causing large-feed request failures.

**Architecture:** Extend the server-authorized unified task feed with the missing instance/template presentation fields in one forward migration. Enrich the existing `TaskBundle` without per-card fetches, isolate the read-only details grid in a small component, and reuse the existing TaskCard expansion and action controls.

**Tech stack:** PostgreSQL/Supabase security-invoker view, strict TypeScript, React 18, Tailwind utilities/design tokens, Vitest, Testing Library, pgTAP.

### Task A — Lock the display contract with failing component tests

**Files:**

- Modify `apps/web/src/features/tasks/TaskCard.test.tsx`
- Create `apps/web/src/features/tasks/TaskDetails.test.tsx`

**Test cases:**

- The collapsed card shows the title and compact summary but not the long description/details grid.
- The disclosure control is named **View details**, has `aria-expanded="false"`, and points to the details region.
- Clicking it changes the label to **Hide details** and reveals the region.
- A task containing every supported field renders the plain-language labels listed in Section 13.
- A blank description renders **No description provided**.
- Other blank optional fields are omitted.
- Dates/times render in `en-IN` and represent India business time consistently.
- `schedule_kind` becomes a friendly frequency, not a raw database/RRULE value.
- Revised deadline is visibly distinguished from the original due time.
- Existing Complete and Upload interactions still call the same actions.
- Checklist and required-form behavior remains unchanged.

Run the focused tests and confirm that the new assertions fail for the missing details before implementation.

### Task B — Add missing feed fields without broadening access

**Files:**

- Create `supabase/migrations/0131_task_feed_operational_details.sql`
- Create `supabase/tests/0131_task_feed_operational_details.test.sql`
- Regenerate `packages/api-client/src/database.types.ts`
- Regenerate `packages/core/src/database.types.ts`

**Proposed view additions for task-instance rows:**

- `scheduled_date`
- `assignment_status`
- `buddy_assignment_allowed`
- `verification_status`
- branch name
- department name
- template `schedule_kind`
- template `starts_on`
- template `planned_time`
- template `due_time`
- template `is_active`
- template `verification_required`

`task_template_id`, `core_task_label`, `description`, start/due datetimes, priority, requirements, and verifier ID already exist in the current view and must remain compatible.

The view must remain `security_invoker=true`. Join only through rows already authorized by underlying RLS. FMS rows in the union must receive correctly typed null/default presentation columns so existing FMS feed behavior remains compatible. Do not expose identity aliases, emails, audit content, import fingerprints, or cross-tenant organization data.

**pgTAP coverage:**

- view remains selectable only through existing authenticated/RLS visibility;
- ordinary assignee can read operational details for their visible task;
- unrelated/cross-tenant task remains invisible;
- recurring instance returns its own task fields plus its authorized template context;
- one-time/manual task returns safe nulls and can be labeled One Time in the client;
- branch and department names correspond to the task scope;
- FMS union remains queryable and does not invent recurring data;
- anonymous access remains denied by underlying contracts/grants.

### Task C — Enrich the task bundle without N+1 requests

**Files:**

- Modify `apps/web/src/features/tasks/api.ts`
- Modify `apps/web/src/features/tasks/api.test.ts`

**Contract changes:**

- Extend `TaskBundle` with display-ready verifier name or derive it from the existing bounded `v_task_users` result using `verifier_user_profile_id`.
- Preserve the existing one-time `v_task_users` load and the 50-ID checklist/attachment/form batches.
- Do not add a network request when a card is expanded.
- Do not load form submissions for tasks without a required linked form.
- Keep grouped multi-assignee task rows correct.

**Tests:**

- verifier ID resolves to the correct visible roster name;
- unknown/unavailable verifier becomes a neutral unavailable label or is omitted;
- 201-task feeds still use 50/50/50/50/1 detail batches;
- no form-submission query is issued when no task requires a form;
- the feed does not issue one request per task or per expansion.

### Task D — Implement the expandable details presentation

**Files:**

- Create `apps/web/src/features/tasks/TaskDetails.tsx`
- Modify `apps/web/src/features/tasks/TaskCard.tsx`
- Modify the focused tests from Task A

**Component boundary:**

- `TaskCard` continues to own disclosure state and action gating.
- `TaskDetails` receives one `TaskBundle`, category label, and status/frequency presentation values; it performs no data fetching and no mutations.
- The collapsed header remains visually compact.
- The expanded region starts with Description, then a responsive definition-list grid, then existing checklist/action controls.

**Accessibility and copy:**

- Use a real button.
- Keep `aria-expanded` synchronized.
- Give the region a stable per-task `id` and connect it with `aria-controls`.
- Use **View details** and **Hide details** rather than relying only on a chevron.
- Use plain labels such as **Evidence required**, **Verification pending**, **Buddy coverage allowed**, and **Schedule paused**.
- Do not display raw enum keys, RRULE strings, null, undefined, or UUIDs.

### Task E — Focused and broad verification

Run from the nested `jewelos` repository:

```powershell
pnpm.cmd --filter web exec vitest run src/features/tasks/TaskDetails.test.tsx src/features/tasks/TaskCard.test.tsx src/features/tasks/api.test.ts
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd --filter web build
supabase.cmd db reset --local --no-seed
supabase.cmd test db supabase/tests/0131_task_feed_operational_details.test.sql
supabase.cmd db lint --local --level warning
git diff --check
```

Rendered verification must cover:

- desktop and narrow/mobile layouts;
- collapsed density;
- View details / Hide details interaction;
- a fully populated imported recurring task;
- a task with no description/optional fields;
- one-time, checklist, recurring, delegated, completed, overdue, upload-required, and form-required examples;
- an ordinary employee account and an admin account;
- no console errors and no regression to the prior Bad Request failures on a large feed.

Use the signed-in in-app browser when available. If it is unavailable, record the limitation and use Playwright against a controlled local environment; do not present unauthenticated screenshots as production proof.

### Task F — Reviewed release, if separately authorized

Before release:

1. Read `PRODUCTION_SWITCH_PLAYBOOK.md` completely.
2. Confirm `git rev-parse --show-toplevel` is the nested `jewelos` repository.
3. Inspect `git status --short --branch` and preserve unrelated changes, especially `artifacts/`.
4. Review the full diff and stage only the named task-detail files.
5. Run `git diff --cached --check` and a credential/PII-safe staged scan.
6. Check `supabase.cmd migration list --linked`.
7. Run `supabase.cmd db push --linked --dry-run` and ensure only the intended new migration is pending.
8. Apply only the reviewed forward migration.
9. Recheck hosted migration parity.
10. Commit the scoped paths and push `main` only when explicitly authorized.
11. Verify the Vercel deployment for the pushed SHA separately.
12. Perform authenticated browser QA separately and record the tested account role and workflow without exposing personal data.

No release claim may combine these proof boundaries. Report local tests, local database, hosted Supabase, GitHub, Vercel, and authenticated UI evidence independently.

## 15. Regression checklist for every future Tasks/import change

- [ ] Ordinary users can see all task instances assigned to them, including recurring occurrences.
- [ ] Ordinary users cannot access Recurring / To-Do or Assigning Left.
- [ ] My Tasks and Delegated classification is unchanged unless intentionally redesigned.
- [ ] Blank employee cells remain unassigned and never fill down.
- [ ] Written unique names, aliases, stale-email name fallback, and omitted-middle-name matching behave consistently in browser and server.
- [ ] Ambiguous names require one explicit admin confirmation and are remembered safely.
- [ ] Repeat upload does not duplicate existing business records.
- [ ] A retry can reconcile existing Assigning Left records when identity becomes resolvable.
- [ ] Import outcome copy distinguishes created, skipped/replayed, rejected, and still-unassigned counts.
- [ ] Assigning Left displays a current visible total.
- [ ] Recurring templates do not masquerade as immediately visible task instances.
- [ ] Current-day and overdue task-feed behavior remains correct.
- [ ] Checklist/attachment/form detail queries remain bounded and do not return Bad Request for large feeds.
- [ ] Evidence-required Upload still completes through the intended audited flow.
- [ ] Required-form completion remains protected.
- [ ] Task-card details do not expose technical IDs, emails, aliases, raw RRULEs, fingerprints, or audit payloads.
- [ ] No per-card query is added.
- [ ] Generated database types match in core and API-client packages.
- [ ] RLS, grants, RPC authorization, and audit behavior have focused database tests when touched.
- [ ] Existing user/Claude changes and unrelated untracked files remain untouched.

## 16. Key commits in chronological order

| Commit | Purpose |
| --- | --- |
| `d4daea7` | Design the current-sheet bulk import |
| `ab4c8ba` | Plan the current-sheet implementation |
| `4b23e14` | Define shared import routing/schedule rules |
| `8910771` | Parse and normalize the final sheet safely |
| `68e41ca` | Persist current checklist schedules safely |
| `454c739` | Show current work and materialize recurrence |
| `163cd15` | Keep the task feed available during recurrence preparation |
| `df92173` | Catch up recurring schedules during the day |
| `4b64010` | Load persisted assigned work before recurrence synchronization |
| `7cb7d80` | Refresh due recurring occurrences |
| `2362d3c` | Retain overdue work in the current task feed |
| `1ee3563` | Simplify direct task completion actions |
| `b90bc0e` | Add zero-touch importing and Assigning Left |
| `6f24178` | Make rejected imports safely retryable and improve result messages |
| `642264d` | Show complete import and Assigning Left counts |
| `d2e916d` | Batch large task-detail requests |
| `288c929` | Reduce task-detail batches to 50 IDs |
| `f76d2b9` | Skip irrelevant form-submission requests |
| `8f976c6` | Complete evidence-required tasks after upload |
| `4fccac3` | Add identity aliases, safer matching, and reconciliation |

Commit messages are navigation aids, not complete proof. Inspect the current files and migrations before changing behavior.

## 17. Related approved design documents

- `docs/superpowers/specs/2026-08-25-current-sheet-task-bulk-import-design.md`
- `docs/superpowers/plans/2026-08-25-current-sheet-task-bulk-import.md`
- `docs/superpowers/specs/2026-08-27-zero-touch-task-import-design.md`
- `docs/superpowers/plans/2026-08-27-zero-touch-task-import.md`
- `docs/superpowers/specs/2026-08-27-today-and-overdue-task-feed.md`
- `docs/superpowers/plans/2026-08-27-today-and-overdue-task-feed.md`

This handoff supersedes chat-only summaries for understanding the sequence of issues and user intent, but it does not supersede current code, forward migrations, executable tests, or later approved specifications.
