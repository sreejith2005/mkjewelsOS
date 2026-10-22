# FMS Task Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the owner chooses delegation. Steps use checkbox syntax for tracking.

**Goal:** Give employees a secure Tasks -> FMS -> family -> published stage -> named record workspace over existing assignments.

**Architecture:** Extend existing task membership and authorized FMS context with a shared read projection. Server summaries and bounded pages supply the hierarchy; existing assigned-work routes and audited completion remain authoritative. Persist optional naming defaults in exact form versions and stage configuration.

**Tech Stack:** React 18, strict TypeScript, existing pnpm packages, PostgreSQL/Supabase, pgTAP, Vitest, existing JewelOS UI tokens.

**Spec:** `docs/superpowers/specs/2026-10-20-fms-task-workspace-design.md` (owner approved in this session).

## Global Constraints

- Work in the authoritative repository; final integration target is main. Preserve the previous feature branch.
- No second task store, workflow engine, completion page, or client-only authorization.
- Preserve exact starter and instance-stage identities, snapshots, history and transactional progression.
- Forward migrations after the checked source/hosted ledger; no applied-history edits.
- Ordinary task behavior and existing management permission scopes remain unchanged.
- At most 50 records per expanded stage page; totals are independent of pagination.
- Stages stay separate by published version; Waiting stays separate from actionable counts.
- Existing Android shell renders the same web UI; validate phone and desktop.
- No production deployment without the owner's required approval and release procedures.

## Review Focus

- Same-name families and renamed stages across versions must not merge incorrectly (Tasks 1, 2, 4).
- A completed multi-doer contribution must not remain counted as the employee's action (Tasks 2, 4).
- Hidden/unreachable historical answers must not leak through names or search counts (Tasks 1, 2).
- Identity changes and out-of-order realtime responses must not show another actor's cached work (Tasks 3, 4).
- Used published form metadata changes must not rename active historical work (Tasks 1, 2, 5).

### Task 1: Shared classification, naming and read-model contracts

**Files:** modify `packages/core/src/taskFeed.ts`, `taskPage.ts`, `taskSearch.ts`, `forms/types.ts`, `forms/definition.ts`, `forms/validation.ts`, `fms/workContracts.ts`, `fms/workPresentation.ts`, `fms/assignmentConfig.ts` and exports; create `packages/core/src/fms/taskWorkspace.ts` and focused tests.

**Interfaces:** add `fms` to `TaskWorkspaceView`; `splitAssignedTaskFeed` returns `myTasks`, `delegatedTasks`, `fmsTasks`. Add `FmsWorkspaceStatus = active | pending | overdue | waiting | completed`, typed filters, family/stage/record pages and strict decoders. Add `recordNameFieldKey` to `FormTemplateDefinition` and optional stage `FmsTaskDisplay.recordNaming`. Export a deterministic eligible-field/name resolver consumed by existing FMS presentation.

- [x] Add failing classification tests for recurring/delegated/FMS starter/runtime identities and watching-only partitioning; add search payload/decoder `fms` cases and malformed response cases.
- [x] Add failing naming tests for explicit stage/initial/form default/legacy template/automatic/reference precedence, blanks, hidden fields, same names, whitespace/length and stable initial names after loops.
- [x] Run the classification/naming/workspace core suites and the complete core suite; record current outcomes and retained red/green evidence below.
- [x] Implement the shared contracts, normalization, validation and presentation; keep ordinary status semantics unchanged.
- [x] Rerun focused core suites and existing forms/FMS assignment suites; check all consumers of the changed partition and types.
- [x] Review and commit only named task paths after whitespace and credential-safe staged checks.

### Task 2: Authorized FMS projection, naming persistence and forward migration

**Files:** create next available `supabase/migrations/*_fms_task_workspace.sql` and `supabase/tests/*_fms_task_workspace.test.sql`; update `packages/core/src/database.types.ts`. Read effective save/revise/duplicate/snapshot definitions before extending them.

