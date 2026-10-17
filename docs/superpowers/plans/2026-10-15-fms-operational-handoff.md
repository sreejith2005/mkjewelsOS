# FMS Operational Assignment and Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution or superpowers:subagent-driven-development if selected by the owner. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move each FMS stage to its correct eligible employee through versioned form assignment and confirmed atomic handoffs, with useful task context and full web/native parity.

**Architecture:** Extend existing Forms/FMS RPCs, visit activation, permission resolution and notification triggers. Add an independently pinned assignment version, per-visit assignment provenance and pending handoff intents; preserve every legacy running instance. Web and native consume one typed protocol and shared validation/presentation logic.

**Tech Stack:** Existing strict TypeScript, React/Vite, Expo/React Native, Supabase/PostgreSQL, pgTAP, Vitest and Playwright. No new framework or workflow engine.

**Spec:** `docs/superpowers/specs/2026-10-15-fms-operational-handoff-design.md` (owner approved 2026-10-15).
**Audit:** `docs/FMS_OPERATIONAL_AUDIT_2026-10-15.md`.
**Status:** Proposed implementation plan; review and execution-method selection pending.

## Global Constraints

- Active repository: `C:\Users\MIS\Downloads\MKJewelOS`. Run commands from this root and preserve concurrent changes.
- Existing published flows and instances retain assignment version 1. New flows use version 2.
- Version 2 never reads `_fms_assignment_user_id` to decide a future owner.
- New human stages default to Previous Form. Never auto-enable same-person propagation.
- Keep the form renderer mounted while showing the confirmation modal so Cancel retains answers and causes no server mutation.
- Reuse `current_profile()`, `current_profile_is_active()`, `has_permission()` and existing module guards.
- Reuse `presentFormSubmission`, existing field/section visibility evaluation, visit infrastructure and notification closure triggers.
- New tables have RLS, restrictive section policies, no direct client writes, minimal SELECT grants and audited server writers.
- No applied migration edits, broad RLS expansion, mock persistence, customer-data test fixtures, or second workflow definition.
- Use existing UI tokens. Ordinary task behavior and CRM records remain unchanged.
- Hosted writes, Git publication and Android publication are separate gates under the repository playbook and mobile release guide.

## Review Focus

1. Lost responses and changed answers after reload: a request key must replay the original result or explicitly reject a different payload (Task 4/6).
2. Conditional hidden employee answers and conflicting join inputs: stale/irrelevant answers must never decide an owner (Task 2/3).
3. Employee becomes inactive or permissions change after preview: final activation must revalidate and roll back cleanly (Task 3/4).
4. Multi-doer or approval deferral: saved forms/intents must not pretend successor assignments already exist (Task 4/7).
5. Switching editor modes or revising legacy flows: preserve advanced settings and explicit version-upgrade choice (Task 9/10).

## Execution and migration discipline

Prefer inline execution for the tightly coupled database/protocol tasks, with a fresh final reviewer; the owner may instead select subagent-driven implementation with task-level reviews. Do not dispatch agents before that selection. All tasks below are required; a task boundary is not permission to declare the overall feature complete.

At task completion, review named diffs, run the named focused checks, and record results. Commit only reviewed task paths after `git diff --cached --check` and a credential-safe scan; exclude unrelated hunks in shared dirty files. Never bulk stage. Read the production playbook before the first commit intended for publication. A failed baseline is recorded separately from a regression.

Migration numbers 0239-0244 below are reserved proposals based on the inspected 0238 maximum. Recheck disk, Git and hosted ledgers before creating them. If a number has since been taken, allocate the next free contiguous range and update this plan before writing SQL. Never renumber an applied migration. Reconcile missing source history before applying anything locally or remotely.

## Shared protocol decisions

Implement these definitions in `packages/core/src/fms/workContracts.ts`, exported through `fms/index.ts`. IDs are UUID strings; use existing form-answer types and checked JSON conversion, not `as never` RPC escapes.

