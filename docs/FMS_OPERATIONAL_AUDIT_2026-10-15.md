# FMS operational audit, 2026-10-15

Evidence level: source investigation and read-only migration/catalog checks.
No product code, database schema, production records or applied migrations were
changed. This is the pre-implementation audit, not a completed repair report.

## Repository and environment

- Confirmed root: `C:/Users/MIS/Downloads/MKJewelOS`.
- Branch: `feat/department-section-access`; inspected HEAD: `93ed086`.
- Worktree already contains extensive unrelated web/native/task/navigation work
  and retired-directory deletions. Preserve all of it. Do not bulk stage.
- Linked project reference read: `yimafxhuwgfhvzczqqdd`. The hosted migration
  ledger reaches 0238. This does not establish the deployed web SHA or prove
  current hosted function bodies.
- Remote-only migration versions absent from this checkout: 0218-0230 and 0235.
  Their files are available in the existing `origin/main` Git reference.
- Local-only ledger entries: 0236 and 0237. Do not treat their behavior as live.
- Docker is available. The `supabase_db_jewelos` catalog ledger reaches 0234;
  its checked function catalog includes the assignment-scope and protected
  recipient helpers. Several other developer stacks are running. No stack was
  stopped or reset.
- Current source has native Expo `FmsStageScreen`, `FormFillScreen`, and
  `FmsBuilderScreen`, alongside the CRM WebView. The attached request's statement
  that Android is a web shell cannot establish the actual installed release.
- `PROJECT_HANDOFF.md` and the production playbook contain dated migration/mobile
  descriptions; current source and ledgers take precedence. The existing dirty
  `LOCAL_DEVELOPMENT.md` also contains obsolete `.../MKJewelOS/jewelos` paths.
  They were read and left untouched.

## Root-cause findings

| Finding | Evidence and consequence | Required repair |
| --- | --- | --- |
| Ordinary defaults defeat form assignment | `0194_fms_optional_assignees.sql`, `resolve_fms_stage_assignees`: any `fms_stage_assignees` row delegates to the old resolver before checking the selected user. | Introduce explicit modes and an unmistakable fixed-owner lock; form-driven targets must prefer a valid current form/handoff selection. |
| Assignment state is instance-wide | `0193`, `fms_update_assignment_from_stage_form` updates `_fms_assignment_user_id`; `0194` consumes it or falls back to `started_by`. Local catalog confirms both relevant functions still reference the global key. | Resolve from the exact causal source visit and persist per-target-visit provenance, preserving legacy versions. |
| Handoff happens without confirmation | `FmsStageRunner.tsx` calls `submitFmsFormAndProgress` directly inside `FormRenderer.onSubmit`. That server operation can immediately complete the stage. | Preview and confirm before the final atomic operation; keep form state mounted on cancel. |
| Current handoff payload cannot express independent parallel choices | Web/data submission APIs accept one `nextAssigneeId`; activation accepts one selected user. | Typed per-target handoffs, validated against server-resolved destinations; independent target resolution. |
| Conditional assignment is intentionally rigid | `0194` and core `fmsAssignmentFields` require required, shown, unconditional `user_dropdown` fields. Auto-discovery also compares the Assigned To label/key. | Persist exact version/key mappings, validate executed visibility and route coverage, require explicit fallback where needed. |
| Initial routing repair is pending | `0236_fms_initial_form_routing.sql` introduces `progress_fms_initial_form_internal` and uses it from starter/Forms paths; remote ledger has no 0236. | Test and integrate the pending repair without editing an applied migration or assuming it is deployed. |
| Starter success can open someone else's next-work destination | `FmsAssignedWorkPage.tsx`, `StarterForm` redirects to an instance link whenever a start returns an instance ID. | Return a confirmation and only link to an exact successor owned by the caller. RLS must remain the boundary. |
| Task screen loads the Forms Library | `AssignedStage.refresh` calls `loadForms()`, which loads up to 200 templates, 2000 fields and 500 submissions. | Fetch the pinned current form and explicitly authorized scoped context only. |
| Targeted loader remains broader than one visit | `loadFmsAssignedStage(instanceId)` scopes to an instance, then loads its stages, all definitions, up to 500 users, and evidence/checklists for every visit. | Exact visit query, bounded/paginated history, current-visit evidence/checklist, dedicated eligible recipient query. |
| Work context is absent from the assigned runner | `FmsStageRunner` presents name/method, status, assigned names, due date and action controls; it does not consume configured prior-answer context. | Audited configuration plus narrow context reads; reuse pinned form presentation helpers. |
| Existing presentation can expose unresolved identifiers | `presentFormSubmission` falls back to the raw user answer when no user name resolves. | FMS context presentation must provide safe historical-person fallback and scoped names. |
| Authoring and execution share section semantics | `roleMenu.ts` includes FMS for doers; `fms.view` opens the combined surface; `FMSBuilderPage` mixes runtime browsing and authoring, while `fms.manage` guards authoring controls. | Hide/guard builder by effective `fms.manage` while preserving assigned execution through Home/Tasks and exact URLs. |
| Manual start remains in normal authoring | `FMSBuilderPage.start` calls `startFmsInstance` with empty context. | Use automatic exact form starters in normal web/native UX; preserve compatibility contracts deliberately. |
| Some retry identities are short-lived | Starter submit APIs generate a new random key per call; the runner's key survives rerenders but not remount/refresh. The server already has durable mutation keys. | Stable unfinished-request identity across reconnect/reload, strict target/payload binding and replay tests. |
| Existing FMS eligibility is weaker than the latest task recipient contract | `assert_direct_assignment_user(...,'FMS')` in 0087 validates active tenant profile; it does not itself enforce the protected-role and assignment-scope checks found in origin/main 0228/0229 and their preceding task migrations. `eligibleFmsUsers` only filters account activity. | Reuse centralized current scope/protected-recipient contracts for ad hoc handoff and enforce published rule authority server-side. Do not reproduce their role lists in the UI. |

