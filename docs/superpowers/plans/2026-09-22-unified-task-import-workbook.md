# Unified Task Import Workbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken four-sheet download with one readable, styled task-import worksheet and accept the new six-column operational file, the previous 18-column file, the unified worksheet, and existing canonical workbooks through one safe normalization flow.

**Architecture:** Shared core modules define the business worksheet schema, explicit source-format adapters, timing-preset requirements, and a closed frequency mapping. The web client lazily generates the formatted `.xlsx` with ExcelJS, while web and native import screens both reparse selected files with the shared timing options and continue through the existing identity, Assigning Left, hashing, chunking, and audited RPC paths. No database migration or alternate persistence path is planned.

**Tech Stack:** TypeScript 5.9, React 18/Vite, React Native/Expo, Vitest, SheetJS `xlsx` for parsing, ExcelJS 4.4.0 for web-only workbook generation, Supabase RPC contracts already in the repository.

**Spec:** `docs/superpowers/specs/2026-09-22-unified-task-import-workbook-design.md`

## Global Constraints

- Work from `C:\Users\MIS\Downloads\MKJewelOS`, the Git root currently returned by `git rev-parse --show-toplevel`; preserve the unrelated untracked `sreejith-crm/` directory.
- Use `pnpm.cmd` for the monorepo and `npm.cmd` inside `apps/mobile`; do not use PowerShell `.ps1` shims.
- Keep the 2 MiB file limit, 2,500 source-row limit, 100-row resumable chunks, metadata-only history, tenant business fingerprints, and current replay behavior.
- Never fill down or guess employee identity. Exact server authorization, active-account checks, aliases, and Assigning Left remain authoritative.
- The generated workbook has exactly one worksheet named `Tasks`, one header row, and one importable example row.
- `MAIN TASK` is the only universally required business cell. Blank task type means `TASK`; blank frequency means `As Required`.
- Unsupported nonblank frequencies remain errors. Formula-prefixed/control-character cells remain errors.
- One source row always remains one import row. Multi-daily labels add checkpoints to one daily card; they do not create extra templates or distort batch totals.
- Preserve the existing task completion contract: completing a task closes remaining checklist items.
- Do not add, edit, rename, or apply a Supabase migration unless implementation proves the approved no-schema-change design impossible; stop for design revision if that occurs.
- Do not deploy, push, apply hosted changes, or claim production/browser/device proof during this implementation unless separately requested.
- Do not commit either attached spreadsheet or any employee/source data.
- Before implementing file parsing or upload changes, invoke the repository's
  `security-review` skill and apply its input-validation and sensitive-data
  checklist. Before React page work, invoke `react-best-practices`.

## Review Focus

- CSV/XLSX cells containing commas, quotes, embedded newlines, or formula prefixes must either round-trip safely or be rejected without shifting columns.
- Unicode `–`, `—`, `×`, ASCII `x`, and whitespace around `/` must normalize deterministically without accepting an unknown frequency.
- Blank values must receive documented defaults, while malformed explicit values must remain blocking corrections.
- A one-sheet workbook named `Tasks` must not be mistaken for the old canonical `Tasks` sheet; exact headers decide the adapter before canonical validation.
- A 2,294-row source with generated checkpoints must remain 2,294 import rows and stay under the 2,500-row limit.

---

### Task 1: Centralize frequency planning and timing requirements

**Files:**
- Create: `packages/core/src/taskImport/frequency.ts`
- Create: `packages/core/src/taskImport/frequency.test.ts`
- Modify: `packages/core/src/taskImport.ts`
- Modify: `packages/core/src/taskImport/index.ts`

**Interfaces:**
- Consumes: existing `ImportScheduleKind` and `buildImportSchedule(kind, startsOn)` from `packages/core/src/taskImport.ts`.
- Produces: `TaskImportTimingPresetKey`, `TaskImportTimeWindow`, `TaskImportTimingPresets`, `TaskImportFrequencyPlan`, `normalizeTaskFrequencyLabel(raw)`, and `planTaskImportFrequency(raw, startsOn, title)` for all source adapters and both clients.

- [ ] **Step 1: Write the failing normalization and mapping tests**

Create table-driven tests that cover every distinct frequency from the 2,294-row source without copying employee data:

