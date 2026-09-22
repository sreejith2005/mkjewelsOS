# Task Import Default Timing and Partial Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give draft task imports safe 11:00-20:00 business-hour defaults by frequency family and allow every valid row to import even when other source rows need correction or an employee name remains unresolved.

**Architecture:** Keep scheduling and row-eligibility decisions in `@jewelos/core`, then make web and native consume the same pure contracts. Preserve the canonical four-sheet validation flow and the existing protected, audited, resumable import RPCs; only the eligible draft-row subset is identity-mapped, hashed, reconciled, batched, and committed.

**Tech Stack:** TypeScript 5.9, React 18/Vite/Vitest, Expo/React Native/Vitest, pnpm workspace packages, Supabase PostgreSQL/pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-22-task-import-default-timing-and-partial-import-design.md`

## Global Constraints

- Work from `C:\Users\MIS\Downloads\MKJewelOS` after confirming it is the Git root.
- Preserve the unrelated untracked `sreejith-crm/` directory and any other user-owned changes.
- Use `pnpm.cmd` for workspace/web/core commands and `npm.cmd --prefix apps/mobile` for the separate Expo package.
- Do not edit an applied migration. This design requires no schema, RPC, RLS, Storage, audit, or generated database-type change.
- Do not change the canonical four-sheet import's all-or-nothing server-validation workflow.
- Do not guess unknown frequency labels or employee identities.
- Keep explicit valid row times authoritative. Invalid explicit values remain row errors.
- Never log, snapshot, commit, or quote source titles, employee names, emails, or raw rows from the real workbook.
- Do not deploy or push until the implementation has passed the required local gates and the user has authorized publication.

## Review Focus

- Every observed frequency selects the intended start and due timing families.
- `2x Daily`, `3x Daily`, `Morning & Evening`, and `Morning & Closing` still create one daily work item with required checkpoints.
- Row errors exclude only their own physical source row; structural/global errors exclude every row.
- Warnings do not block rows.
- Identity mapping happens after row partitioning, and unresolved names remain eligible for Assigning Left.
- Both clients hash, reconcile, begin, and chunk only `readyRows`.
- The action label and counts distinguish source, ready, blocked, assigned, and Assigning Left records.
- Existing authorization, audit, idempotency, correction-report, resume, and canonical-workbook behavior remain intact.

---

## Task 1: Add shared business-hour defaults and finish frequency-family planning

**Files:**

- Modify: `packages/core/src/taskImport/frequency.ts`
- Modify: `packages/core/src/taskImport/frequency.test.ts`
- Modify: `packages/core/src/taskImport/businessSheet.test.ts`
- Modify: `packages/core/src/taskImport/legacySheet.test.ts`

- [ ] **Step 1: Add failing tests for the six shared timing defaults**

In `frequency.test.ts`, import the new factory and assert a complete value:

```ts
expect(createDefaultTaskImportTimingPresets()).toEqual({
  general: { startTime: "11:00", dueTime: "13:00" },
  opening: { startTime: "11:00", dueTime: "13:00" },
  morning: { startTime: "11:00", dueTime: "13:00" },
  closing: { startTime: "18:00", dueTime: "20:00" },
  evening: { startTime: "18:00", dueTime: "20:00" },
  manual: { startTime: "11:00", dueTime: "20:00" },
});
```

Call the factory twice and assert that editing one returned window does not alter the other result. This prevents shared mutable UI state.

- [ ] **Step 2: Add failing frequency-family tests**

Extend the table tests for these exact contracts:

```ts
[
  ["Daily - Opening", "opening", "opening"],
  ["Daily - Morning", "morning", "morning"],
  ["Daily - Closing", "closing", "closing"],
  ["Throughout Day", "opening", "closing"],
  ["2x Daily", "opening", "closing"],
  ["3x Daily", "opening", "closing"],
  ["Morning & Evening", "morning", "evening"],
  ["Morning & Closing", "morning", "closing"],
  ["As Required", "manual", "manual"],
  ["Per Customer", "manual", "manual"],
  ["Per Lead", "manual", "manual"],
  ["After Visit", "manual", "manual"],
  ["", "manual", "manual"],
]
```

Retain and tighten the existing assertions that `2x Daily` has exactly two generated checkpoints and `3x Daily` has exactly three, both with `scheduleKind: "daily"` and `destination: "recurring_todo"`.

- [ ] **Step 3: Run the focused test and confirm it fails for the intended reasons**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- src/taskImport/frequency.test.ts
```

