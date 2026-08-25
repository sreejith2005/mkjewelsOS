# Current-Sheet Task Bulk Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the current 18-column, 1,932-row MK Jewels task CSV through one validated, resumable workflow that routes one-time work to Tasks and recurring/as-required work to Recurring / To-Do.

**Architecture:** Pure import normalization and deadline selection live in `packages/core`; browser-only workbook/CSV parsing and UI orchestration live in `apps/web`; Postgres remains authoritative for identity, scope, routing, idempotency, audit, verification, and chunk commits. Two forward migrations separate task deadline/verifier semantics from the resumable import protocol, while existing applied migrations remain unchanged.

**Tech Stack:** TypeScript 5.9, React 18, Vitest 4, `xlsx` 0.18, Supabase/Postgres, pgTAP, Deno Edge Functions, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-08-25-current-sheet-task-bulk-import-design.md`

## Global Constraints

- Work only in `C:\Users\MIS\Downloads\MKJewelOS\jewelos`; do not inspect or modify retired sibling prototypes.
- Preserve unrelated worktree changes and stage only files named by each task.
- Do not modify an applied migration. Add `0100` and `0101` as forward-only migrations.
- RLS and protected audited RPCs are the authorization boundary; frontend controls are usability only.
- The raw CSV/workbook and raw source rows must not be stored in Postgres, Storage, Git, logs, or chat.
- Blank legacy cells never inherit from a preceding row.
- Employee and verifier names never resolve automatically; the importer must explicitly select an active in-scope profile.
- File limits are exactly 2 MiB, 2,500 normalized rows, and 100 rows per commit chunk.
- Dates and times are interpreted in `Asia/Kolkata`; imported overnight tasks are rejected.
- Existing canonical four-sheet `.xlsx` imports remain supported.
- Existing rows with no `due_datetime` continue to use `revised_datetime`, then `planned_datetime`, as their deadline.
- Regenerate both `packages/api-client/src/database.types.ts` and `packages/core/src/database.types.ts` after migrations.
- Do not push Git, apply hosted migrations, deploy Edge Functions, or deploy Vercel without separate authorization.

## File Structure

### Core domain

- Create `packages/core/src/taskImport.ts`: canonical import types, boolean/frequency/date normalization, deterministic RRULE creation, identity-requirement keys, and chunk partitioning.
- Create `packages/core/src/taskImport.test.ts`: pure normalization, limits, and schedule tests.
- Modify `packages/core/src/taskFeed.ts`: one effective-deadline selector used by overdue calculations.
- Modify `packages/core/src/taskFeed.test.ts`: deadline precedence compatibility tests.
- Modify `packages/core/src/index.ts`: export task-import contracts.

### Web parsing and UI

- Create `apps/web/src/features/tasks/import/legacySheet.ts`: exact 18-header parser and row-to-draft transformation.
- Create `apps/web/src/features/tasks/import/legacySheet.test.ts`: legacy source contract tests.
- Create `apps/web/src/features/tasks/import/identityMappings.ts`: apply explicit name-to-profile selections without guessing.
- Create `apps/web/src/features/tasks/import/identityMappings.test.ts`: identity resolution tests.
- Create `apps/web/src/features/tasks/import/correctionReport.ts`: safe issue-only CSV export.
- Create `apps/web/src/features/tasks/import/correctionReport.test.ts`: escaping and privacy tests.
- Modify `apps/web/src/features/tasks/import/workbook.ts`: format detection, canonical compatibility, 2 MiB/2,500-row bounds, and stable hash/chunk orchestration.
- Modify `apps/web/src/features/tasks/import/workbook.test.ts`: both-format parsing and replay-hash tests.
- Modify `apps/web/src/features/tasks/import/api.ts`: identity lookup, validation, begin/resume, chunk commit, cancellation, status, and history calls.
- Modify `apps/web/src/features/tasks/import/api.test.ts`: Supabase receiver-context and RPC argument tests.
- Create `apps/web/src/features/tasks/import/IdentityMappingPanel.tsx`: explicit batch mapping UI.
- Create `apps/web/src/features/tasks/import/IdentityMappingPanel.test.tsx`: mapping interaction tests.
- Create `apps/web/src/features/tasks/import/ImportProgress.tsx`: resumable chunk status and destination links.
- Create `apps/web/src/features/tasks/import/ImportProgress.test.tsx`: status rendering tests.
- Modify `apps/web/src/pages/TaskBulkImportPage.tsx`: reducer-driven import workflow.
- Create `apps/web/src/pages/TaskBulkImportPage.test.tsx`: end-to-end component-state tests.
- Modify `apps/web/src/features/tasks/TaskCard.tsx`: display effective deadline.
- Modify `apps/web/src/pages/RecurringTodoPage.tsx`: display start and due time independently.
- Modify corresponding focused task and recurring page tests.

### Database and worker

- Create `supabase/migrations/0100_task_deadlines_verifiers_and_evidence.sql`: new columns, effective deadline, evidence independence, designated verification, recurrence propagation, coverage/report/notification compatibility.
- Create `supabase/tests/0100_task_deadlines_verifiers_and_evidence.test.sql`: schema, authorization, audit, and compatibility pgTAP.
- Create `supabase/migrations/0101_resumable_current_sheet_task_import.sql`: import item metadata, batch states, validation, identity candidates, begin/resume, chunk commit, cancel, and status RPCs.
- Create `supabase/tests/0101_resumable_current_sheet_task_import.test.sql`: RLS, validation, routing, idempotency, and audit pgTAP.
- Modify `supabase/functions/generate-recurring-tasks/index.ts`: include both checklist and delegation templates; let the RPC propagate new fields.
- Create `supabase/functions/generate-recurring-tasks/index.test.ts`: selection and privacy-safe failure tests.
- Regenerate both database type files.

---

### Task 1: Core Import Contract and Schedule Normalization

**Files:**
- Create: `packages/core/src/taskImport.ts`
- Create: `packages/core/src/taskImport.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `TaskImportCanonicalRow`, `TaskImportDraftRow`, `TaskImportIdentityRequirement`, `normalizeImportBoolean`, `normalizeLegacyFrequency`, `buildImportSchedule`, `identityRequirementKey`, and `chunkTaskImportRows`.
- Consumed by: Tasks 2, 6, 7, and 8.