```ts
import { describe, expect, it } from "vitest";
import { normalizeTaskFrequencyLabel, planTaskImportFrequency } from "./frequency";

describe("task import frequency planning", () => {
  it.each([
    ["Daily – Opening", "daily - opening"],
    ["Daily — Closing", "daily - closing"],
    ["Daily / As Required", "daily/as required"],
    ["3× Daily", "3x daily"],
  ])("normalizes %s without losing meaning", (source, expected) => {
    expect(normalizeTaskFrequencyLabel(source)).toBe(expected);
  });

  it.each([
    ["Daily", "daily", "FREQ=DAILY"],
    ["Every Monday", "weekly", "FREQ=WEEKLY;BYDAY=MO"],
    ["Monday & Thursday", "weekly", "FREQ=WEEKLY;BYDAY=MO,TH"],
    ["1st Monthly", "monthly", "FREQ=MONTHLY;BYMONTHDAY=1"],
    ["Monthly – 1st to 5th", "monthly", "FREQ=MONTHLY;BYMONTHDAY=1,2,3,4,5"],
    ["Every 15 Days", "daily", "FREQ=DAILY;INTERVAL=15"],
    ["Annual", "yearly", "FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=22"],
    ["Per Customer", "as_required", "FREQ=DAILY"],
  ])("maps %s to a closed recurrence plan", (source, kind, rule) => {
    expect(planTaskImportFrequency(source, "2026-09-22", "Follow up")).toMatchObject({
      scheduleKind: kind,
      recurrenceRule: rule,
    });
  });

  it("creates one daily card with labeled checkpoints", () => {
    expect(planTaskImportFrequency("Morning & Evening", "2026-09-22", "Update follow-ups"))
      .toMatchObject({
        scheduleKind: "daily",
        generatedCheckpoints: [
          "Morning: Update follow-ups",
          "Evening: Update follow-ups",
        ],
      });
  });

  it("treats a blank frequency as manual but rejects unknown text", () => {
    expect(planTaskImportFrequency("", "", "Task").scheduleKind).toBe("as_required");
    expect(() => planTaskImportFrequency("Whenever possible", "2026-09-22", "Task"))
      .toThrow(/unsupported frequency/i);
  });
});
```

Include explicit cases for `Daily`, all Daily compound forms, `Throughout Day`,
`2x Daily`, `3x Daily`, `Morning & Evening`, `Morning & Closing`, all weekly
forms, all monthly forms, `Annual`, every observed `As ...`, `Per ...`,
`After ...`, `Campaign-Based`, `Shoot Days`, and blank.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/taskImport/frequency.test.ts
```

Expected: FAIL because `./frequency` and its exported interfaces do not exist.

- [ ] **Step 3: Implement the closed frequency planner**

Implement normalization and explicit sets rather than prefix/fuzzy acceptance:

```ts
export type TaskImportTimingPresetKey = "general" | "opening" | "morning" | "closing" | "manual";
export type TaskImportTimeWindow = Readonly<{ startTime: string; dueTime: string }>;
export type TaskImportTimingPresets = Readonly<Partial<Record<TaskImportTimingPresetKey, TaskImportTimeWindow>>>;

export type TaskImportFrequencyPlan = Readonly<{
  scheduleKind: ImportScheduleKind;
  destination: TaskImportDestination;
  recurrenceRule: string;
  timingPreset: TaskImportTimingPresetKey;
  generatedCheckpoints: readonly string[];
}>;

export function normalizeTaskFrequencyLabel(raw: string): string {
  return raw.normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-IN");
}
```

Use exhaustive normalized-value sets copied from the approved spec. Return
manual plans only for the named manual labels and blank. Use the existing
`buildImportSchedule` for ordinary anchored daily/weekly/monthly/yearly rules;
return explicit RRULEs for Monday/Thursday, monthly dates/ranges, and the
15-day interval. Generate checkpoint labels only for the four approved
multi-checkpoint frequencies.

Keep `normalizeLegacyFrequency` as a compatibility export in
`taskImport.ts`, but implement it by calling the planner so there is one
frequency vocabulary:

```ts
export function normalizeLegacyFrequency(value: string): ImportScheduleKind {
  return planTaskImportFrequency(value, "2000-01-01", "Task").scheduleKind;
}
```

- [ ] **Step 4: Run frequency and recurrence tests and verify GREEN**

Run:

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/taskImport/frequency.test.ts src/taskImport.test.ts src/recurrence.test.ts
```

Expected: PASS, including the exact RRULE and checkpoint assertions.

