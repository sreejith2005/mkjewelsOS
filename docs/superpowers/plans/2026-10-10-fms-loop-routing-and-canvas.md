# FMS loop routing and canvas implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> for inline execution, or superpowers:subagent-driven-development if the owner
> selects delegation. Checkboxes track execution, not design approval.

**Goal:** Support fresh-work backward routes and make interconnected workflows
readable and editable across desktop web, mobile web, and Android.

**Architecture:** Version the database execution engine for new publications
and new instances. Record each visit and its execution/parallel scope, retaining
legacy instances. Share obstacle-aware edge geometry between both canvases.

**Tech Stack:** TypeScript, React, React Native, SVG, Postgres, Supabase RPC,
Vitest, pgTAP; existing libraries and design tokens.

**Spec:** `docs/superpowers/specs/2026-10-10-fms-loop-routing-and-canvas-design.md`

## Global constraints

- Fresh visits preserve previous work, form submissions, evidence, and alerts.
- Running instances keep their previous execution semantics.
- Conditional routes are first-match; fan-out remains explicit.
- Server authorization and audited atomic submission/progression remain intact.
- Runtime routing never reads canvas coordinates.
- Applied migrations are immutable; reserve the next available migration number.
- Work in `C:\Users\MIS\Downloads\MKJewelOS`; preserve unrelated commits.
- Publish Android only through `scripts/release-mobile.ps1` after required gates.

## Review focus

- Two simultaneous completions must produce one successor within one pass.
- A loop in one parallel branch must not retire another branch's open work.
- A prior split/join completion must not satisfy a new split/join activation.
- A current form visit must not accept another visit's submitted form as evidence.
- Dense manually placed cards must retain editable edges and readable labels.

## Task 1: Shared graph validation and geometry

**Files:** `packages/core/src/fms/engine.ts`, new `graphRouting.ts` and
`graphRouting.test.ts`, `fms.test.ts`, `index.ts`; existing
`packages/data/src/fms/graph.ts`, `apps/web/src/features/fms/graph.ts` and tests.

**Interfaces:** Add `validateFmsRoutingGraph(stages: readonly
FmsStageDefinition[]): readonly FmsValidationIssue[]` and
`routeFmsGraphEdges(edges: readonly FmsCanvasEdge[], positions:
ReadonlyMap<string, FmsPoint>, node: FmsSize): readonly FmsRoutedEdge[]`.
`FmsCanvasEdge` carries stable ID, source, target, kind, and display label;
`FmsRoutedEdge` adds SVG path, source/target ports, label anchor/bounds,
return-route flag, and bounds. Export through core. Preserve existing graph
exports for callers.

- [x] Write failing tests for Follow Up 3 -> Follow Up 1 -> exit, self-return
  with exit, closed reachable loop rejection, and automatic-only cycle rejection.
  Verify all reachable nodes can reach an unconnected completion node. Follow
  actual outgoing routes, not stage order, when finding loops.
- [x] Write failing geometry tests: backward paths avoid intervening node
  interiors, parallel edges get distinct lanes/labels, ports face arrow direction,
  self-return clears its card, every coordinate is finite, saved positions win.
- [x] Run `pnpm.cmd --filter @jewelos/core exec vitest run src/fms/fms.test.ts
  src/fms/graphRouting.test.ts`; confirm intended failures.
- [x] Implement reachability and strongly connected component checks. Replace
  the generic cycle rejection with missing-exit and automatic-cycle issues.
- [x] Implement deterministic rectilinear routing using node-expanded obstacle
  bounds, free-space channels, lane separation, rounded corners, and explicit
  exterior return lanes. Reserve label rectangles and include them in bounds.
  When cramped saved positions provide no gap, use exterior channels rather
  than draw through cards. Consolidate the two graph modules through shared
  exports without changing route naming or persisted positions.
- [x] Run focused tests; retain acyclic validation and readable question/answer
  label tests. Review the scoped diff.