```ts
type FmsAssignmentMode = 'previous_form' | 'fixed_employee' | 'hierarchy'
  | 'previous_stage_employee' | 'manual_handoff' | 'configured_fallback';
type FmsAssignmentSource = {
  sourceStageKey: string; formTemplateId: string; fieldKey: string;
  routeRuleId?: string;
};
type FmsAssignmentConfig = {
  mode: FmsAssignmentMode; sources: readonly FmsAssignmentSource[];
  allowHandoff: boolean; fallbackRule?: FmsAssigneeRule;
};
type FmsHandoffChoice = { targetStageId: string; userProfileId: string };
type FmsWorkState = 'form_saved_pending_completion' | 'awaiting_other_doers'
  | 'awaiting_approval' | 'successors_activated' | 'workflow_completed';
type FmsTransitionRequest =
  | { kind: 'stage_form'; instanceStageId: string; formTemplateId: string;
      answers: FormAnswers; outcome: string; remark: string;
      checklist: Readonly<Record<string, boolean>> }
  | { kind: 'complete'; instanceStageId: string; outcome: string; remark: string;
      checklist: Readonly<Record<string, boolean>> }
  | { kind: 'review'; instanceStageId: string;
      decision: 'approved' | 'rejected' | 'revision_requested'; remark: string }
  | { kind: 'starter_form'; starterAssignmentId: string; formTemplateId: string;
      answers: FormAnswers }
  | { kind: 'flow_form'; flowId: string; formTemplateId: string;
      answers: FormAnswers };
```

`FmsWorkPreview` contains `fingerprint`, `currentStageName`, `wouldDefer`, `requirements`, and `destinations[]`. Each destination contains `targetStageId`, `stageName`, `formTemplateId`, `selectedUserId`, `effectiveUserId`, `employeeName`, `assignmentMethod`, `locked`, `allowHandoff`, and `issue`; nullable fields remain explicit. `FmsWorkResult` contains `state`, `submissionId`, `instanceId`, `sourceInstanceStageId`, `referenceNumber`, authorized destination summaries and `ownWorkTargets: FmsAssignedWorkTarget[]`. Runtime parsers reject malformed/unexpected RPC responses.

Public RPCs: `preview_fms_work_transition(p_request jsonb) returns jsonb`; `transition_fms_work_with_audit(p_request jsonb,p_idempotency_key uuid,p_handoffs jsonb,p_preview_fingerprint text) returns jsonb`; `list_fms_handoff_recipients(p_request jsonb,p_target_stage_id uuid,p_query text default '',p_cursor uuid default null,p_limit integer default 50) returns jsonb`. The transition RPC dispatches into the existing audited form/completion/review/start contracts and activation helpers inside one transaction; it is not a second engine. The recipient RPC first validates the actor and server-resolved destination, then returns only eligible bounded directory entries with display names, designation, branch and department. Preview fingerprints are stale-state checks, never authorization tokens. Recompute authorization and routing on every final call.

## Task 1: Reconcile baseline and create isolated database verification

**Files:** missing original migrations 0218-0230/0235 from `origin/main`; create `scripts/test-fms-contract.ps1`; update the audit evidence appendix. Do not edit unrelated existing migration/test changes.
**Interfaces:** consumes current Git/hosted ledger; produces a documented source baseline and isolated CLI workdir `.local/fms-contract` with unique project ID/ports, migration links and synthetic-only data.