These are source/catalog findings. No production-data reproduction was attempted,
and no claim is made that an unauthorized hosted write succeeded.

## Existing flow to preserve

1. Published flows pin stage definitions/forms. `queue_fms_starter_assignments`
   creates durable starter assignments and exact `/tasks/fms?starter=...&form=...`
   notification links for configured initial people.
2. Home and task feeds expose those assignments. `fmsAssignedWorkPath` and
   `parseFmsAssignedWorkPath` in core define identity; native maps the same union.
3. Starter submission uses `submit_fms_form_and_progress_with_audit` with
   `fms_entry` and the exact starter ID. It locks the assignment and flow,
   submits the form, creates an instance, records initial completion, marks the
   starter complete, activates successor work, and records audits atomically.
4. Forms Library has the separate `submit_form_and_start_fms_with_audit` /
   `start_fms_from_form_submission_with_audit` entry. Shared form identities
   require deterministic explicit workflow binding, not inferred assignment.
5. Activation resolves assignees, writes instance stages and assignee rows,
   creates checklist items, logs activation, and emits notifications. The
   `v_all_tasks` projection supplies exact starter/instance/visit identity.
6. A stage form submits with `fms_stage` and the exact visit ID. Existing RPC
   logic intentionally defers completion for evidence, remarks, checklists,
   handoff, approval and multi-doer rules. Do not report these as progression.
7. `complete_fms_stage_with_audit` / review operations enforce actionability and
   actor authorization, satisfy requirements and evaluate routes before activation.
8. Migration 0212 pins execution version, creates fresh visits and execution/
   parallel scopes, and records causal transitions. Preserve visit-specific
   submissions and join arrivals. Whole-instance completion waits on open work.
9. Notification closure derives from durable work state. Preserve read history
   and existing private Storage registration/signed-download checks.

## Permission and visibility boundaries

- Database `permission_effective_for` is authoritative. `current_profile` includes
  dashboard authority; new checks must not bypass it through raw Auth-ID lookup.
- `fms.manage` controls building/publishing; assigned completion must remain
  separately available. Migration 0156 adds section guards to mutation RPCs and
  restrictive module SELECT policies. Personal section access and maintenance
  disablement must stay distinct.
- `can_read_fms_instance` and `can_read_form_submission` are existing reader
  boundaries. Additional prior-answer visibility needs a narrow field projection,
  not a blanket grant to all submissions in a flow or tenant.
- Assignment-scope/protected-recipient rules in missing migration history must
  be reconciled from authoritative Git before implementing new mutations.
- Source helpers are SECURITY DEFINER with fixed search paths. Keep internal
  helpers inaccessible and expose only guarded, audited public contracts.

## Affected consumers and reusable pieces

| Area | Existing consumers/source |
| --- | --- |
| Web authoring/runtime | `FMSBuilderPage`, `FMSTasksPage`, `FmsFlowBuilder`, `FmsGraphCanvas`, `FmsStageEditor`, `FmsStageRunner`, `features/fms/api.ts`, `definition.ts`, `runtimeView.ts` |
| Forms | `FormsPage`, `FormBuilder`, `FormRenderer`, web/data forms APIs, shared forms validation/visibility and `presentFormSubmission` |
| Assigned entry/work | `FmsAssignedWorkPage`, `HomeView`, `TasksPage`, `TaskCard`, `TaskDetails`, notifications, shared `assignedWork.ts` and `taskFeed.ts` |
| Native | `FmsBuilderScreen`, `FmsStageScreen`, `FormFillScreen`, native graph/editor, `assignedWorkNavigation.ts`, native Home/Tasks/notification entry surfaces |
| Shared/data | `packages/core/src/fms/types.ts`, `engine.ts`, graph modules, permissions/menu; `packages/data/src/fms` and forms/task APIs; generated database types |
| Database | Forms/FMS submit/start/completion/review/activation RPCs, starter assignments, visit scopes/transitions, recipient helpers, form RLS, task projection, notification triggers and private file contracts |

Existing tests include pgTAP 0112/0115/0123/0149/0150/0160/0193/0212/0232/0233
and pending 0236, plus core FMS/forms/permissions, web assigned-work/runner/builder,
data API and native tests. Prior tests intentionally assert the old default
precedence, so new versioned cases must coexist with legacy assertions.

## Investigation commands and limits

Executed read-only: `git rev-parse --show-toplevel`,
`git status --short --branch`, `git log -1`, `git ls-tree origin/main`, selected
`git show origin/main:<migration>`, `supabase.cmd migration list --linked`,
`docker ps`, and `docker exec supabase_db_jewelos psql` SELECT queries for the
local migration ledger and named function metadata. Read active source, migration
history, relevant test fixtures, maintained repository instructions and prior
FMS design documents. No secrets or customer records were queried.

Not executed: local reset, migration apply, pgTAP, unit/component tests, typecheck,
build, browser/device execution, hosted data mutation, Git commit/push, or release.
There is no new product implementation to validate at this checkpoint.

## Next gate

Review `docs/superpowers/specs/2026-10-15-fms-operational-handoff-design.md`.
After design approval, write the detailed implementation plan with exact RPC
signatures, migration numbers, file ownership and acceptance A-M test cases.
Implementation and deployment evidence must be reported separately.