## Task 2: Versioned fresh-visit execution and parallel scopes

**Files:** new `supabase/migrations/0212_fms_loop_execution.sql` and
`supabase/tests/0212_fms_loop_execution.test.sql` (recheck number before writing),
`packages/core/src/database.types.ts`, both FMS API row declarations.

**Interfaces:** Preserve public completion/submission RPC signatures. Add
`execution_version` to flow and instance, `visit_number` and
`execution_scope_id` to instance stages. New private execution-scope and join
arrival tables are reader-protected by tenant/instance access and writable only
through the engine. Scope records identify parent scope and initiating split/
loop execution; arrivals identify their split activation, join definition,
incoming branch, and contributing execution. Engine helpers are owner-only.

**Scope rules:** Root activation creates a root pass. Normal successors inherit
the pass. A split creates a cohort tied to that exact split execution, with
branch scopes referencing that cohort; nested splits create nested cohorts.
A route closing a causal path to an ancestor creates a fresh local pass and
revisits that target. A loop within a branch retains the enclosing split cohort
and does not replace sibling work. A return across a split boundary restores
the target's enclosing scope and creates a fresh pass there; replaying the
split then creates a fresh cohort. Joins accept arrivals only from their exact
cohort and required branch identities; they emit one successor into the parent
scope. Deduplication uses instance + definition + pass, not definition alone.

- [x] Write failing pgTAP execution fixtures for the reported loop with two
  repetitions and an exit, fresh form/checklist/assignment IDs, unchanged prior
  answers, repeated completion, concurrent-equivalent retries, convergence,
  nested split/join replay, and a local branch loop preserving sibling work.
- [x] Write allowed/denied tests for unauthenticated/inactive users, tenant and
  branch boundaries, ordinary assignees, managers, Super Admin, service role,
  direct helper calls, and private scope-table writes. Verify audit and alert
  IDs refer to the new visit.
- [x] Run local database tests to confirm expected failures before migration.
- [x] Add version defaults preserving existing published flows/instances.
  Set version 2 only through new publication and copy it server-side when
  starting an instance. Do not trust client context for engine/scope identity.
- [x] Preserve the current activation implementation as the version 1 path.
  Implement scope-aware version 2 activation under an instance row lock; create
  a fresh visit on causal return and reuse an existing visit on convergence or
  retry within one pass. Retain prior records and existing revision behavior.
- [x] Replace version 2 join readiness with cohort arrivals, including `any`,
  `all`, and `specific`; count branch identities once, not historical rows.
- [x] Preserve current authorized completion and routing behavior. Form-answer
  routing reads the current visit's submission. Revisited initial forms use
  fresh `fms_stage` submissions; the original starter submission stays intact.
  Preserve assignment precedence, SLA resolution, upload/checklist rules,
  explicit revisions, rejection, and child workflow behavior.
- [x] Bound automatic transitions; on exhaustion persist an audited `on_hold`
  state and actionable stage log instead of recursively activating forever.
- [x] Apply new publish checks server-side and retain all existing form,
  assignment, scope, timing, fallback, and permission validation.
- [x] Generate types from the local schema. Run `supabase.cmd test db` and
  `supabase.cmd db lint --local --level warning`, including legacy acyclic,
  starter submission, permissions, form assignment, and notification tests.

## Task 3: Web and native canvas interaction

**Files:** both `FmsGraphCanvas.tsx`, web `FmsFlowBuilder.tsx`, native
`FmsBuilderScreen.tsx`, both `FmsStageEditor.tsx`, relevant existing builder
tests, new focused canvas tests.

**Interfaces:** Consume Task 1 routed edges; keep callback signatures for
connect/reconnect/disconnect and persisted `onMove` positions.

- [x] Add failing tests for return/self connections, distinct connections to
  the same target, node/edge highlight, destination details, auto-arrange, and
  fit bounds including loops. Cover selection/reconnect/remove at phone width.