- [ ] Inspect Git root/status, tracked/untracked migration collisions and `origin/main` source; fetch only if required. Restore missing authoritative files from that reference without replacing locally changed files or importing retired prototypes.
- [ ] Implement the local-only helper with `-Initialize`, `-Reset`, `-TestFile`, `-Lint`, and `-Stop` switches. Run `supabase.cmd --workdir .local/fms-contract ...` from the Git root. Refuse linked targets, validate the resolved workdir, avoid copying credentials, and never stop/reset other stacks. Initialization must not automatically reset an existing database. Confirm the workdir is ignored without committing local service state.
- [ ] Run the isolated clean reset and existing pgTAP 0112, 0115, 0123, 0149, 0150, 0160, 0193, 0212, 0232, 0233 and pending 0236 tests, plus baseline core/data/web FMS suites. Record existing failures and confirm the 0236 routing repair before depending on it.
- [ ] Record the source SHA, migration range, local project identity and exact commands. No hosted migration apply or existing-stack reset in this task.

## Task 2: Pin assignment version and validate authoring configuration

**Files:** create `supabase/migrations/0239_fms_assignment_contract.sql`, `supabase/tests/0239_fms_assignment_contract.test.sql`, `packages/core/src/fms/workContracts.ts`, `assignmentConfig.ts`, `assignmentConfig.test.ts`; modify core `fms/types.ts`, `engine.ts`, `index.ts` and web/data `fms/definition.ts`.
**Interfaces:** consumes existing stage JSON and assignee rules; produces `assignment_version` on flows/instances and `planned_time_rule.assignment`, `.completionFormRequired`, `.taskDisplay`, `.followUp` JSON configuration, plus checked normalization/validation helpers. The initial trigger uses its submitting actor; it does not require an incoming source mapping.

- [ ] Add failing tests: new draft uses version 2; existing published/running rows stay 1; legacy revision stays 1 until explicit upgrade; client instance context cannot pick a version; source field keys are preserved exactly; round-trip normalization retains all existing SLA/routing values.
- [ ] Add cases for all six modes, a fixed owner with no employee, ambiguous incoming mappings, hidden conditional fields without fallback, stale form/options, source from another flow, and fallback to reporter only when explicitly configured.
- [ ] Run `pnpm.cmd --filter @jewelos/core test -- src/fms/assignmentConfig.test.ts` and the isolated 0239 pgTAP file; capture expected failures before implementation.
- [ ] Add version-pinning triggers and extend draft-save/revision/publish contracts; store assignment-source stage keys, exact form IDs and field keys. A fixed mode is always visibly locked. Preserve existing hierarchy rules and their fallback fields on round-trip; do not filter non-specific rules out of web/data definition loaders. Revision/duplicate remaps source/route references to the copied definition and does not retain foreign-flow IDs. A required completion form is enforced on complete/review as well as form submission; legacy optional-form behavior stays optional.
- [ ] Extend server publish checks and shared validation together; retain stage-key issue navigation. Match conditional route coverage to existing visibility semantics. Configure optional `followUp.maxVisits` and explicit `onLimit: hold | escalate`, with no limit by default for human visits. Do not introduce an implicit reporter fallback.
- [ ] Rerun the focused tests and existing normalization, assignment-fields, FMS loop and publication regression suites. Inspect schema expansion for changes to existing rows beyond version defaults.

## Task 3: Resolve and record owners by exact causal visit

**Files:** create `supabase/migrations/0240_fms_visit_assignment_decisions.sql`, `supabase/tests/0240_fms_visit_assignment_decisions.test.sql`; create core `fms/assignmentPreview.ts` and `.test.ts` for deterministic synthetic evaluation.
**Interfaces:** internal SQL `resolve_fms_visit_assignment(p_instance_id uuid,p_target_stage_id uuid,p_source_visit_id uuid,p_handoff_user_id uuid) returns jsonb`; existing activation calls it for assignment version 2 only. Version 1 keeps its resolver.

