# FMS task workspace implementation report

This implements the approved [design](superpowers/specs/2026-10-20-fms-task-workspace-design.md)
and [plan](superpowers/plans/2026-10-20-fms-task-workspace.md). The employee and
author instructions are in the [user guide](FMS_TASK_WORKSPACE_GUIDE.md).

## Audit and resulting behavior

The previous personal feed mixed persisted FMS assignments into ordinary task
subsections, exposed only flat records, and used technical stage titles where an
employee needed a recognizable customer or record name. A first page could not
stand in for exact assignment totals. Form-template identity could not identify
one assigned execution, and historic answers required causal visibility checks.
The design document records the source audit and affected consumers.

Tasks now offers My Tasks, Delegated, In Loop and FMS, with All Tasks retained for
authorized managers. Personal FMS assignments belong to FMS; watcher semantics
remain separate. Actor-scoped database summaries supply exact counts independent
of the current 50-record page. Employees expand a workflow family and its saved,
published stages, then open a named record. Published versions and repeat visits
retain their identities. Waiting is separate from actionable work; completed work
is explicitly available as history.

Families and stages start collapsed. Opening one fetches only its required child
data. Search and filters run against authorized work, including historical names,
and preserve expanded groups. Request guards reject responses for an old actor or
filter. Realtime refresh uses the existing subscription path and reloads summaries
and expanded pages. Phone subsection buttons use two columns so FMS remains visible.

## Naming and execution compatibility

Form authors can select an eligible question as the form's record-name default.
The initial FMS stage can select that default, Automatic, or a pinned question.
Later stages inherit the original name unless explicitly configured otherwise.
Shared rules use stable question keys, linked form versions and historical
snapshots; hidden or unavailable answers cannot become a search/name side channel.
Legacy templates and safe automatic identifiers remain supported, with the
durable workflow reference as the final fallback.

Home and assigned-work headings use the same authorized record context. Cards use
the existing canonical starter or instance-stage link. The assigned-work runner,
transactional form submission, handoff, approval/evidence controls and notification
closure remain authoritative. No duplicate task store or execution engine was added.
Completed starter history reconciles with its exact initial runtime visit, without
removing repeated visits or losing completed history after a later cancellation.

## Source and database responsibilities

| Area | Responsibility |
| --- | --- |
| `packages/core/src/taskFeed.ts`, `taskPage.ts`, `taskSearch.ts` | Shared subsection membership, filters and contracts |
| `packages/core/src/fms/{recordNaming,taskWorkspace,workContracts,workPresentation,assignmentConfig}.ts` | Naming eligibility/precedence, strict hierarchy decoding and compatible work presentation |
| `packages/core/src/forms/{types,definition}.ts`, `database.types.ts` | Form naming metadata and generated-schema contract |
| `packages/data/src/fms/{taskWorkspace,work}.ts` | Typed actor-scoped hierarchy and existing work-context reads |
| `packages/data/src/{tasks,forms,analytics}/` | Immediate subsection counts, naming persistence and Home context |
| `apps/web/src/features/tasks/fms/`, `pages/TasksPage.tsx`, `features/tasks/TaskSearchControls.tsx` | Lazy hierarchy, safe request state, compact filters and navigation |
| `apps/web/src/features/fms/FmsTaskNaming.tsx`, `FmsStageEditor.tsx`, `features/forms/FormBuilder.tsx` | Actual linked-question naming controls |
| `apps/web/src/features/fms/{FmsWorkContext,FmsContextFirst}.tsx`, `pages/FmsAssignedWorkPage.tsx`, `features/home/HomeView.tsx` | Consistent authorized names at existing entry points |
| `packages/core/src/assistant/appHelp.ts`, help review and regression documents | Exact user labels, author recipes and regression instructions |

The user guide lists each forward migration **0300 through 0317** and its purpose.
These add `form_templates.record_name_field_key`, private projection/validation
helpers, and three authenticated read RPCs: `get_fms_task_workspace`,
`get_fms_task_stages`, `get_fms_task_stage_page`. Existing feed/search signatures
remain compatible. Form metadata uses the audited save/revise/duplicate lifecycle.
No new table, Storage policy, bucket, cron or Edge Function is required.

The public reads accept no employee selector and resolve the active actor through
`current_profile()`. Registered section guards enforce Tasks/FMS availability and
permissions. Existing RLS and the feed view's security-invoker setting remain in
force. Private helpers and original write implementations have no client or
service-role execution grants. Direct browser form writes remain denied.

## Verification and release boundary

The plan records exact commands, counts, regression evidence and unresolved gates.
Independent review covered the feature and naming boundaries through 0316. Its
requested submitted/unsubmitted self-exclusion test was strengthened and passed.
The final filter-order refinement was checked against the search/denial suites.
Database, Git publication, web deployment and physical Android evidence are separate.
No production migration, push or deployment has been performed for this feature.