- [ ] **Step 5: Prove the regression test detects removal of the implementation**

Temporarily change the `Daily – Opening` mapping to throw, rerun
`frequency.test.ts`, and confirm the relevant case fails. Restore the mapping
and rerun until green.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- packages/core/src/taskImport.ts packages/core/src/taskImport/index.ts packages/core/src/taskImport/frequency.ts packages/core/src/taskImport/frequency.test.ts
git diff --cached --check
git commit -m "feat(tasks): centralize import frequency planning"
```

### Task 2: Add the unified and compact business-sheet adapters

**Files:**
- Create: `packages/core/src/taskImport/businessSheet.ts`
- Create: `packages/core/src/taskImport/businessSheet.test.ts`
- Modify: `packages/core/src/taskImport/legacySheet.ts`
- Modify: `packages/core/src/taskImport/legacySheet.test.ts`
- Modify: `packages/core/src/taskImport/workbook.ts`
- Modify: `packages/core/src/taskImport/workbook.test.ts`
- Modify: `packages/core/src/taskImport/index.ts`

**Interfaces:**
- Consumes: `planTaskImportFrequency`, `TaskImportTimingPresets`, existing `TaskImportDraftRow`, `TaskImportIdentityRequirement`, and `TaskBulkImportIssue`.
- Produces: `IDEAL_TASK_IMPORT_HEADERS`, `COMPACT_TASK_IMPORT_HEADERS`, `TASK_IMPORT_BUSINESS_COLUMNS`, `normalizeBusinessTaskSheet(rows, options)`, `TaskImportDraftSourceFormat`, `isTaskImportDraftSourceFormat(value)`, and `requiredTimingPresets` on parser results.

- [ ] **Step 1: Write failing adapter tests for the 20-column format**

Use one helper that constructs exact rows from the exported header list:

```ts
const businessRow = (overrides: Record<string, string> = {}) =>
  Object.fromEntries(IDEAL_TASK_IMPORT_HEADERS.map((header) => [header, overrides[header] ?? ""]));

it("defaults optional cells while retaining one source row", () => {
  const result = normalizeBusinessTaskSheet([
    businessRow({ "MAIN TASK": "Clean display", "EMPLOYEE NAME": "Named Person" }),
  ], {
    format: "ideal_business_sheet",
    defaultStartsOn: "2026-09-22",
    timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
  });

  expect(result.issues).toEqual([]);
  expect(result.draftRows).toHaveLength(1);
  expect(result.draftRows[0]).toMatchObject({
    title: "Clean display",
    task_type: "delegation",
    schedule_kind: "as_required",
    priority: "medium",
    buddy_assignment_allowed: true,
    is_active: false,
  });
});

it("uses explicit newline checkpoints instead of generated checkpoints", () => {
  const result = normalizeBusinessTaskSheet([
    businessRow({
      "MAIN TASK": "Update follow-ups",
      "TASK FREQUENCY": "Morning & Evening",
      CHECKPOINTS: "Opening review\nClosing review",
    }),
  ], {
    format: "ideal_business_sheet",
    defaultStartsOn: "2026-09-22",
    timingPresets: { general: { startTime: "09:00", dueTime: "19:00" } },
  });
  expect(result.draftRows[0]?.checklist.map((item) => item.item_text))
    .toEqual(["Opening review", "Closing review"]);
});
```

Also test commas, quoted text, embedded newlines, a 501-character title,
formula-prefixed content, invalid explicit boolean/time values, and row-count
preservation when checkpoints are generated.

- [ ] **Step 2: Write failing six-column adapter tests**

Assert exact headers and defaults:

```ts
expect(COMPACT_TASK_IMPORT_HEADERS).toEqual([
  "EMPLOYEE NAME", "DESIGNATION", "MAIN TASK", "TASK TYPE", "TASK FREQUENCY", "KRA",
]);

const result = normalizeBusinessTaskSheet([{
  "EMPLOYEE NAME": "Named Person",
  DESIGNATION: "Sales Executive",
  "MAIN TASK": "Attend customer",
  "TASK TYPE": "",
  "TASK FREQUENCY": "Per Customer",
  KRA: "Customer Experience",
}], {
  format: "compact_work_list",
  defaultStartsOn: "2026-09-22",
  timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
});

