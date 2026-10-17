# FMS operational assignment and confirmed handoff

Status: owner approved on 2026-10-15; implementation plan awaiting review.
Date: 2026-10-15 (Asia/Kolkata).

## Intent and acceptance

Extend the existing JewelOS engine so real work moves through form submission,
eligible employee assignment, relevant task context, completion form, confirmed
handoff, and successor activation. Use the existing Forms subsystem, permission
resolver, execution visits, notification triggers, and canonical assigned-work
links. Do not introduce another workflow engine or rewrite historical work.

The attached owner specification supplies the business requirements. This design
resolves implementation choices; the accompanying audit records the observed
source and migration state. All sixteen requested phases remain in scope.

## Compatibility boundary

Add an assignment contract version to flows and instances, separate from the
existing execution version. Existing published flows and instances retain
assignment version 1. New flows use version 2. Revising an existing published
flow preserves version 1 until the builder explicitly upgrades the draft and
reviews changed assignment rules. The server pins the version on instance
creation; client context cannot select it. Active instances are never upgraded
or reassigned by this migration.

Version 1 keeps its existing assignment precedence. Version 2 never reads
`_fms_assignment_user_id` to decide a future owner. This avoids changing loop
execution semantics merely to change assignment semantics.

## Assignment configuration and resolution

Store target-stage assignment configuration with the existing stage definition
and preserve it through normalization, draft saves, revisions, and publication.
Offer the six requested modes: Previous Form, Fixed Employee, Existing
Role/Hierarchy Rule, Previous Stage Employee, Manual Handoff, Configured
Fallback. Keep existing assignee rules as the source for hierarchy resolution.

New human stages default to Previous Form. Publication requires a valid incoming
form mapping or explicit fallback. The initial trigger's submitter is recorded
as its doer; it is not a silent fallback for later stages. Never auto-enable
same-person propagation. Old definitions without the new configuration remain
readable and retain their compatibility contract.

One internal resolver consumes the target definition, exact source visit,
validated submission, authenticated actor, and optional per-target handoff.
For an unlocked target it applies: authorized handoff, applicable source-form
answer, configured target rule/default, explicit fallback. A locked Fixed
Employee target uses its published owner and explicitly rejects an attempted
conflicting handoff. The preview and modal show the lock and explain that the
selected form employee will not receive that destination. Never discard the
conflict invisibly.

Mappings identify a pinned form version and stable question key. Support
per-destination mappings for parallel paths and route-specific mappings for
conditional forms. Reuse existing field/section visibility evaluation. Hidden
answers cannot determine ownership; routes without a guaranteed valid answer
need an explicit authorized fallback or must fail publication. Ambiguous
automatic-source discovery requires the builder to choose a question. Display
labels do not become runtime identifiers.

Traverse exact causal predecessors through automatic nodes; do not select the
latest completed stage anywhere in the instance. At a join, conflicting source
answers require an explicit source mapping or destination rule. Resolve every
human destination independently, including each fresh loop visit.

## Durable decisions and history

Add a minimal assignment-decision relation. Each consumed decision identifies
tenant, instance, source visit, target definition and target visit, pinned source
submission, selected and effective employee, method, actor, timestamp, execution
scope, parallel branch, and visit number. Preserve original owner and subsequent
handoff/reassignment history using existing assignee and log records, linked to
the new provenance. Availability coverage must retain both the selected and
effective owner.

Persist pending handoff intents by source visit and target definition when form
submission is valid but checklist, evidence, multi-doer, or approval requirements
defer completion. Pending intents are not activated assignments. Activation
consumes the applicable intent and revalidates eligibility. Unique constraints
prevent duplicate activation decisions for a target visit. Different visits
retain distinct decisions and submissions.

New tables have RLS, restrictive section policies, no direct client writes,
minimal SELECT grants, indexes by instance/source/target visit, and audited
server writers. Cross-table instance/tenant identities are validated in the
writer; foreign keys alone are insufficient. Internal helpers are not directly
executable by authenticated, anonymous, or service-role callers.

## Authorization

