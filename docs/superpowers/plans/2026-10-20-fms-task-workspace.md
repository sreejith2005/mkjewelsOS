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
- [ ] Run `pnpm.cmd --dir packages/core exec vitest run src/taskFeed.test.ts src/taskPage.test.ts src/taskSearch.test.ts src/fms/workPresentation.test.ts src/fms/taskWorkspace.test.ts`; confirm new assertions fail before implementation.
- [x] Implement the shared contracts, normalization, validation and presentation; keep ordinary status semantics unchanged.
- [x] Rerun focused core suites and existing forms/FMS assignment suites; check all consumers of the changed partition and types.
- [ ] Review and commit only named task paths after whitespace and credential-safe staged checks.

### Task 2: Authorized FMS projection, naming persistence and forward migration

**Files:** create next available `supabase/migrations/*_fms_task_workspace.sql` and `supabase/tests/*_fms_task_workspace.test.sql`; update `packages/core/src/database.types.ts`. Read effective save/revise/duplicate/snapshot definitions before extending them.

**Interfaces:** private actor-scoped eligible-assignment projection; public `get_fms_task_workspace` (family summaries), `get_fms_task_stages` (one family/version-aware stage summary), `get_fms_task_stage_page` (bounded exact stage/starter page). Public inputs include validated filters/pagination and family/stage selectors, never arbitrary employee IDs. Extend existing task workspace/feed signatures compatibly.

- [ ] Add pgTAP fixtures for exact section separation, duplicate-family names, old published versions, starter completion, conditional skips, repeated and parallel visits, per-user contributions, waiting and 250-assignment totals.
- [ ] Add denial assertions for anonymous/inactive/cross-tenant/unassigned/cross-scope/direct-parameter/service-role access, and search against hidden/unreachable form fields.
- [ ] Run the new pgTAP suite against the current local stack to record missing-contract failures before adding SQL.
- [x] Add `form_templates.record_name_field_key`, validated audited save/revision/duplicate handling and immutable-on-used-version behavior; preserve it in historical snapshots.
- [x] Implement shared eligibility/filter/name projection and use it in family/stage/pages and existing task search. Preserve ordinary predicates and exact legacy RPC signatures.
- [x] Reuse causal/snapshot visibility helpers; expose minimal naming data, not full form histories. Add pinned stage graph/pipeline metadata and deterministic version/stage ordering inputs.
- [ ] Apply only to local test infrastructure; run focused pgTAP plus existing `0286`-`0290`, context/assignment/parallel/loop/handoff suites; inspect synthetic query plans.
- [ ] Generate database types, inspect grants and run local lint. Commit only reviewed SQL/tests/types.

### Task 3: Data adapters and exact-page hydration

**Files:** create `packages/data/src/fms/taskWorkspace.ts` and tests; modify task API adapters in `packages/data/src/tasks/api.ts` and `apps/web/src/features/tasks/api.ts`; update both form API conversion paths and focused tests.

**Interfaces:** `loadFmsTaskWorkspace(filters, offset)`, `loadFmsTaskStages(familyId, filters)`, `loadFmsTaskStagePage(familyId, flowId, stageId, filters, offset)` return strict shared decoded pages. Existing `loadTaskTabCounts`, `loadTaskPage`, `loadTaskSearchPage` accept `fms` and keep existing APIs.

- [ ] Add failing adapter tests for correct RPC parameters, strict decoding, 50-record bounds, inaccessible data, summary errors and naming round-trips.
- [ ] Run focused data/web adapter tests and record failures.
- [x] Implement adapters through `@jewelos/api-client`; reuse existing authorized context batching and avoid per-record history loaders.
- [x] Include FMS tab counts on initial load. Ensure request identity can prevent stale actor/filter results from being installed by the UI.
- [x] Rerun adapters and existing form/task/FMS data suites; commit reviewed named paths.

### Task 4: Tasks navigation and lazy hierarchical workspace

**Files:** modify `apps/web/src/pages/TasksPage.tsx`; create focused workspace, family/stage group and compact record-card components under `apps/web/src/features/tasks/fms/`; extend Tasks paging/search and new component tests.

**Interfaces:** `FmsTaskWorkspace` accepts current actor identity, navigation callback and an FMS-count refresh callback; owns FMS filters/expansion/page state. Record cards consume shared presentation and use only `fmsAssignedWorkPath` for Open Work.

- [ ] Add failing component tests for tab order, default collapsed groups, no record fetch until expansion, family/stage totals, version labels, graph/pipeline ordering, empty/error/retry and exact starter/stage links.
- [ ] Add stale response, identity-change, completed-contribution and 250-item pagination tests; verify filter reset and realtime clamping preserve expansion.
- [ ] Run targeted component suites and record failures.
- [x] Implement FMS tab and lazy hierarchy with current tokens/accessibility/touch targets; keep ordinary search, Task Control, composer and completion controls intact.
- [x] Integrate existing realtime refresh; refresh only summaries and expanded pages, with request generation guards.
- [ ] Run Tasks, Home, notifications and assigned-work suites; perform rendered 390px/1440px light/dark/keyboard checks and current Android shell navigation regressions.
- [ ] Commit reviewed components/tests after checks.

### Task 5: Form/FMS naming controls and consistent entry headings

**Files:** modify `apps/web/src/features/forms/FormBuilder.tsx`, `apps/web/src/features/fms/FmsAssignmentEditor.tsx`, `FmsWorkContext.tsx`, `apps/web/src/pages/FmsAssignedWorkPage.tsx` and existing supported Home/task presentation consumers; add focused naming control and persistence tests.

**Interfaces:** actual-form eligible question selector for form default; initial FMS mode Automatic/form default/explicit source; later stage optional override. Existing advanced template/reference controls remain supported.

