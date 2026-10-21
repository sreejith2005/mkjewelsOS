# FMS employee task workspace and record naming

Status: owner-approved design; implementation and local verification in progress.
Date: 2026-10-20 (Asia/Kolkata).
Source baseline: refreshed `origin/main`, `b844a67`, migrations through `0290`.
Final integration target: `main`, per the owner's instruction in this session.

## Intent and protected boundaries

Implement the owner's supplied FMS task workspace brief in the existing system.
Employees find persisted work through Tasks -> FMS -> workflow family -> published
stage -> recognizable record name. Existing assigned-work routes and transactional
completion remain authoritative. No second task store, workflow engine, completion
page, or client-only authorization is introduced.

The first view contains collapsed workflow families with exact counts. Expanding
a family loads its published stage summaries; expanding a stage loads a bounded
record page. Customer names come only from the destination assignment's authorized
historical form projection. Workflow definitions and existing runtime assignments
remain the sources of structure and work respectively.

## Audit findings and baseline resolution

The initial checkout was clean on `feat/department-section-access` at `258b703`.
It had seven commits absent from main, while refreshed main had 73 absent from that
branch. It ended at `0263_task_workspace_visibility.sql` and lacked task search.
Several FMS migrations on that branch have different numbers from equivalent
main migrations. Those histories must not be merged by filename or renumbered.

After the owner identified main as the integration target, a clean feature branch
`feat/fms-task-workspace-20261020` was created from refreshed `origin/main` in the
authoritative repository directory. The previous branch and its commits remain.
No migrations were applied, no production data was read, and no branch was pushed.

Current source findings on main:

| Contract | Finding and required change |
| --- | --- |
| `packages/core/src/taskFeed.ts` | `isRecurringOrWorkflowTask` and `splitAssignedTaskFeed` explicitly put FMS into My Tasks; introduce an independent FMS partition using persisted origin metadata. |
| `packages/core/src/taskPage.ts` | `TaskWorkspaceView` lacks `fms`; extend the union and all exhaustive consumers. |
| `packages/core/src/taskSearch.ts` | Labels, payload validation and response decoding enumerate four sections; all must recognize `fms`. |
| `supabase/migrations/0290_task_search_filters.sql` | `task_workspace_page` owns effective membership/search. FMS is eligible for `mine`; an admin's creator membership can also make it delegated. Search includes workflow/stage/instance text but excludes projected form names. |
| `task_feed_page` | The effective definition in `0290` delegates to `task_workspace_page`; keep the legacy signature and ordinary-task behavior. |
| `packages/data/src/tasks/api.ts` | `loadTaskTabCounts` enumerates four views. Page/search loaders hydrate IDs through existing feed reads; summary counts cannot be computed from this bounded page. |
| `apps/web/src/pages/TasksPage.tsx` | Flat cards, existing global search and generation guards, no family/stage summary loader. Preserve ordinary-task controls and search. |
| `FmsAssignmentEditor.tsx` | Technical title templates and reference mappings exist; the reference field currently must also be selected as work information. A simple naming selector must not require that extra step. |
| `forms/types.ts`, form definition normalization and both form API adapters | No record-name default currently exists; persist and round-trip it through draft/save/revision/snapshot paths. |
| `0264`, `0269`, `0279`, `0283`, `0289` | Exact assigned context, batched context, reference mapping, historical context and causal form projection already exist; reuse their authorization and visibility rules. |
| `packages/core/src/fms/engine.ts` | `fmsStagesInFlowOrder` provides cycle-safe graph ordering; do not sort stage names or infer order from task creation. |
| `FMSBuilderPage.tsx` | Existing family grouping uses `family_id`; names are presentation only. |
| `FmsAssignedWorkPage.tsx` and `fms/assignedWork.ts` | Exact starter and instance-stage destinations already exist; keep them and their form/approval/evidence/handoff handling. |
| `apps/mobile/App.tsx` | Main uses the deployed web app in one Android WebView. The old branch's native screens are superseded. Validate the web UI at phone width and through the current shell; do not restore old native screens. |

Relevant existing test boundaries include core task-feed/page/search and FMS
presentation/assignment suites, data FMS work and task API suites, Tasks and
assigned-work component tests, and pgTAP `0286`, `0287`, `0288`, `0289`, `0290` plus
the causal visit/handoff/parallel/loop fixtures. Prior release notes do not replace
running these tests against the new change.

