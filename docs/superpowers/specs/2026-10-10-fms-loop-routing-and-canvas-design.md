# FMS backward routing and readable canvas

Status: owner approved fresh-work design and inline implementation on 2026-10-10.
Implemented locally; hosted rollout and connected-device release gates remain open.

## Requested outcome

Any workflow can route from a step back to a previous step, including the
reported `FOLLOW UP 3: Route 2 destination loops back to an earlier step`.
Interconnected steps and return routes must remain understandable and editable
on desktop web, mobile web, and employee Android. Existing persisted work,
authorization, submissions, and notifications must remain intact.

This change extends the existing workflow engine and editor. It does not add
the unrelated integrations, expression language, or connector catalog of n8n
or Make.

## Confirmed source findings

- `packages/core/src/fms/engine.ts` rejects cycles in `validateFmsDefinition`.
- `supabase/migrations/0194_fms_optional_assignees.sql` contains the current
  `assert_fms_flow_publishable` cycle rejection. Applied migrations stay intact.
- Activation's current definition is in `0082_repair_fms_status_condition_runtime.sql`.
  Its existing-stage lookup returns a previously
  completed execution instead of creating fresh work. The initial execution
  has a partial unique index; revisions already have distinct identities.
- Parallel joins use historical stage completion counts. Allowing cycles
  requires matching completions to the current execution pass.
- Both canvas implementations use generic cubic curves; the web renderer
  places route labels at endpoint midpoints. Neither routes connections around
  card obstacles or assigns independent lanes to return edges.
- Web and native currently refuse a direct connection from a node to itself.
  Self-return is included in the proposed design, subject to the same exit and
  automatic-transition rules as other loops.

## Execution design

1. Conditional routes, fallback routes, and supported parallel routes can name
   previous nodes. Keep first-match conditional routing and explicit parallel
   fan-out. Canvas coordinates never determine runtime routing.
2. A revisit to a completed step creates a fresh execution with a fresh
   instance-stage ID, assignment, checklist, deadline, and form submission.
   Keep prior executions immutable and link their history. Reusing completed
   work or clearing its answers is prohibited.
3. Each execution carries a pass/scope identity. Converging branches within the
   same pass reuse the same active work; a deliberate loop creates a new pass.
   Parallel split/join prerequisites belong to their activation scope, so old
   completions cannot satisfy a new join. The implementation plan must specify
   scope propagation and cover nested splits, return routes, and convergence
   before changing activation.
4. Retain an explicit finish path and reject reachable regions that cannot
   reach it. A loop can repeat until its exit condition matches; human-driven
   repetitions have no arbitrary global limit. Detect automatic-only cycles at
   publication where possible, retain the server transition guard, and stop
   visibly with an audited hold if automatic execution exhausts its budget.
5. Resolve assignments through existing server contracts on every fresh visit.
   Preserve current assignment precedence: a User answer sets the default for
   later steps, and an explicit step assignment takes priority. Require the
   current visit's assignment-source form before completing it. Do not use
   another visit's submission as evidence that current required work is complete.
6. Submission and progression stay one audited transaction. New Tasks, Home
   alerts, notifications, and direct links target the new instance-stage ID.
   Completion closes only that visit's alerts and retains earlier history.
7. Version the execution behavior for newly published definitions/new instances.
   Running instances retain their previous execution semantics. Existing
   completed records are not rewritten or bulk reassigned.
8. The initial Form may be revisited as fresh form work. The original starter
   submission and initial instance context remain historical evidence;
   routing uses the explicitly applicable current submission.

## Canvas design

Use one tested geometry implementation in `packages/core`, consumed by web
and native. Consolidate duplicated graph/layout behavior through the existing
shared package exports without unrelated refactoring.

- Route connections around node bounds with orthogonal segments and rounded
  corners. Forward connections use gaps between columns; return connections
  use separate exterior lanes. Multiple connections between the same cards
  have separate ports, lanes, and labels.
- Place arrowheads at their destination ports, with direction matching the
  final segment. Return paths show a return indicator and destination name.
- Place labels on their own routed segment, clear of cards and other labels.
  Full route condition and source/destination are available on selection.
- Selecting a node emphasizes its incoming/outgoing paths and fades unrelated
  paths. Selecting an edge emphasizes both endpoints and exposes accessible
  reconnect/remove controls. Maintain touch-sized hit targets.
- Provide an explicit auto-arrange action and fit-to-view including return
  lanes. Keep saved positions until the user requests arrangement. Preserve
  drag, pan, zoom, add, duplicate, delete, connection, and reconnection actions.
- Use existing tokens and stage/route styling. Do not introduce color as the
  only indication of connection meaning.

## Changes and verification to plan after design approval

Update shared FMS validation/geometry and focused tests; extend the database
with the next available forward migration and generated types; update web and
native builders, canvas, and runtime presentation. Inventory consumers across
web, mobile, core, data, API client, Tasks, Forms, Home, and Notifications.

Required tests include Follow Up 3 returning to Follow Up 1 then exiting,
multiple repetitions, self-return, latest-visit form routing, parallel
convergence without duplicate work, joins without stale completions, repeated
completion/retry safety, automatic-cycle handling, and unchanged acyclic and
legacy running workflows. Database tests must cover allowed and denied actors,
inactive and unauthenticated users, tenant/branch boundaries, direct RPC access,
audit history, and fresh work notifications.

Canvas tests cover backward edges, shared destinations, parallel edges,
multiple lanes, obstacle avoidance, label bounds, selection, reconnect/remove,
saved positions, phone viewport, and native touch interaction. Complete focused
tests, relevant broader regressions, typecheck/build, local database tests, and
browser/device checks, reporting their evidence separately.

Follow the production playbook for hosted changes. Employee Android release
uses `scripts/release-mobile.ps1` after required gates pass, with the reviewed
release commit pushed and public manifest/APK verified. Do not publish if a
required runtime/device gate fails.

## Review checkpoint

Owner confirmed: a backward route creates fresh assigned work for each revisit
and preserves all previous submissions/results. The approved plan was implemented and locally tested. The owner subsequently
authorized deploying migration 0212 and pushing the scoped implementation to
main; Android publication remains subject to device validation.
