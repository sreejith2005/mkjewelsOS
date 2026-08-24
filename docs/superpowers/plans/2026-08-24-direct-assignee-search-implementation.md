# Direct Assignee Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete direct, tenant-wide searchable person assignment for CRM and FMS while deriving assignee-owned scope server-side.

**Architecture:** The web app supplies only an eligible profile ID through the shared picker. Migration `0087` retains compatible RPC signatures, ignores caller-supplied assignee scope, loads and validates the selected profile under the existing security-definer boundary, and writes derived scope plus the existing transactional audit and coverage behavior.

**Tech Stack:** React/Vite, TypeScript, Supabase Postgres RPC/RLS, pgTAP, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-direct-assignee-search-design.md`

## Global Constraints

- Preserve independent CRM client/visit branch and FMS workflow scope fields.
- Do not change applied migrations; use one reviewed forward migration `0087`.
- Never allow cross-tenant, inactive, resigned, suspended, or login-disabled assignees.
- Preserve 0086 original-to-primary-to-secondary absence coverage and existing feeds.
- Preserve the six pre-existing responsive UI edits outside the direct-assignment overlap.

---

### Task 1: Prove and complete picker integration

**Files:**
- Modify: `apps/web/src/components/assignees/AssigneePicker.tsx`
- Modify: `apps/web/src/features/crm/{api.ts,types.ts,ClientForm.tsx,ClientDetail.tsx,WalkinForm.tsx,FollowupsPanel.tsx}`
- Modify: `apps/web/src/features/fms/{api.ts,FmsFlowBuilder.tsx,FmsStageRunner.tsx,startScope.ts}`
- Test: relevant CRM/FMS component tests

- [ ] Write failing component tests for cross-branch person discovery, organization labels, and selection without a preselected scope.
- [ ] Run the focused Vitest files and observe those assertions fail on the old cascades.
- [ ] Expand roster references and replace assignment-only selects with the shared single-user picker; retain independent branch/scope controls.
- [ ] Re-run focused Vitest tests and typecheck.

### Task 2: Add the authoritative database contract

**Files:**
- Create: `supabase/migrations/0087_direct_assignee_search.sql`
- Create: `supabase/tests/0087_direct_assignee_search.test.sql`
- Modify: `packages/api-client/src/database.types.ts` after local type generation

- [ ] Write pgTAP cases for authorized same-tenant cross-branch assignment, derived scope, inactive/login-disabled/cross-tenant denials, audit rows, and 0086 buddy coverage.
- [ ] Run the new test against the pre-0087 local schema and observe expected failures.
- [ ] Explicitly recreate the listed CRM/FMS functions, validate active login-enabled profiles and module authority, derive assignee scope, preserve independent CRM branch validation, concurrency, coverage, and audit behavior.
- [ ] Reset local Supabase, generate types, and run the new and regression pgTAP suites.

### Task 3: Release verification and publication

**Files:**
- Stage only direct-assignee implementation, test, generated-type, and plan paths.

- [ ] Run focused web tests, required pgTAP tests, full web typecheck/test/build, and `git diff --check`.
- [ ] Review named staged paths and run the staged credential-pattern scan without printing sensitive values.
- [ ] Commit and push `origin/main`; verify remote parity.
- [ ] Run linked migration list and dry-run. Apply only when exactly `0087` is pending, then verify the linked migration list.