**Interfaces:** private actor-scoped eligible-assignment projection; public `get_fms_task_workspace` (family summaries), `get_fms_task_stages` (one family/version-aware stage summary), `get_fms_task_stage_page` (bounded exact stage/starter page). Public inputs include validated filters/pagination and family/stage selectors, never arbitrary employee IDs. Extend existing task workspace/feed signatures compatibly.

- [x] Add pgTAP fixtures for exact section separation, duplicate-family names, old published versions, starter completion, conditional skips, repeated and parallel visits, per-user contributions, waiting and 250-assignment totals.
- [x] Add denial assertions for anonymous/inactive/cross-tenant/unassigned/cross-scope/direct-parameter/service-role access, and search against hidden/unreachable form fields.
- [x] Run the new pgTAP suite against the local stack; retain representative red/green failures for section denial, history, graph order and the post-handoff search budget.
- [x] Add `form_templates.record_name_field_key`, validated audited save/revision/duplicate handling and immutable-on-used-version behavior; preserve it in historical snapshots.
- [x] Implement shared eligibility/filter/name projection and use it in family/stage/pages and existing task search. Preserve ordinary predicates and exact legacy RPC signatures.
- [x] Reuse causal/snapshot visibility helpers; expose minimal naming data, not full form histories. Add pinned stage graph/pipeline metadata and deterministic version/stage ordering inputs.
- [x] Apply only to local test infrastructure; run focused pgTAP plus existing `0286`-`0290`, context/assignment/parallel/loop/handoff suites; inspect synthetic query plans.
- [x] Generate database types, inspect grants and run local lint. Commit only reviewed SQL/tests/types.

### Task 3: Data adapters and exact-page hydration

**Files:** create `packages/data/src/fms/taskWorkspace.ts` and tests; modify task API adapters in `packages/data/src/tasks/api.ts` and `apps/web/src/features/tasks/api.ts`; update both form API conversion paths and focused tests.

**Interfaces:** `loadFmsTaskWorkspace(filters, offset)`, `loadFmsTaskStages(familyId, filters)`, `loadFmsTaskStagePage(familyId, flowId, stageId, filters, offset)` return strict shared decoded pages. Existing `loadTaskTabCounts`, `loadTaskPage`, `loadTaskSearchPage` accept `fms` and keep existing APIs.

- [x] Add failing adapter tests for correct RPC parameters, strict decoding, 50-record bounds, inaccessible data, summary errors and naming round-trips.
- [x] Run focused data/web adapter tests and record results, followed by complete data coverage.
- [x] Implement adapters through `@jewelos/api-client`; reuse existing authorized context batching and avoid per-record history loaders.
- [x] Include FMS tab counts on initial load. Ensure request identity can prevent stale actor/filter results from being installed by the UI.
- [x] Rerun adapters and existing form/task/FMS data suites; commit reviewed named paths.

### Task 4: Tasks navigation and lazy hierarchical workspace

**Files:** modify `apps/web/src/pages/TasksPage.tsx`; create focused workspace, family/stage group and compact record-card components under `apps/web/src/features/tasks/fms/`; extend Tasks paging/search and new component tests.

**Interfaces:** `FmsTaskWorkspace` accepts current actor identity, navigation callback and an FMS-count refresh callback; owns FMS filters/expansion/page state. Record cards consume shared presentation and use only `fmsAssignedWorkPath` for Open Work.

- [x] Add failing component tests for tab order, default collapsed groups, no record fetch until expansion, family/stage totals, version labels, graph/pipeline ordering, empty/error/retry and exact starter/stage links.
- [x] Add stale response, identity-change, completed-contribution and 250-item pagination tests; verify filter reset and realtime clamping preserve expansion.
- [x] Run targeted component suites and complete web coverage; record results below.
- [x] Implement FMS tab and lazy hierarchy with current tokens/accessibility/touch targets; keep ordinary search, Task Control, composer and completion controls intact.
- [x] Integrate existing realtime refresh; refresh only summaries and expanded pages, with request generation guards.
- [x] Run Tasks, Home, notifications and assigned-work suites; perform rendered 390px/1440px light/dark/keyboard checks and current Android shell navigation regressions.
- [x] Commit reviewed components/tests after checks.

