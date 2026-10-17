# FMS implementation report — 2026-10-17

Release numbering: this document records the original isolated development stack. The main-based release uses migrations `0260`-`0284`, preserving production task-video migration `0259`. See `FMS_WEB_RELEASE_2026-10-17.md` for the exact mapping and current release outcome. Do not apply the development filenames to production.

The approved FMS repair is implemented locally with verification still in
progress. This report does not authorize or establish a production release.
Current command results and open gates are maintained in
`FMS_OPERATIONAL_VERIFICATION_2026-10-15.md`; operational instructions are in
`FMS_USER_GUIDE.md`. The original audit retains its pre-change evidence in
`FMS_OPERATIONAL_AUDIT_2026-10-15.md`.

Scope update from the owner, 2026-10-17: finish the web app now; the owner will
handle Android later. Existing native edits remain in the worktree, but native
runtime checks and APK publication are deferred and do not block this web scope.

## A. Findings and repairs

| Finding and cause | Repair and source |
| --- | --- |
| Ordinary named defaults took precedence over each new form answer; `_fms_assignment_user_id` carried one employee through the instance | Versioned assignment configuration and exact causal-visit resolution, migrations 0239–0240. Legacy version 1 remains unchanged |
| Submission advanced work before an employee could review the next owner | Read-only preview followed by a validated atomic transaction with per-destination choices, request hash, fingerprint and durable retry result, 0241, 0245, 0248, 0252–0254 |
| Starting Forms could select the wrong workflow or open another person's work | Exact workflow/form/assignment identities, explicit starter selection, common confirmation, own-work targets and recoverable operation identity, 0243 and shared data work APIs |
| A repeated visit could reuse an already-consumed manual choice | Consume intents through their durable assignment decision receipt, retaining history, 0259; SQL regression 0262 |
| Fallback previews used an incomplete source visit's old completed-by value | Candidate actor is the completing employee, matching final activation, 0260; SQL regression 0263 |
| Route-specific sources read the persisted route before unsaved answers were submitted | One ordered matcher for execution and candidate previews, exact source-route validation, 0262; SQL regression 0267 and core config tests |
| Legacy approve/reject controls omitted the selected next employee | Carry `nextAssigneeId` through both clients and the shared review request type; rendered review tests and SQL regression 0266 |
| Lost-response recovery did not mark library submission identity complete | Mark recovered durable results complete before permitting a new submission; data recovery tests |
| Assigned work loaded broad Forms/runtime data and lacked useful prior answers | Exact visit loader, bounded context projection, configured reference/instructions and paginated journey, 0242, 0244, 0247, 0257 |
| Loop journey omitted prior passes; dropdown labels used current options | Journey-only ancestry traversal and pinned option snapshots, 0261; SQL regressions 0264–0265. Prior-answer access is not expanded |
| File context needed a real private-storage boundary | Explicit mapped causal file checks, audited path RPC and short-lived signing, 0250. Real local upload/sign/download was verified |
| Follow-up caps and parallel joins needed consistent preview/final behavior | Explicit hold/resume result, merged causal paths, nested cohort handling, 0248, 0251–0253, 0256 |
| Builder controls omitted source routes and Forms authoring round trips | Source route pickers; save the draft before opening the existing Forms workspace; retain selected step and pinned version on return |
| Simulation ignored hidden/skipped answers, route mappings and multiple fixed doers | Load exact linked Forms, reuse core Forms normalization/validation, trace matched routes and all fixed doers; handle invalid draft errors inside the simulation surface |
| Web sample controls flattened checkboxes, multiple choices and numeric values to strings | Typed sample controls preserve boolean, array and number answers; regression demonstrated failure before the change and passes after it. Simulation performs no file upload |
| Normal staff shared the builder surface | Effective `fms.manage` gates authoring; durable assigned work remains accessible through canonical work destinations. Protected recipient rules remain server-enforced |

## B. Implementation paths

The paths below are scoped FMS work. Concurrent task-control and other mixed
worktree changes are excluded from this report and must not be bulk-staged.

- Shared contracts and rules: `packages/core/src/fms/{workContracts,types,engine,assignmentConfig,assignmentAuthoring,assignmentUpgrade,workPresentation,simulation,index}.ts`;
  `packages/core/src/roleMenu.ts`. Their accompanying tests cover configuration,
  version upgrade, navigation/presentation, loops and simulation.
- Persisted client boundary: `packages/data/src/fms/{work,confirmation,formAuthoring}.ts`,
  `packages/data/src/tasks/api.ts`; data builder, confirmation, recovery,
  form-authoring and Forms API regression tests.
- Schema types: `packages/core/src/database.types.ts` and
  `packages/api-client/src/database.types.ts`; scoped metadata reconciliation
  tool `scripts/sync-fms-contract-types.mjs`.
- Web: `apps/web/src/features/fms/{FmsAssignmentEditor,FmsFlowBuilder,FmsGraphCanvas,FmsHandoffConfirmation,FmsStageEditor,FmsStageRunner,FmsStepList,FmsWorkContext,FmsFormAuthoring,FmsSimulation,useFmsHandoffConfirmation}.tsx`;
  `apps/web/src/features/forms/FmsStartingForm.tsx`;
  `apps/web/src/features/tasks/{TaskCard.tsx,api.ts}`;
  `apps/web/src/pages/{FMSBuilderPage,FmsAssignedWorkPage}.tsx` and focused tests.