## Alternatives and selected architecture

1. **Extend the existing read contracts and add a shared authorized FMS projection
   (recommended).** One projection supplies membership, summaries, stage pages and
   searchable names. Existing runtime records and completion contracts remain.
2. Group the current 50-card page in React. Rejected: totals and search become
   incomplete and work disappears behind unrelated pagination.
3. Maintain a separate denormalized FMS task/name store. Rejected: duplicates work,
   creates synchronization and authorization drift, and is unnecessary here.

## Membership and count semantics

Add `fms` to the shared workspace contract. Runtime stage IDs and starter
assignment IDs are durable work identities. Resolve FMS origin from those
persisted relations and existing explicit FMS linkage, never title matching.

My Tasks and Delegated exclude all FMS-origin rows. Their existing ordinary-task
rules, including management/coverage behavior, stay intact. Watching-only work
retains In Loop membership and is excluded from assigned FMS membership. An
explicit All Tasks request retains its existing `tasks.view_all` requirement and
may contain FMS. A manager does not gain a broader personal FMS list by virtue of
having management permissions; management remains in explicitly authorized views.

The FMS tab badge counts the signed-in employee's open work that still requires
their permitted action, including overdue work. A contribution already completed
by that employee is not counted as actionable merely because a multi-doer stage
remains open. Waiting for another employee/approver is separately identified.
An actual approver's permitted action follows the existing server capability
contract; it is not inferred from role names in the client.

FMS-specific status filters are Active (default), Pending, Overdue, Waiting and
Completed. Active = pending + overdue actionable work. Pending excludes overdue.
Waiting is not added to the active badge. Completed is explicitly historical.
These filters do not redefine the ordinary Tasks status contract.

For the same filter snapshot, sum(stage counts) = family count and sum(family
counts) = filtered FMS total. The unfiltered active total is the FMS tab badge.
When a filter is active, label the filtered total so it is not confused with the
unfiltered badge. Count durable assignments once, including independent parallel
visits and repeated visits; never count by client name or instance alone.

## Read model, pagination and authorization

Add forward migrations after `0290`; `0291` is the next candidate in the current
source tree. Recheck source and the hosted ledger before allocating/applying a
release migration. Do not edit any earlier migration or repair remote history.

Use an internal actor-scoped projection for eligible FMS assignments, joined to
their exact instance, pinned flow version, stage definition and starter identity.
Apply current profile activity, tenant, module availability, assignment and
existing work-context permission checks before exposing names, counts or search
matches. There is no caller-selected employee/tenant parameter.

Extend `task_workspace_page` and `task_feed_page` with `fms` membership and reuse
that projection for FMS metadata/name search. Preserve ordinary-task predicates,
legacy signatures, date semantics and ordering. Reject unknown section/filter
values. Database authorization remains identical for direct API calls.

Add focused Tasks-owned RPC reads for:

- Workflow-family summaries: exact filtered totals, status counts and a bounded
  family page; return an independent full eligible total so family pagination
  cannot undercount the badge.
- One eligible family's stage summaries and minimal pinned graph metadata.
- One exact published stage/starter group: at most 50 records, total, status
  counts, durable identities and bounded card presentation.

Use one shared filtering implementation across all three levels. Workflow/stage
filter options must come from the employee's eligible scope, not a company-wide
builder load. Validate that a requested family/stage belongs to that scope.
Do not leak inaccessible activity through zero-count groups or search counts.

Counts and pages are internally consistent within each database statement. Across
requests, runtime changes may legitimately alter totals; refresh summaries and
clamp stale offsets rather than presenting a false frozen snapshot guarantee.

Summary queries do not hydrate form histories. Name searching uses the same
bounded authorized name projection as cards, rather than calling the complete
journey loader per record. Add only indexes justified by the actor/assignment,
flow/stage and historical source lookup plans. Test representative scale with
EXPLAIN ANALYZE on synthetic data before claiming performance.

New RPCs use `assert_module_access('tasks')` and retain the underlying FMS module
guards. Private helpers have no public/anon/authenticated/service-role execution
grant. Authenticated callers receive only the intended public RPC grants. New
read RPCs do not create audit writes; protected naming configuration saves remain
audited in their existing transactions. No new Storage bucket or write grant.
Update generated database types for new signatures and form metadata columns.