- [x] Replace edge rendering in both canvases with shared paths, ports, label
  bounds, return indicators, and destination arrowheads. Keep temporary drag
  previews, native hit-testing, and endpoint controls aligned to those paths.
- [x] Emphasize selected-node connections and edge endpoints; expose full
  route/source/destination details on selection and retain touch-size controls.
- [x] Add explicit auto-arrange and preserve saved positions otherwise. Fit
  nodes, labels, and return lanes. Keep existing pan/zoom/drag/duplicate/delete.
- [x] Permit backward and self connections; remove obsolete unsupported-cycle
  UI messages. Surface the new missing-exit/automatic-cycle errors at their node.
- [ ] Run web/data/core and mobile focused tests and typechecks. Verify desktop
  and phone browser behavior and native pinch/drag/connect on a connected device.

## Task 4: Runtime presentation and cross-surface regressions

**Files:** web/native stage runners and runtime views, both FMS API modules,
FMS runtime tests, assigned-work navigation tests; other consumers only where
inspection demonstrates a change is necessary.

- [x] Inventory Home/Tasks/Notifications/Forms/deep-link consumers across web,
  native, core, data, API client, and migrations. Add tests demonstrating that
  completing visit 1 does not complete visit 2 or close visit 2's notification.
- [x] Load/display visit identity and retained history, key selected/form work
  by instance-stage ID, and preserve exact assignment URLs. Confirm feed filters
  still expose open future/undated FMS work and direct links authorize normally.
- [x] Verify the latest visit's status does not disappear behind completed
  template-level history. Keep earlier evidence/forms inspectable with existing
  read permissions. Verify fresh initial-form visits open the correct form.
- [x] Run core/data/web relevant suites, mobile suite, monorepo typecheck/build,
  mobile typecheck/export, and `git diff --check`. Record existing unrelated
  baseline failures separately; do not silently widen implementation scope.

## Task 5: Review and release gates

- [ ] Review all named paths against the approved spec and manual
  `docs/REGRESSION_CHECKLIST.md`. Record local DB, browser, device, and hosted
  results separately. Stop publication if required evidence is unavailable.
- [ ] Read the full production/mobile release guides; verify Git root,
  branch integration scope, and linked Supabase project. Run migration ledger
  comparison and linked dry-run before any authorized hosted apply.
- [ ] Stage only reviewed feature paths; inspect the staged diff, staged
  whitespace check, and credential-safe scan. Commit without unrelated paths.
- [ ] After required gates pass, release via `scripts/release-mobile.ps1`, push
  the reviewed integration/release commit to `origin/main`, and verify public
  `latest.json`, signed APK asset, web hosting, and exact hosted schema version.
  Do not use `-Mandatory` without explicit approval.

## Baseline evidence (2026-10-10)

- `pnpm.cmd --filter @jewelos/core exec vitest run src/fms/fms.test.ts src/fms/canvas.test.ts`: 87 passed.
- `pnpm.cmd --filter @jewelos/data exec vitest run src/fms/runtimeView.test.ts src/fms/builder.test.ts`: 38 passed.
- `pnpm.cmd --filter web exec vitest run src/features/fms/graph.test.ts src/features/fms/FmsFlowBuilder.test.tsx src/features/fms/runtimeView.test.ts`: 46 passed.
- Docker is running. No database reset, migration apply, or hosted test ran.
- `adb devices -l`: no connected device; native runtime/release gate is open.
- Worktree changes are only this plan and its design document. Baseline tests
  prove existing covered behavior, not the proposed implementation.

## Execution handoff

Owner approved the plan and inline execution on 2026-10-10. Implementation is
in the working tree. The owner subsequently explicitly authorized deploying the necessary migration and pushing the scoped FMS implementation to main. APK publication remains subject to the device gate.

### Implementation decisions and review fixes