- [ ] Write failing pgTAP tests A-D/G/H: A selects B, B selects C, C selects D, D selects E; default X loses to form Y; fixed X rejects override; separate parallel destinations; three loop visits preserve original ownership and answers; joined paths cannot use unrelated latest completion.
- [ ] Add success/denial cases for inactive/deleted/suspended, tenant, branch/department/designation scope, protected recipients, permission overrides and forged source IDs. Cover configured fixed/hierarchy authority separately from employee ad hoc handoff authority; reuse current task assignment scope/recipient helpers rather than duplicate their role lists.
- [ ] Run the isolated 0240 file and core assignment-preview tests to demonstrate the failures.
- [ ] Create `fms_stage_assignment_intents` (tenant/instance/source visit/target definition/actor/selected user/source submission/method/timestamps; unique source visit + target definition) and append-only `fms_stage_assignment_decisions` (those identities plus target visit, effective owner, execution/parallel scope, visit number; unique target visit). Add FK indexes, guarded provenance writes, SELECT policies with module/instance restrictions, and no direct client mutation grants.
- [ ] Integrate causal resolution into existing versioned activation, using the exact predecessor/path across structural nodes. Do not use a global latest visit or global assignment context. Validate coverage results against current eligibility and record selected versus effective employee; persist the decision only when the target visit is created. Reassignment uses existing history/logs and links the original decision.
- [ ] Implement explicit conflicting-join handling and visit-limit holds/escalation using existing logs/authority. Preserve automatic-transition guards, nested split tokens and mandatory join behavior.
- [ ] Rerun focused SQL/shared tests, existing 0193 legacy and 0212 execution tests. Assert audit rows, RLS denial, no duplicate activation and unchanged historical visit data.

## Task 4: Implement read-only preview and atomic confirmed transition

**Files:** create `supabase/migrations/0241_fms_confirmed_work_transition.sql`, `supabase/tests/0241_fms_confirmed_work_transition.test.sql`, `scripts/fms-transition-race.test.mjs`; extend `fms_workflow_mutation_keys` and core protocol parsers.
**Interfaces:** public preview/final RPCs defined above; internal route planner consumes validated candidate answers without inserting a submission. It is reused by preview and final execution. Existing engine remains the only activator.

- [ ] Write failing tests for preview with zero new rows, per-target manual handoff, locked conflicts, terminal confirmation, changed recipient after preview, forged extra destination, stale route/outcome, cross-instance submission, and actor identity resolved only from Auth.
- [ ] Add deferred cases for checklist/evidence/remark, approval, any/all doers, rejection and revision. Assert correct `FmsWorkState`, no premature successor, and persistence/revalidation of pending intents through later completion/review.
- [ ] Add same-key/same-payload replay and changed-payload/target rejection before returning cached results. In a two-connection local-only Node test, submit the same key concurrently; assert one submission/result/activation/audit decision. Use synthetic local credentials held in process; never print them.
- [ ] Run focused pgTAP/race tests to demonstrate missing-contract failures.
- [ ] Implement strict request parsing, tenant/source locks in consistent order, exact form validation, canonical request hash, preview fingerprint recomputation and atomic dispatch through existing submit/complete/review/start operations. Retain original public signatures for legacy callers; every callable legacy mutation that could bypass version-2 required handoff/assignment validation must share the same server guards. Do not rely on a client flag proving a modal was opened.
- [ ] Stage-form submission saves valid intent and completes only when existing requirements are satisfied. Later completion/review consumes persisted intent. Rejections and revisions cannot accidentally activate a proposed normal successor. Roll back all form/intent writes on invalid final transition.
- [ ] Run the focused suite and all affected form/FMS/notification SQL regressions. Verify ordinary task form completion and private file linkage remain unchanged.

## Task 5: Add narrow work context and task presentation projection

**Files:** create `supabase/migrations/0242_fms_assigned_work_context.sql`, `supabase/tests/0242_fms_assigned_work_context.test.sql`, core `fms/workPresentation.ts` and `.test.ts`; modify FMS task projection by forward migration only.
**Interfaces:** `get_fms_assigned_work_context(p_instance_id uuid,p_instance_stage_id uuid,p_cursor text default null,p_limit integer default 20) returns jsonb`; shared `presentFmsWorkContext(input): FmsPresentedWork` supplies title, summary, instructions, received answers, expected result and permitted timeline.