Expected: failure because the factory is missing and the spanning-day frequency families still select `general/general`.

- [ ] **Step 4: Implement the shared immutable default factory**

In `frequency.ts`, export:

```ts
const DEFAULT_WINDOWS: Readonly<Record<TaskImportTimingPresetKey, TaskImportTimeWindow>> = {
  general: { startTime: "11:00", dueTime: "13:00" },
  opening: { startTime: "11:00", dueTime: "13:00" },
  morning: { startTime: "11:00", dueTime: "13:00" },
  closing: { startTime: "18:00", dueTime: "20:00" },
  evening: { startTime: "18:00", dueTime: "20:00" },
  manual: { startTime: "11:00", dueTime: "20:00" },
};

export function createDefaultTaskImportTimingPresets(): TaskImportTimingPresets {
  return {
    general: { ...DEFAULT_WINDOWS.general },
    opening: { ...DEFAULT_WINDOWS.opening },
    morning: { ...DEFAULT_WINDOWS.morning },
    closing: { ...DEFAULT_WINDOWS.closing },
    evening: { ...DEFAULT_WINDOWS.evening },
    manual: { ...DEFAULT_WINDOWS.manual },
  };
}
```

Keep the public type as `TaskImportTimingPresets` so existing parser options remain source-compatible.

- [ ] **Step 5: Update the planner without broadening accepted input**

Make these narrow changes in `planTaskImportFrequency`:

```ts
if (frequency === "throughout day") return plan("daily", "FREQ=DAILY", "opening", "closing");
if (frequency === "2x daily") return plan("daily", "FREQ=DAILY", "opening", "closing", numberedCheckpoints(2, title));
if (frequency === "3x daily") return plan("daily", "FREQ=DAILY", "opening", "closing", numberedCheckpoints(3, title));
```

Remove `throughout day` from the ordinary `DAILY` set. Leave the closed recognized-label sets and unsupported-frequency exception unchanged.

Keep the existing observed-label tables as one explicit 72-value regression fixture (including the blank value) and assert every entry plans successfully. Assert the fixture length is 72 so a future accidental deletion is visible.

- [ ] **Step 6: Prove default use, explicit override, and invalid-explicit rejection in both adapters**

Add business-sheet tests that normalize representative rows with `createDefaultTaskImportTimingPresets()` and assert:

- blank `START TIME`/`DUE TIME` for `Daily - Opening` become `11:00`/`13:00`;
- blank times for `As Required` become `11:00`/`20:00`;
- blank times for `Throughout Day` and `3x Daily` become `11:00`/`20:00`;
- `3x Daily` produces one row with three checklist items;
- a valid explicit start replaces only the default start;
- a valid explicit due replaces only the default due;
- an invalid explicit time still produces an error rather than falling back.

Add the equivalent representative default and explicit-override assertions for the legacy 18-column adapter. Do not duplicate all 72 frequency cases across both adapters; the planner table owns that exhaustive coverage.

- [ ] **Step 7: Run the focused core tests**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- src/taskImport/frequency.test.ts src/taskImport/businessSheet.test.ts src/taskImport/legacySheet.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit the shared timing contract**

```powershell
git add packages/core/src/taskImport/frequency.ts packages/core/src/taskImport/frequency.test.ts packages/core/src/taskImport/businessSheet.test.ts packages/core/src/taskImport/legacySheet.test.ts
git diff --cached --check
git commit -m "feat(tasks): add import timing defaults"
```

---

## Task 2: Partition draft rows by blocking parser issues

**Files:**

- Create: `packages/core/src/taskImport/eligibility.ts`
- Create: `packages/core/src/taskImport/eligibility.test.ts`
- Modify: `packages/core/src/taskImport/index.ts`

- [ ] **Step 1: Write the failing pure-helper tests**

Cover these cases with rows whose `source_row` values are 2, 3, and 4:

