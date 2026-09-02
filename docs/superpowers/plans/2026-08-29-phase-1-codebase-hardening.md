# Phase 1 Codebase Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reliable source-validation baseline and remove only source proven unused, without changing JewelOS business or database behaviour.

**Architecture:** Retain the existing runtime and database architecture. This plan changes test mechanics, repository automation, source ownership, and operational documentation only; it does not alter Supabase contracts or browser workflow behaviour.

**Tech Stack:** pnpm 11, Turbo, TypeScript, Vitest, React Testing Library, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-29-phase-1-codebase-hardening-design.md`

## Global Constraints

- Work only in `C:\Users\MIS\Downloads\MKJewelOS\jewelos` on `main`.
- Preserve all existing migrations and do not run hosted Supabase commands.
- Do not change RLS, RPC, Edge Function, Auth, Storage, customer data, or the retirement operation's production behaviour.
- Keep `packages/core` as the sole generated database-type owner.
- Stage named approved paths only; do not use `git add -A`.

---

### Task 1: Stabilize the protected retirement-card test

**Files:**
- Modify: `apps/web/src/features/settings/ProductionDemoDataRetirementCard.test.tsx`

**Interfaces:**
- Consumes: `ProductionDemoDataRetirementCard` props `onPreview` and `onExecute`.
- Produces: a deterministic regression test that asserts preview and execution gates.

- [ ] **Step 1: Run the existing focused test and record its result**

Run: `pnpm.cmd --filter web exec vitest run src/features/settings/ProductionDemoDataRetirementCard.test.tsx`

Expected: existing assertions execute; the test may expose the full-suite timing problem.

- [ ] **Step 2: Replace scheduled typing with direct controlled-input events**

Use `fireEvent.change` for `Backup reference` and `Confirmation`, plus
`fireEvent.click` for the acknowledgement and buttons. Retain `findByText` for
the asynchronous preview result and retain the exact executor-argument
assertion.

- [ ] **Step 3: Run the focused test**

Run: `pnpm.cmd --filter web exec vitest run src/features/settings/ProductionDemoDataRetirementCard.test.tsx`

Expected: 2 tests pass.

### Task 2: Add source-only CI gates

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: locked `pnpm-lock.yaml`, workspace scripts, and GitHub-hosted Ubuntu runners.
- Produces: required repeatable install, tests, typecheck, build, and whitespace checks.

- [ ] **Step 1: Create the CI workflow**

Configure `push` and `pull_request`; use Node 20 and pnpm 11.20.0; run a
frozen install, core tests, web tests, serial Turbo typecheck/build, and
`git diff --check`. Do not configure credentials, hosted URLs, or Supabase
linking.

- [ ] **Step 2: Validate workflow syntax and command availability locally**

Run: `pnpm.cmd --filter @jewelos/core test`

Expected: the CI command is a valid local workspace command and all core tests pass.

### Task 3: Remove proven-unused source

**Files:**
- Delete: `apps/web/src/features/tasks/DelegateTaskModal.tsx`
- Delete: `packages/api-client/src/database.types.ts`

**Interfaces:**
- Consumes: the active TypeScript import graph and `@jewelos/api-client` public exports.
- Produces: one authoritative generated database type definition in `packages/core`.

- [ ] **Step 1: Prove both files have no consumers**

Run: `rg -n 'DelegateTaskModal|database\.types' apps packages --glob '*.{ts,tsx}'`

Expected: no source import of `DelegateTaskModal`; database types are exported from `packages/core/src/index.ts` and imported by API client from `@jewelos/core`.

- [ ] **Step 2: Delete the two files**

Remove only the named files. Do not change generated types in
`packages/core/src/database.types.ts`.

- [ ] **Step 3: Run focused type checks**

Run: `pnpm.cmd --filter @jewelos/api-client typecheck`

Expected: API client compiles using the `@jewelos/core` database type export.

### Task 4: Correct operational source inventory

**Files:**
- Modify: `PROJECT_HANDOFF.md`
- Modify: `PRODUCTION_SWITCH_PLAYBOOK.md`

**Interfaces:**
- Consumes: checked-in migration filenames through `0109` and the current Git checkpoint.
- Produces: source documentation that does not mislead release operators about migration coverage.

- [ ] **Step 1: Update only stale source statements**

Replace migration-through-`0070` statements with `0109`; add concise ranges for
`0071-0109`; update the source-audit date/checkpoint to the current commit;
retain all warnings that source does not prove hosted state.

- [ ] **Step 2: Verify documentation facts against source**

Run: `Get-ChildItem supabase\migrations -File | Sort-Object Name | Select-Object -Last 1`

Expected: `0109_recurring_todo_reference_parity.sql`.

### Task 5: Full source validation

**Files:**
- Verify: files from Tasks 1-4

- [ ] **Step 1: Run source validation**

Run: `pnpm.cmd --filter @jewelos/core test`

Run: `pnpm.cmd --filter web test`

Run: `pnpm.cmd exec turbo run typecheck --force --concurrency=1`

Run: `pnpm.cmd exec turbo run build --force --concurrency=1`

Run: `git diff --check`

Expected: all completed commands exit successfully; document any unavailable or failing check without claiming it passed.
