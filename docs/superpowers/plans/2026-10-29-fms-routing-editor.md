# Compact FMS routing editor

**Goal:** Reduce scrolling while adding and reviewing conditions; show the last added condition first without changing backend routing behavior.

**Scope:** Presentation in `FmsStageEditor.tsx`, focused regression tests, and Kiara help. No RPC, schema, migration, generated type, engine, permission, or API changes. Preserve unrelated checkout edits.

**Design:** Reverse only the rendered list (retain original indexes and IDs). Use compact condition summaries with question, answer labels and destination; expand one editor at a time and open a newly added condition. Keep priority numbers and explain first-match evaluation. Move destination before answers, keep add controls visible, and give phone controls usable touch targets. Existing single saved conditions open by default. Reordering is still an explicit author action; arrows follow visual movement with matching priority descriptions.

**Alternatives:** Merely reversing expanded rows leaves the scrolling problem. A separate routing screen adds navigation and scope. Extend the existing inspector with collapsible rows.

## Steps

- [x] Add and run regression tests: reverse rendering without mutating priority; adding opens newest and collapses older; editing/removing/reordering still targets exact IDs; summaries use labels and preserve removed values.
- [x] Implement the presentation change in the existing editor, using current semantic styles.
- [x] Update FMS help and review checklist; no new Kiara read tool is needed for presentation controls.
- [x] Run focused editor and related FMS/core tests, web typecheck/build, and diff checks.
- [x] Validate rendered desktop and phone layouts using a temporary component harness if authenticated local access is unavailable. Record evidence limits; no production deployment in this task.

## Local evidence

- `pnpm.cmd --filter web test src/features/fms/FmsStageEditor.test.tsx src/features/fms/FmsStageEditor.sections.test.tsx src/features/fms/FmsFlowBuilder.test.tsx --maxWorkers=1`: 58/58 pass. New reverse-order/add/reorder tests were observed failing before implementation. Includes opening a collapsed older condition from canvas and readiness issues.
- `pnpm.cmd --filter @jewelos/core test src/fms/engine.test.ts src/fms/fms.test.ts src/fms/routeAnswers.test.ts src/assistant/appHelp.test.ts`: 79/79 pass across the three existing matched test files (`engine.test.ts` does not exist).
- `pnpm.cmd --filter web typecheck` and `pnpm.cmd --filter web build`: blocked by unrelated Forms API `FormRule`/`Json` incompatibilities in web/data and an unused import in `FormsPage.workflows.test.tsx`. No errors reported in the routing editor. Concurrent unrelated edits were preserved.
- Scoped `git diff --check`: pass.
- Browser plugin not available. Used existing Playwright through an external temporary Vite component harness at `http://127.0.0.1:4178/__routing-qa`, with synthetic data only. Checked desktop 1440x900 and phones 390x844 / 320x844: one expanded editor, newly added condition first, editable answer/destination, no horizontal overflow, meaningful page/title, no framework overlay or console errors. Inspected light/dark screenshots. Harness scripts/screenshots stay outside repository.
- No database, RPC, RLS, Storage, audit, generated types, engine, or API changes. No hosted writes, deployment, APK, or physical-phone evidence.
- Independent scoped source/test review: no important findings. Verified original-index mutations, explicit priority movement, stable-ID expansion, and canvas/readiness targeting; reviewer did not rerun tests.