### Task 5: Form/FMS naming controls and consistent entry headings

**Files:** modify `apps/web/src/features/forms/FormBuilder.tsx`, `apps/web/src/features/fms/FmsAssignmentEditor.tsx`, `FmsWorkContext.tsx`, `apps/web/src/pages/FmsAssignedWorkPage.tsx` and existing supported Home/task presentation consumers; add focused naming control and persistence tests.

**Interfaces:** actual-form eligible question selector for form default; initial FMS mode Automatic/form default/explicit source; later stage optional override. Existing advanced template/reference controls remain supported.

- [x] Add failing tests for actual field options, stable key/pinned version storage, round-trip/revision behavior, unsupported/removed/hidden choices and preserving legacy advanced configurations.
- [x] Run focused builder/presentation regressions and preserve actual naming persistence/visibility checks.
- [x] Implement controls over shared eligibility/validation and audited persistence; reuse shared name presentation on all affected current entry surfaces.
- [x] Check no stage transition RPC/capability/handoff logic was changed; rerun existing form/FMS builder and exact assigned-work suites.
- [x] Verify phone/desktop controls and completed/approval/deferred states; commit reviewed paths.

### Task 6: Help, full regression, review and main delivery

**Files:** update `packages/core/src/assistant/appHelp.ts`, tests, `docs/ASK_KIARA_APP_HELP_REVIEW.md`, `docs/REGRESSION_CHECKLIST.md`; create `docs/FMS_TASK_WORKSPACE_GUIDE.md`; update design/plan status with actual evidence.

- [x] Add/help-test exact Tasks -> FMS navigation and naming instructions without widening Kiara access; document that no new Kiara read tool is needed for navigation help.
- [x] Run focused tests, clean local DB rebuild/full pgTAP/lint, core/data/web suites, serial typecheck/build, rendered phone/desktop and applicable shell checks. Record exact commands/results and distinguish blockers.
- [x] Review complete diff for permission scope, duplicate logic, historical compatibility, legacy RPC callers, ordinary tasks and credential/customer data. Request an independent review using the approved execution method.
- [x] Resolve review findings and rerun affected checks. Stage named paths, inspect staged diff, run `git diff --cached --check` and credential-safe staged scan.
- [ ] Integrate validated work into main as the final target; do not overwrite unrelated branch changes. Follow the publication skill/playbook for an authorized push.
- [x] Prepare concrete hosted migration dry-run/release steps; do not deploy without the required approval. Report local, Git, hosted, web and physical Android evidence separately.

## Execution evidence (local, 2026-10-20/21)

Owner approved the design and this plan, choosing direct implementation. The
implementation, independent review and rendered verification are complete.
Local main integration is the remaining Git step. The full database gate has
the explicitly recorded baseline failures below. No hosted writes or publication
have been performed.

- `pnpm.cmd --dir packages/core test --maxWorkers=1`: refreshed after merging
  `origin/main` (`adef660`), 94 files / 1,022 tests passed.
- `pnpm.cmd --dir packages/data test --maxWorkers=1`: refreshed after the merge,
  32 files / 192 tests passed, including the real Home separate-starter-RPC contract.
- `pnpm.cmd --dir apps/web test --maxWorkers=1 --testTimeout=20000`: refreshed
  after the merge, 120 files / 591 tests passed. The suite includes workspace,
  naming, stale actor/filter, Home, assigned-work and Anytime duty regressions.
- `pnpm.cmd exec turbo run typecheck build --force --concurrency=1`: refreshed
  after the merge, all 12 tasks passed. Existing bundle-size and CRM output
  configuration warnings remain.