## Family, version and stage structure

Group by persisted `family_id` with the flow ID as the legacy family fallback.
Pick family display metadata deterministically from eligible pinned versions,
while keeping each instance on its original version. Include archived published
versions with relevant assignments; never substitute the latest definition.

Keep stage groups version-specific, keyed by pinned flow version plus stage ID.
This conservative policy prevents accidental cross-version merging. Show a small
version label when a family contains multiple relevant versions. Within a version,
reuse `fmsStagesInFlowOrder`; carry configured pipeline names for parallel paths.
Starting Form is a distinct group keyed to its exact published flow/start stage.

After family expansion, configured stages from the relevant pinned definitions
may be shown subdued with zero tasks. These rows create no assignments. Only
persisted activated visits produce cards. Conditional skips, child instances and
parallel branches retain their real definition and runtime identities. Repeated
visits display their visit number alongside the durable workflow reference.

## Record-name configuration and historical safety

Add an optional `record_name_field_key` to form template metadata and a typed
`recordNameFieldKey` to the shared form definition. The Form Builder offers
"Use this question as the record name" using actual eligible field keys. Preserve
this setting in normalization, draft saves, duplication/revision, API conversion
and submission snapshots. Server validation verifies the key belongs to that
exact template and is eligible. A naming-default change on a used published form
requires a new revision; do not change names of running historical work through
an in-place metadata edit.

Extend existing `FmsTaskDisplay` with optional record-naming configuration, stored
in the existing stage planned-time JSON. The initial stage offers Automatic,
Use the form's selected record-name question, or Select a different question.
Later stages inherit that initial record name unless an explicit advanced
stage-specific source override is selected. Sources bind the pinned form ID,
source-stage key and stable field key. Extend publication checks on the server
and shared preview validators; keep advanced title templates/reference fields.

Resolve names in this order: explicit stage override, initial-stage workflow
override/default, initial submission snapshot's form default, valid existing
custom title configuration, deterministic safe automatic identifier, durable
workflow reference. A configured but missing/hidden/unavailable value uses the
same safe fallback chain. Never render null, broken placeholders, IDs or JSON as
the record title. Keep durable reference separate from the human record name.

Automatic identification is conservative: consider visible, reachable, nonblank
short text or number fields whose stable keys/labels identify a person or record;
rank deterministically by semantic category, sort order and stable key. Exclude
long remarks, contact/secrets/sensitive fields, uploads, layout fields and
unrelated generic text. If no safe candidate exists, use the durable reference.
Explicit supported option/date/user questions use existing historical answer
formatting and resolved display labels, not raw option/user IDs.

Reuse `fms_context_form_visits`, snapshot visibility/section evaluation and the
existing authorized projection. The source is the exact causal initial submission
or explicit authorized stage source, never the latest unrelated form in an
instance. Returning through a loop must not replace the initial record name.
Do not alter saved answers, instance titles, assignment ownership or history.
Compute legacy names at read time; no mass backfill or employee resubmission.

Keep name selection shared in `packages/core` for all current presentation
consumers, with server-side parity tests for search projection. Only hydrate the
minimal authorized naming fields. Apply the selected name to workspace cards,
assigned-stage heading and existing supported Home/previews. Notification text
changes are limited to existing safe contracts; exact assignment URLs remain.

## Employee UI and refresh behavior

Add the FMS tab after In Loop, before authorized All Tasks. Use focused
`FmsTaskWorkspace`, workflow group, stage group, record card and naming-selector
components. Reuse existing task tokens, buttons, notices, loaders and inputs.

All groups start collapsed. Use accessible disclosure buttons with aria-expanded,
stable control IDs and at least 44px targets. Avoid nested scroll containers.
Cards show record name, one useful authorized context line, due/status/overdue,
short instructions where useful, reference/visit as secondary text and Open Work.
They do not repeat workflow/stage headings or ordinary-task configuration noise.

