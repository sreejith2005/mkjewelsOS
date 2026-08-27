# Zero-Touch Task Import and Assigning Left Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the final checklist with automatic exact matching, a durable admin-only Assigning Left queue, and duplicate-safe overlapping uploads.

**Architecture:** Pure normalization and preview matching live in TypeScript; Postgres resolves identities again, owns assignment state, reserves tenant-wide business fingerprints, and audits queue assignment. The existing chunked import remains the transport and receives a forward-only upgrade.

**Tech Stack:** TypeScript 5.9, React 18, Vitest 4, Supabase/Postgres, pgTAP, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-08-27-zero-touch-task-import-design.md`

## Global Constraints

- Work only in the nested `jewelos` repository and preserve unrelated dirty task-card/task-page changes.
- Execute inline as explicitly requested; do not create a worktree.
- Use failing tests before production changes.
- Add migration `0104`; never modify applied migrations.
- Keep file limits at 2 MiB, 2,500 rows, and 100-row chunks.
- Do not persist or log raw files, task text, employee names, or employee emails in import metadata.
- Treat RLS/RPC authorization as the boundary; UI gates are usability only.

---

### Task 1: Pure import normalization and matching

**Files:**
- Modify: `packages/core/src/taskImport.ts`
- Modify: `packages/core/src/taskImport.test.ts`
- Modify: `apps/web/src/features/tasks/import/legacySheet.ts`
- Modify: `apps/web/src/features/tasks/import/legacySheet.test.ts`
- Modify: `apps/web/src/features/tasks/import/identityMappings.ts`
- Modify: `apps/web/src/features/tasks/import/identityMappings.test.ts`

**Interfaces:**
- Produces: canonical rows with `assignment_status`, grouped-field normalization, one default start date, exact preview matches, and deduplicated issues.

- [ ] Add failing tests proving identity never fills down, only approved context fields fill down, the default start date removes blank-date errors, and unmatched identities become `assigning_left` without blocking.
- [ ] Run the focused core/web tests and confirm failures name the missing behavior.
- [ ] Implement the smallest pure functions and parser changes.
- [ ] Re-run focused tests until green.

### Task 2: Protected persistence, fingerprints, and assignment RPCs

**Files:**
- Create: `supabase/migrations/0104_zero_touch_task_import_and_assigning_left.sql`
- Create: `supabase/tests/0104_zero_touch_task_import_and_assigning_left.test.sql`

**Interfaces:**
- Produces: `assignment_status`, `task_import_row_registry`, upgraded chunk commit, `list_assigning_left_tasks`, and `assign_imported_task_with_audit`.

- [ ] Write pgTAP contracts for anonymous/ordinary/manager denial, admin visibility, unassigned one-time and recurring creation, exact-name and manager-verifier fallback, audited later assignment, and cross-batch replay.
- [ ] Run the focused pgTAP file and confirm RED against migration `0103`.
- [ ] Add migration `0104` with constraints, indexes, RLS, minimal grants, metadata-only registry, server resolution, and audited RPCs.
- [ ] Reset local Supabase and run `0101`, `0103`, and `0104` tests until green; run database lint.

### Task 3: Simplified import and Assigning Left UI

**Files:**
- Modify: `apps/web/src/features/tasks/import/api.ts`
- Modify: `apps/web/src/features/tasks/import/api.test.ts`
- Modify: `apps/web/src/pages/TaskBulkImportPage.tsx`
- Create: `apps/web/src/pages/TaskBulkImportPage.test.tsx`
- Create: `apps/web/src/features/tasks/import/AssigningLeftPanel.tsx`
- Create: `apps/web/src/features/tasks/import/AssigningLeftPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify carefully: `apps/web/src/pages/TasksPage.tsx`
- Modify: `packages/core/src/roleMenu.ts`
- Modify: `packages/core/src/roleMenu.test.ts`

**Interfaces:**
- Consumes: `list_assigning_left_tasks` and `assign_imported_task_with_audit`.
- Produces: one-date upload workflow, compact grouped issue summaries, and an admin-only `/tasks/assigning-left` workspace.

- [ ] Add failing API/component/route tests for the compact import experience and assignment queue.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the API wrappers, import summary, queue, guarded route, and admin entry while preserving existing user edits in `TasksPage.tsx`.
- [ ] Run focused tests until green.

### Task 4: Generated contracts and release verification

**Files:**
- Modify: `packages/api-client/src/database.types.ts`
- Modify: `packages/core/src/database.types.ts`
- Modify: `docs/superpowers/plans/2026-08-27-zero-touch-task-import.md`

**Interfaces:**
- Produces: synchronized generated types and recorded release evidence.

- [ ] Regenerate types from the reset local database and verify both generated files are identical.
- [ ] Run focused tests, full core/web tests, typecheck, build, database tests/lint, and `git diff --check`.
- [ ] Inspect the complete diff, staged paths, secrets/PII scan, and preserve unrelated changes.
- [ ] Read the production playbook, compare linked migration history, run linked dry-run, apply migration `0104`, verify hosted history, commit only approved paths, and push `main` to GitHub.
- [ ] Record exact local, hosted Supabase, Git, and unverified browser/Vercel proof boundaries.