Use `current_profile()`, `current_profile_is_active()`, `has_permission()` and
existing module guards. Reuse the authoritative assignment-scope and protected
recipient contracts from the applied permission migrations; do not copy role
lists into new clients or SQL functions. Explicit ad hoc reassignment respects
the actor's effective assignment permissions and permitted recipient scope.
Published fixed/hierarchy rules retain their authorized configuration provenance;
executing an assigned form does not grant the employee builder authority.

Validate active/login-enabled tenant membership, branch/department/designation
scope, protected recipients, coverage, exact source assignment ownership, and
target flow membership at the server boundary. Recheck at final activation,
including changes after preview. A missing eligible owner yields an actionable
error or the configured eligible fallback. No arbitrary administrator fallback.

Hiding the builder uses `fms.manage`; completing assigned work does not require
that permission. Preserve the existing distinction between section maintenance
and personal authoring access. Review SELECT policies and permission-derived
views together so removing the builder menu cannot remove `/tasks/fms` access.

## Preview and atomic transition

Add an authorized, read-only handoff preview for an exact source visit, pinned
form and validated candidate answers/outcome. It returns resolved destinations,
proposed owners, fixed-owner locks, eligible replacement choices, and any pending
requirements. Bound the automatic-node traversal and return understandable
errors for unresolved joins or invalid configuration. Do not persist submissions,
decisions, notifications, or visits during preview.

Extend the existing audited form/progression boundary with a typed handoff
payload keyed by target-stage identity. Preserve compatibility for existing
callers. The final operation locks the source visit and instance, validates the
same pinned definition and answers, recomputes the route and recipients, saves
the form and handoff intents, satisfies completion requirements, and activates
successors in one transaction when ready. Clients cannot choose unauthorized
routes or inject instance context. Reject stale previews when the proposed
destinations or ownership contract no longer match.

Retain the durable mutation-key table. Check target identity before returning
cached responses and bind new requests to a canonical payload fingerprint so a
key cannot silently reuse different answers/targets. Keep request keys across
retries, reconnects, refresh and remount for an unfinished submission. A successful
request returns the original durable result on replay. Do not persist sensitive
answers in browser storage merely to retain an idempotency key.

The result distinguishes form_saved_pending_completion, awaiting_other_doers,
awaiting_approval, successors_activated, and workflow_completed, with authorized
destination summaries. Preserve rejection, evidence, checklist and approval
behavior. Completion of the whole instance still waits for mandatory branches.

## Automatic starters

Reuse starter assignment identities and automatic submission/start RPCs. Add
explicit published workflow/form-version identity for a form link shared across
flows; a generic library submission with multiple possible triggers must ask
for an authorized explicit choice or fail clearly. Never guess by template.
Initial completion uses the same route evaluator as subsequent forms, including
the pending initial-routing repair, after that repair's tests pass.

Remove normal manual Start instance actions from web and native authoring.
Preserve old URLs through the canonical assigned-work parser. Successful start
shows the workflow name and permitted assignment summary; only offer Open work
when the caller owns the returned exact work identity. Otherwise return to the
caller's work surface. Multiple internal pipelines share the same instance.

## Employee experience

Keep the form renderer mounted while showing the confirmation modal so Cancel
retains answers and causes no server mutation. Show the requested Complete Stage
and Assign Next Work modal after validation and preview, before submission.
Offer Continue with Selected Employee, Assign to a Different Employee, and Cancel
and Return to Form. Display one assignment row per parallel human destination.
Fixed-owner rows explain their lock. Last stages show a final completion
confirmation. Busy controls prevent duplicate clicks but do not replace server
idempotency. Deferred completion must never claim that successor work exists.

Add Task Display Settings to stage authoring: title template, short description,
instructions, selected initial/prior answer fields, priority fields, reference,
due label and expected result. Templates reference stable keys and use bounded
substitution, never executable expressions. Old workflows use a restrained
automatic summary. Ordinary task presentation remains unchanged.

