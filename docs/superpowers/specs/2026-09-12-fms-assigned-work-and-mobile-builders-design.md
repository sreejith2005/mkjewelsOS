# FMS Assigned Work and Mobile Builders Design

## Goal

Restore one dependable assigned-work contract across Home, Tasks,
notifications, Forms, and FMS. An assigned FMS stage must appear in Tasks with
an `FMS` label, every form-bearing entry point must open the exact pinned form,
and submitting that form must transactionally complete a form-only stage and
remove it from the user's action-required state.

Bring the native Android FMS and Forms builders to practical parity with the
existing web builders without introducing mobile-only business rules or
overwriting unrelated uncommitted mobile work.

## Current-state findings

The repository already contains most of the server contract needed for stage
form completion:

- `v_all_tasks` projects `fms_instance_stages` as `task_type = 'fms'`.
- Web task cards display an `FMS` badge and expose a dedicated FMS-form action.
- `/tasks/fms?instance=<id>&stage=<id>&form=<id>` identifies an exact runtime
  stage and pinned form.
- `submit_fms_form_and_progress_with_audit` records the submission, completes
  an eligible form-only stage, evaluates routing, activates subsequent work,
  and writes audit/runtime history in one transaction.
- Starter-form submissions carry the exact `fms_starter_assignments.id` and do
  not infer a workflow only from a reusable form template.

The observed regressions come from the surrounding presentation and routing:

1. The committed route map contains an older `/tasks/fms -> fms_tasks` rule
   before the newer `/tasks/fms -> fms_builder` rule. The first result has no
   active web destination and is permission-fallback routed to Dashboard. A
   current uncommitted change removes the stale rule, but that change has not
   been published.
2. The Tasks feed loads work for the current India-local day plus unfinished
   overdue work. Home loads all open assigned FMS stages. A future or
   unscheduled stage can therefore appear on Home but not in Tasks.
3. Database-created FMS assignment notifications retain only the instance in
   their link. They cannot open a stage's exact pinned form.
4. The native task card does not distinguish an FMS row and sends every
   required form through the ordinary task-form path. An FMS row can therefore
   be submitted under the wrong linked-module contract.
5. The native Forms Library can fill and manage lifecycle actions but contains
   no form-authoring workspace.
6. The native FMS canvas competes with its parent `ScrollView`, commits pan and
   zoom through React state on every gesture update, and places native `View`
   elements inside the SVG tree. These choices account for lost gestures,
   unstable scrolling, excessive graph rerenders, and invalid SVG composition.

## Assigned-work model

### Tasks visibility

Keep the existing date-focused task board for checklist, delegation, and
recurring work. Extend the existing security-invoker task projection and its
bounded loader so My Tasks also receives both kinds of assigned FMS work:

- pending `fms_starter_assignments`, before a workflow instance exists;
- open `fms_instance_stages`, after the workflow has started.

The projection uses its existing columns and distinguishes the variants with a
stable source value (`fms_starter` or `fms_stage`). For runtime stages:

- include stages whose status is `pending`, `in_progress`, `in_review`, or
  `overdue`;
- include a stage when the caller is an active assignee or is its currently
  effective coverage assignee under the existing RLS projection;
- do not limit an open FMS stage by date or require a non-null deadline;
- merge by stable runtime-stage ID, avoiding duplicates from multiple active
  assignee rows;
- do not add completed workflow history to this open assigned-work read.

Pending starters are included regardless of date and use their exact starter
assignment ID as the work identity. Completed or cancelled starters are absent.
The current date window continues to govern non-FMS task history, including
what appears under the Done filter.

The shared task split continues to place `task_type = 'fms'` in My Tasks. Both
web and native cards use shared state to display an `FMS` badge and choose the
correct starter-form, runtime-form, or runtime-stage action from the stable
source value. FMS work remains read-only for ordinary task mutations; only the
audited FMS contracts may mutate it.

### Canonical destinations

Use one shared, typed destination model with these identities:

- a starter-form destination carries the durable `starterAssignmentId` and
  pinned `formTemplateId` before a runtime instance exists;
- a runtime destination carries `instanceId` and `instanceStageId`, plus the
  pinned `formTemplateId` when the step has a form.

Every producer uses that model:

- Home action-required cards;
- web and native Task cards;
- in-app assignment notifications;
- notification-bell and inbox navigation;
- legacy FMS links normalized by the client when sufficient authorized data is
  available.

On web, a form-bearing destination stays under the Tasks authorization surface
and renders a focused starter or assigned-stage form. It must not open Forms
Library or the workflow builder. On Android it opens `FormFill` with the exact
starter assignment or `FmsStageForm` with the exact runtime stage. A stage with
no form opens the authorized runtime stage/instance view so its actual
checklist, evidence, decision, approval, or handoff controls remain available.