- [ ] Add failing tests for exact visit/form pinning, configured initial and causal previous answers, unreadable/unrelated submissions excluded, bounded history, renamed users/options, deleted historical users and files with no exposed Storage paths.
- [ ] Run focused SQL/presentation tests; implement the guarded field projection and bounded non-executable title substitution. Reuse `presentFormSubmission` with a safe historical-person fallback for FMS context. Do not broaden general `form_submissions` RLS or expose raw submissions through a definer RPC.
- [ ] Provide compact display fields for FMS task cards through the existing task-feed projection/query path; preserve ordinary-task columns, filters and permission behavior. Large text answers stay off cards. Keep open undated/future FMS work visible through `taskFeedCurrentOrOverdueFilter`.
- [ ] Run SQL denial cases, core presentation tests and existing task-feed/ordinary-task regressions. Check indexed query plans with a large synthetic history and confirm pagination/current-visit evidence bounds.

## Task 6: Wire typed APIs, stable request identity and exact starters

**Files:** create `packages/data/src/fms/work.ts`, `work.test.ts`, `mutationIdentity.ts`, `mutationIdentity.test.ts`; modify web/data FMS and forms APIs, `packages/api-client/src/database.types.ts`, `packages/core/src/database.types.ts`, `FormsPage.tsx`, `FmsAssignedWorkPage.tsx`, native `FormFillScreen.tsx`; create `supabase/migrations/0243_fms_exact_form_starters.sql` and matching pgTAP file.
**Interfaces:** `previewFmsWork(request): Promise<FmsWorkPreview>`, `transitionFmsWork({request,idempotencyKey,handoffs,previewFingerprint}): Promise<FmsWorkResult>`. Both surfaces reuse data-layer transport. Mutation-identity adapter offers get/create/mark-complete by authenticated user + durable work target + operation.

- [ ] Add failing API tests for typed request/response parsing, malformed results, stable retry key, target/payload mismatch, sign-out/user-switch isolation and completed starter replay. Generic Forms submission shared by two flows must require explicit authorized flow identity; never infer assigned work from form ID.
- [ ] Run focused data tests; implement web session storage and native storage adapters retaining only key/target metadata, never form answers or credentials. For a new standalone form submission, retain one operation ID until success; explicit Start another form rotates it. After an uncertain/lost response, recover the original result before allowing a different payload under that operation.
- [ ] Extend exact flow/form starter binding and legacy entry guards server-side. Reuse initial route evaluation from validated 0236; ensure generic legacy RPCs cannot accidentally create duplicate version-2 instances. Keep one instance across internal pipelines.
- [ ] Return a readable start confirmation; navigate only to returned `ownWorkTargets` using `fmsAssignedWorkPath`. Keep old starter/deep links parseable. Do not open another employee's work merely because an instance was created.
- [ ] Regenerate database types from the isolated complete migration state, inspect only relevant deltas in the already-dirty generated files, and remove new RPC type escapes. Run data/forms API, starter, assigned-page and native navigation tests.

## Task 7: Implement web and native confirmation before final submission

**Files:** create web `features/fms/FmsHandoffConfirmation.tsx`, `.test.tsx`, `FmsStageRunner.handoff.test.tsx`; native `features/fms/FmsHandoffConfirmation.tsx` and `fms/handoffController.ts`/`.test.ts`; modify web `FmsStageRunner.tsx`, `FormRenderer.tsx`; native `FmsStageFormScreen.tsx`, `FmsStageScreen.tsx`, `forms/FormRenderer.tsx` and navigation parameters only as needed.
**Interfaces:** shared request/preview/result and data transport from Tasks 4/6; controller states editing -> previewing -> confirming -> submitting -> result, with cancel -> editing and recoverable errors -> confirming/editing.

