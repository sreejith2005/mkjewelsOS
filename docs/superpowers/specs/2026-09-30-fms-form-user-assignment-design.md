# FMS form selected user assignment

## Intent

Authors can find a workflow error by its step, choose one person for every
human step with one toggle, or leave individual step assignees empty. A User
question in a linked Form can establish the default person for later FMS work.
An explicit person on a step takes priority. The selected answer is a Users
profile ID, so a later name change affects the displayed name without changing
the assignment identity.

## Existing contracts

Forms already support `user_dropdown` on web and native. The choices come from
the live, tenant scoped Users view, and the submitted value is the profile ID.
The web question palette was missing this existing field type; submission
details also displayed its stored ID instead of the current Users name.
FMS publication and activation currently require a named assignee for every
human step. Starter assignments are durable records for named first stage
assignees. FMS stage form submission and progression share one audited RPC.

## Assignment rule

The initial form may be filled by an active user authorized to start the flow,
even before a person has been selected in the form. A workflow author chooses
one User question on a linked form as the source of the runtime default. The
question must be required and visible. A submitted answer updates the instance
default for stages activated after that submission. The current default carries
through to the last step. A later form with an explicitly configured assignment
question replaces that default for subsequent stages. A step's explicit named
assignee overrides the default for that step only; it does not clear the
default. A manual next assignee handoff, when configured, retains its existing
one step precedence.

A standalone Forms Library form submission and the linked FMS start use one
audited database RPC. If the selected user is invalid or the workflow cannot
start, the form submission rolls back with it. Existing starter assignments
still use their assignment-specific submission path.

If a human step has neither a named assignee nor a valid current form selected
user, activation must stop with an actionable assignment error. Publication
must reject a path that can reach such a step before any required assignment
question, with the step and missing source identified. No work becomes
available to everyone merely because a later assignment is missing.

The runtime validates the selected profile against the instance tenant,
active account, login eligibility, and existing coverage rules in the
transaction that submits the form and progresses the stage. The browser does
not supply an assignee ID as an authority. Existing flow versions, in progress
instances, pinned form versions, and old submissions retain their meanings.

## Builder behavior

Publish readiness issues include the step name. Clicking one selects its
inspector and centers its canvas node, while the inspector repeats that step's
specific errors. On phone layouts, the issue opens the step editor. The
assignee dialog has a toggle to copy the first step's person to every human
step. An individual override turns the toggle off and is preserved. Empty
per step assignees remain allowed when a preceding required user answer can
provide the runtime default.

## Validation

Cover core path validation and assignment precedence, database publication
and runtime allowed and denied cases, first form submission, later form
submission, stale/inactive/cross tenant answers, and both web and native
builder and submission surfaces. Apply a forward migration. The source key is
stored in existing stage JSON; generated database types gain the new standalone
submission RPC signature.
Keep local, hosted, and device evidence separate.