- [ ] **Step 1: Write failing normalization tests**

```ts
import { describe, expect, it } from "vitest";
import { buildImportSchedule, chunkTaskImportRows, normalizeImportBoolean } from "./taskImport";

describe("task import rules", () => {
  it("builds anchored quarterly and yearly rules", () => {
    expect(buildImportSchedule("quarterly", "2026-09-17").recurrenceRule)
      .toBe("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=17");
    expect(buildImportSchedule("yearly", "2026-09-17").recurrenceRule)
      .toBe("FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=17");
  });

  it("rejects blank explicit booleans", () => {
    expect(() => normalizeImportBoolean("")).toThrow(/required/i);
  });

  it("chunks without losing row order", () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ source_row: index + 2 }));
    expect(chunkTaskImportRows(rows, 100).map((part) => part.length)).toEqual([100, 100, 1]);
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm.cmd --filter @jewelos/core test -- taskImport.test.ts`

Expected: FAIL because `taskImport.ts` does not exist.

- [ ] **Step 3: Implement canonical types and pure rules**

```ts
export const TASK_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const TASK_IMPORT_MAX_ROWS = 2_500;
export const TASK_IMPORT_CHUNK_SIZE = 100;

export type ImportScheduleKind = "one_time" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "as_required";
export type TaskImportDestination = "tasks" | "recurring_todo";
export type TaskImportCompletionMode = "delegation" | "checklist";

export type TaskImportCanonicalRow = Readonly<{
  source_row: number;
  task_key: string;
  destination: TaskImportDestination;
  schedule_kind: ImportScheduleKind;
  task_type: TaskImportCompletionMode;
  core_task_label: string;
  title: string;
  description: string;
  priority: string;
  branch: string;
  department: string;
  category: string;
  assignee_email: string;
  assignee_profile_id: string;
  verifier_label: string;
  verifier_profile_id: string;
  starts_on: string;
  start_time: string;
  due_time: string;
  planned_at: string;
  due_at: string;
  recurrence_rule: string;
  requires_upload: boolean;
  verification_required: boolean;
  buddy_assignment_allowed: boolean;
  is_active: boolean;
  checklist: readonly Readonly<{ item_text: string; required: boolean }>[];
}>;

export type TaskImportDraftRow = Omit<
  TaskImportCanonicalRow,
  "assignee_profile_id" | "verifier_profile_id"
> & Readonly<{
  assignee_name: string;
  verifier_name: string;
}>;

export type TaskImportIdentityRequirement = Readonly<{
  key: string;
  kind: "assignee" | "verifier";
  label: string;
  source_rows: readonly number[];
}>;

export function normalizeImportBoolean(value: string): boolean;
export function normalizeLegacyFrequency(value: string): ImportScheduleKind;
export function buildImportSchedule(
  kind: ImportScheduleKind,
  startsOn: string,
): Readonly<{ destination: TaskImportDestination; recurrenceRule: string }>;
export function identityRequirementKey(kind: "assignee" | "verifier", label: string): string;
export function chunkTaskImportRows<T>(rows: readonly T[], size?: number): readonly (readonly T[])[];
```

