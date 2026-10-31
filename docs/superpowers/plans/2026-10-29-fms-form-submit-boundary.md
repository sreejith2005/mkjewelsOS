# FMS form submission boundary fix

**Goal:** Show the assignment confirmation once, only after the respondent finishes the form route and submits.

**Architecture:** Preserve the existing FmsStartingForm and assigned-stage handoff transaction. Correct the shared FormRenderer's navigation/submit boundary; do not change workflow identities, RPCs, permissions, stored data or generated types.

**References:** `2026-10-15-fms-operational-handoff-design.md` and `2026-10-23-fms-form-sections-canvas-design.md` in the specs directory. The user explicitly requests final-form assignment rather than per-section assignment.

## Plan

- [x] Reproduce premature submission with native submit events and real browser Next clicks on a multi-section form.
- [x] Add failing regression coverage, including the Forms Library FMS starter wrapper.
- [x] Separate navigation and submission button identity and guard non-final submit events in FormRenderer, as confirmed by reproduction.
- [x] Run form, FMS assigned-work and work/upload regressions, web typecheck/build, and browser checks at desktop and phone widths.
- [x] Review the scoped diff and report local evidence separately from deployment. Preserve all unrelated checkout changes.

No new screen, label, feature or Kiara tool is introduced. Existing app help continues to describe final submission and handoff.

## Evidence

- A native submit event before the final section invoked the callback in the failing regression.
- Chromium reproduced an unintended submission from Next on the original renderer at widths 1280 and 390. The corrected renderer kept the submission count at zero through Next/Back and invoked it once on Submit form, with no page errors. Synthetic form and local configuration only; no hosted records were written. Browser plugin not available, so regular Playwright was used.
- `pnpm.cmd --filter web typecheck`: passed.
- Initial targeted run of the renderer and FMS starter tests: 8 passed. The broader run hit five-second test timeouts and was stopped after stalling; repeat focused related regressions with `--maxWorkers=1 --testTimeout=30000`.
- Related regression rerun: 10 files / 65 tests passed (guided, confirmation, preview, starter, work/upload, conditional forms, visibility, assigned-work page, stage sections and stage review). Command: `pnpm.cmd --filter web exec vitest run src/features/forms/FormRenderer.guided.test.tsx src/features/forms/FormRenderer.confirmation.test.tsx src/features/forms/FormRenderer.preview.test.tsx src/features/forms/FmsStartingForm.test.tsx src/features/forms/workUploadForm.test.tsx src/features/forms/forms.test.tsx src/features/forms/visibility.test.tsx src/pages/FmsAssignedWorkPage.test.tsx src/features/fms/FmsStageRunner.sections.test.tsx src/features/fms/FmsStageRunner.review.test.tsx --maxWorkers=1 --testTimeout=30000`.
- Temporary browser reproduction files and baseline component copy were removed.
- `pnpm.cmd --filter web exec vite build`: passed (existing large-chunk warnings). `git diff --check`: passed.
- Local verification only. No Git publication, web deployment, database migration or hosted employee-session verification was performed. No APK is needed for this web-only change. No schema/RPC/RLS/Storage/audit/type-generation impact or historical data migration.