Legacy `/tasks/fms?instance=<id>` links remain accepted. They resolve to the
runtime view rather than Dashboard. New links include the stage and, when
present, pinned form identifiers.

## Submission and notification lifecycle

The existing `submit_fms_form_and_progress_with_audit` RPC remains the single
write boundary. Clients must not submit a standalone form first and complete a
stage in a second request.

For a starter form, the existing exact-starter branch validates and completes
the named `fms_starter_assignments.id`, creates only its workflow instance, and
marks that starter notification read. For a runtime form-only stage, one
successful call:

1. validates the active current profile, tenant, instance, stage assignment,
   pinned form, and idempotency key;
2. writes the form submission linked as `fms_stage` to the exact runtime-stage
   ID;
3. completes that stage and records its submission ID;
4. evaluates deterministic routes and activates the correct subsequent work;
5. writes the existing FMS stage log and audit record;
6. marks unread assignment notifications whose `source_module = 'fms'` and
   `source_record_id` is that runtime-stage ID as read for the completing user.

The notification history is not deleted. It remains visible as read history,
while the unread badge and action-required queues stop presenting completed
work.

Auto-completion does not override authored requirements. A stage that also
requires upload, checklist, remark, next-doer handoff, approval, or multi-doer
coordination remains open after form submission until those requirements are
satisfied. The focused form result must explain the remaining requirement and
offer the authorized runtime-stage destination instead of falsely reporting
completion.

Home and Tasks refresh after a successful mutation. Realtime refresh remains a
secondary synchronization aid; immediate local refresh is required so success
does not depend on receiving a realtime event.

## Database and authorization changes

Use the next numbered forward migration. Do not edit migrations `0149`, `0150`,
or `0156`.

The migration will:

- recreate `v_all_tasks` with its existing column contract plus a compatible
  pending-starter union, and preserve `security_invoker` plus authenticated
  SELECT grants;
- redefine only the current FMS assignment-notification producer necessary to
  emit exact safe internal links;
- extend the transactional stage-form submission contract only if marking the
  related notification read cannot be achieved through an existing audited
  helper;
- preserve the current function owner, pinned `search_path`, grants, module
  availability assertion, active-profile lookup, tenant checks, assignee
  checks, idempotency behavior, form snapshot, routing, and audit writes;
- add durable source metadata to new starter notifications and target existing
  unread FMS assignment notifications only when their stored identifiers
  resolve unambiguously to a starter assignment or active runtime stage;
- avoid rewriting unrelated notification history or inferring identity from
  title/message text.

No new client-controlled role, permission, tenant, or assignment value is
trusted. FMS RLS and protected RPC authorization remain the enforcement
boundary. Generated database types are updated only if the migration changes a
schema signature visible to clients.

## Native FMS canvas

Keep the existing definition, layout, graph-edge, validation, save, publish,
and undo/redo models. Replace only the gesture/rendering boundary:

- use the already-installed Gesture Handler and Reanimated libraries;
- give the canvas exclusive ownership of an active pan, node drag, connection
  drag, reconnection drag, or pinch gesture while allowing the surrounding
  page to scroll outside the canvas;
- hold transient pan, zoom, and active drag coordinates in UI-thread shared
  values so pointer movement does not rerender every node and edge;
- commit only final node positions to the React definition/undo stack;
- render SVG children with valid SVG containers such as `G`, not native
  `View`;
- preserve finger-sized connection handles, zoom limits, fit-to-view,
  selection, deletion, duplication, add-after, reconnect, and accessibility
  labels;
- prevent a tap from nudging a node and prevent lifting one pinch finger from
  producing a pan jump.

The builder page becomes one deliberate vertical layout rather than a
`ScrollView` fighting an embedded canvas. Static controls can scroll above the
canvas, while the canvas interaction region remains stable and bounded for a
phone viewport.

## Native Forms Builder

Add an authoring route reachable from Forms Library only when
`forms.manage` is effective. The mobile builder consumes the same shared form
definition, field types, validation, conversion, guided-condition, routing,
dropdown-source, save, publish, revision, and deletion-impact contracts as web.

The phone layout uses:

- a compact header with Save, Check form, and Publish actions;
- a virtualized section/question outline rather than mounting every field
  editor;
- one active question editor in a tall sheet;
- a field-type picker and contextual Add question/Add section actions;
- option editing, required/helper settings, validation, dropdown source,
  answer routing, and advanced visibility controls appropriate to the selected
  type;
- a vertically scrollable routing overview using the shared routing-map model;
- unsaved-change protection and retryable inline write failures.

Historical multiselect and legacy checkbox forms remain load/edit compatible.
New authoring choices and conversions follow the existing web rules exactly.
The implementation must first extract any remaining pure decision from the web
component into `packages/core` or `packages/data`, point web at that shared
decision, and keep web tests green before the native component consumes it.

