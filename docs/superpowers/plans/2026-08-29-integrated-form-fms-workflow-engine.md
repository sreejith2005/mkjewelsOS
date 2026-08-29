# Integrated Form, FMS, and Task Workflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend JewelOS's existing real Forms, Dropdown Master, FMS and Tasks contracts into one reliable, version-safe workflow engine.

**Architecture:** Preserve the current versioned tables and protected RPCs, adding compatible rule/option metadata and new transactional FMS RPCs. FMS stage work stays distinct from normal tasks and is surfaced by authorized server aggregates.

**Tech Stack:** React 18/Vite, strict TypeScript, Vitest, Supabase Postgres/RLS/SECURITY DEFINER RPCs, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-29-integrated-form-fms-workflow-engine-design.md`

## Global Constraints

- Use only the nested `jewelos` repository; preserve unrelated dirty work.
- Add only forward migrations; never edit applied migrations or production data.
- Keep existing form/FMS versions, submissions, task instances and audit history readable.
- Every sensitive mutation is a server-authorized, audited transaction; frontend checks are UX only.
- Keep pure rules in `packages/core`; do not add mock data or client-side backend logic.
- Generate database types after schema changes and validate local/hosted evidence separately.

---

### Task 1: Shared structured rule and form-option definitions

**Files:**
- Modify: `packages/core/src/forms/types.ts`, `definition.ts`, `visibility.ts`, `validation.ts`, `index.ts`
- Modify: `packages/core/src/forms/forms.test.ts`

**Interfaces:**
- Produces `FormRule`, `FormRuleGroup`, `evaluateFormRule(rule, answers)`, and field option source metadata.
- Legacy `FormCondition` is normalized to a one-leaf rule.

- [ ] Write tests for nested AND/OR, `in`, `not_in`, emptiness, hidden-required omission and legacy-condition compatibility.
- [ ] Run `pnpm.cmd --filter @jewelos/core test -- forms` and verify new tests fail before the implementation.
- [ ] Implement pure, total rule evaluation with no JavaScript expression evaluation, typed operands, and sequential normalized-answer visibility.
- [ ] Extend definition validation to verify field keys, operator/value shapes, target existence/order, and valid manual/master option metadata.
- [ ] Run the focused core tests, then the full core suite.

### Task 2: Forward database contract for form master references and FMS mutations

**Files:**
- Create: `supabase/migrations/0112_integrated_form_fms_workflow_engine.sql`
- Create: `supabase/tests/0112_integrated_form_fms_workflow_engine.test.sql`
- Modify: `packages/core/src/database.types.ts`, `packages/api-client/src/database.types.ts`

**Interfaces:**
- Adds non-destructive form-field option source metadata, idempotency records and indexed FMS runtime access.
- Produces protected RPCs `submit_fms_stage_and_progress_with_audit` and `get_my_fms_task_dashboard`.

- [ ] Write pgTAP cases for unauthenticated/cross-tenant rejection, same-key idempotency, first-match ordering, retry history, terminal closure, parallel creation, and audit rows.
- [ ] Run the test file locally after `supabase.cmd db reset` and confirm failing contract assertions.
- [ ] Implement RLS, minimum grants, tenant/profile checks, row locking, bounded JSON validation, action idempotency and audit writes in the migration.
- [ ] Add partial/composite indexes only for active authorized FMS-stage dashboard predicates.
- [ ] Refresh generated types and run the pgTAP file plus `supabase.cmd db lint --local --level warning`.

### Task 3: Transactional FMS submission clients and dashboard loader

**Files:**
- Modify: `apps/web/src/features/fms/api.ts`, `apps/web/src/features/fms/FmsStageRunner.tsx`
- Modify: `apps/web/src/features/fms/api.test.ts`, `apps/web/src/features/fms/FmsStageRunner.test.tsx`
- Create: `apps/web/src/features/fms/taskDashboard.ts`

**Interfaces:**
- Consumes Task 2 RPCs.
- Produces a one-call form-submit/progress action with a per-attempt idempotency UUID and typed paginated dashboard query.

- [ ] Write UI/API tests that assert one RPC is invoked for stage form submit and repeated click reuses the same mutation key.
- [ ] Run focused web tests and observe failure.
- [ ] Replace the separate submit/complete client sequence only for eligible FMS stage forms; leave normal task form submissions unchanged.
- [ ] Add retry-safe success/error state and refetch only after a successful server response.
- [ ] Run focused web tests and `pnpm.cmd --filter web typecheck`.

### Task 4: FMS task dashboard and route repair

**Files:**
- Modify: `apps/web/src/App.tsx`, `apps/web/src/pages/FMSTasksPage.tsx`
- Modify: `apps/web/src/pages/FMSTasksPage.test.tsx`

**Interfaces:**
- Consumes the authorized dashboard and paging contract from Task 2.
- Restores `fms_tasks -> FMSTasksPage` while `fms_builder -> FMSBuilderPage` remains unchanged.

- [ ] Write tests for router selection and flow/stage group filtering.
- [ ] Replace capped client-side count derivation with server dashboard totals while retaining the existing runner and timeline on selection.
- [ ] Add compact mobile cards, flow/stage filters and explicit FMS task labels without mixing normal tasks.
- [ ] Run focused web tests and build.

### Task 5: Builder and renderer integration

**Files:**
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`, `FormRenderer.tsx`, `api.ts`
- Modify: `apps/web/src/features/fms/FmsStageEditor.tsx`, `FmsGraphCanvas.tsx`
- Modify: corresponding Vitest files

**Interfaces:**
- Consumes structured rules and option-source metadata from Tasks 1–2.
- Uses current Dropdown Master values when editing and stores stable source IDs/snapshots in the form definition.

- [ ] Add tests for source selection, grouped conditions, hidden-required renderer behavior and stable published snapshots.
- [ ] Implement progressive builder controls; retain current manual options and legacy forms unchanged.
- [ ] Add stage route order, retry and terminal configuration controls to the existing graph editor rather than replacing the canvas.
- [ ] Run focused Forms/FMS tests, typecheck, build, and browser responsive QA.

### Task 6: Regression and release evidence

**Files:**
- Modify only generated types/documentation resulting from verified schema changes.

- [ ] Run `supabase.cmd test db`, core tests, web tests, Turbo typecheck/build, and `git diff --check`.
- [ ] Record baseline failures separately; do not weaken unrelated assertions.
- [ ] Before any linked operation, read `PRODUCTION_SWITCH_PLAYBOOK.md`, verify target, run `supabase.cmd db push --linked --dry-run`, and stop if it would apply unexpected changes.
- [ ] Deploy only after approval under the production playbook and report Git, Supabase, Vercel and authenticated UI evidence separately.
