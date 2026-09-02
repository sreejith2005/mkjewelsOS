# Forms Builder Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a compact, contextual Forms Builder with safe type switching, multi-answer Checkbox, star Rating, section navigation, and an optional full routing map while preserving existing Forms/FMS contracts.

**Architecture:** Extend the existing shared Forms domain and React builder rather than replacing them. Keep compatibility decisions in pure helpers, render only the active editor, and add one forward SQL migration for the changed Checkbox storage contract.

**Tech Stack:** React 18, TypeScript, Vitest/Testing Library, Tailwind, lucide-react, Supabase Postgres/pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-01-forms-builder-workspace-design.md`

## Global Constraints

- Work only in `C:\Users\MIS\Downloads\MKJewelOS\jewelos` and preserve unrelated dirty changes.
- Do not rename existing RPCs, weaken RLS, edit applied migrations, or alter pinned FMS form versions.
- Keep historical `multiselect` and optionless Checkbox readable; do not offer Multi-select for new fields.
- Use stable field, option, and section IDs for every route.
- Preserve the in-progress file-upload changes in Forms source and migration `0119`.

---

### Task 1: Shared Checkbox answer contract

**Files:**
- Modify: `packages/core/src/forms/options.ts`
- Modify: `packages/core/src/forms/validation.ts`
- Modify: `packages/core/src/forms/format.ts`
- Modify: `packages/core/src/forms/rules.ts`
- Test: `packages/core/src/forms/forms.test.ts`

**Interfaces:**
- Produces: option-backed Checkbox definitions validate arrays; optionless legacy Checkbox validates booleans; formatted arrays use option labels.

- [ ] Write failing core tests for option-backed Checkbox definition, required/invalid arrays, legacy boolean compatibility, array formatting, and `contains` operators.
- [ ] Run `pnpm.cmd --filter @jewelos/core test -- forms/forms.test.ts` and confirm the expected failures.
- [ ] Implement the smallest shared-domain changes.
- [ ] Re-run the focused core tests and keep existing multiselect coverage green.

### Task 2: Safe field conversion and routing graph models

**Files:**
- Create: `apps/web/src/features/forms/fieldTypes.ts`
- Create: `apps/web/src/features/forms/fieldTypes.test.ts`
- Create: `apps/web/src/features/forms/routingMap.ts`
- Create: `apps/web/src/features/forms/routingMap.test.ts`
- Modify: `apps/web/src/features/forms/guidedConditions.ts`
- Modify: `apps/web/src/features/forms/guidedConditions.test.ts`

**Interfaces:**
- Produces: `convertFormFieldType(fields, index, nextType)` returning cleaned fields and cleanup facts; `buildFormRoutingMap(fields, sections, options)` returning ordered nodes/edges.

- [ ] Write failing tests for Text to Dropdown initialization, Dropdown to Text cleanup, Radio and Checkbox route conversion, legacy multiselect compatibility, and dangling-route removal.
- [ ] Write failing tests requiring a Start-to-End graph with every section/question, normal edges, conditional edges, and convergence destinations.
- [ ] Run the focused web tests and confirm failures are caused by missing behavior.
- [ ] Implement the pure helpers and update guided conditions so option-backed Checkbox routes use `contains`.
- [ ] Re-run focused tests.

### Task 3: Respondent Checkbox and Rating controls

**Files:**
- Create: `apps/web/src/features/forms/RatingField.tsx`
- Modify: `apps/web/src/features/forms/FormRenderer.tsx`
- Test: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: shared option-backed Checkbox contract from Task 1.
- Produces: accessible Checkbox group arrays and numeric 1-5 Rating values without changing `FormRenderer` submission API.

- [ ] Write failing component tests for selecting multiple Checkbox options and keyboard-selecting Rating 4.
- [ ] Run the focused Forms test and confirm expected failures.
- [ ] Implement the checkbox group and star radiogroup while retaining legacy boolean Checkbox, file upload, and all other renderer branches.
- [ ] Re-run the focused Forms tests.

### Task 4: Compact builder workspace

**Files:**
- Create: `apps/web/src/features/forms/FormOutline.tsx`
- Create: `apps/web/src/features/forms/FormRoutingMap.tsx`
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`
- Modify: `apps/web/src/features/forms/OptionListEditor.tsx`
- Test: `apps/web/src/features/forms/forms.test.tsx`

**Interfaces:**
- Consumes: conversion and routing-map helpers from Task 2.
- Produces: one active editor, outline navigation, contextual insertion, type selector, compact routing details, optional map, duplicate action, and node-to-question navigation.

- [ ] Write failing interaction tests for no top palette, insertion after active question, one expanded card, field type conversion, no Multi-select creation option, outline jump, map open/close, and node navigation.
- [ ] Run the focused Forms tests and confirm the failures.
- [ ] Implement the outline and map as focused components.
- [ ] Refactor `FormBuilder` around one active editor and inline Add question menus without changing save/preview callbacks.
- [ ] Make Question/Type/Options primary, Routing and Advanced collapsible, and Divider minimal.
- [ ] Re-run focused Forms and visibility tests.

### Task 5: Forward database compatibility

**Files:**
- Create: `supabase/migrations/0125_checkbox_multi_answer_fields.sql`
- Create: `supabase/migrations/0126_preserve_legacy_boolean_checkbox.sql`
- Create: `supabase/tests/0125_checkbox_multi_answer_fields.test.sql`

**Interfaces:**
- Produces: existing draft/published save RPCs accept Checkbox options; existing submit RPC validates option-backed arrays and legacy booleans under the same authorization/audit boundary.

- [ ] Write pgTAP cases for normalized Checkbox options, valid multi-answer submission, invalid/duplicate/unknown values, required empty arrays, and legacy boolean submission.
- [ ] Run the focused pgTAP test against a reset local database and confirm the contract fails before the migration when Docker is available.
- [ ] Add a forward-only replacement of the latest `normalize_form_fields`, `replace_form_draft_fields`, and `submit_form_locked_with_audit` bodies with only Checkbox-specific changes.
- [ ] Re-run the focused pgTAP suite and the existing Forms/FMS SQL suites.

### Task 6: Regression and rendered verification

**Files:**
- Modify only if a test reveals a regression in the scoped Forms files.

- [ ] Run `pnpm.cmd --filter @jewelos/core test`.
- [ ] Run `pnpm.cmd --filter web test -- src/features/forms/forms.test.tsx src/features/forms/visibility.test.tsx src/features/forms/guidedConditions.test.ts src/features/forms/fieldTypes.test.ts src/features/forms/routingMap.test.ts`.
- [ ] Run `pnpm.cmd exec turbo run typecheck --force --concurrency=1`.
- [ ] Run `pnpm.cmd exec turbo run build --force --concurrency=1`.
- [ ] Run `git diff --check` and inspect the named-path diff for accidental changes or secrets.
- [ ] Use the in-app Browser for signed-in desktop and mobile flows; compare the result to the generated concept with `view_image`. If authentication or Browser is unavailable, record the exact proof gap.

## Completion record

Implemented on 2026-09-01 and final-audited on 2026-09-02. Red-green core and web tests were completed, the production web build passed, and the full web/core suites passed. Local Supabase applied `0125` and the forward compatibility correction `0126`; five focused Forms/FMS pgTAP files passed 110 tests, including the new 15-test Checkbox contract. The in-app Browser control was unavailable, so signed-in local QA used headless Chrome DevTools Protocol at desktop and mobile widths; its screenshots are in `artifacts/`. No hosted Supabase migration, Vercel deployment, Git commit, or push was performed.