A targeted work-context read returns only authorized configured fields from
causal predecessor visits and initial submission, pinned question metadata,
safe display names, current instructions, and a compact permitted journey.
Reuse `presentFormSubmission`; unresolved historical user values show a readable
historical-person placeholder instead of raw UUIDs. File values do not expose
Storage paths; existing signed-download authorization still applies. Do not
broaden general form-submission RLS to expose entire unrelated submissions.

Load the exact current form with `loadTaskForms`, not `loadForms`. Bound history
with pagination and fetch evidence/checklists for the current visit only.
Web, phone-width web and native screens implement the same contract. Source
currently contains native Expo FMS screens, so assuming WebView-only parity is
insufficient until the employee release entry point is verified.

## Builder, pipelines and follow-ups

Simple mode presents Initial Form, Stages, Assignments, Conditions, Review,
Publish. Canvas mode keeps the existing advanced graph. Both edit one normalized
definition; switching modes cannot drop advanced settings. Nonlinear graphs
remain readable in Simple mode, with advanced connections explicitly shown.
Keep undo, redo, pan, zoom, drag, connect, duplicate, remove and issue navigation.

Integrate existing form selection, creation, preview, published-version display,
and return to the same draft/stage after editing. Graph summaries show form,
assignment mode, timing, next steps and validation issues. Pipeline labels and
swimlanes are presentation metadata on the existing graph, not separate engines.

Reuse execution scopes, parallel joins and fresh visit infrastructure. Add an
optional per-stage visit cap and explicit escalation/hold behavior for configured
follow-up safeguards. Preserve unbounded human-driven follow-ups where explicitly
configured, exit-path validation, automatic-cycle rejection and transition guards.
Never overwrite old visit data or satisfy a new join with an old completion.

## Validation and deterministic dry run

Extend existing shared validation and matching server publication checks for
initial/pinned forms, completion requirements, all assignment modes, conditional
visibility coverage, deterministic routing, valid question/options references,
eligible configured recipients, connected paths, joins, loop exits, timing and
handoff feasibility. Problems retain stage keys and open the affected control.

Dry run uses synthetic answers, shared route/assignment semantics and an explicit
synthetic directory snapshot. It cannot call mutation RPCs or generate production
records. Clearly distinguish its assumptions from live preview eligibility.
Parity tests compare representative shared and SQL decisions; final execution
always recomputes on the server.

## Implementation sequence and evidence

1. Reconcile the authoritative migration/source history from `origin/main`
   without overwriting concurrent work. Reserve migration numbers after recheck.
   Establish an isolated synthetic validation database without resetting any
   existing developer stack. Verify baseline tests and record existing failures.
2. Implement versioned assignment, provenance, eligibility, publish validation
   and preview/final-transition contracts with pgTAP success/denial coverage.
3. Update shared types, normalization, routing/simulation helpers, generated
   database types and both API layers with focused tests.
4. Wire stable request keys, exact automatic starters and pending/final results.
5. Implement web/native confirmation and contextual task screens; verify cancel,
   last stage, parallel handoff, approval and evidence behavior.
6. Implement builder modes, form integration, display settings, assignment modes,
   graph summaries, pipeline grouping and deterministic preview on both surfaces.
7. Separate authoring navigation and work access; test direct URLs and RPCs.
8. Execute owner acceptance A-M, focused and broader regressions, pgTAP, database
   lint, typecheck/build, desktop/phone browser QA and physical Android validation.
9. Produce the requested audit, changed-files, database/security, test, user-guide
   and blocker report. Follow staging/production and signed mobile release gates.

Required failure cases include changed eligibility between preview/confirm,
hidden assignment answers, stale previews, canceled forms, lost responses,
same-key concurrent requests, forged target IDs, conflicting join inputs,
deferred approval, and legacy version replay. The implementation plan will pin
exact signatures and test files after review of this design.

## Current limits

No product changes or tests are claimed by this document. The hosted ledger was
read, not migrated. Hosted function definitions, authenticated browser behavior,
employee installation type, staging availability, and physical-device behavior
remain unverified. Migration gaps and concurrent changes are listed in the audit.