- an error on row 3 yields ready rows 2 and 4, blocked row 3, and `blockedSourceRows: [3]`;
- two errors on row 3 still count one blocked row;
- errors on rows 3 and 4 return sorted, unique blocked source rows;
- a warning on row 3 does not block it;
- an error at row 1 is global, returns no ready rows, and marks every input row blocked;
- an error at row 0 is also global;
- an error for a data-row number absent from the normalized rows is preserved as a row issue but does not fabricate a blocked row;
- empty rows and issues produce empty partitions.

Use only synthetic titles and identities.

- [ ] **Step 2: Run the new test and confirm the missing-module failure**

```powershell
pnpm.cmd --filter @jewelos/core test -- src/taskImport/eligibility.test.ts
```

Expected: failure because `eligibility.ts` and its export do not exist.

- [ ] **Step 3: Implement the generic partition contract**

Create `eligibility.ts` with these exported shapes:

```ts
import type { TaskBulkImportIssue } from "./workbook";

export type TaskImportRowEligibility<T extends { source_row: number }> = Readonly<{
  readyRows: readonly T[];
  blockedRows: readonly T[];
  blockedSourceRows: readonly number[];
  globalIssues: readonly TaskBulkImportIssue[];
}>;

export function partitionTaskImportRows<T extends { source_row: number }>(
  rows: readonly T[],
  issues: readonly TaskBulkImportIssue[],
): TaskImportRowEligibility<T> {
  const errors = issues.filter((issue) => issue.severity === "error");
  const globalIssues = errors.filter((issue) => issue.row < 2);
  if (globalIssues.length > 0) {
    return {
      readyRows: [],
      blockedRows: [...rows],
      blockedSourceRows: [...new Set(rows.map((row) => row.source_row))].sort((a, b) => a - b),
      globalIssues,
    };
  }
  const blocked = new Set(errors.map((issue) => issue.row));
  const blockedRows = rows.filter((row) => blocked.has(row.source_row));
  return {
    readyRows: rows.filter((row) => !blocked.has(row.source_row)),
    blockedRows,
    blockedSourceRows: [...new Set(blockedRows.map((row) => row.source_row))].sort((a, b) => a - b),
    globalIssues,
  };
}
```

Export the module from `packages/core/src/taskImport/index.ts`. Keep issue deduplication in its existing helper; eligibility must tolerate duplicate issues without depending on prior deduplication.

- [ ] **Step 4: Run focused and complete core tests**

