# Recurring / To-Do Assignment Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the screenshot-style recurring task assignment composer with real due-time and profile-coverage behavior.

**Architecture:** A forward migration expands the existing recurring template contract. The audited RPC remains the only writer; React maps the operational form into that contract and derives organizational scope from the selected active employee.

**Tech Stack:** React 18, TypeScript, Vitest, Supabase/Postgres, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-22-recurring-todo-assignment-composer-design.md`

## Global Constraints

- Work only in the JewelOS repository and preserve historical schedules and instances.
- Keep Tasks one-off only; this composer is exclusive to Recurring / To-Do.
- Use profile-owned Primary Buddy, Secondary Buddy, then Reporting Manager; never author per-schedule buddies.
- All protected writes remain authorized and audited server-side.
- Use a forward-only migration; do not apply hosted changes without explicit approval.

### Task 1: Database contract

**Files:** Create `supabase/migrations/0085_recurring_todo_assignment_composer.sql`; create `supabase/tests/0085_recurring_todo_assignment_composer.test.sql`.

- [ ] Write pgTAP assertions for `due_time`, `coverage_enabled`, secure RPC validation, and enabled/disabled coverage behavior.
- [ ] Run the test and confirm it fails before the migration exists.
- [ ] Add the compatible columns, indexes if the instance query needs one, RPC updates, and minimum grants.
- [ ] Reset locally and run the focused pgTAP test.

### Task 2: Types and form payload

**Files:** Modify both database type files; modify `apps/web/src/features/tasks/TaskForms.tsx`; add focused TaskForms tests.

- [ ] Write failing UI tests for the three operational groups, profile-derived scope, due-time validation, Upload completion type, and coverage wording.
- [ ] Update generated types from the local schema.
- [ ] Implement the typed payload mapper and form controls.
- [ ] Run the focused tests until green.

### Task 3: Workspace integration and regression checks

**Files:** Modify `apps/web/src/pages/RecurringTodoPage.tsx` and its test; modify worker/core tests only if the new contract requires it.

- [ ] Write a failing page test for opening the new assignment composer in Recurring / To-Do.
- [ ] Wire the modal, user-safe errors, loading state, and refresh-after-save behavior.
- [ ] Run focused core, web, and pgTAP checks; then typecheck/build and `git diff --check`.
