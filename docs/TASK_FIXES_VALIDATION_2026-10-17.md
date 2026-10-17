# Task fixes validation - 2026-10-17

Local implementation and final focused checks are complete. No production action or Git publication occurred.

## Changes

- Web `TasksPage.tsx`, shared data `tasks/api.ts`, and native `taskWorkspace.ts` / `TasksScreen.tsx`: fetch all authorized subsection counts on entry using existing bounded `task_feed_page` RPC calls, without hydrating unopened lists. Refresh on work changes; guard obsolete requests. Web also refreshes all counts after recurring catch-up creates work.
- Web and native `TaskCard.tsx`: a required remark no longer leaves Complete permanently disabled. Web opens and focuses the remark; native opens task details. Native `TaskDetailScreen.tsx` uses the existing shared remark rule, including on-behalf completion, and uploads evidence before requesting a separate remarked completion where needed.
- `0263_task_workspace_visibility.sql`: adds an RLS SELECT policy for the pinned workflow definition through existing authorized instance/assignment reads. Excludes unassigned runtime placeholders and inaccessible starter-author rows from page counts. No task data rewritten; no write grants added; RPC signatures, generated types, Storage and audit contracts unchanged.
- Regression tests: web card/paging, shared data count reads, native workspace, and `0268_task_workspace_visibility.test.sql`.

## Validation

- `pnpm.cmd --filter web test --maxWorkers=2`: 105 files / 493 tests passed before final recurring-count followup; `pnpm.cmd --filter web test src/pages/TasksPage.paging.test.tsx src/pages/TasksPage.test.tsx src/features/tasks/TaskCard.test.tsx src/features/tasks/taskRefresh.test.ts src/features/tasks/api.test.ts --maxWorkers=1` passed all 38 tests after the followup. Final `pnpm.cmd --filter web typecheck` passed. Independent code review found no remaining blockers in the scoped changes.
- `pnpm.cmd --filter @jewelos/data test`: 25 files / 143 tests passed. Additional count-denial test: focused task API 18/18 passed.
- `pnpm.cmd --dir apps/mobile test --maxWorkers=1`: 26 files / 128 tests passed. Initial parallel run had `appAvailability.test.ts` timeout; full serial rerun passed.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1`: all six workspace packages passed.
- `pnpm.cmd --dir apps/mobile typecheck`: passed.
- `pnpm.cmd --filter web build`: passed; existing large-chunk warning.
- `pnpm.cmd --filter @jewelos/core test`: 856 passed, one failed: `permissions/catalog.migration.test.ts`, seeded catalog 42 versus client catalog 36. Neither the catalog nor permission seed migrations were changed by this task; do not treat the overall core gate as green.
- Local PostgreSQL: applied only the new migration to explicitly named Docker container `supabase_db_jewelos-fms-contract`; no reset. New test 17/17, existing assigned-work test 28/28, task scale/management test 77/77 passed. Covers archived/cross-branch runtime visibility, page/card agreement, placeholders, ordinary/admin, inactive, anonymous, cross-tenant and service-role page grants.
- `git diff --check`: passed.

## Browser evidence

Browser plugin was unavailable; used installed Playwright against local Vite at `http://127.0.0.1:61319/tasks` and local Supabase `61321`, with synthetic accounts/records only. Desktop 1440x1000 and phone 390x844 passed: unopened subsection counts, FMS cards, focused required remark, and two persisted checklist completions. No horizontal overflow or framework overlay. Local Edge Runtime was absent: recurring preparation emitted the recorded non-2xx errors; recurrence generation itself was not proven in this browser run. All other page-error checks passed.

Evidence in ignored `.local/task-workspace/`: `browser-check.mjs`, `browser-result.json`, `fms-phone.png`, `fms-desktop.png`, `checklist-phone.png`, `checklist-desktop.png`. Unit regression separately covers counts after recurring generation.

## Release boundaries

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-mobile.ps1 -Notes 'Task subsection counts and checklist completion fixes' -NoPublish` stopped during preflight: checkout is `feat/department-section-access`, not `main`. Extensive pre-existing uncommitted mobile/shared FMS changes also prevent a scoped APK release. No connected ADB device; no physical Android proof.

No commit, push, hosted migration, web deployment, signed APK, or update manifest publication. The particular employee account/work item was not accessed. Release requires clean reviewed integration on main, resolving the existing core catalog mismatch, linked-project migration ledger/dry-run validation, and staging/hosted checks under the production playbook. Do not publish the unrelated dirty FMS work as part of these fixes.


## Subsequent authorized production release

The owner subsequently authorized deployment and main publication. The current
main architecture uses the Android WebView shell, so retired native screen
changes were excluded and no APK was necessary. The scoped release was ported
to current main, preserving video support and styling, and migration0286
`task_workspace_visibility` was applied and ledger-verified in production.
No pending migrations remain; hosted SQL lint and anonymous denial checks pass.
Main was pushed and remote-hash verified at
`2e44d0fcb86b60a7d2f5385b514222003d5515e1`.
The clean release passed987 core and183 data tests, all six typechecks,
production build,17 new pgTAP assertions, and exact-source desktop/phone browser
checks with persisted completions. Its full web scan had539 passes and two
five-second FMS timeouts; the isolated48-test retry passed both cases.
Current release evidence is in
`.worktrees/task-workspace-release-20261017/docs/TASK_WORKSPACE_RELEASE_2026-10-17.md`.
Vercel deployment is verified separately in the final release handoff.

Hosted web verification: both Vercel projects succeeded for2e44d0f. The production /tasks route returned HTTP200 and served `/assets/TasksPage-WysyRq1l.js`, containing the new subsection-count code. Full core/web suites and typechecks passed in GitHub CI; final workflow conclusion is recorded in the chat handoff.