```powershell
pnpm.cmd --filter @jewelos/core test -- src/taskImport/eligibility.test.ts src/taskImport/workbook.test.ts
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/core typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit the eligibility contract**

```powershell
git add packages/core/src/taskImport/eligibility.ts packages/core/src/taskImport/eligibility.test.ts packages/core/src/taskImport/index.ts
git diff --cached --check
git commit -m "feat(tasks): partition valid import rows"
```

---

## Task 3: Make the web importer defaulted, partial, and Assigning Left-safe

**Files:**

- Modify: `apps/web/src/pages/TaskBulkImportPage.tsx`
- Modify: `apps/web/src/pages/TaskBulkImportPage.test.tsx`
- Modify: `apps/web/src/features/tasks/import/ImportReadinessSummary.tsx`
- Modify: `apps/web/src/features/tasks/import/ImportReadinessSummary.test.tsx`

- [ ] **Step 1: Rewrite the existing timing test around first-parse defaults**

Change the parser mock so the uploaded file is immediately valid when it receives the shared defaults. Assert the first parse call includes:

```ts
timingPresets: expect.objectContaining({
  general: { startTime: "11:00", dueTime: "13:00" },
  opening: { startTime: "11:00", dueTime: "13:00" },
  closing: { startTime: "18:00", dueTime: "20:00" },
  manual: { startTime: "11:00", dueTime: "20:00" },
})
```

Then edit the opening window and assert reparsing still sends the override without discarding the other default families.

- [ ] **Step 2: Add failing page tests for row-level partial import**

Extend the API mocks for:

- `reconcileTaskImportAssignments`;
- `beginCurrentSheetTaskImport`;
- `commitCurrentSheetTaskImportChunk`; and
- history refresh after completion.

Return two draft rows with source rows 2 and 3 plus one error tied to row 3. Assert:

- the summary shows `Source records 2`, `Ready to import 1`, and `Blocked rows 1`;
- the button reads `Import 1 valid record` and is enabled;
- the correction-report action remains available;
- clicking import reconciles and starts a batch with only source row 2;
- the batch count and hash source are based on the one-row eligible subset;
- no import API receives source row 3.

Mock the hashing boundary or compare the expected one-row hash using the page's existing hashing helper; do not assert a hash generated from all source rows.

- [ ] **Step 3: Add a failing unresolved-identity test**

Return a ready draft row with a written unmatched employee name and no matching candidate. Assert the confirmation panel is shown, `Assigning Left` is counted, and the import button remains enabled. After clicking it, assert the imported row has an empty `assignee_profile_id` and `assignment_status: "assigning_left"`.

- [ ] **Step 4: Add a failing global-error regression test**

Return otherwise valid draft rows plus a row-1 header or sheet error. Assert `Ready to import 0`, every row is blocked, and the import button is disabled.

- [ ] **Step 5: Update the summary component test**

Change `ImportReadinessSummary` props and expectations to render five cards:

```ts
type Props = Readonly<{
  total: number;
  ready: number;
  blocked: number;
  assigned: number;
  assigningLeft: number;
  recurring: number;
  startDate: string;
  unresolvedLabels: number;
  unresolvedNamed: number;
}>;
```

Use labels `Source records`, `Ready to import`, `Blocked rows`, `Assigned automatically`, and `Assigning Left`. Remove the redundant `Names written` card. Keep the explanatory text for unresolved labels, blank assignees, and recurring start dates, but ensure counts are derived from the eligible subset.

- [ ] **Step 6: Run the web tests and confirm the new assertions fail**

```powershell
pnpm.cmd --filter web test -- src/pages/TaskBulkImportPage.test.tsx src/features/tasks/import/ImportReadinessSummary.test.tsx
```

Expected: failures because timing state starts empty, any issue clears `readyRows`, unresolved names disable import, and the summary lacks readiness cards.

- [ ] **Step 7: Consume the shared contracts in the web page**

Initialize and reset presets with `createDefaultTaskImportTimingPresets()`:

```ts
const [timingPresets, setTimingPresets] = useState<TaskImportTimingPresets>(
  createDefaultTaskImportTimingPresets,
);
```

On upload, create a fresh default object before the first parse.

Partition before identity mapping:

```ts
const eligibility = useMemo(
  () => partitionTaskImportRows(draftRows, issues),
  [draftRows, issues],
);
const mapped = useMemo(
  () => applyIdentityMappings(eligibility.readyRows, candidates ?? []),
  [candidates, eligibility.readyRows],
);
const readyRows = candidates ? mapped.rows : [];
```

Do not map or count blocked rows as assigned/Assigning Left. Remove unresolved-assignee count from the import button's disabled condition. Keep reference-data loading as a prerequisite so exact identity matching still occurs before importing.

- [ ] **Step 8: Update web labels, progress, and completion context**

Use this action-label contract:

```ts
const importLabel = readyRows.length === draftRows.length
  ? `Import all ${readyRows.length} record${readyRows.length === 1 ? "" : "s"}`
  : `Import ${readyRows.length} valid record${readyRows.length === 1 ? "" : "s"}`;