## Responsive web scope

The web Forms and FMS builders retain their existing desktop structures. Make
only evidence-backed compact-layout corrections found while exercising the
approved workflows:

- controls must not clip or overlap at phone width;
- sheets/modals must remain scrollable above the safe-area inset and keyboard;
- canvas touch input must not trap page scrolling outside its active region;
- the direct FMS form must fit the first viewport and keep Submit reachable;
- no new color system or alternate navigation surface is introduced.

This is not authorization to redesign unrelated mobile screens. Any unrelated
defect found during QA is recorded separately unless its root cause is a shared
primitive already in the approved path.

## Regression protection in `AGENTS.md`

Add a `Protected cross-surface workflow invariants` subsection under the
existing regression-safe rules. It will require anyone changing FMS, Forms,
Tasks, Home, notifications, permissions, routing, or mobile navigation to
verify the complete consumer chain rather than only the edited component.

The protected invariants are:

1. an assigned open FMS stage is visible on Home and in My Tasks;
2. an FMS task is visibly labelled on web and native;
3. Home, Tasks, and notification actions preserve exact stage/form identity;
4. a user may complete assigned work without requiring builder-management
   permission;
5. form-only submission transactionally completes the stage and activates the
   correct next step;
6. completed work leaves action-required and unread state without deleting
   history;
7. stages with extra requirements do not complete prematurely;
8. web and native share business rules and server contracts;
9. direct URLs and RPC calls retain RLS/RPC authorization;
10. focused regression tests for every affected consumer run before broader
    typecheck/build/device gates.

## Failure handling

- If exact stage/form identity cannot be resolved, show a bounded error and do
  not fall back to an arbitrary form or workflow.
- If the stage was already completed, treat an idempotent retry as success and
  refresh the work queues.
- If submission succeeds but navigation refresh fails, retain a clear success
  state and provide a retry rather than resubmitting answers.
- If a linked form is no longer RLS-visible, show that exact version as
  unavailable; never substitute another form version.
- Gesture cancellation clears transient drag/connection state without
  mutating the saved workflow.
- Builder save/publish failures leave the draft and unsaved edits visible.

## Test and verification strategy

Implementation follows red-green TDD for each behavior.

### Shared and client tests

- Core tests for starter/runtime FMS classification, tags/actions, canonical
  destination parsing, legacy-link compatibility, and date-independent open
  assigned-work merging.
- Data-layer tests for bounded starter/runtime loading, exact pinned-form
  resolution, deduplication, completed-state exclusion, and complete database
  query shapes.
- Web tests for Home and notification destinations, Tasks visibility, FMS tag,
  direct focused-form opening, submission refresh, and extra-requirement
  handling.
- Native tests for the FMS badge/action, direct navigation parameters, Home
  navigation, Forms Builder state transformations, unsaved guard, and canvas
  gesture-state reducers where they can be tested without asserting framework
  internals.
- Existing web builder tests stay green when pure behavior moves into shared
  packages.

### Database tests

Add pgTAP cases for unauthenticated, inactive, cross-tenant, unassigned,
ordinary assigned, elevated, idempotent retry, additional-requirement, and
notification-read paths. Confirm new notification links are safe internal
paths containing only authorized durable identifiers.

### Broader gates

Run focused tests first, followed by:

```powershell
supabase.cmd start
supabase.cmd db reset
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd --dir packages/core test
pnpm.cmd --dir packages/data test
pnpm.cmd --dir apps/web test
npm.cmd --prefix apps/mobile run test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
npm.cmd --prefix apps/mobile run typecheck
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

Use the in-app Browser for signed-in web QA when an authenticated session is
available. Verify the target flow at desktop and compact phone widths, including
page identity, console health, exact form opening, successful submission, and
queue removal.

For Android, build the standalone release APK, verify its certificate, install
it on the authorized device, launch without Metro, inspect app-scoped logs and
ANR records, and manually exercise Tasks -> FMS form -> completion, Home -> FMS
form -> completion, form authoring, workflow authoring, node drag, pan, pinch,
connect, reconnect, save, reload, and publish. A green TypeScript/build gate is
not device evidence.

Hosted Supabase migration preflight/apply, Git publication, Vercel deployment,
and authenticated production QA remain separate approval and evidence gates.

## Compatibility and rollout

- Preserve existing form templates, submissions, FMS definitions, runtime
  stages, notification history, task history, URLs, and deep links.
- Use one forward migration and review the exact linked pending set before any
  hosted apply.
- Preserve all unrelated dirty work and stage only approved named paths.
- Do not claim production readiness until the database, web, and device gates
  relevant to the changed surfaces have separate evidence.