- [ ] Write failing interaction tests: click Submit validates, previews, opens modal and makes zero transition calls; Continue uses the proposed employee; Different uses eligible picker; Cancel preserves answers; final/parallel/fixed cases render correct controls; duplicate clicks submit once.
- [ ] Verify the existing renderer's success flag does not mark a form successful merely because preview opened. Add a backwards-compatible optional pre-submit confirmation hook awaited inside its existing submission lifecycle; cancellation exits without setting success. Keep the renderer mounted and preserve validation/focus/scroll behavior.
- [ ] Implement the exact title `Complete Stage and Assign Next Work`, requested three choices, per-destination assignment rows and authorized name/designation/branch/department labels. Load eligible candidates from the server scope contract, not a local active-account filter. Show fixed-owner conflicts and coverage explanations.
- [ ] Use the same confirmation path for separate Complete/Approve actions when form/evidence rules previously deferred progression; stage without successors uses final completion confirmation. Display actual pending/approval/success results from the backend.
- [ ] Run `pnpm.cmd --filter web test -- src/features/fms/FmsHandoffConfirmation.test.tsx src/features/fms/FmsStageRunner.handoff.test.tsx` and `pnpm.cmd mobile:test -- src/fms/handoffController.test.ts`. Check native rendered interaction on a connected device during Task 12; pure controller tests are not device proof.

## Task 8: Make all assigned entry surfaces useful and bounded

**Files:** modify `FmsAssignedWorkPage.tsx`, web/data FMS loaders, `FmsStageRunner.tsx`, web/native TaskCard and task-details components, Home FMS summaries, native `FmsStageScreen.tsx`, `FmsInstanceScreen.tsx`; create web `FmsWorkContext.tsx` and corresponding native component; extend `FmsAssignedWorkPage.test.tsx`, core presentation and data loader tests.
**Interfaces:** `loadFmsAssignedStage(instanceId,instanceStageId)` loads current visit and required definition; separate context cursor supports journey pages. Preserve an explicit compatibility path for old instance-only links resolving only the caller's authorized actionable work.

- [ ] Add failing tests that opening one work item never calls `loadForms()` or whole-company runtime/history loaders; fetch current form through `loadTaskForms`. Assert exact instance/visit mismatches are denied rather than falling through to generic instance lists.
- [ ] Render Work Summary, Information Received, What You Need To Do, Work Completion Form, What Happens Next and permitted Workflow Journey. Use current visit context and configurable display metadata; keep pinned form rendering/attachments intact.
- [ ] Prioritize compact client/reference/answer fields on FMS cards and use `Open and Complete Work`; preserve ordinary task details and actions. Keep the canonical durable assignment on Home, Tasks, Notifications and direct links.
- [ ] Run assigned-page, loader, task-feed, ordinary TaskCard/TaskDetails and navigation regressions. Inspect phone/desktop layout with long labels, historical names, missing optional context, no date and repeated visits.

## Task 9: Implement assignment, completion-form and display settings in both builders

**Files:** modify web/native FMS stage editors and definition adapters; create web/native `FmsAssignmentSettings.tsx`, `FmsTaskDisplaySettings.tsx`; modify `FmsFlowBuilder.tsx`, native `FmsBuilderScreen.tsx`, shared assignment/config validation and tests.
**Interfaces:** consumes exact `FmsAssignmentConfig`, `.taskDisplay`, `.followUp` and version-upgrade contracts from Task 2; Forms editor launch/return state includes the saved draft and stage key, never a duplicate workflow definition.

- [ ] Add failing tests for all mode labels, form-driven default, explicit fixed lock, optional configured fallback, route-specific user mappings, no automatic first-person propagation, retained hierarchy rules, version upgrade acknowledgement and unchanged active instance behavior.
- [ ] Implement Select Existing, Create New, Preview, Open Builder and View Published Version using existing Forms authoring. Save the FMS draft before navigation; return to the same draft/stage and explicitly select a newly published form version. Respect `forms.manage` separately.
- [ ] Implement display mapping, expected result, instructions and optional visit limit/escalation settings. Show field labels while persisting stable keys/pinned versions. Existing context defaults become explicit optional fallback choices, without changing legacy version-1 behavior.
- [ ] Run web stage-editor/flow-builder tests, data builder tests and native authoring model tests; inspect both rendered editors in Task 12.