Before release, resolve or explicitly disposition the database regression/lint
gate, inspect the linked project and migration ledger, then review
`supabase.cmd migration list --linked` and
`supabase.cmd db push --linked --dry-run` under the production playbook. Confirm
0300-0317 are still available; add forward migrations if production history has
moved. Obtain the required hosted-release approval, apply reviewed schema changes,
publish the matching web client, and verify allowed/denied and employee handoff
flows with synthetic staging identities. A Git push alone does none of those steps.

Historical submissions and running definitions are not rewritten. An old four-tab
client is not a complete rollback because membership intentionally changes; use a
compatible client or a reviewed forward correction. The Android WebView receives
this UI through the web deployment; no native source change or APK is needed.

## Local verification results

| Command/check | Observed result |
| --- | --- |
| `pnpm.cmd --dir packages/core test --maxWorkers=1` | 94 files / 1,022 passed after merging main |
| `pnpm.cmd --dir packages/data test --maxWorkers=1` | 32 files / 192 passed after merging main |
| `pnpm.cmd --dir apps/web test --maxWorkers=1 --testTimeout=20000` | 120 files / 591 passed after merging main |
| `pnpm.cmd exec turbo run typecheck build --force --concurrency=1` | All 12 tasks passed on the combined feature/main implementation |
| Android WebView bridge/navigation unit suite | 17 passed; no APK/native change required |
| Dedicated local `supabase.cmd db reset --workdir .worktrees/fms-workspace-local-db` | Clean rebuild through 0311 passed; later migrations applied separately with local-only db push |
| Full local `supabase.cmd test db --workdir .worktrees/fms-workspace-local-db` | 187 files / 3,851 assertions; failed, not a green release gate |
| Serial Dashboard budget retry | 21/21 passed after a loaded full-run timeout |
| Final focused database regressions after 0313 | 47 files / 578 assertions passed, including exact-work/section denials, history, naming, loops and request budget |
| Final isolated database regressions after 0317 (2026-10-22) | 48 files / 590 assertions passed, including equivalent-name batches and submitted/unsubmitted self-exclusion |
| Serial `supabase.cmd db lint --local --level warning --workdir .worktrees/fms-workspace-local-db` | Exit 0 with existing-function warnings; not warning-free |
| Final authenticated 249-visit search after 0317 | Family 4,234 ms; stages 3,175 ms; 50-record stage page 4,584 ms; global FMS search 5,693 ms; all correct totals and no RPC errors |
| Final serial authenticated browser run after 0317 | Passed collapsed/lazy groups, search/expansion, canonical runner, actual form/handoff, inherited recipient name, author selectors and 390px/1440px light/dark layouts; final large search 3,421 ms |
| Final web build after phone navigation refinement | `pnpm.cmd --dir apps/web build` exited 0; TypeScript and production bundling passed |

The original full database feature run's 49 distinct failed assertion descriptions
were reproduced on an unchanged baseline: stale grant inventories, legacy FMS
fixture/validation assumptions, CRM roster assertions and retirement-manifest
classification. The merged full run retained those failures and initially hit
main's Dashboard request budget; the latter passed serially. Full database success
is not claimed. The new post-handoff search regression reproduced an 8-second
timeout. Naming reuse, stable actor/module snapshots and equivalent-input batches
reduce repeated projection work. Submitted destinations remain distinct; exact
authorization is materialized for every member before names are shared. Work IDs,
links and execution ownership are never replaced by the naming representative.

Earlier runs exceeded the request budget during shared-container contention.
For the final gates, the owner approved temporarily stopping 61 containers from
13 other local Supabase stacks. Only the dedicated four-container FMS stack ran
during verification. Restoration restarted 57 of the 61 recorded containers.
Windows excluded TCP port ranges 58233-58332 and 58333-58432 blocked the
database and Kong containers for `crm-workflow-perf` (58421/58422) and
`jewelos-crm-parity-original` (58321/58322), including on retry. Those four
containers remain stopped; their volumes and configuration are intact. Completing
restoration requires resolving the host port reservations. No global Windows
networking restart or unrelated container reconfiguration was attempted.
Measurements use synthetic local data and do not establish hosted latency,
concurrent-stack capacity or larger tenant-wide administrator search capacity.
The excluded local Edge runtime
returns 503 for recurring-task preparation and realtime sockets are unavailable;
real hosted realtime/Edge behavior and physical Android behavior are unverified.

The validated implementation was fast-forwarded into local `main` at `9a73a3a`.
No GitHub push, hosted migration or deployment was performed.

## Exact changed file manifest