- Root/local pass identity is a UUID on visits. `fms_execution_scopes` records
  split cohorts, not one row for every root pass. Reverse exit reachability and
  automatic-subgraph cycle checks implement the approved graph safety rules.
- Migration 0212 pins legacy publications/instances to version 1 and selects
  version 2 on new draft publication. Existing running work is not retargeted.
  Revise/publish an older workflow to use the new execution semantics.
- Fresh visits preserve completed assignments, original form answers, checklists,
  evidence and notification history. Public audited RPC signatures stay the same.
  Instance row locking and a unique definition/pass key serialize activations.
  Repeated/late activations are covered; a real multi-connection load test was
  not run.
- Cohort arrivals support all/any/specific joins. `fms_visit_inputs` retains
  shared-task branch provenance. `fms_visit_transitions` records the actual
  selected destination and successor visit so late convergence cannot duplicate
  a previously chosen return assignment or choose a different conditional route.
- The activation guard holds and audits an instance after 100 automatic
  transitions. Automatic-only cycles and reachable regions without an exit fail
  publication. Fresh initial-form revisits require their own submitted answers.
- A direct cross-tenant administrator completion gap found during testing is
  closed inside the existing completion transaction. No permission resolver is
  duplicated. New provenance tables have RLS and owner-only writes. Parent
  cleanup cascades within the existing guarded retirement operation; its inventory
  includes the new provenance. Storage contracts are unchanged.
- API lists and scoped visit histories paginate stage rows. Scoped details retain
  authorized parent/child metadata, and latest-visit progress preserves every
  independent open assignment. Assigned-work URLs continue to use runtime IDs.
- Web/native canvases share obstacle-aware rounded paths, separate return lanes
  and ports, readable condition labels, selected connection details/highlights,
  explicit auto-arrange and bounds-aware fitting. Saved positions remain intact.
  World dimensions grow with workflows; both clients allow 10% overview zoom.
  Native port hit areas are bounded at overview zoom so they do not swallow
  drags initiated inside a card.
- Independent review reproduced and corrected shared convergence, late return
  duplication, list truncation, lineage loss, exterior clipping and native card/
  edge coordinate mismatch. Source-based older pgTAP assertions now inspect the
  appropriate versioned engine; executable behavior is covered by 0212 fixtures.

### Validation evidence

- `supabase.cmd db reset --local`: clean rebuild through 0212 passed. Local
  synthetic database only; no hosted project mutation.
- `supabase.cmd test db supabase/tests/0212_fms_loop_execution.test.sql`: 83 checks
  passed, including repeated form loops, shared/late return convergence, nested
  joins, all/any/specific readiness, version-one completion, notification identity,
  audited hold, ordinary assigned actors and denied inactive/unassigned/cross-
  branch/cross-tenant/helper/table write cases.
- `supabase.cmd test db`: 119 suites / 2949 checks passed after the final clean rebuild.
- `supabase.cmd db lint --local --level warning`: completed with existing CRM,
  task and pgTAP-extension warnings/errors; the new engine's unused variable was
  removed. Final lint found no issues in new FMS routines; five existing routines still
  have findings. CLI exit zero alone is not a clean lint.
- `pnpm.cmd --filter @jewelos/core test`: 69 suites / 809 checks passed; the final canvas helper regression also passed
  with its focused 21-check canvas suite.
- `pnpm.cmd --filter @jewelos/data test`: 17 suites / 105 checks passed.
- `pnpm.cmd --filter web test`: 91 suites / 426 checks passed; the additional
  boundary regression passed separately (3 canvas tests total).