- [ ] Add failing tests for actual field options, stable key/pinned version storage, round-trip/revision behavior, unsupported/removed/hidden choices and preserving legacy advanced configurations.
- [ ] Run the focused builder/presentation tests and confirm failures.
- [x] Implement controls over shared eligibility/validation and audited persistence; reuse shared name presentation on all affected current entry surfaces.
- [x] Check no stage transition RPC/capability/handoff logic was changed; rerun existing form/FMS builder and exact assigned-work suites.
- [ ] Verify phone/desktop controls and completed/approval/deferred states; commit reviewed paths.

### Task 6: Help, full regression, review and main delivery

**Files:** update `packages/core/src/assistant/appHelp.ts`, tests, `docs/ASK_KIARA_APP_HELP_REVIEW.md`, `docs/REGRESSION_CHECKLIST.md`; create `docs/FMS_TASK_WORKSPACE_GUIDE.md`; update design/plan status with actual evidence.

- [x] Add/help-test exact Tasks -> FMS navigation and naming instructions without widening Kiara access; document that no new Kiara read tool is needed for navigation help.
- [ ] Run focused tests, clean local DB rebuild/full pgTAP/lint, core/data/web suites, serial typecheck/build, rendered phone/desktop and applicable shell checks. Record exact commands/results and distinguish blockers.
- [ ] Review complete diff for permission scope, duplicate logic, historical compatibility, legacy RPC callers, ordinary tasks and credential/customer data. Request an independent review using the approved execution method.
- [ ] Resolve review findings and rerun affected checks. Stage named paths, inspect staged diff, run `git diff --cached --check` and credential-safe staged scan.
- [ ] Integrate validated work into main as the final target; do not overwrite unrelated branch changes. Follow the publication skill/playbook for an authorized push.
- [ ] Prepare concrete hosted migration dry-run/release steps; do not deploy without the required approval. Report local, Git, hosted, web and physical Android evidence separately.

## Execution evidence (local, 2026-10-20/21)

Owner approved the design and this plan, choosing direct implementation. The
implementation is present; final rendered verification, review and main
integration are still pending. The checkboxes above distinguish implementation
from the remaining combined release gates. No hosted writes or publication have
been performed.

- `pnpm.cmd --dir packages/core test --maxWorkers=1`: 93 files, 1,014 tests passed
  in the current shared checkout, including concurrent manual-task work.
- `pnpm.cmd --dir packages/data test --maxWorkers=1`: 32 files, 190 tests passed;
  the corrected Home separate-starter-RPC contract also passed its focused test.
- `pnpm.cmd --dir apps/web test --maxWorkers=1 --testTimeout=20000`: 116 files,
  567 tests passed. Subsequent FMS workspace/naming tests passed seven cases;
  stale actor/filter hook tests passed two more.
- `pnpm.cmd exec turbo run typecheck build --force --concurrency=1`: all 12 tasks
  passed. A later fresh serial typecheck passed all six projects.
- `pnpm.cmd --dir apps/mobile test src/features/webShell/webShellBridge.test.ts --maxWorkers=1`:
  17 bridge/navigation tests passed. No native code or APK change is required.
- A dedicated local stack (`jewelos-fms-workspace`, API 54921, database 54922)
  rebuilt the schema through baseline 0290. All feature migrations 0300-0307
  were subsequently applied locally. Generated-column/RPC declarations were
  cross-checked against local type generation.
- Full feature pgTAP run: 182 files / 3,764 assertions, failed. Clean unchanged
  `b844a67` baseline run: 176 files / 3,701 assertions, failed. All 49 distinct
  failed assertion descriptions were reproduced on the unchanged baseline.
  These include stale function inventory, legacy FMS validation/fixture behavior,
  CRM roster assertions and unclassified retirement-manifest tables. They are
  not a green full database gate.
- A 37-file / 405-assertion focused run passed every file except the newly added
  Tasks-denial assertion. That failure exposed the inherited shorthand page-ID
  bug. Forward migration 0307 uses the registered page identifiers; the corrected
  24-assertion cross-scope/denial suite and eight terminal/date/maintenance
  assertions then passed. The complete focused rerun remains pending.
- Synthetic 250-visit `EXPLAIN (ANALYZE, BUFFERS)` measurements: eligible relation
  159 ms; unsearched family summary 307 ms; name search 4,735 ms; first 50-record
  stage page 1,376 ms on the shared local Docker host. Search remains a read-time
  causal projection; these measurements do not establish hosted latency.

Review fixes retain expanded family/stage keys through filters and realtime,
hide cached records when a stage becomes empty, and classify unfinished visits
on terminal instances as Waiting. Tests cover both stage/page response orders.
The existing approval authority check was verified against the effective
permission resolver and `current_profile`; no new approval authorization was
introduced.

Feature migrations were renumbered from the unpublished local draft to
0300-0307 because concurrent `origin/main` added 0293. No hosted migration history
was changed. Final integration must preserve current main's on-demand duties,
manual task assignment and scheduler changes.

Rendered QA uses repository Playwright because the Browser plugin/skill is
unavailable. A local synthetic authenticated run reached the application but its
first locator selected the sidebar FMS route rather than the Tasks subsection;
that test locator was corrected. The owner then updated WSL after Docker's engine
became unavailable. Docker restart and the corrected real-database browser flow
are pending. Do not infer phone/desktop rendering or successful browser handoff
from the component/database passes above.

The user guide and migration/file map are in `docs/FMS_TASK_WORKSPACE_GUIDE.md`.
Kiara help is updated; no additional Kiara read tool is needed for navigation and
naming configuration, and no Kiara mutation capability is added.
