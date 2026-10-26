# FMS: optional Otherwise, form-chosen handoff, deadline types, sidebar (2026-10-26)

Owner request, four items. Base: `origin/main` e5f3fbe. Branch
`fix/fms-routing-handoff-sidebar-20261026`, worktree `C:\jfix`.

## 1. Otherwise is optional on a routed step

Today a step with conditional routes must have an Otherwise destination:
core `route_without_fallback`, the red builder note "Choose where any other
answer goes.", and `assert_fms_flow_publishable_before_assignment` (0212,
renamed in 0261). At runtime an unmatched answer puts the workflow on hold
(`complete_fms_stage_with_audit`, 0142) or raises on the first form
(`progress_fms_initial_form_internal`, 0260).

New rule: an unmatched answer with no Otherwise finishes that path, exactly
like "Complete workflow here". The instance completes when no other work is
open (parallel paths keep running).

- core: drop the `route_without_fallback` issue; a routed step without a
  fallback counts as a completion point in `validateFmsRoutingGraph`.
- web: the Otherwise picker stays, labelled so "Complete workflow here" is
  the visible default; the red note goes.
- 0347: remove the publish check; replace the on-hold block with a
  `route_unmatched` log and fall through to the existing completion; the first
  form completes the instance instead of raising. Completion-step publish check
  also accepts a routed step without a fallback.

## 2. The next step follows the employee chosen on the form

`fms_form_chain_choice` (0288) recognises only a User question named
"Assigned To"/"Assign To" (or the stage's `assignmentFieldKey`) and reads the
whole Form, ignoring the stage's section (0345). A follow-up form whose
employee question is named anything else ("Salesperson", "Assign to sales")
silently leaves the next step with the previous employee.

New rule, server (0347) and simulation (core) alike:

1. Questions are limited to the section the source stage answers.
2. A named Assigned To question (or `assignmentFieldKey`) wins, unchanged.
3. Otherwise, when the section has exactly one User question and it was
   answered (visible, reached), that employee receives the step.
4. Otherwise the previous employee keeps the work, as before.

The builder's Assignment panel names which question will be followed, so the
behaviour is visible before publishing.

## 3. Sidebar stays closed after a reload

`lazyPage.ts` reloads the page when a deploy replaced a page chunk (FMS ships
most often). `AppShell` starts with the sidebar open, so after that reload the
sidebar is open on the FMS page. The sidebar state is kept for the browser
session (`sessionStorage`, guarded), so a reload keeps it as the user left it.
First visit still opens it.

## 4. Deadline types visible again

Builder 3.0 replaced the four visible deadline-type cards with a compact
dropdown that defaults to a date. Restore the cards (Completion date, TAT,
Days before date, Specific clock time, each with its help line) inside the
existing "When / Deadline" section. No data or contract change.

## Validation

pgTAP for 0347 (unmatched route completes, first form completes, publish
without Otherwise, single-question handoff, section scoping, named question
still wins); core and web Vitest; typecheck; build; phone-width check of the
inspector. Hosted: owner runs the deploy script for 0347 before merge.