- `npm.cmd --prefix apps/mobile test`: 24 suites / 126 checks passed.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1` and build with the
  same options passed, including generated-type/client rechecks. A subsequent
  core build and native typecheck covered the overview hit-area helper.
- Native typecheck and final Android Expo export passed (3690 modules, Hermes
  bundle written outside the repository). An unrelated appAvailability test
  exceeded its five-second timeout under concurrent build load; its focused
  retry and the subsequent full native run passed (24 suites / 126 checks).
- Browser plugin tools were unavailable, so existing Playwright 1.63 provided
  local rendered canvas QA. Desktop: return routes, full details, pointer
  reconnect, self-return and auto-arrange. Phone 390x844: return tap/details/remove,
  no page overflow. No browser errors. This was a component regression fixture,
  not authenticated hosted action parity. Temporary screenshots stayed outside Git.
- `git diff --check` passed. No unrelated paths changed or staged.

### Remaining release gates

No device is connected (`adb devices -l`). Native pinch/drag/reconnect behavior,
authenticated cross-surface actions and hosted migration/deployment remain
unproven. Per AGENTS.md, do not publish an unverified employee APK. Keep Android
publication pending the required runtime/release checks; the owner subsequently
authorized database and Git publication separately (recorded below); do not
use `-Mandatory`. The next operational gate is connected-phone validation,
then reviewed integration and linked-project migration ledger/dry-run under the
production playbook, followed by controlled web/Android publication.


### Authorized database and Git rollout (2026-10-10)

The owner explicitly requested: "deploy necessary migrations and push to main".
This authorizes the database/Git rollout separately from the Android publication.
Target: JewelOS production, project `yimafxhuwgfhvzczqqdd`.
Preflight: linked ledger matches through 0211; dry-run contains only
`0212_fms_loop_execution.sql`, with no seeds, roles or other migrations.
Current HEAD matches origin/main before the scoped FMS commit. Concurrent task
management edits are excluded from staging and preserved in the worktree.

Compatibility: existing published flows and running instances remain execution
version 1. Newly published drafts use version 2. No customer records are
retargeted or deleted; original submissions and completed visits remain intact.
Recovery: retain the compatible prior web commit and pre-migration public-schema
snapshot outside Git; database corrections must use a reviewed forward migration.
The schema snapshot is not a full data backup or proof of a restore drill.
No functions, secrets, Storage policies or Android assets are being deployed.

Local release recheck: focused core routing/visits/canvas, paginated history,
web canvas/builder and migration 0212 tests; monorepo typecheck. Existing full
local suite/build evidence above remains separate from hosted verification.
Hosted ledger verification will establish migration installation only; separate
staging and authenticated hosted workflow smoke tests remain unproven.
Android pinch/drag/reconnect and employee APK publication remain pending a
connected phone and the required signed-release checks.

Fresh rollout rechecks: core 98/98, data history 2/2, web canvas/builder/graph
32/32, local migration 83/83; staged whitespace and credential-pattern scans passed.
Pre-migration public-schema snapshot completed outside Git.
Migration SHA256: `6e06cd8ea423a2349e115f6290093faec0247e495922aa9066eb0bde62ac2fd3`.

Fresh monorepo typecheck passed: 6 packages, forced sequential execution.

### Database/Git rollout outcome (2026-10-10)

- Implementation SHA: `4682a4848521f99be18a33e4bb83f32978ebe75f`.
- Applied only `0212_fms_loop_execution.sql` to the confirmed JewelOS production
  project `yimafxhuwgfhvzczqqdd`; CLI apply succeeded, without seeds or role imports.
- Hosted ledger: local/remote both 0212, zero unmatched entries. Post-apply linked
  dry-run reports up to date and no pending migrations.
- Post-apply schema snapshot confirms all four provenance tables with RLS enabled
  and the versioned activation/visit/version-trigger functions. Both schema
  snapshots remain in the local temporary directory, outside Git.
- Normal fast-forward push to `origin/main` succeeded; remote main was verified
  at the implementation SHA. No unrelated paths were included in the FMS commit.
- This confirms database installation and Git publication. Authenticated hosted
  workflow smoke tests, web-host readiness and connected native runtime evidence
  remain separate and unproven. No APK was published and no update was mandatory.
