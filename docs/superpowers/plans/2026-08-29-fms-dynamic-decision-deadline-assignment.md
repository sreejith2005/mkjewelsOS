# FMS Dynamic Decision, Deadline, and Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FMS decisions, deadlines/TAT, conditional routing, and default assignees fully data-driven and durable.

**Architecture:** Extend the existing JSON `planned_time_rule` contract in the shared FMS domain while preserving legacy `yes_no` and `tatHours` data. Add one forward-only migration that validates and executes the expanded contract server-side, plus a tenant-scoped context-to-user mapping that supplies persisted stage assignee rules.

**Tech Stack:** TypeScript, React/Vite, Vitest, Supabase Postgres/PLpgSQL, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-29-fms-dynamic-decision-deadline-assignment-design.md`

## Global Constraints

- Work only in the nested `jewelos` repository; do not alter unrelated dirty files.
- Preserve old `yes_no`, `yes`/`no`, and `tatHours` workflow data when loading and running it.
- Runtime decisions compare configured option keys and must not test for specific labels or values.
- `deadlineEnabled: false` produces no deadline, rather than a zero-duration deadline.
- Mapping values are selected by profile ID from Users; no employee name is used in runtime logic.
- New persistent data and sensitive mutations require RLS, server authorization, audit logging, and a forward-only migration.

---

### Task 1: Extend the shared FMS definition contract

**Files:**
- Modify: `packages/core/src/fms/types.ts`
- Modify: `packages/core/src/fms/engine.ts`
- Modify: `packages/core/src/fms/fms.test.ts`

**Consumes:** Existing `FmsSlaRule`, `normalizeFmsDefinition`, and `validateFmsDefinition`.

**Produces:** `FmsDecisionOption`, `decisionMode: "decision"`, `decisionOptions`, `deadlineEnabled`, `tatMinutes`, `tatUnit`, and the generic decision conditional shape `{ decisionStageKey, decisionOptionKey }`.

- [ ] **Step 1: Write failing core tests** for default/legacy decision normalization, custom-option validation, stale-option rejection, disabled deadlines, and hour/minute normalization.

```ts
expect(normalizeFmsDefinition(flow([decisionStage])).stages[1]?.sla.decisionOptions)
  .toEqual([{ key: "yes", label: "Yes" }, { key: "no", label: "No" }]);
expect(validateFmsDefinition(flow([decisionStage, conditionalWithMissingKey])))
  .toContainEqual(expect.objectContaining({ code: "invalid_conditional" }));