- `pnpm.cmd --dir apps/mobile test src/features/webShell/webShellBridge.test.ts --maxWorkers=1`:
  17 bridge/navigation tests passed. No native code or APK change is required.
- `supabase.cmd db reset --workdir .worktrees/fms-workspace-local-db`: a clean
  dedicated local stack (`jewelos-fms-workspace`, API 54921, database 54922)
  rebuilt the merged schema through 0311 successfully. Local-only
  `supabase.cmd db push --local --workdir .worktrees/fms-workspace-local-db`
  subsequently applied the later forward migrations locally. Generated-column/RPC declarations were
  cross-checked against local type generation; the final migrations add only
  private helpers/query configuration and preserve all public RPC signatures.
- Full feature pgTAP run: 182 files / 3,764 assertions, failed. Clean unchanged
  `b844a67` baseline run: 176 files / 3,701 assertions, failed. All 49 distinct
  failed assertion descriptions were reproduced on the unchanged baseline.
  These include stale function inventory, legacy FMS validation/fixture behavior,
  CRM roster assertions and unclassified retirement-manifest tables. They are
  not a green full database gate. The merged rerun completed 187 files / 3,851
  assertions and failed with those same 49 descriptions plus a timeout in the
  newly merged main's 0296 Dashboard budget test. Its 8-second block timed out
  under shared-host load, leaving two failed assertions and an unset test GUC.
  Its serial retry passed all 21 assertions.
- A 37-file / 405-assertion focused run passed every file except the newly added
  Tasks-denial assertion. That failure exposed the inherited shorthand page-ID
  bug. Forward migration 0307 uses the registered page identifiers; the corrected
  24-assertion cross-scope/denial suite and eight terminal/date/maintenance
  assertions then passed. After 0313, the complete focused rerun passed
  **47 files / 578 assertions**, including all FMS suites numbered 0240 onward
  plus task-scale, loop, task visibility/search and Dashboard budget contracts.
- Synthetic 250-visit `EXPLAIN (ANALYZE, BUFFERS)` measurements: eligible relation
  159 ms; unsearched family summary 307 ms; name search 4,735 ms; first 50-record
  stage page 1,376 ms on the shared local Docker host. Search remains a read-time
  causal projection; these initial measurements do not establish hosted latency.
  A later real authenticated post-handoff 249-visit search reproduced the
  8-second timeout. Its new regression also failed before the fix. 0312 reuses
  causal sources and visible fields behind a materialized authorized relation;
  0313 snapshots stable actor/module checks once per query. The regression then
  passed, as did authenticated family/stage/page/global search. Recorded times
  were 5,125 / 2,326 / 2,008 / 4,740 ms respectively, with 249 matching records
  and a bounded 50-record page. The final browser run repeated name search in
  4,895 ms. These are local measurements, not hosted or higher-volume capacity.

Review fixes retain expanded family/stage keys through filters and realtime,
hide cached records when a stage becomes empty, and classify unfinished visits
on terminal instances as Waiting. Tests cover both stage/page response orders.
The existing approval authority check was verified against the effective
permission resolver and `current_profile`; no new approval authorization was
introduced.

Feature migrations were renumbered from the unpublished local draft because
concurrent `origin/main` added 0293, and now span 0300-0317. No hosted migration
history was changed. Merge 4449536 preserves current main's on-demand/standing
duties, collapsible Anytime bar, manual assignment, team Home and task ordering.

Later focused database checks observed failing assertions before the fixes:
completed/cancelled history and starting-form deduplication then passed 10/10;
the existing parallel/loop suite with saved target-order assertions passed 85/85.
Combined naming/inheritance/history checks passed 28 assertions. All new FMS
workspace files, the cross-scope denial suite and loop suite passed again in
the merged full database run. The read-only independent reviewer finished with
no remaining Critical, Important or Minor code findings.