```

Disable only when busy, candidate reference data is not loaded, `readyRows` is empty, or a global issue exists. Pass source, ready, and blocked counts into the summary. Progress denominator must be `readyRows.length`, not `draftRows.length`.

Append a neutral sentence to the result when `blockedRows.length > 0`, for example:

```ts
`${message.text} ${blockedRows.length.toLocaleString("en-IN")} source row${blockedRows.length === 1 ? " remains" : "s remain"} blocked for correction.`
```

Preserve the existing correction-report generation from all parser issues and the current batch-resume behavior.

- [ ] **Step 9: Run focused web tests and typecheck**

```powershell
pnpm.cmd --filter web test -- src/pages/TaskBulkImportPage.test.tsx src/features/tasks/import/ImportReadinessSummary.test.tsx src/features/tasks/import/TimingPresetFields.test.tsx
pnpm.cmd --filter web typecheck
```

Expected: all commands pass.

- [ ] **Step 10: Commit the web behavior**

```powershell
git add apps/web/src/pages/TaskBulkImportPage.tsx apps/web/src/pages/TaskBulkImportPage.test.tsx apps/web/src/features/tasks/import/ImportReadinessSummary.tsx apps/web/src/features/tasks/import/ImportReadinessSummary.test.tsx
git diff --cached --check
git commit -m "feat(tasks): import valid sheet rows on web"
```

---

## Task 4: Give the native importer behavioral parity

**Files:**

- Modify: `apps/mobile/src/features/taskImport/timingPresets.ts`
- Modify: `apps/mobile/src/features/taskImport/timingPresets.test.ts`
- Create: `apps/mobile/src/features/taskImport/readiness.ts`
- Create: `apps/mobile/src/features/taskImport/readiness.test.ts`
- Modify: `apps/mobile/src/screens/TaskImportScreen.tsx`

- [ ] **Step 1: Add failing native helper tests for fresh defaults**

Export a native initialization helper that delegates to core:

```ts
export function initialTaskImportTimingPresets(): TaskImportTimingPresets {
  return createDefaultTaskImportTimingPresets();
}
```

Test the exact six windows and independent return values. Retain the existing edit and same-day-validity tests.

- [ ] **Step 2: Add failing native presentation-helper tests**

Create `readiness.test.ts` first and specify:

```ts
expect(taskImportActionLabel(3, 3)).toBe("Import all 3 records");
expect(taskImportActionLabel(3, 2)).toBe("Import 2 valid records");
expect(taskImportActionLabel(2, 1)).toBe("Import 1 valid record");
```

Also test a helper that calculates eligible-row counts after mapping, if extracting that calculation makes the screen simpler. Keep row eligibility itself in core rather than duplicating it in mobile.

- [ ] **Step 3: Run the native helper tests and confirm failure**

```powershell
npm.cmd --prefix apps/mobile test -- src/features/taskImport/timingPresets.test.ts src/features/taskImport/readiness.test.ts
```

Expected: failure because the new helpers do not exist.

- [ ] **Step 4: Implement native helper functions**

Add `initialTaskImportTimingPresets` to `timingPresets.ts`. Add this focused label function to `readiness.ts`:

```ts
export function taskImportActionLabel(total: number, ready: number): string {
  const noun = ready === 1 ? "record" : "records";
  return ready === total ? `Import all ${ready} ${noun}` : `Import ${ready} valid ${noun}`;
}
```

- [ ] **Step 5: Apply the shared eligibility flow in `TaskImportScreen`**

Make native mirror the web data flow:

```ts
const eligibility = useMemo(
  () => partitionTaskImportRows(draftRows, issues),
  [draftRows, issues],
);
const mapped = useMemo(
  () => applyIdentityMappings(eligibility.readyRows, candidates),
  [candidates, eligibility.readyRows],
);
const readyRows = mapped.rows;
```

Initialize state and each selected file with a fresh `initialTaskImportTimingPresets()` result. Remove the unresolved-assignee guard from both `importCurrentSheet` and the button. Do not remove identity confirmation cards.

- [ ] **Step 6: Update the native review card**

Show these rows:

- `Source records` from `draftRows.length`;
- `Ready to import` from `readyRows.length`;
- `Blocked rows` from `eligibility.blockedRows.length`;
- `Assigned automatically` from eligible mapped rows with an assignee ID;
- `Assigning Left` from eligible mapped rows without an assignee ID.

Use `taskImportActionLabel(draftRows.length, readyRows.length)`. Disable only for busy state, no ready rows, or global structural failure. Keep correction sharing available when issues exist. Use the ready count as the run-progress denominator and include the blocked-row reminder in the success message.

- [ ] **Step 7: Run native tests and typecheck**

```powershell
npm.cmd --prefix apps/mobile test -- src/features/taskImport/timingPresets.test.ts src/features/taskImport/readiness.test.ts src/features/taskImport/importSession.test.ts
npm.cmd --prefix apps/mobile run typecheck
```

Expected: all commands pass.

- [ ] **Step 8: Commit native parity**

```powershell
git add apps/mobile/src/features/taskImport/timingPresets.ts apps/mobile/src/features/taskImport/timingPresets.test.ts apps/mobile/src/features/taskImport/readiness.ts apps/mobile/src/features/taskImport/readiness.test.ts apps/mobile/src/screens/TaskImportScreen.tsx
git diff --cached --check
git commit -m "feat(tasks): import valid sheet rows on native"
```

---

## Task 5: Verify the real source safely and update maintained documentation

**Files:**

- Modify: `docs/TASKS_AND_BULK_IMPORT_HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-09-22-task-import-default-timing-and-partial-import-design.md`
- Modify only if implementation evidence requires correction: `docs/superpowers/plans/2026-09-22-task-import-default-timing-and-partial-import.md`

- [ ] **Step 1: Add an aggregate-only local verification script invocation**

Run this aggregate-only TypeScript probe from the repository root:

```powershell
$aggregateCheck = @'
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  createDefaultTaskImportTimingPresets,
  parseTaskImportFile,
  partitionTaskImportRows,
} from "./src/taskImport/index.ts";