expect(result.draftRows[0]).toMatchObject({
  assignee_name: "Named Person",
  title: "Attend customer",
  task_type: "delegation",
  schedule_kind: "as_required",
  category: "Customer Experience",
});
```

Assert that `DESIGNATION` is safety-checked but is not persisted or used for
authorization/identity selection.

- [ ] **Step 3: Write failing parser detection and compatibility tests**

Add `.csv` and `.xlsx` fixtures in memory for all exact header signatures:

```ts
expect((await parseTaskImportFile(fileFor(IDEAL_TASK_IMPORT_HEADERS))).sourceFormat)
  .toBe("ideal_business_sheet");
expect((await parseTaskImportFile(fileFor(COMPACT_TASK_IMPORT_HEADERS))).sourceFormat)
  .toBe("compact_work_list");
expect((await parseTaskImportFile(fileFor(LEGACY_TASK_HEADERS))).sourceFormat)
  .toBe("mk_daily_checklist_csv");
expect((await parseTaskImportFile(existingCanonicalWorkbook())).sourceFormat)
  .toBe("canonical");
```

Add a test proving a one-sheet `Tasks` workbook with business headers is routed
before canonical validation. Add an unknown-header test that returns one
structural issue rather than 2,294 missing-canonical-field issues.

- [ ] **Step 4: Run the focused adapter tests and verify RED**

Run:

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/taskImport/businessSheet.test.ts src/taskImport/workbook.test.ts src/taskImport/legacySheet.test.ts
```

Expected: FAIL because the business schema, adapters, parser formats, and timing
metadata do not exist.

- [ ] **Step 5: Implement the shared column descriptor and adapters**

Define the schema once:

```ts
export type TaskImportBusinessColumn = Readonly<{
  header: typeof IDEAL_TASK_IMPORT_HEADERS[number];
  required: boolean;
  width: number;
  comment: string;
  example: string;
}>;

export const IDEAL_TASK_IMPORT_HEADERS = [
  "EMPLOYEE NAME", "EMPLOYEE EMAIL", "MAIN TASK", "TASK DESCRIPTION",
  "TASK TYPE", "TASK FREQUENCY", "CHECKPOINTS", "KRA", "CORE TASK",
  "DEPARTMENT", "BRANCH NAME", "TASK START DATE", "START TIME", "DUE TIME",
  "PRIORITY", "EVIDENCE REQUIRED", "VERIFICATION REQUIRED", "VERIFIER",
  "BUDDY ALLOWED", "ACTIVE",
] as const;
```

Populate all 20 descriptor entries with exact comments, widths, and example
values. Use small helpers for safe text, optional booleans, times, newline
checkpoints, identity requirements, and issue creation. Explicit row values win;
missing time values consult only the frequency plan's required preset. When a
preset is absent, add one grouped-compatible issue and include its key in
`requiredTimingPresets` so clients can display the missing controls.

- [ ] **Step 6: Integrate adapters into parsing without removing canonical support**

Extend options and source-format narrowing:

```ts
export type ParseTaskImportOptions = Readonly<{
  defaultStartsOn?: string;
  timingPresets?: TaskImportTimingPresets;
}>;

export type TaskImportDraftSourceFormat =
  | "ideal_business_sheet"
  | "compact_work_list"
  | "mk_daily_checklist_csv";

export function isTaskImportDraftSourceFormat(value: string): value is TaskImportDraftSourceFormat {
  return value === "ideal_business_sheet"
    || value === "compact_work_list"
    || value === "mk_daily_checklist_csv";
}
```

Read the first physical row for both CSV and XLSX. Compare exact normalized
header arrays in the order business, compact, legacy. Only then fall back to
the existing canonical workbook parser. Ensure every return variant includes
`requiredTimingPresets: []` when none apply.