Rendered QA uses repository Playwright because the Browser plugin/skill is
unavailable. The owner updated WSL and the dedicated Docker stack recovered.
Authenticated synthetic browser checks verified collapsed/lazy groups, persisted
record names, search preserving expansion, canonical assigned-work navigation,
previous answers, real form completion/handoff and the next employee seeing the
same name. Viewport screenshots confirmed desktop content clears the sidebar.
Phone screenshots exposed a clipped FMS tab; subsection buttons now use two
columns at phone width, retaining the desktop row. The final serial browser run
passed at 390x844 and 1440x1000 in light/dark, including no horizontal overflow,
visible subsection counts, Form Builder's default selector, the FMS naming
selector, real handoff, recipient inheritance and authenticated large search.
Screenshots and synthetic-only result JSON are outside the repo at
`%LOCALAPPDATA%/Temp/fms-workspace-20261020/`.

The local Edge runtime and realtime service are excluded: recurring-task
preparation returns the exact environment error `Prepare recurring tasks: Edge
Function returned a non-2xx status code` (503), and realtime sockets cannot
connect. These checks do not prove hosted Edge/realtime delivery. Stale response
and refresh behavior have component coverage. The first merged lint attempt
failed to connect to local Postgres; the serial retry completed with exit 0 and
existing-function warnings. A warning-free lint/full database gate is not claimed.

The final independent static review also approved the naming reuse and actor
snapshot changes. The checked row relation is explicitly materialized before
unchecked private naming; unrelated causal fields are loaded only if legacy
interpolation actually needs them. New grant assertions deny all three unchecked
helpers to anon, authenticated and service_role.

Representative red/green failures are recorded above; individual initial red-run
captures were not retained for every newly added unit/component assertion.

### Final verification, 2026-10-22

- The owner approved temporarily stopping the 61 recorded containers in 13
  unrelated local Supabase stacks, then restoring those same containers. This
  isolates the four-container FMS stack for the final timing-sensitive gates.
- `supabase.cmd db push --local --workdir .worktrees/fms-workspace-local-db`
  applied forward migrations through 0317. No hosted command was used.
- `supabase.cmd test db <focused files> --workdir .worktrees/fms-workspace-local-db`:
  **48 files / 590 assertions passed**. The set is every `*fms*test.sql` numbered
  0240 or later plus `0208_task_scale_and_management`, `0212_fms_loop_execution`,
  `0286_task_workspace_visibility`, `0290_task_search_filters` and
  `0296_dashboard_budget_fms_cancel_report_jobs` (deduplicated).
- Real password-authenticated API calls for 249 assignments passed: family
  search 4,234 ms; stages 3,175 ms; bounded stage page 4,584 ms; global search
  5,693 ms. The final browser run passed and repeated the large search in 3,421 ms.
- Final local lint exited 0 with warnings in 15 existing functions and none in
  the workspace/naming helpers or global task-search function. The final web
  build exited 0 after the phone navigation change.
- 0316 batches only identical instance/stage/ordered ancestry/previous-visit
  inputs within the same checked actor/statement. Every submitted destination
  stays unique. Tests compare equivalent, detached, reordered, explicit override,
  legacy and submitted/unsubmitted results against individual checked resolution.
  0317 applies non-name membership/date/priority/requirement filters before names,
  preserving nullable broad membership and existing cross-status counts.
- The full database baseline failures and hosted Edge/realtime/physical-device
  boundaries above remain release gates; these passing focused checks do not
  constitute production deployment or a warning-free/full-green database gate.

The user guide and migration/file map are in `docs/FMS_TASK_WORKSPACE_GUIDE.md`;
the implementation report is `docs/FMS_TASK_WORKSPACE_IMPLEMENTATION.md`.
Kiara help is updated; no additional Kiara read tool is needed for navigation and
naming configuration, and no Kiara mutation capability is added.