const sourcePath = "C:/Users/MIS/Downloads/All Employees Work list - FINAL CLEAN TASK.csv";
(async () => {
  const bytes = readFileSync(sourcePath);
  const arrayBuffer = Uint8Array.from(bytes).buffer;
  const workbook = XLSX.read(arrayBuffer, { type: "array", raw: false, cellFormula: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
  const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const frequencyHeader = Object.keys(sourceRows[0] ?? {}).find(
    (key) => key.trim().toLocaleLowerCase("en-IN") === "task frequency",
  );
  if (!frequencyHeader) throw new Error("TASK FREQUENCY header was not found");
  const parsed = await parseTaskImportFile({
    name: "aggregate-source.csv",
    size: bytes.byteLength,
    type: "text/csv",
    arrayBuffer: async () => arrayBuffer,
  }, {
    defaultStartsOn: "2026-09-22",
    timingPresets: createDefaultTaskImportTimingPresets(),
  });
  const eligibility = partitionTaskImportRows(parsed.draftRows, parsed.issues);
  const grouped = new Map<string, { field: string; reason: string; count: number }>();
  for (const issue of parsed.issues) {
    const key = `${issue.field}\u0000${issue.reason}`;
    const current = grouped.get(key);
    grouped.set(key, current
      ? { ...current, count: current.count + 1 }
      : { field: issue.field, reason: issue.reason, count: 1 });
  }
  console.log(JSON.stringify({
    sourceFormat: parsed.sourceFormat,
    sourceCount: sourceRows.length,
    distinctFrequencyCount: new Set(sourceRows.map((row) => String(row[frequencyHeader] ?? "").trim())).size,
    readyCount: eligibility.readyRows.length,
    blockedCount: eligibility.blockedRows.length,
    requiredTimingPresets: parsed.requiredTimingPresets,
    issueGroups: [...grouped.values()],
  }, null, 2));
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Aggregate verification failed");
  process.exitCode = 1;
});
'@
Push-Location packages/core
try { pnpm.cmd exec tsx -e $aggregateCheck } finally { Pop-Location }
```

The command must print only this JSON shape:

```ts
{
  sourceFormat,
  sourceCount,
  distinctFrequencyCount,
  readyCount,
  blockedCount,
  requiredTimingPresets,
  issueGroups: [{ field, reason, count }],
}
```

Do not print row objects, field values, task titles, names, emails, or source-row text. Expected baseline is 2,294 source rows and 72 distinct written frequency labels; investigate any mismatch before continuing.

- [ ] **Step 2: Verify partial eligibility with a synthetic damaged copy in memory**

Using unit fixtures or an in-memory workbook only, corrupt one row's frequency while leaving another valid. Verify the valid row remains ready, the corrupt row is blocked, and no raw real-source data is written to disk.

- [ ] **Step 3: Update the maintained handoff**

Document:

- store hours and the six default preset windows;
- the frequency families that span 11:00-20:00;
- explicit-value precedence;
- row-scoped versus global blocking;
- unresolved names importing to Assigning Left;
- ready-subset hashing/chunking and corrected-reupload idempotency;
- canonical four-sheet behavior remaining unchanged; and
- no migration or generated database-type impact.

Change the approved design status to `Implemented and locally verified` only after all required local gates pass. If any gate is unavailable, use `Implemented; verification incomplete` and list the missing evidence.

- [ ] **Step 4: Run the protected import database contract tests**

First confirm local Supabase status without displaying credentials:

```powershell
supabase.cmd status
```

If the local stack is running, execute:

```powershell
supabase.cmd test db supabase/tests/0104_zero_touch_task_import_and_assigning_left.test.sql
supabase.cmd test db supabase/tests/0166_task_import_optional_category.test.sql
supabase.cmd test db supabase/tests/database/0064_task_import_with_notifications.test.sql
```

Expected: all focused pgTAP files pass. If Docker/local Supabase is unavailable, record that database behavior was not re-proven locally; do not treat TypeScript tests as a substitute.

- [ ] **Step 5: Run all application verification gates**

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
npm.cmd --prefix apps/mobile test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

Expected: all commands pass. If a broader pre-existing failure occurs, isolate it with the focused suites and report it precisely rather than claiming a full green gate.

- [ ] **Step 6: Run a clean Expo Android bundle check**

Create a task-specific temporary directory outside the repository and verify its resolved path before use:

```powershell
$taskImportExportRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$taskImportExportDir = [System.IO.Path]::GetFullPath((Join-Path $taskImportExportRoot "jewelos-task-import-expo-export"))
if (-not $taskImportExportDir.StartsWith($taskImportExportRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe Expo export path" }
New-Item -ItemType Directory -Force -Path $taskImportExportDir | Out-Null
npm.cmd --prefix apps/mobile exec expo export -- --platform android --output-dir $taskImportExportDir
```

Expected: Metro completes and emits an Android export. After reconfirming the same prefix condition, remove only `$taskImportExportDir` with `Remove-Item -LiteralPath $taskImportExportDir -Recurse -Force`. This proves bundling, not APK signing, device installation, login, or authenticated UI behavior.

- [ ] **Step 7: Review the complete diff for data and security safety**

```powershell
git status --short --branch
git diff --stat
git diff --check
git diff -- packages/core/src/taskImport apps/web/src/pages/TaskBulkImportPage.tsx apps/web/src/features/tasks/import apps/mobile/src/features/taskImport apps/mobile/src/screens/TaskImportScreen.tsx docs/TASKS_AND_BULK_IMPORT_HANDOFF.md docs/superpowers/specs/2026-09-22-task-import-default-timing-and-partial-import-design.md
```

Confirm no `.env`, `.supabase`, exports, temporary bundles, source workbook, raw rows, employee details, or unrelated paths are staged.

- [ ] **Step 8: Commit documentation and verification updates**

```powershell
git add docs/TASKS_AND_BULK_IMPORT_HANDOFF.md docs/superpowers/specs/2026-09-22-task-import-default-timing-and-partial-import-design.md
git diff --cached --check
git commit -m "docs(tasks): document partial import scheduling"
```

---

## Task 6: Final review and release handoff

**Files:** Review all files changed by Tasks 1-5; do not make unrelated edits.

- [ ] **Step 1: Perform a fresh requirements review**

Compare the implementation line by line with the approved spec and the Review Focus list. Specifically trace one example for each of these paths:

- opening task -> 11:00-13:00;
- closing task -> 18:00-20:00;
- As Required task -> 11:00-20:00 and Assigning Left when unresolved;
- 3x Daily -> one daily record, three checkpoints, 11:00-20:00;
- one malformed data row beside one valid row -> only valid row enters all import APIs;
- wrong headers -> no ready rows;
- canonical four-sheet workbook -> existing server validation and import path.

- [ ] **Step 2: Inspect commit scope and staged safety**

```powershell
git log --oneline --decorate -8
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
```

Confirm `sreejith-crm/` remains untouched and untracked, and confirm every commit contains only its named paths.

- [ ] **Step 3: Prepare the evidence-based handoff**

Report separately:

- behavior changed;
- files changed;
- schema/RPC/RLS/Storage/audit/generated-type impact: none;
- focused and broad local commands with results;
- aggregate-only real-source counts;
- database test status;
- Expo bundle status;
- authenticated rendered web/native proof status;
- hosted migration/deployment status: no migration required and no deployment performed unless separately authorized;
- Git status and whether local commits are ahead of `origin/main`.

- [ ] **Step 4: Stop at the publication gate**

Do not push, deploy, or apply hosted changes as part of this plan without explicit publication authorization. If authorized later, read `PRODUCTION_SWITCH_PLAYBOOK.md`, fetch and re-check divergence, scan the staged/committed range for credentials and customer data, push the reviewed commits to `main`, and verify Git hosting, web deployment, and hosted Supabase as separate systems.