Implement exact case-insensitive aliases from the spec, real Gregorian date validation, Kolkata-local timestamp strings, same-day `due_time > start_time`, deterministic RRULEs, `as_required` blank-date handling, and chunk-size validation from 1 through 100.

- [ ] **Step 4: Export and run GREEN tests**

Run: `pnpm.cmd --filter @jewelos/core test -- taskImport.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- packages/core/src/taskImport.ts packages/core/src/taskImport.test.ts packages/core/src/index.ts
git commit -m "feat(core): define current sheet task import rules"
```

### Task 2: Legacy CSV Parser, Explicit Identity Mapping, and Correction Report

**Files:**
- Create: `apps/web/src/features/tasks/import/legacySheet.ts`
- Create: `apps/web/src/features/tasks/import/legacySheet.test.ts`
- Create: `apps/web/src/features/tasks/import/identityMappings.ts`
- Create: `apps/web/src/features/tasks/import/identityMappings.test.ts`
- Create: `apps/web/src/features/tasks/import/correctionReport.ts`
- Create: `apps/web/src/features/tasks/import/correctionReport.test.ts`

**Interfaces:**
- Consumes: Task 1 types and schedule functions.
- Produces: `LEGACY_TASK_HEADERS`, `normalizeLegacyTaskSheet`, `applyIdentityMappings`, `createCorrectionReportCsv`.
- Consumed by: Tasks 6 and 8.

- [ ] **Step 1: Write failing parser and no-fill-down tests**

```ts
it("does not inherit employee or branch values from the prior row", () => {
  const result = normalizeLegacyTaskSheet([
    legacyRow({ "EMPLOYEE EMAIL": "first@example.com", "BRANCH NAME": "Bandra" }),
    legacyRow({ "EMPLOYEE EMAIL": "", "BRANCH NAME": "" }),
  ]);
  expect(result.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ row: 3, field: "EMPLOYEE EMAIL" }),
    expect.objectContaining({ row: 3, field: "BRANCH NAME" }),
  ]));
});

it("maps checklist rows to a core title and one required item", () => {
  const result = normalizeLegacyTaskSheet([legacyRow({
    "TASK TYPE": "CHECK LIST", "CORE TASK": "Opening", "TASK": "Open shutters",
  })]);
  expect(result.draftRows[0]).toMatchObject({
    task_type: "checklist", title: "Opening",
    checklist: [{ item_text: "Open shutters", required: true }],
  });
});
```

- [ ] **Step 2: Run parser tests and confirm RED**

Run: `pnpm.cmd --filter web test -- src/features/tasks/import/legacySheet.test.ts src/features/tasks/import/identityMappings.test.ts src/features/tasks/import/correctionReport.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement exact-header parsing and issues**

`normalizeLegacyTaskSheet(rows)` must return:

```ts
type LegacyTaskSheetNormalization = Readonly<{
  draftRows: readonly TaskImportDraftRow[];
  identityRequirements: readonly TaskImportIdentityRequirement[];
  issues: readonly TaskBulkImportIssue[];
}>;
```

Reject missing/reordered headers, unsafe cells, missing branch/department/task/type/frequency/priority/boolean values, invalid schedules, blank dates for scheduled work, and more than 2,500 rows. Preserve source row numbers starting at 2.

- [ ] **Step 4: Implement explicit mappings and safe correction CSV**

```ts
export type TaskImportIdentityMappings = Readonly<Record<string, string>>;

export function applyIdentityMappings(
  draftRows: readonly TaskImportDraftRow[],
  mappings: TaskImportIdentityMappings,
): { rows: readonly TaskImportCanonicalRow[]; issues: readonly TaskBulkImportIssue[] };
```

Missing mapping keys remain errors. Never select the first candidate. `createCorrectionReportCsv` outputs only `source_row,field,reason,guidance`, quotes CSV cells correctly, and excludes task text, names, emails, candidate IDs, and raw values.

- [ ] **Step 5: Run GREEN tests and commit**

Run: `pnpm.cmd --filter web test -- src/features/tasks/import/legacySheet.test.ts src/features/tasks/import/identityMappings.test.ts src/features/tasks/import/correctionReport.test.ts`

Expected: PASS.

```powershell
git add -- apps/web/src/features/tasks/import/legacySheet.ts apps/web/src/features/tasks/import/legacySheet.test.ts apps/web/src/features/tasks/import/identityMappings.ts apps/web/src/features/tasks/import/identityMappings.test.ts apps/web/src/features/tasks/import/correctionReport.ts apps/web/src/features/tasks/import/correctionReport.test.ts
git commit -m "feat(web): parse current task sheet safely"
```

### Task 3: Canonical Workbook Compatibility and Format Orchestration

**Files:**
- Modify: `apps/web/src/features/tasks/import/workbook.ts`
- Modify: `apps/web/src/features/tasks/import/workbook.test.ts`

**Interfaces:**
- Consumes: `normalizeLegacyTaskSheet`, `applyIdentityMappings`, Task 1 limits/types.
- Produces: `parseTaskImportFile`, `finalizeTaskImportDraft`, `hashTaskImportPayload`, `createTaskImportChunks`.
- Consumed by: Task 8.

- [ ] **Step 1: Add failing compatibility and observed-file-size tests**

```ts
it("detects the MK Jewels legacy CSV by its 18 exact headers", async () => {
  const parsed = await parseTaskImportFile(csvFile(legacyCsv));
  expect(parsed.sourceFormat).toBe("mk_daily_checklist_csv");
  expect(parsed.draftRows).toHaveLength(2);
});

