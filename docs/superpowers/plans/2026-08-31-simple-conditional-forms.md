# Simple Conditional Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let form authors connect an answer to a later follow-up question in plain language and test the resulting respondent path in a live preview.

**Architecture:** Add a pure Forms helper that recognizes and writes only simple existing equality rules. FormBuilder uses that helper to expose answer-to-follow-up controls for choose-one questions, while leaving unrepresentable legacy rules unchanged and visibly marked. Reuse FormRenderer in a persistent preview pane, so builder preview and respondent behavior share evaluation code.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, `@jewelos/core` FormRule/FormRenderer contracts.

**Spec:** `docs/superpowers/specs/2026-08-31-simple-conditional-forms-design.md`

## Global Constraints

- Preserve stored field keys, existing FormRule/legacy condition data, Forms RPCs, RLS, audit contracts, and submitted answers.
- Do not add a database migration, dependency, flow graph, code editor, calculation, redirect, or new section-routing behavior.
- Everyday copy uses plain language: "choose-one question", "follow-up question", and "If [answer] is selected, ask [question]".
- Only later questions may become follow-ups; never emit a backwards or self dependency.
- Do not commit, push, deploy, or run linked Supabase commands without separate user authorization.

---

### Task 1: Isolate simple answer-to-follow-up rule conversion

**Files:**
- Create: `apps/web/src/features/forms/guidedConditions.ts`
- Create: `apps/web/src/features/forms/guidedConditions.test.ts`

**Interfaces:**
- Consumes: `FormRule`, `FormCondition`, and `FormFieldDefinition` from `@jewelos/core`.
- Produces: `readGuidedConditionLinks(field): GuidedConditionLink[] | null` and `setGuidedFollowUp(fields, sourceKey, optionValue, targetKey): FormFieldDefinition[]`.

- [ ] **Step 1: Write failing helper tests**

```ts
expect(readGuidedConditionLinks({ rule: predicate("metal", "gold") })).toEqual([
  { sourceKey: "metal", optionValue: "gold" },
]);
expect(readGuidedConditionLinks({ rule: nestedAllRule })).toBeNull();
expect(setGuidedFollowUp(fields, "metal", "gold", "karat")[1]?.rule).toEqual(
  predicate("metal", "gold"),
);
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run: `pnpm.cmd --filter web exec vitest run src/features/forms/guidedConditions.test.ts`

- [ ] **Step 3: Implement immutable simple-rule conversion**

```ts
export type GuidedConditionLink = Readonly<{ sourceKey: string; optionValue: FormAnswer }>;
export function readGuidedConditionLinks(field: FormFieldDefinition): readonly GuidedConditionLink[] | null;
export function setGuidedFollowUp(
  fields: readonly FormFieldDefinition[], sourceKey: string, optionValue: FormAnswer, targetKey: string | undefined,
): readonly FormFieldDefinition[];
```

Recognize a legacy equality condition, one equality predicate, or a flat `any`
group of equality predicates. Return `null` for any other rule. Remove only
the named source-answer link from representable targets, add it to the named
target, and serialize one link as a predicate and several links as an `any`
group.

- [ ] **Step 4: Run the helper test and verify it passes**

Run: `pnpm.cmd --filter web exec vitest run src/features/forms/guidedConditions.test.ts`

### Task 2: Replace low-level conditional editing with guided follow-ups

**Files:**
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`
- Modify: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: `readGuidedConditionLinks` and `setGuidedFollowUp` from Task 1.
- Produces: a `FollowUpEditor` inside the edit panel for select/radio questions.

- [ ] **Step 1: Write failing UI tests**

```tsx
await user.selectOptions(screen.getByLabelText("Follow-up after Gold"), "karat");
expect(screen.getByText("If Gold is selected, ask Gold purity.")).toBeTruthy();
expect(screen.queryByText("IF")).toBeNull();
```

Include a test that an existing nested/number comparison is shown as
"Advanced condition" and is not rewritten by opening the editor.

- [ ] **Step 2: Run the Forms UI test and verify it fails**

Run: `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`

- [ ] **Step 3: Implement the guided controls**

For each inline option of a select or choose-one field, render a labelled
select: "Follow-up after [option label]". Its choices are "Continue normally"
plus later fields whose current rules are absent or representable. Invoke
`setGuidedFollowUp` through the builder's structural state update. Place the
editor outside Advanced settings; remove `VisibilityRuleEditor` and
`SectionBranchEditor` from normal authoring. Show a concise condition badge on
each target question. Keep an existing unrepresentable rule read-only with an
"Advanced condition" summary.

- [ ] **Step 4: Run the Forms UI test and verify it passes**

Run: `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`

### Task 3: Add a persistent live respondent preview

**Files:**
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`
- Modify: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: `FormRenderer` and the current in-memory normalized definition.
- Produces: desktop builder/preview split layout and a preview reset action.

- [ ] **Step 1: Write failing preview tests**

```tsx
await user.selectOptions(screen.getByRole("combobox", { name: "Metal" }), "gold");
expect(screen.getByLabelText("Gold purity")).toBeTruthy();
await user.click(screen.getByRole("button", { name: "Start preview again" }));
expect(screen.queryByLabelText("Gold purity")).toBeNull();
```

- [ ] **Step 2: Run the Forms UI test and verify it fails**

Run: `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`

- [ ] **Step 3: Implement the responsive preview pane**

Wrap editor content and preview in a desktop two-column layout. Render
`FormRenderer` with `preview` using the exact in-memory normalized form and
dynamic options. Use a numeric React key incremented by "Start preview again"
to discard preview answers. Keep the existing modal Preview button as the
narrow-screen fallback; do not submit or save from preview.

- [ ] **Step 4: Run the Forms UI test and verify it passes**

Run: `pnpm.cmd --filter web exec vitest run src/features/forms/forms.test.tsx`

### Task 4: Validate the scoped client contract

**Files:**
- Modify: `apps/web/src/features/forms/guidedConditions.test.ts`
- Modify: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence that simple branching, advanced-rule preservation, preview routing, and legacy renderer behavior coexist.

- [ ] **Step 1: Run focused Forms unit tests**

Run: `pnpm.cmd --filter web exec vitest run src/features/forms/guidedConditions.test.ts src/features/forms/forms.test.tsx`

- [ ] **Step 2: Run existing core rule tests**

Run: `pnpm.cmd --filter @jewelos/core test -- forms`

- [ ] **Step 3: Run web static checks and production build**

Run: `pnpm.cmd --filter web typecheck` and `pnpm.cmd --filter web build`

- [ ] **Step 4: Check patch integrity**

Run: `git diff --check -- apps/web/src/features/forms`