## Task 10: Add simple authoring, pipeline grouping and deterministic preview

**Files:** create core `fms/simulation.ts`/`.test.ts`, web `FmsSimpleBuilder.tsx`, `FmsWorkflowPreview.tsx` and tests; native counterparts; modify both graph canvases, existing step lists, builder mode switch and shared graph presentation as necessary.
**Interfaces:** `simulateFmsWorkflow({definition,answersByStage,directory,now,maxTransitions}): FmsSimulationResult`; defaults `maxTransitions` to 100 and returns a visible truncated trace rather than looping. It performs no I/O and never calls mutation RPCs. Preview shares route/assignment helpers with core validation and has SQL parity fixtures.

- [ ] Add failing tests for Initial Form -> Stages -> Assignments -> Conditions -> Review -> Publish, graph-to-simple-to-graph exact configuration preservation, and a nonlinear graph remaining editable without deleting routes.
- [ ] Implement graph summaries for form, assignment, timing, successor and validation. Add optional pipeline label/group metadata and visual grouping without changing execution or creating extra instances. Preserve drag/pan/zoom/undo/redo/connect/reconnect/duplicate/delete and phone hit targets.
- [ ] Add synthetic dry-run trace showing matching conditions, path, selected employee, task preview, linked form and subsequent state. Require an explicit synthetic directory snapshot and freeze `now` for reproducible timing. Display simulation assumptions.
- [ ] Test conditional assignment, loops exiting/capped, parallel completion and deterministic repeated traces; assert zero mutation requests. Run core graph/canvas/simulation tests and web/native builder regressions.

## Task 11: Separate authoring access and remove normal manual starts

**Files:** modify core `roleMenu.ts`, permissions page-access integration, web `App.tsx`/`FMSBuilderPage.tsx`, native FMS navigation/screens, shared navigation tests; create `supabase/migrations/0244_fms_authoring_execution_access.sql` and matching pgTAP test without adding a new role.
**Interfaces:** builder route/menu requires effective `fms.manage`; assigned execution uses durable ownership and existing runtime section guards. `fms.view` remains runtime visibility, not automatic management authority.

- [ ] Write failing allowed/denied tests: Super Admin and delegated builder author; ordinary staff cannot open authoring by menu/direct URL/RPC; staff complete own assignments through Tasks/Home/Notifications; user-specific manage grant/deny and dashboard authority behave consistently.
- [ ] Remove Start instance from normal web/native usage, retain deliberate legacy RPC compatibility, and preserve old URLs through the shared parser. Check restrictive SELECT policies and shared permissions views so hiding authoring does not hide assigned forms/context.
- [ ] Test management-inspection scope, maintenance disablement, direct API forging and cross-tenant work IDs. Run role-menu/catalog-parity, App route, native shell/navigation and affected SQL authorization suites. Regenerate/check database types after this final schema/privilege migration and inspect scoped deltas again.

## Task 12: Complete acceptance A-M, regression and release evidence

**Files:** create `scripts/fms-operational-e2e.mjs`, `docs/FMS_OPERATIONAL_VERIFICATION_2026-10-15.md`, `docs/FMS_USER_GUIDE.md`; refresh audit outcomes and `docs/REGRESSION_CHECKLIST.md` only for new workflow checks. Do not rewrite unrelated handoff history.
**Interfaces:** synthetic acceptance fixture has A/B/C/D/E plus default X, fixed Y, protected manager, inactive and cross-tenant users; browser/device uses the same durable assignment identities.

