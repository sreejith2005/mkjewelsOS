# Task Bulk Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, validate-first Excel bulk-import workspace for one-time and recurring tasks.

**Architecture:** A focused import domain converts the fixed workbook into a canonical payload and a hash. The browser provides immediate structural feedback, while Supabase validates and imports the payload through audited, RLS-scoped RPCs. The full-page route displays the workflow and authorized batch summaries.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, SheetJS `xlsx`, Supabase Postgres/RPC/RLS, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-21-task-bulk-import-design.md`

## Global Constraints

- Support `.xlsx` download/upload and a CSV Tasks-sheet fallback; no Google OAuth.
- Limit a workbook to 1 MiB and 500 Tasks rows; never persist source workbook bytes or raw cells.
- Validate in the browser for feedback and revalidate in Postgres before every import.
- Import is atomic, idempotent by SHA-256 canonical-payload hash, and audited.
- Only active super admins, admins, and managers can operate the workflow; PostgreSQL enforces tenant and manager scope.
- Recurring rows create one named-assignee task template and its initial task instance; one-time rows allow semicolon-separated doer/watcher emails.

---

### Task 1: Define and test the canonical workbook import domain

**Files:**
- Create: `apps/web/src/features/tasks/import/workbook.ts`
- Create: `apps/web/src/features/tasks/import/workbook.test.ts`
- Modify: `apps/web/src/features/tasks/import/parseCsv.ts`
- Modify: `apps/web/src/features/tasks/import/normalizeRows.ts`
- Modify: `apps/web/src/features/tasks/import/parseCsv.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `TaskBulkImportPayload`, `TaskBulkImportIssue`, `parseTaskWorkbook(file)`, `createTaskImportTemplate()`, and `hashTaskImportPayload(payload)`.
- Consumes those interfaces in the API and page tasks below.

- [ ] Write failing Vitest cases for exact headers, duplicated/missing columns, `one_time` and `recurring` rows, checklist joins, semicolon email parsing, invalid schedule shape, unsafe formula cells, and a stable hash.
- [ ] Run `pnpm.cmd --filter web test -- workbook.test.ts` and confirm the new imports fail.
- [ ] Add `xlsx` as a direct web dependency, then implement fixed-sheet parsing and a template generator with `Read Me`, `Tasks`, `Checklist Items`, and `Reference Data` sheets.
- [ ] Canonicalize trimmed values, dates, recurrence fields, checklists, and sorted email lists before hashing; reject fields beginning with `=`, `+`, `-`, or `@`.
- [ ] Run the focused test suite; commit `feat: add task import workbook contract`.

### Task 2: Add an audited validate/import database contract

**Files:**
- Create: `supabase/migrations/0080_task_bulk_import_workspace.sql`
- Create: `supabase/tests/database/0080_task_bulk_import_workspace.test.sql`
- Modify: `packages/core/src/database.types.ts`

**Interfaces:**
- Produces `validate_task_bulk_import(jsonb,text)` and `import_task_bulk_with_audit(jsonb,text,text)`.
- Returns `{ valid, summary, issues, canonical_hash }` from validation and a batch summary from import.

- [ ] Write failing pgTAP assertions for unauthenticated denial, inactive/unauthorized-role denial, cross-tenant and manager branch denial, invalid user/form/category/date/recurrence rejection, atomic rollback, idempotency, history visibility, and audit totals.
- [ ] Run the database contract suite and confirm the new functions are unavailable.
- [ ] Add a forward-only migration that evolves `task_import_batches` with mode/outcome/validation summary fields, bounded-safe batch details, indexes, RLS, and minimum grants.
- [ ] Implement a shared SECURITY DEFINER validation helper and the two RPCs. Resolve all tenant/branch/department, people, forms, category, participant, checklist, and recurrence values in PostgreSQL. Reuse audited task/template contracts; keep raw cells and file bytes out of storage.
- [ ] Regenerate database types using the project’s established type-generation command; run the database test suite; commit `feat: add validated task bulk import rpc`.

### Task 3: Add typed import APIs and history loading

**Files:**
- Modify: `apps/web/src/features/tasks/import/api.ts`
- Create: `apps/web/src/features/tasks/import/api.test.ts`

**Interfaces:**
- Produces `loadTaskImportReferenceData()`, `validateTaskBulkImport(payload, hash)`, `submitTaskBulkImport(payload, hash, fileLabel)`, and `loadTaskImportBatches()`.
- Consumes `TaskBulkImportPayload` from Task 1 and RPC results from Task 2.

- [ ] Write failing tests for valid RPC argument serialization, error translation, and batch-summary decoding.
- [ ] Run `pnpm.cmd --filter web test -- api.test.ts` and confirm failure.
- [ ] Implement typed Supabase calls without direct table mutation and query only authorized batch-summary columns.
- [ ] Run focused API tests and typecheck; commit `feat: add task bulk import api`.

### Task 4: Build the dedicated bulk-import page

**Files:**
- Create: `apps/web/src/pages/TaskBulkImportPage.tsx`
- Create: `apps/web/src/pages/TaskBulkImportPage.test.tsx`
- Create: `apps/web/src/features/tasks/import/ImportValidationResults.tsx`
- Create: `apps/web/src/features/tasks/import/ImportHistory.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/TasksPage.tsx`
- Delete: `apps/web/src/features/tasks/import/TaskImportDialog.tsx`

**Interfaces:**
- `TaskBulkImportPage` loads reference data and batch summaries in parallel, owns the upload/validation/import state machine, and calls the API in Task 3.
- `/tasks/import` is an authenticated Tasks child route and preserves `/tasks` as the task-feed route.

- [ ] Write failing component tests proving download format invokes the workbook builder, invalid upload displays a safe error, Import remains disabled until validation has zero errors, validation shows row-level results, and history renders batch totals.
- [ ] Run `pnpm.cmd --filter web test -- TaskBulkImportPage.test.tsx` and confirm failure.
- [ ] Build the responsive page using existing design tokens: workflow steps, fixed-format guide, upload control, result metrics, issue table, preview table, and history cards/details. Avoid dynamic HTML and never show raw unauthorized reference data.
- [ ] Change the Tasks floating action to navigate to `/tasks/import`; lazy-load the new page in `App.tsx`; remove the obsolete modal route/state.
- [ ] Run component tests and `pnpm.cmd --filter web typecheck`; commit `feat: add task bulk import workspace`.

### Task 5: Run end-to-end validation and publish the reviewed branch

**Files:**
- Modify only files required by corrections found in this task.

- [ ] Run `pnpm.cmd --filter web test`, `pnpm.cmd --filter web typecheck`, and `pnpm.cmd --filter web build`.
- [ ] Run the new pgTAP database suite with the project’s local Supabase test command and record the exact result.
- [ ] Inspect the rendered `/tasks/import` route in the in-app browser: desktop/mobile layout, template download, structural upload rejection, valid validation state, import-disabled error state, and history state. If browser execution is unavailable, report the precise blocker rather than claiming visual QA.
- [ ] Run `git diff --check`, review only the branch changes, and scan staged source for credentials before publication.
- [ ] Merge the reviewed branch into `main`, push `main`, and verify `origin/main` matches the local published hash; commit any correction with a focused message.