Update `normalizeLegacyTaskSheet` to call the shared frequency planner and to
honor timing presets only when an old-format time is genuinely blank. Preserve
its existing four-column fill-down behavior and strict explicit-value errors.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/taskImport/frequency.test.ts src/taskImport/businessSheet.test.ts src/taskImport/workbook.test.ts src/taskImport/legacySheet.test.ts src/taskImport/identityMappings.test.ts
```

Expected: PASS with exact format detection and no canonical regression.

- [ ] **Step 8: Prove the 2,294-row boundary behavior locally without committing data**

Run a temporary in-memory test or one-off command against
`C:\Users\MIS\Downloads\All Employees Work list - FINAL CLEAN TASK.csv` that
prints only aggregate counts. Verify: 2,294 source rows, 2,294 draft rows,
zero canonical-header errors, and required timing preset keys only. Do not print
employee names/tasks or copy the file into the repository.

- [ ] **Step 9: Commit Task 2**

```powershell
git add -- packages/core/src/taskImport/businessSheet.ts packages/core/src/taskImport/businessSheet.test.ts packages/core/src/taskImport/legacySheet.ts packages/core/src/taskImport/legacySheet.test.ts packages/core/src/taskImport/workbook.ts packages/core/src/taskImport/workbook.test.ts packages/core/src/taskImport/index.ts
git diff --cached --check
git commit -m "feat(tasks): accept unified business import sheets"
```

### Task 3: Generate the readable one-sheet workbook on the web

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/core/src/taskImport/workbook.ts`
- Modify: `packages/core/src/taskImport/workbook.test.ts`
- Modify: `packages/core/src/taskImport/index.ts`
- Create: `apps/web/src/features/tasks/import/template.ts`
- Create: `apps/web/src/features/tasks/import/template.test.ts`
- Modify: `apps/web/src/features/tasks/import/workbook.ts`
- Modify: `apps/web/src/pages/TaskBulkImportPage.tsx`

**Interfaces:**
- Consumes: `TASK_IMPORT_BUSINESS_COLUMNS`, `IDEAL_TASK_IMPORT_HEADERS`, and `parseTaskImportFile` from `@jewelos/core`.
- Produces: async `createTaskImportTemplateBytes(): Promise<ArrayBuffer>` loaded only when Download format is clicked.

- [ ] **Step 1: Write the failing generated-workbook test**

Use ExcelJS to inspect presentation metadata and SheetJS/core to prove parser
compatibility:

```ts
it("creates one readable Tasks worksheet whose example round-trips", async () => {
  const bytes = await createTaskImportTemplateBytes();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Tasks"]);
  const sheet = workbook.getWorksheet("Tasks")!;
  expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  expect(sheet.autoFilter).toEqual("A1:T2");
  expect(sheet.getRow(1).font.bold).toBe(true);
  expect(sheet.getCell("C1").note).toBeTruthy();

  const parsed = await parseTaskImportFile(readableFile(bytes), {
    defaultStartsOn: "2026-09-22",
  });
  expect(parsed.sourceFormat).toBe("ideal_business_sheet");
  expect(parsed.issues).toEqual([]);
  expect(parsed.draftRows).toHaveLength(1);
});
```

Assert exact column headers, widths bounded between 12 and 48, wrapped long-text
columns, required/optional header fills, and no extra worksheet.

- [ ] **Step 2: Run the template test and verify RED**

Run:

```powershell
pnpm.cmd --filter web exec vitest run src/features/tasks/import/template.test.ts
```

Expected: FAIL because ExcelJS and the async generator do not exist.

- [ ] **Step 3: Add the web-only workbook dependency**

Run:

```powershell
pnpm.cmd --filter web add exceljs@4.4.0
```

Verify that only `apps/web/package.json` and `pnpm-lock.yaml` change. Do not add
ExcelJS to core or mobile; parsing continues to use the existing shared `xlsx`
dependency.

Run `pnpm.cmd audit --prod` and compare any report with the pre-add baseline.
Do not accept a newly introduced high or critical production vulnerability;
if one appears, stop and revise the workbook-generation choice.

- [ ] **Step 4: Implement the async ExcelJS generator**

Create the workbook from the core descriptor:

```ts
import ExcelJS from "exceljs";
import { TASK_IMPORT_BUSINESS_COLUMNS } from "@jewelos/core";

export async function createTaskImportTemplateBytes(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JewelOS";
  const sheet = workbook.addWorksheet("Tasks", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = TASK_IMPORT_BUSINESS_COLUMNS.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width,
  }));
  sheet.addRow(Object.fromEntries(TASK_IMPORT_BUSINESS_COLUMNS.map((column) => [column.header, column.example])));
  sheet.autoFilter = "A1:T2";
  // Apply semantic required/optional fills, bold white header text, wrapped
  // example cells, thin borders, and each descriptor comment as a cell note.
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
```

Use existing task palette colors rather than a blue accent. Sanitize no runtime
data because the workbook contains only static sample values.

- [ ] **Step 5: Replace the Download format handler with a lazy download**

Keep ExcelJS out of the initial Tasks bundle:

```ts
const download = async () => {
  setBusy(true);
  setError(null);
  try {
    const { createTaskImportTemplateBytes } = await import("@/features/tasks/import/template");
    const bytes = await createTaskImportTemplateBytes();
    downloadBlob(bytes, "mk-jewels-task-bulk-import.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : "Unable to create the import format");
  } finally {
    setBusy(false);
  }
};
```

Remove `createTaskImportTemplate` from the web wrapper export and page import,
remove the old four-sheet generator and its obsolete four-sheet-generation test
from core, and retain canonical parsing exports/tests for existing files.

- [ ] **Step 6: Run template and parser tests and verify GREEN**

Run:

```powershell
pnpm.cmd --filter web exec vitest run src/features/tasks/import/template.test.ts src/features/tasks/import/workbook.test.ts
```

Expected: PASS; the generated file has one sheet and its example becomes one
business draft row.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- apps/web/package.json pnpm-lock.yaml packages/core/src/taskImport/workbook.ts packages/core/src/taskImport/workbook.test.ts packages/core/src/taskImport/index.ts apps/web/src/features/tasks/import/template.ts apps/web/src/features/tasks/import/template.test.ts apps/web/src/features/tasks/import/workbook.ts apps/web/src/pages/TaskBulkImportPage.tsx
git diff --cached --check
git commit -m "feat(tasks): generate readable import workbook"
```

### Task 4: Add web timing presets and route every draft format consistently

**Files:**
- Create: `apps/web/src/features/tasks/import/TimingPresetFields.tsx`
- Create: `apps/web/src/features/tasks/import/TimingPresetFields.test.tsx`
- Create: `apps/web/src/pages/TaskBulkImportPage.test.tsx`
- Modify: `apps/web/src/pages/TaskBulkImportPage.tsx`

**Interfaces:**
- Consumes: `TaskImportTimingPresets`, `TaskImportTimingPresetKey`, `isTaskImportDraftSourceFormat`, and parser `requiredTimingPresets`.
- Produces: `TimingPresetFields` with controlled `value`, `required`, `disabled`, and `onChange` props; the page reparses the retained browser `File` after each relevant timing change.

- [ ] **Step 1: Write failing timing-control tests**

```tsx
render(
  <TimingPresetFields
    disabled={false}
    onChange={onChange}
    required={["opening", "closing"]}
    value={{}}
  />,
);
expect(screen.getByLabelText("Opening start time")).toBeTruthy();
expect(screen.getByLabelText("Opening due time")).toBeTruthy();
expect(screen.getByLabelText("Closing start time")).toBeTruthy();
expect(screen.queryByLabelText("Morning start time")).toBeNull();
```

Add validation cases proving incomplete windows remain visible/invalid and a
due time not later than start does not enable import.

- [ ] **Step 2: Write the failing page integration test**

Mock `parseTaskImportFile` twice: first return a compact draft result requiring
`opening`, then return a valid draft after timings are entered. Assert the page:

- advertises all supported formats rather than only 18-column/canonical;
- renders opening controls only;
- calls the parser again with `defaultStartsOn` and `timingPresets`;
- recognizes all three draft source formats through
  `isTaskImportDraftSourceFormat`;
- enables `Import all 1 record` only after structural/timing issues clear;
- invokes the async download module when Download format is clicked.

- [ ] **Step 3: Run the focused web tests and verify RED**

Run:

```powershell
pnpm.cmd --filter web exec vitest run src/features/tasks/import/TimingPresetFields.test.tsx src/pages/TaskBulkImportPage.test.tsx
```

Expected: FAIL because the component and new page behavior do not exist.

- [ ] **Step 4: Implement the controlled timing component**

Render only required presets, using `<input type="time">` and semantic labels.
Update one immutable window at a time:

```ts
const update = (key: TaskImportTimingPresetKey, field: "startTime" | "dueTime", next: string) => {
  onChange({
    ...value,
    [key]: { startTime: value[key]?.startTime ?? "", dueTime: value[key]?.dueTime ?? "", [field]: next },
  });
};
```

Do not hide validation errors; use the same-day `HH:MM` rule from core to mark
incomplete windows.

- [ ] **Step 5: Integrate retained-file reparsing safely**

Store `requiredTimingPresets` and `timingPresets` separately. Pass both date and
timings on every parse. When a timing changes, reparse the retained `File`
without changing its label, raw persistence, or progress state. Guard against a
slower older parse overwriting a newer selection with a monotonically increasing
request id held in a ref.

Replace the one-format condition:

```ts
if (isTaskImportDraftSourceFormat(parsed.sourceFormat)) {
  setDraftRows(parsed.draftRows);
} else if (parsed.payload) {
  setPayload(parsed.payload);
}
```

Continue blocking import whenever issues or unresolved identity confirmations
remain.

- [ ] **Step 6: Run focused and adjacent web tests and verify GREEN**

Run:

```powershell
pnpm.cmd --filter web exec vitest run src/features/tasks/import/TimingPresetFields.test.tsx src/pages/TaskBulkImportPage.test.tsx src/features/tasks/import/identityMappings.test.ts src/features/tasks/import/ImportReadinessSummary.test.tsx src/features/tasks/import/chunkRunner.test.ts
```

Expected: PASS with stale parse results ignored.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- apps/web/src/features/tasks/import/TimingPresetFields.tsx apps/web/src/features/tasks/import/TimingPresetFields.test.tsx apps/web/src/pages/TaskBulkImportPage.tsx apps/web/src/pages/TaskBulkImportPage.test.tsx
git diff --cached --check
git commit -m "feat(tasks): configure import timing presets"
```

