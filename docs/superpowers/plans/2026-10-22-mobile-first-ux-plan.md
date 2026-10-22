# Mobile-first UX pass — audit and plan (2026-10-22)

Owner brief: "JewelOS — Complete UI/UX Transformation" (pasted in chat; the referenced
`MK_Jewels_JewelOS_Codex_Mobile_First_UX_Prompt.md` was not present on this machine, so the
pasted brief is the specification). Branch `feat/mobile-first-ux-20261022`.

Scope rule: presentation and client-side guidance only. No migration, RPC, RLS, Storage or
audit change. Every write keeps going through the existing audited RPCs
(`transition_fms_work_with_audit`, `submit_form_and_start_fms_idempotent`, task RPCs).

## Audit — usability issues found in the current source

FMS form filling (`FormRenderer`, shared by Forms Library, FMS starters, stages, task forms)

1. Only the hard-coded "Work and Upload" form is step-by-step; every other long multi-section
   form renders as one long page.
2. Validation shows a single banner at the top; the failing question is not marked, so on a
   phone the employee sees an error far away from the field.
3. Step indicator reads "Step 1 of 1" before the route is known (the total grows as branches
   are answered) — confusing.
4. No progress indication and no way to jump back to an earlier step except repeated Back.
5. No "check your answers" before the final submit.
6. Question labels use the tiny uppercase `.label` style; long questions are hard to read.
7. Multi-select questions use a native `<select multiple>` (unusable on Android).
8. Phone fields render `type="phone"` (invalid; no numeric keypad); numbers have no numeric
   keypad hint; currency has no ₹ cue.
9. The "Workflow form?" hint is phrased as a question and reads like developer text.

Previous form answers (`FmsWorkContext`)

10. The client parser throws on any object-valued or non-string-array answer, so one legacy
    answer makes the whole "Previous form answers" panel fail to load.
11. `formatFormAnswer` falls back to `String(value)`: objects print `[object Object]`; branch /
    department answers without a resolved label print a raw UUID; dates print ISO strings.
12. "What you need to do" sits below all previous answers; the employee must scroll past
    every earlier form to learn the task.
13. After "Continue to stage form" the full previous-answer list stays expanded above the work.

FMS in Tasks (`FmsTaskWorkspace`)

14. Workflow → stage → record drill-down: with one workflow, an employee taps twice before
    seeing any work.
15. Record cards show no stage name and a generic "Open Work" action regardless of whether a
    form, a stage, or a starter form is waiting; due date is absolute only.

Stage completion and handoff (`FmsStageRunner`, `FmsHandoffConfirmation`, `FmsWorkOutcome`)

16. "Complete stage" is disabled with no explanation of what is missing (form, decision,
    checklist, evidence, remark).
17. Status shows raw enum text (`in_review`), evidence upload has no list/feedback of what is
    already uploaded on this stage beyond buttons.
18. The handoff dialog uses mixed Title Case labels and does not say which step of the
    sequence the employee is on.
19. The result screen does not offer a way back to the task list inside the result card.

Tasks (`TaskCard`)

20. FMS and required-form task actions are hidden inside the expanded details.
21. Blocked tasks show developer text ("future database-backed workflow; no simulated
    resolution").
22. Due dates are absolute only; no "Due today / Overdue by 2 days" cue.

## Checklist

- [ ] core: `formUsesSteps`, `formCompletionProgress`, `displayFormAnswer`,
      `readableReceivedAnswer`, `describeDue`, `fmsStageCompletionChecklist` + tests
- [ ] FormRenderer: stepped mode for long multi-section forms, inline field errors, progress,
      step chips, review-before-submit, readable labels, mobile input modes, checkbox
      multi-select, plain hint text
- [ ] FmsWorkContext: tolerant parser, human-readable answers, task-first ordering,
      stage cards, collapsible after continue
- [ ] FMS page: "Read → Complete → Review next → Confirm" step indicator
- [ ] FmsStageRunner: requirement list, friendly status, clearer layout
- [ ] FmsHandoffConfirmation / FmsWorkOutcome: plain language, step label, back action
- [ ] FMS in Tasks: auto-open single workflow/stage, clearer record cards
- [ ] TaskCard: primary action on the card face, plain blocked text, due cue
- [ ] Ask Kiara app help + review doc updated for changed labels
- [ ] core + web tests, typecheck, build, `git diff --check`

## Out of scope / dependencies

- No backend change is required for the items above. Server-side label resolution for
  `user_dropdown`, `branch_dropdown`, `department_dropdown` already exists in
  `fms_context_form_fields` (migration 0289); when it returns no label the client now shows
  "No longer available" instead of an identifier.
- CRM screens keep their contractual structure (parity rule) and are not changed here.