Open Work uses `fmsAssignedWorkPath`: exact starter assignment and pinned form,
or exact instance-stage and optional pinned completion form. It opens the existing
`FmsAssignedWorkPage`. Completed starter history remains non-actionable and uses
that exact assignment's existing completed/unavailable state, never a new starter.
Approvals, evidence, conditional forms, checklist, handoff and confirmation controls
stay in the existing runner.

FMS filters support server-side record/reference query, family, pinned stage,
status and due-date range with Clear all. Global Tasks search remains available
across existing authorized subsections/history; an FMS-local query stays scoped
to FMS and does not unexpectedly flatten the hierarchy or widen its audience.

Reuse `useTenantRealtimeRefresh` topics. Refresh summaries plus only expanded
stage pages; preserve expansion keys, reset offsets on filter changes and clamp
offsets after removals. Guard responses by actor/filter/request generation, clear
actor-specific caches on identity change and ignore stale responses. Display
retryable errors and first-load skeletons without hiding successful submission.

## Tests and acceptance evidence

Implement failing tests before behavior changes, then run focused regressions.

| Acceptance area | Required evidence |
| --- | --- |
| Subsections | Shared/data/UI/pgTAP: 5 recurring, 3 delegated, 2 watched, 7 FMS; mutually exclusive actionable membership, retained All Tasks gate. |
| Family/version/stage | Duplicate names across families, multiple published versions, archived live work, graph order, zero stages without fake tasks. |
| Naming | Person/order/enquiry variants, explicit/default/automatic/advanced fallbacks, blanks, hidden conditions, missing legacy snapshots, normalization, saved revisions and stable cross-stage identity. |
| Runtime regression | Existing initial start, selected assignee, manual/locked handoff, approval/deferred completion, loop visits, conditional skip, parallel branches and linked workflow fixtures remain green. |
| Exact links | Card, Home, notification and direct URL retain starter/instance-stage identity; existing completion page opens correct pinned form and refreshes counts. |
| Scale and counts | At least 250 synthetic assignments, bounded family/stage paging, exact totals independent of 50-card pages, repeated visits counted separately and stable earliest-due ordering. |
| Search | Form-derived name matches beyond the first page; hidden/cross-tenant/cross-employee values do not influence exposed results or counts. |
| Authorization | Anonymous, inactive, cross-tenant, cross-branch/department, unassigned, ordinary assignee, permitted manager/admin, denied overrides and service-role direct-call cases. |
| Ordinary Tasks | Existing delegation, checklist, recurrence, upload/form/evidence, completion, bulk import, In Loop, All Tasks and Task Control suites. |
| UI | Keyboard disclosure, lazy fetches, retries, stale response/offset handling, rapid realtime completion, light/dark, 390px phone and 1440px desktop. Android shell checks are separate from physical-device proof. |

Broader gates after focused checks: local Supabase rebuild/pgTAP/lint, core/data/web
tests, serial typecheck/build, current shell bridge regression tests where relevant,
rendered desktop/phone checks and `git diff --check`. Report actual commands and
failures; do not convert static/build evidence into database or physical-device proof.

## Help, release and rollback

Update `packages/core/src/assistant/appHelp.ts`, its tests,
`docs/ASK_KIARA_APP_HELP_REVIEW.md`, the regression checklist and a short owner/employee
guide. Kiara needs accurate navigation/help text, not wider customer access or a
new unrestricted table read. Any later read-tool extension must use existing
actor-scoped RPCs and allowed/denied evaluations.

Review named paths and credential-safe staged content, validate, then integrate
the completed feature into main. Git publication, hosted migrations, web deploy
and production verification remain distinct gates. The owner explicitly asked
that production not be deployed without required approval/release procedures.
Before hosted writes, check the actual linked project, migration ledger and dry
run; do not infer hosted migration availability from this local spec.

On main's current Android shell, this UI reaches phones through the web deployment;
avoid unrelated shell changes. Follow the owner's supplied standing release rules
if actual native/shared mobile-consumed runtime changes require an APK. No APK,
hosted migration, merge or production deployment has been performed for this design.

Release the backward-compatible database reads/configuration first and matching
clients together after validation. Existing RPC signatures remain. A UI rollback
must use a compatible client because FMS membership intentionally changes; do not
claim an old four-tab client can display the new membership correctly. Fix forward
or roll back the presentation and membership together with reviewed forward SQL;
never delete workflow/form/task history or edit applied migrations.