### Task 5: Preserve native import and checkpoint parity

**Files:**
- Create: `apps/mobile/src/features/taskImport/timingPresets.ts`
- Create: `apps/mobile/src/features/taskImport/timingPresets.test.ts`
- Modify: `apps/mobile/src/screens/TaskImportScreen.tsx`
- Modify: `apps/mobile/src/features/tasks/TaskCard.tsx` only if verification reveals generated delegation checkpoints are hidden
- Modify: `apps/mobile/src/screens/TaskDetailScreen.tsx` only if verification reveals generated delegation checkpoints are hidden

**Interfaces:**
- Consumes: the shared draft-source guard, required timing keys, timing preset types, and `DateField mode="time"`.
- Produces: pure `updateTaskImportTimingPreset` and `taskImportTimingWindowsValid` helpers used by the native screen.

- [ ] **Step 1: Write failing native timing-model tests**

```ts
it("updates one required time without discarding another preset", () => {
  const first = updateTaskImportTimingPreset({}, "opening", "startTime", "09:00");
  const second = updateTaskImportTimingPreset(first, "closing", "dueTime", "20:00");
  expect(second).toEqual({
    opening: { startTime: "09:00", dueTime: "" },
    closing: { startTime: "", dueTime: "20:00" },
  });
});

it("requires a later due time for every requested preset", () => {
  expect(taskImportTimingWindowsValid(["general"], {
    general: { startTime: "18:00", dueTime: "09:00" },
  })).toBe(false);
});
```

- [ ] **Step 2: Run the native focused test and verify RED**

Run from `apps/mobile`:

```powershell
npm.cmd test -- src/features/taskImport/timingPresets.test.ts
```

Expected: FAIL because the timing helper does not exist.

- [ ] **Step 3: Implement the pure timing helper and native controls**

Use `DateField mode="time"` for each required start/due pair. Retain the picked
file URI only as long as the screen is mounted, reparse after timing changes,
and pass `timingPresets` into `parseTaskImportFile`. Use
`isTaskImportDraftSourceFormat` instead of checking only
`mk_daily_checklist_csv`. Update the banner to describe the unified, six-column,
18-column, and existing canonical formats.

Do not add a mobile Download format button; this task preserves upload parity
and task rendering only.

- [ ] **Step 4: Verify generated checkpoints already render on both native task surfaces**

Use existing `TaskCard` and `TaskDetailScreen` fixtures with a delegation task
that has two checklist rows. If existing assertions already prove visibility
and toggling, add only a named regression case. Modify production components
only if the failing test proves a real parity gap.

- [ ] **Step 5: Run native tests and typecheck and verify GREEN**

Run from `apps/mobile`:

```powershell
npm.cmd test -- src/features/taskImport/timingPresets.test.ts src/features/taskImport/importSession.test.ts
npm.cmd run typecheck
```

Expected: PASS; TypeScript resolves the new shared parser types without adding
a mobile workbook-generation dependency.

- [ ] **Step 6: Commit Task 5**