it("keeps the four-sheet canonical workbook compatible", () => {
  expect(createTaskImportTemplate().SheetNames)
    .toEqual(["Read Me", "Tasks", "Checklist Items", "Reference Data"]);
});

it("accepts 2500 rows and rejects 2501", () => {
  expect(normalizeTaskImportWorkbook({ Tasks: canonicalRows(2500) }).issues).toEqual([]);
  expect(normalizeTaskImportWorkbook({ Tasks: canonicalRows(2501) }).issues[0]?.reason)
    .toMatch(/at most 2500/i);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm.cmd --filter web test -- src/features/tasks/import/workbook.test.ts`

Expected: FAIL on missing format detection and old limits.

- [ ] **Step 3: Refactor workbook orchestration**

Keep `xlsx` access in this file. Detect `.xlsx` as canonical, and detect CSV headers before choosing canonical versus legacy normalization. Return a draft even when identity mappings remain. Hash the final canonical payload, including explicit profile mappings, using stable property ordering and source-row ordering. Create 100-row chunks without reordering.

- [ ] **Step 4: Run GREEN tests and commit**

Run: `pnpm.cmd --filter web test -- src/features/tasks/import/workbook.test.ts src/features/tasks/import/legacySheet.test.ts`

Expected: PASS.

```powershell
git add -- apps/web/src/features/tasks/import/workbook.ts apps/web/src/features/tasks/import/workbook.test.ts
git commit -m "feat(web): support canonical and current task imports"
```

### Task 4: Task Deadline, Evidence, and Designated-Verifier Database Contract

**Files:**
- Create: `supabase/tests/0100_task_deadlines_verifiers_and_evidence.test.sql`
- Create: `supabase/migrations/0100_task_deadlines_verifiers_and_evidence.sql`

**Interfaces:**
- Produces columns `task_templates.core_task_label`, `due_time`, `verifier_user_profile_id`; `task_instances.core_task_label`, `due_datetime`, `verifier_user_profile_id`; and function `task_effective_due_datetime(task_instances)`.
- Replaces current definitions of recurring save/create/verify, task completion, assignment coverage, absence reconciliation, home summary, task reports, and overdue event generation with deadline-aware versions.
- Consumed by: Tasks 5, 7, 8, and 9.

- [ ] **Step 1: Write failing pgTAP schema and behavior tests**

```sql
begin;
select plan(18);
select has_column('public','task_templates','due_time');
select has_column('public','task_instances','due_datetime');
select has_column('public','task_instances','verifier_user_profile_id');
select has_function('public','task_effective_due_datetime',array['task_instances']);
select * from finish();
rollback;
```

Add fixtures proving due precedence, same-day due validation, evidence true/false independence for checklist/delegation, verifier copying, designated-verifier denial, admin override-note requirement, audit creation, and buddy-disabled direct assignment.

- [ ] **Step 2: Run pgTAP and confirm RED**

Run: `supabase.cmd test db supabase/tests/0100_task_deadlines_verifiers_and_evidence.test.sql`

Expected: FAIL because migration `0100` does not exist in the current local database.

- [ ] **Step 3: Add columns, indexes, and effective-deadline helper**

```sql
alter table task_templates
  add column core_task_label text,
  add column due_time time,
  add column verifier_user_profile_id uuid references user_profiles(id);
alter table task_instances
  add column core_task_label text,
  add column due_datetime timestamptz,
  add column verifier_user_profile_id uuid references user_profiles(id);

create or replace function task_effective_due_datetime(p_task task_instances)
returns timestamptz language sql immutable set search_path=public as $$
  select coalesce(p_task.revised_datetime,p_task.due_datetime,p_task.planned_datetime)
$$;
```

Add tenant-leading indexes for due queues and verifier queues. Add trigger validation requiring same-tenant active verifier when verification is required and `due_datetime > planned_datetime` when due is present.

- [ ] **Step 4: Redefine protected task contracts forward-only**

Redefine the latest functions without editing historical files. `create_delegation_task_with_audit` must preserve its existing default but accept validated `task_type`, `core_task_label`, `due_datetime`, `verification_required`, and `verifier_user_profile_id` fields for imported one-time checklist/delegation work. The recurring save RPC must read `core_task_label`, `due_time`, `verifier_user_profile_id`, and independent `requires_upload`. Instance generation copies those fields and calculates Kolkata timestamps. Verification permits the designated verifier, or active super-admin/admin with a nonblank override note, and audits the decision. Task completion keeps attachment enforcement conditional solely on `requires_upload`.

Every current `coalesce(revised_datetime,planned_datetime)` deadline consumer must use `task_effective_due_datetime(...)`, including coverage/reconciliation, home summary, task reports, on-time metrics, overdue events, notification payloads, and watcher assignment payloads.

- [ ] **Step 5: Reset locally and run GREEN pgTAP**

First verify that the running Supabase stack belongs to this checkout without printing credentials. Then run:

```powershell
supabase.cmd db reset --local --no-seed
supabase.cmd test db supabase/tests/0100_task_deadlines_verifiers_and_evidence.test.sql supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql supabase/tests/0085_recurring_task_completion_modes.test.sql
```

Expected: reset succeeds; all named tests pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- supabase/migrations/0100_task_deadlines_verifiers_and_evidence.sql supabase/tests/0100_task_deadlines_verifiers_and_evidence.test.sql
git commit -m "feat(db): add task deadlines and designated verification"
```

### Task 5: Effective Deadline Presentation and Recurring Worker Compatibility

**Files:**
- Modify: `packages/core/src/taskFeed.ts`
- Modify: `packages/core/src/taskFeed.test.ts`
- Modify: `apps/web/src/features/tasks/TaskCard.tsx`
- Modify: `apps/web/src/features/tasks/TaskCard.test.tsx`
- Modify: `apps/web/src/pages/RecurringTodoPage.tsx`
- Modify: `apps/web/src/pages/RecurringTodoPage.test.tsx`
- Modify: `supabase/functions/generate-recurring-tasks/index.ts`
- Create: `supabase/functions/generate-recurring-tasks/index.test.ts`

**Interfaces:**
- Consumes: `due_datetime` and `due_time` from Task 4.
- Produces: `effectiveTaskDeadline(task)` used by task cards and overdue helpers.
- Consumed by: Task 8 UI preview links and final validation.

- [ ] **Step 1: Write failing deadline precedence tests**

```ts
expect(effectiveTaskDeadline({
  planned_datetime: "2026-08-25T09:00:00Z",
  due_datetime: "2026-08-25T17:00:00Z",
  revised_datetime: null,
})).toBe("2026-08-25T17:00:00Z");
```

Add raw-source assertions that TaskCard and RecurringTodoPage render distinct start/deadline labels, and a worker test proving delegation templates are selected as well as checklist templates.

- [ ] **Step 2: Run and confirm RED**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- taskFeed.test.ts
pnpm.cmd --filter web test -- src/features/tasks/TaskCard.test.tsx src/pages/RecurringTodoPage.test.tsx
```

Expected: FAIL because `due_datetime` is not part of `TaskFeedLike` and worker selection is checklist-only.

- [ ] **Step 3: Implement presentation and worker changes**

```ts
export function effectiveTaskDeadline(task: Pick<TaskFeedLike, "planned_datetime" | "due_datetime" | "revised_datetime">) {
  return task.revised_datetime ?? task.due_datetime ?? task.planned_datetime;
}
```

Use the helper for overdue state and card deadline labels. Recurring cards show `Starts` and `Due`. Change the worker query from `.eq("task_type", "checklist")` to `.in("task_type", ["checklist", "delegation"])`; keep `as_required` skipped and return only template IDs plus safe failure codes.

- [ ] **Step 4: Run GREEN tests and commit**

Run the Task 5 focused commands plus `deno test supabase/functions/generate-recurring-tasks/index.test.ts` if Deno is available.

```powershell
git add -- packages/core/src/taskFeed.ts packages/core/src/taskFeed.test.ts apps/web/src/features/tasks/TaskCard.tsx apps/web/src/features/tasks/TaskCard.test.tsx apps/web/src/pages/RecurringTodoPage.tsx apps/web/src/pages/RecurringTodoPage.test.tsx supabase/functions/generate-recurring-tasks/index.ts supabase/functions/generate-recurring-tasks/index.test.ts
git commit -m "feat(tasks): display start and effective deadlines"
```

### Task 6: Resumable Import Database Protocol

**Files:**
- Create: `supabase/tests/0101_resumable_current_sheet_task_import.test.sql`
- Create: `supabase/migrations/0101_resumable_current_sheet_task_import.sql`

**Interfaces:**
- Produces table `task_import_items` and RPCs `list_task_import_identity_candidates(text[])`, `validate_task_bulk_import(jsonb,text)`, `begin_task_bulk_import(jsonb,text,text)`, `commit_task_bulk_import_chunk(uuid,text,jsonb)`, `cancel_task_bulk_import(uuid)`, and `get_task_import_batch_status(uuid)`.
- Consumed by: Task 7 API and Task 8 UI.

- [ ] **Step 1: Write failing authorization, routing, and replay pgTAP**

Tests must cover 32 assertions: table/RLS existence; no anon execution; inactive and ordinary-user denial; manager branch denial; privacy-safe identity candidates; explicit mapped-profile success; 2,500 accepted/2,501 denied; full-file validation before begin; metadata-only items; 100-row chunk maximum; atomic failed chunk; one-time task creation; daily/quarterly/yearly/as-required templates; paused template; first instance; checklist transformation; deadline/evidence/verifier/buddy/core-label persistence; exact replay; changed hash denial; cancel-before-first-chunk; cancel-after-progress denial; completed batch counts; audit rows.

- [ ] **Step 2: Run and confirm RED**

Run: `supabase.cmd test db supabase/tests/0101_resumable_current_sheet_task_import.test.sql`

Expected: FAIL because `task_import_items` and new RPCs do not exist.

- [ ] **Step 3: Add metadata-only item and batch state schema**

```sql
create table task_import_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  batch_id uuid not null references task_import_batches(id) on delete cascade,
  source_row integer not null check (source_row between 2 and 2501),
  canonical_row_hash text not null check (canonical_row_hash ~ '^[a-f0-9]{64}$'),
  outcome text not null default 'pending' check (outcome in ('pending','completed','failed')),
  task_template_id uuid references task_templates(id),
  task_instance_id uuid references task_instances(id),
  safe_issue_code text,
  completed_at timestamptz,
  unique(batch_id,source_row)
);
alter table task_import_items enable row level security;
```

Extend batch outcomes to `validating`, `ready`, `importing`, `paused`, `completed`, `cancelled`, and `replayed`; widen count checks to 2,500; add completed/remaining/as-required counters. Do not add raw-row JSON, title, description, email, or name columns.

- [ ] **Step 4: Implement validation and identity candidates**

The candidate RPC accepts normalized labels, returns only profiles visible to the active manager/admin, and never returns cross-scope candidates. Validation re-resolves every supplied email/profile UUID, branch, department, verifier, dates, schedule, and boolean. It computes the server canonical hash with `pgcrypto.digest`, returns safe issues, and creates no records.

- [ ] **Step 5: Implement begin/resume and chunk commit**

`begin_task_bulk_import` reruns whole-payload validation, inserts/resumes the batch, and inserts one pending item hash per source row. `commit_task_bulk_import_chunk` accepts 1–100 rows, locks the batch/items, recomputes and matches row hashes, revalidates state, routes the row through existing audited one-time or recurring contracts, stores only output IDs, and atomically updates progress. Exact completed replay returns existing IDs/counts. A chunk failure rolls back the entire chunk.

- [ ] **Step 6: Run migration, GREEN pgTAP, lint, and commit**

```powershell
supabase.cmd db reset --local --no-seed
supabase.cmd test db supabase/tests/0100_task_deadlines_verifiers_and_evidence.test.sql supabase/tests/0101_resumable_current_sheet_task_import.test.sql supabase/tests/0080_task_bulk_import_workspace.test.sql
supabase.cmd db lint --local --level warning
git add -- supabase/migrations/0101_resumable_current_sheet_task_import.sql supabase/tests/0101_resumable_current_sheet_task_import.test.sql
git commit -m "feat(db): add resumable task import protocol"
```

Expected: reset and named tests pass; lint has no new `0100`/`0101` warning.

### Task 7: Typed Import API and Resumable Chunk Runner

**Files:**
- Modify: `apps/web/src/features/tasks/import/api.ts`
- Modify: `apps/web/src/features/tasks/import/api.test.ts`
- Create: `apps/web/src/features/tasks/import/chunkRunner.ts`
- Create: `apps/web/src/features/tasks/import/chunkRunner.test.ts`

**Interfaces:**
- Consumes: Task 6 RPCs and Task 1 chunking.
- Produces: `loadIdentityCandidates`, `validateTaskBulkImport`, `beginTaskBulkImport`, `commitTaskBulkImportChunk`, `cancelTaskBulkImport`, `loadTaskImportBatchStatus`, and `runTaskImportChunks`.
- Consumed by: Task 8.

- [ ] **Step 1: Write failing RPC and resume tests**

```ts
it("resumes after two completed chunks", async () => {
  const commit = vi.fn().mockResolvedValueOnce({ completed_count: 200, remaining_count: 1 });
  await runTaskImportChunks({ rows: rows(201), completedSourceRows: new Set(rows(200).map((r) => r.source_row)), commit });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]?.[0]).toHaveLength(1);
});
```

Retain regression assertions that call `supabase.rpc(...)` and `supabase.from(...)` directly so the receiver-context bug cannot return.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm.cmd --filter web test -- src/features/tasks/import/api.test.ts src/features/tasks/import/chunkRunner.test.ts`