```text
apps/web/src/features/analytics/api.ts
apps/web/src/features/analytics/types.ts
apps/web/src/features/fms/FmsContextFirst.tsx
apps/web/src/features/fms/FmsStageEditor.tsx
apps/web/src/features/fms/FmsTaskNaming.test.tsx
apps/web/src/features/fms/FmsTaskNaming.tsx
apps/web/src/features/fms/FmsWorkContext.tsx
apps/web/src/features/forms/api.ts
apps/web/src/features/forms/FormBuilder.tsx
apps/web/src/features/home/HomeView.tsx
apps/web/src/features/tasks/fms/FmsTaskGroups.tsx
apps/web/src/features/tasks/fms/FmsTaskWorkspace.test.tsx
apps/web/src/features/tasks/fms/FmsTaskWorkspace.tsx
apps/web/src/features/tasks/fms/useFmsRead.test.ts
apps/web/src/features/tasks/fms/useFmsRead.ts
apps/web/src/features/tasks/TaskSearchControls.tsx
apps/web/src/pages/FmsAssignedWorkPage.tsx
apps/web/src/pages/TasksPage.tsx
docs/ASK_KIARA_APP_HELP_REVIEW.md
docs/FMS_TASK_WORKSPACE_GUIDE.md
docs/FMS_TASK_WORKSPACE_IMPLEMENTATION.md
docs/REGRESSION_CHECKLIST.md
docs/superpowers/plans/2026-10-20-fms-task-workspace.md
docs/superpowers/specs/2026-10-20-fms-task-workspace-design.md
packages/core/src/assistant/appHelp.test.ts
packages/core/src/assistant/appHelp.ts
packages/core/src/database.types.ts
packages/core/src/fms/assignmentConfig.test.ts
packages/core/src/fms/assignmentConfig.ts
packages/core/src/fms/index.ts
packages/core/src/fms/recordNaming.test.ts
packages/core/src/fms/recordNaming.ts
packages/core/src/fms/taskWorkspace.test.ts
packages/core/src/fms/taskWorkspace.ts
packages/core/src/fms/workContracts.ts
packages/core/src/fms/workPresentation.test.ts
packages/core/src/fms/workPresentation.ts
packages/core/src/forms/definition.ts
packages/core/src/forms/forms.test.ts
packages/core/src/forms/types.ts
packages/core/src/taskFeed.test.ts
packages/core/src/taskFeed.ts
packages/core/src/taskPage.ts
packages/core/src/taskSearch.test.ts
packages/core/src/taskSearch.ts
packages/data/src/analytics/api.ts
packages/data/src/analytics/homeNaming.test.ts
packages/data/src/analytics/types.ts
packages/data/src/fms/taskWorkspace.test.ts
packages/data/src/fms/taskWorkspace.ts
packages/data/src/fms/work.ts
packages/data/src/forms/api.test.ts
packages/data/src/forms/api.ts
packages/data/src/tasks/api.test.ts
packages/data/src/tasks/api.ts
supabase/migrations/0300_fms_task_workspace.sql
supabase/migrations/0301_fms_workspace_name_projection.sql
supabase/migrations/0302_fms_workspace_history_and_visibility.sql
supabase/migrations/0303_fms_record_template_projection.sql
supabase/migrations/0304_fms_starter_undated_work.sql
supabase/migrations/0305_fms_record_name_inheritance.sql
supabase/migrations/0306_fms_workspace_actionability.sql
supabase/migrations/0307_fms_workspace_section_boundaries.sql
supabase/migrations/0308_fms_record_name_projection_cost.sql
supabase/migrations/0309_fms_cancelled_workflow_history.sql
supabase/migrations/0310_fms_starting_form_history_identity.sql
supabase/migrations/0311_fms_workspace_builder_edge_order.sql
supabase/migrations/0312_fms_workspace_naming_projection_reuse.sql
supabase/migrations/0313_fms_workspace_actor_snapshot.sql
supabase/migrations/0314_fms_name_candidate_volatility.sql
supabase/migrations/0315_fms_global_search_module_snapshot.sql
supabase/migrations/0316_fms_batch_equivalent_record_names.sql
supabase/migrations/0317_fms_global_search_filter_before_names.sql
supabase/tests/0208_task_scale_and_management.test.sql
supabase/tests/0212_fms_loop_execution.test.sql
supabase/tests/0286_task_workspace_visibility.test.sql
supabase/tests/0291_fms_task_workspace.test.sql
supabase/tests/0293_fms_record_naming.test.sql
supabase/tests/0293_fms_workspace_history_scale.test.sql
supabase/tests/0295_fms_starter_deadlines.test.sql
supabase/tests/0296_fms_record_name_inheritance.test.sql
supabase/tests/0296_fms_workspace_versions.test.sql
supabase/tests/0297_fms_workspace_actionability.test.sql
supabase/tests/0309_fms_completed_history.test.sql
supabase/tests/0312_fms_workspace_naming_cost.test.sql
supabase/tests/0316_fms_batch_name_boundaries.test.sql
supabase/tests/helpers/fms_visit_assignment_fixture.psql
```