- [ ] Implement/reuse local synthetic fixtures for automatic start A, successive reassignment B/C, fixed conflict D, modal E, conditional F, repeated visit G, parallel H, context I, permission J, all entry surfaces K, concurrent duplicate L and protected regressions M. Exclude customer records from artifacts/logs.
- [ ] Run all new pgTAP files, existing affected suites and local DB lint in the isolated stack. Run core/data/web suites, native tests/typecheck and `pnpm.cmd exec turbo run typecheck --force --concurrency=1`, `pnpm.cmd exec turbo run build --force --concurrency=1`, `git diff --check`. Reduce workers if concurrent-stack pressure causes timeouts; do not conceal deterministic failures.
- [ ] Use the frontend testing skill and available browser tool first for rendered QA. Record desktop 1440x900 and phone 390x844 proof, keyboard/focus/cancel behavior, error/empty/loading states and no horizontal overflow. Run the synthetic automated scenario with `pnpm.cmd exec node scripts/fms-operational-e2e.mjs` against a local-only app; refuse hosted origins in this harness.
- [ ] Check `adb devices -l`, exercise installed native form/handoff/builder and incoming work links on a connected phone, record app version and results. No connected device is an explicit unproven gate, not a browser substitute.
- [ ] Verify ordinary tasks, required forms, delegation, manager approvals, evidence/checklists, notification closure/history, form/FMS revisions, old running workflows, permission overrides and existing CRM regression tests. No CRM schema/data changes are included.
- [ ] Request a fresh whole-change review after local checks; resolve findings and rerun affected tests. Prepare named-path commits without unrelated work. The review must inspect authorization, causal provenance, atomicity, SQL/core parity, source upgrades and acceptance coverage, not only code style.
- [ ] Follow `PRODUCTION_SWITCH_PLAYBOOK.md`: verify linked target/ledger, dry-run, staging synthetic proof and required operational approvals before production. Reconcile all pending migrations; never apply unrelated 0237/0238 merely because they are pending. Treat Git push, Supabase migration, web deployment and authenticated hosted smoke tests as separate outcomes.
- [ ] For mobile-affecting changes, follow `docs/MOBILE_RELEASE_GUIDE.md` and the standing release authorization: after every required gate passes, use `scripts/release-mobile.ps1`, push the scoped release commit to `origin/main`, and verify public manifest/APK. No `-Mandatory` without explicit approval. Stop publication if runtime/device/signing/staging gates fail and report exactly which gate remains open.
- [ ] Deliver report A-F: repaired audit findings, exact paths, migration/RPC/RLS/audit/type changes, commands/results, Super Admin/employee instructions and remaining blockers. Never call unverified changes production-ready.

## Self-review and owner checkpoint

Coverage: original phases 1 and 13 are covered by Tasks 1-6/12; phase 2 by 2-4/9; phase 3 by 4/6/11; phases 4-5 by 2/4/7/9; phase 6 by 5/8/9; phase 7 by 11; phases 8-12 by 2/3/9/10; phases 14-16 and acceptance A-M by 12. The five Review Focus cases each have explicit task tests. Compatibility, inactive/cross-scope denial, exact form pinning, prior-context disclosure, file authorization and signed release gates are included.

The owner approved this design and plan and selected inline implementation. Implementation and local verification are in progress; publication remains gated by the production playbook and device/runtime evidence. Do not request design approval again.

2026-10-17 scope update: the owner explicitly deferred Android and requested
the web app be finished first. Android/device/APK items above are deferred for
this scope. Existing native edits are preserved. Web/database implementation
and focused verification are recorded in
`docs/FMS_IMPLEMENTATION_REPORT_2026-10-17.md` and
`docs/FMS_OPERATIONAL_VERIFICATION_2026-10-15.md`; Task 12 remains open for the
combined SQL replay/lint, expanded browser proof, independent review and web
release gates. Docker Desktop currently returns HTTP 500 and the dedicated
API/database ports are unreachable. No unrelated stack is restarted.
