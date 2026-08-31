# Forms Routing Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Forms authoring full-width and make long conditional paths understandable through option-mapped routing controls.

**Architecture:** Keep existing Forms definitions and the core evaluator authoritative. Add pure helpers that project equality conditions and section branches into answer-route rows, then render those rows directly in `FormBuilder`. Preview becomes an explicit full-page mode using `FormRenderer`.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, `@jewelos/core` Forms types and evaluator.

**Spec:** `docs/superpowers/specs/2026-08-31-forms-routing-workspace-design.md`

## Global Constraints

- Do not add a migration, RPC, RLS, generated-type, audit, or dependency change.
- Preserve stable field keys, existing saved FormRules/branches, published forms, and respondent evaluation.
- Author routes only to later fields/sections; never create backward or self dependencies.
- Source answer choices come from the selected question's actual options; never require manual comparison text.
- Leave complex existing rules intact and visibly identify them rather than silently converting them.
- Preserve unrelated dirty work and stage only named Forms/doc paths if a later user asks for a commit.

---

### Task 1: Add a pure option-route projection and mutation helper

**Files:**
- Modify: `apps/web/src/features/forms/guidedConditions.ts`
- Modify: `apps/web/src/features/forms/guidedConditions.test.ts`

**Interfaces:**
- Consumes: `FormFieldDefinition`, `FormSectionDefinition`, and existing simple equality `FormRule` values.
- Produces: `AnswerRoute`, `readAnswerRoutes(fields, sections, sourceKey)`, and `setAnswerRoute(fields, sourceKey, optionValue, route)`.

- [ ] **Step 1: Write failing helper tests**

Add assertions that a Gold equality rule projects to its question route and that setting Silver to a later section writes its equality branch.

- [ ] **Step 2: Run test to verify it fails**

Run `pnpm.cmd --filter web exec vitest run src/features/forms/guidedConditions.test.ts`; expect missing route APIs.

- [ ] **Step 3: Implement minimal immutable route mutation**

Question routes reuse the simple equality-rule writer and remove that answer from other representable targets. Section/submit routes alter only the matching equality branch on the source field. Complex targets are not mutated.

- [ ] **Step 4: Run test to verify it passes**

Run `pnpm.cmd --filter web exec vitest run src/features/forms/guidedConditions.test.ts`; expect PASS.

### Task 2: Make conditional controls option-mapped and visible

**Files:**
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`
- Modify: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: route helper APIs, actual source `FormOption` values, and later field/section choices.
- Produces: visible per-answer routing table and direct source-option condition editor.

- [ ] **Step 1: Write failing Forms UI tests**

Assert a target question selects an earlier question first, then receives that source's options. Assert the Silver answer can map to a later section and emits readable routing text.

- [ ] **Step 2: Run test to verify it fails**

Run `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`; expect missing visible routing controls.

- [ ] **Step 3: Implement visible mapping controls**

Render `What happens after each answer?` for choose-one questions. Each option chooses Continue, a later question, a later section, or Submit. Render `Show this question when...` with source-question and source-option selects. Remove the Advanced details wrapper and raw editor from normal authoring; show complex conditions non-editably.

- [ ] **Step 4: Run test to verify it passes**

Run `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`; expect PASS.

### Task 3: Add routing overview and full-page preview mode

**Files:**
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`
- Modify: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: answer-route helpers and the normalized form definition.
- Produces: grouped readable routing overview and Preview/Close preview workspace mode.

- [ ] **Step 1: Write failing UI tests**

Assert `Gold -> Ask Gold purity` is visible. Assert Preview form changes to a full-form mode with Close preview, and closing restores the mapping table.

- [ ] **Step 2: Run test to verify it fails**

Run `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`; expect current preview panel/modal behavior to fail these assertions.

- [ ] **Step 3: Implement workspace preview and overview**

Use the FMS builder's full-page sticky-header pattern. Render `FormRenderer` only in preview mode with Close preview. Render grouped readable answer rows instead of adding a graph dependency.

- [ ] **Step 4: Run test to verify it passes**

Run `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`; expect PASS.

### Task 4: Prove nested respondent paths and release quality

**Files:**
- Modify: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: multi-level route controls and `FormRenderer`.
- Produces: coverage for three-level conditional forms and option-specific sections.

- [ ] **Step 1: Write a failing nested-path test**

Configure Metal/Gold -> Gold purity, Gold purity/22K -> Certificate number, and Metal/Silver -> Silver finish. Assert the preview renderer exposes the active Gold chain and hides Silver finish.

- [ ] **Step 2: Run test to verify it fails**

Run `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`; expect failure before the route setup and full preview implementation exist.

- [ ] **Step 3: Implement the minimum missing behavior and assertions**

Use only visible mapping controls in the test and keep all runtime evaluation in `FormRenderer`.

- [ ] **Step 4: Run complete scoped verification**

Run focused Forms UI/helper tests, core Forms tests, web typecheck, web build, and `git diff --check -- apps/web/src/features/forms docs/superpowers`; expect all to pass.