Expected: FAIL because the v2 API and runner do not exist.

- [ ] **Step 3: Implement bounded API types and runner**

```ts
export type TaskImportProgress = Readonly<{
  batch_id: string;
  outcome: "ready" | "importing" | "paused" | "completed" | "cancelled" | "replayed";
  requested_count: number;
  completed_count: number;
  remaining_count: number;
  completed_source_rows: readonly number[];
}>;
```

The runner skips completed source rows, sends sequential 100-row chunks, reports progress after each response, stops on the first error, and never logs row payloads.

- [ ] **Step 4: Run GREEN tests and commit**

```powershell
pnpm.cmd --filter web test -- src/features/tasks/import/api.test.ts src/features/tasks/import/chunkRunner.test.ts
git add -- apps/web/src/features/tasks/import/api.ts apps/web/src/features/tasks/import/api.test.ts apps/web/src/features/tasks/import/chunkRunner.ts apps/web/src/features/tasks/import/chunkRunner.test.ts
git commit -m "feat(web): add resumable task import client"
```

### Task 8: Identity Mapping, Progress, and Bulk Import Workspace

**Files:**
- Create: `apps/web/src/features/tasks/import/IdentityMappingPanel.tsx`
- Create: `apps/web/src/features/tasks/import/IdentityMappingPanel.test.tsx`
- Create: `apps/web/src/features/tasks/import/ImportProgress.tsx`
- Create: `apps/web/src/features/tasks/import/ImportProgress.test.tsx`
- Modify: `apps/web/src/pages/TaskBulkImportPage.tsx`
- Create: `apps/web/src/pages/TaskBulkImportPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, and 7.
- Produces: the complete `/tasks/import` workflow available from Tasks and Recurring / To-Do.

- [ ] **Step 1: Write failing component workflow tests**

Test: legacy upload detection; blocking blank cells; explicit identity selection; no automatic candidate selection; validation disabled until mappings complete; route counts for one-time/recurring/as-required; correction report download; import confirmation; per-chunk progress; paused retry; exact-file resume; cancel allowed only before progress; destination links; recent metadata-only history.

```tsx
expect(screen.getByRole("button", { name: /import all/i })).toBeDisabled();
await user.selectOptions(screen.getByLabelText(/map employee name/i), "profile-1");
expect(screen.getByText(/mapping requires confirmation/i)).toBeVisible();
await user.click(screen.getByRole("button", { name: /confirm mapping/i }));
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm.cmd --filter web test -- src/features/tasks/import/IdentityMappingPanel.test.tsx src/features/tasks/import/ImportProgress.test.tsx src/pages/TaskBulkImportPage.test.tsx`

Expected: FAIL because the components and workflow states do not exist.

- [ ] **Step 3: Implement focused components and reducer state**

Use states `idle`, `parsed`, `mapping`, `validating`, `ready`, `importing`, `paused`, `completed`. Keep task data in memory only. The preview is paginated and text-rendered. Issue filters use `missing`, `identity`, `schedule`, `scope`, `unsupported`. Update copy to 2 MiB/2,500 rows, India time, resumable chunks, and immediate chunk visibility.

- [ ] **Step 4: Implement safe completion and navigation**

On success, show counts and buttons that navigate to `/tasks` and `/recurring-todo`. Preserve history refresh. Re-uploading an unchanged file calls begin/resume and continues missing rows. A changed file cannot resume a progressed batch.

- [ ] **Step 5: Run GREEN tests and commit**

```powershell
pnpm.cmd --filter web test -- src/features/tasks/import/IdentityMappingPanel.test.tsx src/features/tasks/import/ImportProgress.test.tsx src/pages/TaskBulkImportPage.test.tsx src/features/tasks/import/workbook.test.ts
git add -- apps/web/src/features/tasks/import/IdentityMappingPanel.tsx apps/web/src/features/tasks/import/IdentityMappingPanel.test.tsx apps/web/src/features/tasks/import/ImportProgress.tsx apps/web/src/features/tasks/import/ImportProgress.test.tsx apps/web/src/pages/TaskBulkImportPage.tsx apps/web/src/pages/TaskBulkImportPage.test.tsx
git commit -m "feat(web): build current sheet import workspace"
```

### Task 9: Generated Types and Focused Integration Gate

**Files:**
- Modify: `packages/api-client/src/database.types.ts`
- Modify: `packages/core/src/database.types.ts`

**Interfaces:**
- Consumes: local schema through `0101`.
- Produces: identical generated Supabase types for API client and core.

- [ ] **Step 1: Regenerate types from the verified local database**

Run from the nested repository after a successful local reset:

```powershell
supabase.cmd gen types typescript --local | Set-Content -Encoding utf8 packages/api-client/src/database.types.ts
Copy-Item -LiteralPath packages/api-client/src/database.types.ts -Destination packages/core/src/database.types.ts
```

- [ ] **Step 2: Verify generated contracts**

Run:

```powershell
rg -n "task_import_items|due_datetime|due_time|verifier_user_profile_id|begin_task_bulk_import|commit_task_bulk_import_chunk" packages/api-client/src/database.types.ts packages/core/src/database.types.ts
git diff --no-index -- packages/api-client/src/database.types.ts packages/core/src/database.types.ts
```

Expected: all new contracts appear; `git diff --no-index` exits 0 with no content difference.

- [ ] **Step 3: Run focused database and TypeScript gates**

```powershell
supabase.cmd test db supabase/tests/0100_task_deadlines_verifiers_and_evidence.test.sql supabase/tests/0101_resumable_current_sheet_task_import.test.sql supabase/tests/0080_task_bulk_import_workspace.test.sql supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql supabase/tests/0085_recurring_task_completion_modes.test.sql
pnpm.cmd --filter @jewelos/core test -- taskImport.test.ts taskFeed.test.ts
pnpm.cmd --filter web test -- src/features/tasks/import src/pages/TaskBulkImportPage.test.tsx src/features/tasks/TaskCard.test.tsx src/pages/RecurringTodoPage.test.tsx
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