```powershell
git add -- apps/mobile/src/features/taskImport/timingPresets.ts apps/mobile/src/features/taskImport/timingPresets.test.ts apps/mobile/src/screens/TaskImportScreen.tsx apps/mobile/src/features/tasks/TaskCard.tsx apps/mobile/src/screens/TaskDetailScreen.tsx
git diff --cached --check
git commit -m "feat(mobile): support unified task imports"
```

Stage only paths that actually changed; omit unchanged optional task-display
files from `git add`.

### Task 6: Update durable documentation and run the complete local gate

**Files:**
- Modify: `docs/TASKS_AND_BULK_IMPORT_HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-09-22-unified-task-import-workbook-design.md`
- Test: all focused and affected suites listed below

**Interfaces:**
- Consumes: completed core, web, and native behavior from Tasks 1-5.
- Produces: durable current-format documentation and evidence-backed local handoff.

- [ ] **Step 1: Update the durable handoff and specification status**

Document:

- the 20-column one-sheet download;
- the four accepted source formats;
- required/default field rules;
- timing preset behavior;
- the frequency categories and one-card checkpoint decision;
- the continued 2 MiB/2,500-row/100-row limits;
- that event-driven labels create manual As Required templates;
- the exact local verification achieved and any unverified browser/device or
  hosted state.

Change the spec status to `Implemented locally` only after all implementation
and focused verification steps pass.

- [ ] **Step 2: Run all focused core import tests**

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/taskImport.test.ts src/taskImport/frequency.test.ts src/taskImport/businessSheet.test.ts src/taskImport/workbook.test.ts src/taskImport/legacySheet.test.ts src/taskImport/identityMappings.test.ts src/taskImport/correctionReport.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Run the full core and web suites**

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
```

Expected: all tests PASS. Report unrelated historical failures separately; do
not weaken tests to force green.

- [ ] **Step 4: Run native tests, typechecks, and clean Metro export**

From `apps/mobile`:

```powershell
npm.cmd test
npm.cmd run typecheck
npx.cmd expo export --platform android --clear
```

Expected: tests and typecheck PASS; Expo export completes without unresolved
`xlsx` or core-module dependencies. This does not prove an installed APK or
device behavior.

- [ ] **Step 5: Run monorepo typecheck, web production build, and diff checks**

From the repository root:

```powershell
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
git status --short --branch
```

Expected: typecheck/build exit 0, diff check is clean, and only intended task
import/documentation paths plus the pre-existing untracked `sreejith-crm/`
appear.

- [ ] **Step 6: Perform workbook and browser-visible verification**

Start a fresh local web server and use the available in-app browser if a signed
in local session exists. Verify:

1. Download format creates one `.xlsx` with one `Tasks` worksheet.
2. Opening it programmatically with ExcelJS confirms freeze pane, filters,
   widths, comments, and header styles.
3. Uploading the newly downloaded workbook reaches a one-record readiness
   preview rather than canonical missing-field errors.
4. Uploading a sanitized six-column fixture exposes only the timing presets it
   needs and preserves record count.
5. Unsupported frequency text produces one grouped correction.

If authenticated browser access or a desktop spreadsheet renderer is
unavailable, record that limitation precisely; automated workbook inspection
does not equal visual Excel proof.

- [ ] **Step 7: Review security and protected behavior before the final commit**

Confirm the staged diff contains no source spreadsheet content, employee names,
emails, secrets, service-role values, `.env`, `.supabase`, or exports. Confirm
there is no browser-side insert, role-derived authorization, fuzzy header
mapping, identity fill-down, or raw row persistence.

- [ ] **Step 8: Commit Task 6**

```powershell
git add -- docs/TASKS_AND_BULK_IMPORT_HANDOFF.md docs/superpowers/specs/2026-09-22-unified-task-import-workbook-design.md
git diff --cached --check
git commit -m "docs(tasks): record unified import contract"
```

- [ ] **Step 9: Run final verification against committed HEAD**

Rerun the smallest decisive set after the documentation commit:

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/taskImport/frequency.test.ts src/taskImport/businessSheet.test.ts src/taskImport/workbook.test.ts
pnpm.cmd --filter web exec vitest run src/features/tasks/import/template.test.ts src/features/tasks/import/TimingPresetFields.test.tsx src/pages/TaskBulkImportPage.test.tsx
git diff --check
git status --short --branch
```

Expected: all focused tests PASS, no unstaged implementation changes remain,
and the unrelated `sreejith-crm/` directory is still untouched.