- Native: `apps/mobile/src/features/fms/{FmsAssignmentEditor,FmsGraphCanvas,FmsHandoffConfirmation,FmsStageEditor,FmsStepList,FmsWorkContext,FmsFormAuthoring,FmsSimulation}.tsx`;
  `apps/mobile/src/features/tasks/TaskCard.tsx`;
  `apps/mobile/src/screens/{FmsBuilderScreen,FmsStageFormScreen,FmsStageScreen,FormBuilderScreen,FormFillScreen}.tsx`;
  `apps/mobile/src/navigation/shellModel.test.ts`.
- Local acceptance tooling: `scripts/test-fms-contract.ps1`,
  `scripts/fms-operational-e2e.mjs`,
  `supabase/tests/helpers/fms_visit_assignment_fixture.psql`, FMS pgTAP tests
  0239–0267, and `docs/REGRESSION_CHECKLIST.md`.

Brace groups list exact filenames within the named directory; they are not
staging commands.

## C. Database changes

All changes are forward-only local migration files. Incremental application
through 0262 succeeded in the dedicated local stack. A clean replay and a
fresh hosted-ledger comparison are still required before applying anything
outside that stack.

| Migration filename | Contract |
| --- | --- |
| `0239_fms_assignment_contract.sql` | Assignment version and pinned configuration |
| `0240_fms_visit_assignment_decisions.sql` | Intent/decision persistence, causal resolver and scoped reads |
| `0241_fms_confirmed_work_transition.sql` | Preview, common Forms validation and atomic idempotent transition |
| `0242_fms_assigned_work_context.sql` | Authorized configured prior-answer projection and journey |
| `0243_fms_exact_form_starters.sql` | Exact automatic starter identity and recovery |
| `0244_fms_assigned_stage.sql` | Scoped current-work loader |
| `0245_fms_handoff_edge_cases.sql` | Deferred completion, review and compatibility paths |
| `0246_fms_authoring_guards.sql` | Publication, pinning, role and display guards |
| `0247_fms_task_context_batch.sql` | Bounded authorized task-card enrichment |
| `0248_fms_causal_transition_preview.sql` | Parallel causal read plan |
| `0249_fms_hierarchy_authority.sql` | Central protected-recipient role guard |
| `0250_fms_context_files_and_hold_result.sql` | Private file authorization and held result |
| `0251_fms_follow_up_review_holds.sql` | Follow-up limit review/hold/resume |
| `0252_fms_initial_handoff_plan.sql` | Read-only initial destination planning and atomic starter handoffs |
| `0253_fms_confirmed_coverage_preview.sql` | Confirm selected/effective employee and coverage fingerprint |
| `0254_fms_previous_employee_preview.sql` | Candidate completing employee parity |
| `0255_fms_initial_return_assignment.sql` | Assignment on a return to the initial step |
| `0256_fms_nested_parallel_preview.sql` | Nested cohort ancestry |
| `0257_fms_context_reference.sql` | Configured reference projection |
| `0258_fms_assignment_route_remap_variable.sql` | Unambiguous saved/revised source-route remapping |
| `0259_fms_consumed_handoff_intents.sql` | No consumed manual choice replay |
| `0260_fms_previous_doer_fallback_preview.sql` | Previous-doer fallback preview parity |
| `0261_fms_historical_work_context.sql` | Prior loop summaries and snapshot labels |
| `0262_fms_candidate_route_sources.sql` | Shared route matcher and candidate route-specific sources |

Public application contracts include `preview_fms_work_transition`,
`transition_fms_work_with_audit`, `get_fms_assigned_stage`,
`get_fms_assigned_work_context`, and `get_fms_work_file_path`, plus scoped
eligible-recipient, task-context and starter/recovery operations. Internal
helpers remain revoked from direct browser execution. Tenant/account/module
and work authority are checked server-side. Protected writes and file-path
access record audits; browser controls are not the authorization boundary.

One completion Form is retained per visit. Multiple doers record separate
completion actions against that saved Form rather than overwriting it.
Existing submissions, earlier visit owners, assignment decisions, task and
notification history are preserved. Published/running versions are not
silently upgraded. No customer data move or CRM schema change is included.

## D. Verification

See the command-by-command results and their limitations in
`FMS_OPERATIONAL_VERIFICATION_2026-10-15.md`. Database assertions, component
tests, type/build checks, local browser proof, hosted proof and physical
Android proof are recorded separately. Earlier successful SQL runs do not
replace the currently blocked final combined sweep and clean replay.

## E. User instructions

Follow `FMS_USER_GUIDE.md` for initial Forms, completion Forms, six assignment
modes, source question/route selection, follow-ups, publishing, simulation,
employee completion and confirmed handoff. Staff open their assigned work
from Home, Tasks, Notifications or its exact link; builder permission is not
required to execute that work.

## F. Remaining blockers

1. Docker Desktop HTTP 500 blocks the final isolated SQL sweep/lint/replay and
   expanded real browser acceptance run. Do not restart unrelated stacks.
2. The permission catalog baseline has 42 migration entries versus 36 client
   entries. The six unrelated Kiara permissions need reconciliation before a
   whole-repository green claim or release.
3. The independent reviewer exhausted provider quota before a final report.
   Partial important findings were fixed and tested; this is not clean
   independent approval. Full review remains a release gate.
4. Hosted ledger/dry-run, staging, authenticated hosted smoke, named-path Git
   publication and web deployment are outstanding.
   No hosted write, push, deployment or APK release was performed here.

Android device verification and signed release are explicitly deferred by the
owner; no APK release is required for the current web-only scope.