```

- [ ] **Step 2: Run the focused core test** and confirm it fails because the fields/validation do not exist.

Run: `pnpm.cmd --filter @jewelos/core test -- fms.test.ts`

- [ ] **Step 3: Implement the minimal shared contract**: normalize legacy fields into the new representation, validate option identity/labels and cross-stage references, and expose minute conversion without changing generic branch operators.

- [ ] **Step 4: Re-run the focused core test** and confirm it passes.

- [ ] **Step 5: Commit only the core files** with message `feat: make FMS decision and timing rules data-driven`.

### Task 2: Add server-side schema, persistence, and runtime enforcement

**Files:**
- Create: `supabase/migrations/0113_fms_dynamic_decisions_deadlines_and_assignments.sql`
- Create: `supabase/tests/0113_fms_dynamic_decisions_deadlines_and_assignments.test.sql`
- Modify: `packages/api-client/src/database.types.ts` only if generated types are available and the current file is restored by its owner.

**Consumes:** Task 1 JSON contract and existing `save_fms_flow_draft_with_audit`, `assert_fms_flow_publishable`, `fms_stage_deadline_for_instance`, `activate_fms_stage_internal`, and `complete_fms_stage_with_audit`.

**Produces:** A tenant-scoped `fms_context_assignee_defaults` mapping, audited mapping mutation RPC, persisted `module_context` on FMS flows, valid null deadlines, dynamic outcome validation, and publication-time stale-condition protection.

- [ ] **Step 1: Write pgTAP assertions first** for RLS/grants, inactive/mismatched mapping rejection, a disabled deadline returning null, custom option publication, and stale option publication rejection.

```sql
select is(public.fms_stage_deadline_for_instance('{"deadlineEnabled":false}'::jsonb, tenant_id, instance_id), null, 'disabled deadline is null');
select throws_like($$select public.assert_fms_flow_publishable(flow_id)$$, '%valid decision option%', 'stale decision option blocks publication');
```

- [ ] **Step 2: Run the focused pgTAP suite** against a fresh local Supabase database and confirm failure before the migration is applied.

Run: `supabase.cmd test db --file supabase/tests/0113_fms_dynamic_decisions_deadlines_and_assignments.test.sql`

- [ ] **Step 3: Implement one forward-only migration**. Add the mapping table with tenant RLS/policies, secure audited RPC, `module_context` persistence in the existing draft-save RPC, and replacement functions that accept legacy and expanded JSON while returning null for disabled deadlines and validating generic option keys.

- [ ] **Step 4: Re-run pgTAP** and confirm the suite passes. Also run database lint if the local service is available.

Run: `supabase.cmd test db --file supabase/tests/0113_fms_dynamic_decisions_deadlines_and_assignments.test.sql`

- [ ] **Step 5: Commit only the migration and pgTAP test** with message `feat: enforce dynamic FMS workflow rules`.

### Task 3: Update FMS builder loading, editing, and defaulting

**Files:**
- Modify: `apps/web/src/features/fms/api.ts`
- Modify: `apps/web/src/features/fms/definition.ts`
- Modify: `apps/web/src/features/fms/FmsStageEditor.tsx`
- Modify: `apps/web/src/features/fms/FmsFlowBuilder.tsx`
- Modify: `apps/web/src/features/fms/graph.ts`
- Modify: `apps/web/src/features/fms/FmsStageEditor.test.tsx`
- Modify: `apps/web/src/features/fms/definition.test.ts`
- Modify: `apps/web/src/pages/FMSBuilderPage.test.tsx` when its mocked FMS data needs the expanded contract.

**Consumes:** Task 1 domain types and Task 2 mapping/read contract.

**Produces:** Decision-option controls, deadline ON/OFF control, hours/minutes selector, dynamic prior-decision picker, visible stale-condition error, context mapping picker sourced from Users, and stage rules prefilled from the persisted selected-user mapping.

- [ ] **Step 1: Write failing UI tests** for adding/renaming/reordering/removing a decision option, minute TAT UI, disabled deadline UI, dynamic decision values, and inherited CRM default assignment.

```tsx
await user.click(screen.getByRole("button", { name: "Decision step" }));
await user.click(screen.getByRole("button", { name: "Add decision option" }));
expect(screen.getByLabelText("Run when answer is")).toHaveTextContent("Call Back Required");
```

- [ ] **Step 2: Run the focused web tests** and confirm each new assertion fails for the missing UI/behavior.

Run: `pnpm.cmd --filter web test -- FmsStageEditor.test.tsx definition.test.ts`

- [ ] **Step 3: Implement the narrow UI changes**. Use stable option keys, clear disabled-deadline fields, and select assignee IDs from the existing loaded `user_profiles` list. When a context mapping is absent, show the normal assignee picker rather than inventing an assignee.

- [ ] **Step 4: Re-run focused web tests** and confirm they pass.

- [ ] **Step 5: Commit only the FMS web files** with message `feat: configure dynamic FMS decisions and defaults`.

### Task 4: Verify the integrated contract and publish safely

**Files:**
- Modify only test files identified by actual failures in Tasks 1–3.

**Consumes:** Completed core, database, and web changes.

**Produces:** Evidence that the Instagram path routes only the selected dynamic option, disabled deadlines remain null, and selected CRM default assignees persist.

- [ ] **Step 1: Run all focused test suites**.

Run: `pnpm.cmd --filter @jewelos/core test -- fms.test.ts; pnpm.cmd --filter web test -- FmsStageEditor.test.tsx FMSBuilderPage.test.tsx definition.test.ts; supabase.cmd test db --file supabase/tests/0113_fms_dynamic_decisions_deadlines_and_assignments.test.sql`

- [ ] **Step 2: Run static checks and build**.

Run: `pnpm.cmd --filter @jewelos/core typecheck; pnpm.cmd --filter web typecheck; pnpm.cmd --filter web build`

- [ ] **Step 3: Manually exercise the configured Instagram flow** in the local app: Decision options Call Connected/Call Not Connected/Call Back Required; deadline disabled; Demonstration condition on Call Connected; then change options and verify the selector/validation updates.

- [ ] **Step 4: Confirm CRM behavior using the Users-selected Riya Mahto mapping**: create a CRM-context flow, verify its human stages inherit her profile ID, override one stage, save/reload, and confirm both values persist.

- [ ] **Step 5: Stage only reviewed FMS paths**, inspect `git diff --cached --check` and the staged secret scan, commit final test adjustments if any, then push `main`.

Run: `git add -- <reviewed paths>; git diff --cached --check; git push origin main`