Expected: all focused tests, typechecks, builds, and diff check pass. Record unrelated full-suite failures separately; do not weaken tests.

- [ ] **Step 4: Commit generated types**

```powershell
git add -- packages/api-client/src/database.types.ts packages/core/src/database.types.ts
git commit -m "chore(db): regenerate task import types"
```

### Task 10: Authenticated Browser QA and Final Evidence

**Files:**
- Modify only if QA exposes a scoped defect in files already named above.

**Interfaces:**
- Consumes: complete local implementation.
- Produces: evidence for parsing, validation, identity mapping, progress, resume, and destination visibility.

- [ ] **Step 1: Start the verified local stack and web app**

Verify checkout/container identity without printing credentials. Run `pnpm.cmd --filter web dev` and capture the bound local URL.

- [ ] **Step 2: Exercise the supplied CSV without importing invalid rows**

Upload `C:\Users\MIS\Downloads\MK_Jewels_Daily_Checklist - FINAL DATA.csv`. Verify the UI reports 1,932 rows, the six observed frequency counts, all blank start dates, explicit identity requirements, missing required values, zero one-time rows, and disabled import. Do not place task names, employee names, emails, or verifier names in screenshots or logs.

- [ ] **Step 3: Exercise a synthetic valid mixed file**

Use synthetic users and a temporary local-only CSV containing one-time, daily, quarterly, yearly, paused, as-required, task, checklist, evidence, verification, and buddy variations. Verify preview routing, import progress, destination links, exact replay, and resume after interrupting between chunks.

- [ ] **Step 4: Inspect database evidence without raw content**

Confirm batch/item counts, created IDs, RLS denial, audits, deadlines, designated verifier, and template/instance destinations using metadata-only queries. Do not output raw row or profile content.

- [ ] **Step 5: Run final verification and review commit history**

Re-run Task 9 gates, `git status --short --branch`, `git log --oneline --decorate -12`, and a credential-safe diff scan. If a QA fix was required, commit only its named files with `fix(tasks): correct current sheet import QA issue`.

- [ ] **Step 6: Report proof boundaries**

Report files changed, migration/RPC/RLS/audit impact, generated types, local database results, focused/full test results, browser results, and any unavailable tool. Explicitly state that Git push, hosted Supabase, deployed Edge Function, Vercel, and production-data import were not performed.
