# Tasks -> FMS

This describes the new implementation; deployment is a separate release gate.

When the confirmation offers **Assign to a Different Employee**, you can search
all active, login-enabled users in your company across departments and branches,
including management. The same rule applies to an employee selected in the
workflow form. Fixed employee steps stay locked and availability coverage still
applies. Ordinary task-assignment permissions are separate from an authorized
FMS handoff.

## For employees

1. Open Tasks and select FMS. My Tasks and Delegated keep ordinary tasks; In Loop
   keeps watched work. Managers retain their existing All Tasks overview.
2. Expand a workflow family, then a published stage. Groups start collapsed.
   Only stages holding your work are listed. The start form is filled from the
   Forms Library and is not a stage; a pending start form you were asked to fill
   is listed as **Form to start**. Counts include all matching assignments, even
   when records span several pages.
3. Choose Open Work on the named record. The page is headed by the record name
   only (the card already showed workflow, stage and reference). Review previous
   answers, continue to the
   exact stage form and complete the existing evidence/approval/handoff steps.
4. Follow the confirmation from the existing runner. When no employee is set for
   the next step, it stays with you by default; press **Assign to a Different
   Employee** under the step to choose someone from the list that opens there, or
   **Keep it with me** to undo. The server checks the choice before Confirm unlocks. Newly assigned work appears
   under its destination stage for the employee who receives it.

Active includes your pending and overdue actions. Waiting separates a contribution
you have already finished while others complete their work, held work and deferred
approval states. Completed opens historical work. Workflow and stage filters, due
dates, record-name/reference search and Clear all apply on the server.
Open **Workflow and date filters** to choose a workflow, stage or due range.

Published versions stay separate within a family when necessary. A visit number
distinguishes repeated work for the same record. The durable workflow reference
stays visible even when different customers share a name.

## For form and workflow authors

In Form Builder, set **Use this question as the record name** to an eligible
identifying question, or leave Automatic. Save/publish through the normal form
workflow. A used published form requires a revision to change its naming default.

In the FMS Builder's initial form settings, open **Task Naming** and choose
**Task name from**: Automatic, the form's selected record-name question, or a
specific eligible question from the linked form. This affects that workflow.
Later stages inherit the original record name unless an advanced stage override
selects another causal form question. Keep a custom title template in Employee
work information when you need the existing advanced format.

Selections use stable field keys and exact linked form versions. Hidden, missing,
blank or unauthorized values fall back safely to an eligible historical identifier
or the durable workflow reference. Existing submissions and running workflow
definitions are not rewritten. Apply naming changes using the normal draft/revision
and publication lifecycle.

## Release requirements

Apply the reviewed forward migrations only after local database/security tests,
typecheck/build, rendered phone/desktop checks and the repository's release gates.
Before any hosted write, verify the linked project and migration ledger and review
`supabase.cmd db push --linked --dry-run`. Do not repair or renumber hosted history
to accommodate this feature. Publish matching web clients after the database reads
are present; an old four-tab client is not a complete rollback for new membership.

The current Android shell renders the deployed web UI. A browser check at phone
width is not physical Android evidence. Hosted migration, Git publication, web
deployment and device validation must be reported separately.

Kiara receives updated navigation help. No new unrestricted customer-data tool,
service-role read or mutation tool is added.

## Implementation and database contract

The shared classification and strict response contracts live in
`packages/core/src/taskFeed.ts`, `taskSearch.ts`, and `fms/taskWorkspace.ts`.
`fms/recordNaming.ts` supplies the form/editor naming choices and normalization.
`packages/data/src/fms/taskWorkspace.ts` calls the three actor-scoped read RPCs.
The UI is in `apps/web/src/features/tasks/fms/`; `TasksPage.tsx` owns navigation
and immediate subsection counts. Existing assigned-work and Home entry points
reuse the same authorized naming context and canonical work routes.

New forward migrations:

| Migration | Purpose |
| --- | --- |
| `0300_fms_task_workspace.sql` | Hierarchy reads, exact membership/counts, audited form naming, publication validation, indexes and narrow grants |
| `0301_fms_workspace_name_projection.sql` | Unambiguous name projection |
| `0302_fms_workspace_history_and_visibility.sql` | Waiting/history and causal answer visibility |
| `0303_fms_record_template_projection.sql` | Legacy template projection and required selectors |
| `0304_fms_starter_undated_work.sql` | Starter creation time is not a fabricated deadline |
| `0305_fms_record_name_inheritance.sql` | Stage override, original form default, legacy template, safe automatic and reference precedence |
| `0306_fms_workspace_actionability.sql` | Terminal-instance waiting state and strict ISO dates |
| `0307_fms_workspace_section_boundaries.sql` | Registered Tasks/FMS section identifiers enforce permissions and maintenance on hierarchy and legacy reads |
| `0308_fms_record_name_projection_cost.sql` | Skip unnecessary historical field projection when a form has no naming default |
| `0309_fms_cancelled_workflow_history.sql` | Retain completed visits after later workflow cancellation |
| `0310_fms_starting_form_history_identity.sql` | Count a submitted starting form once using its canonical completed runtime history; preserve repeat visits |
| `0311_fms_workspace_builder_edge_order.sql` | Preserve saved parallel/branch order and conditional-before-default graph traversal |
| `0312_fms_workspace_naming_projection_reuse.sql` | Reuse exact causal naming sources and fields behind materialized authorized assignments; keep unchecked helpers private |
| `0313_fms_workspace_actor_snapshot.sql` | Resolve stable actor/module checks once per query while retaining exact-work authorization |
| `0314_fms_name_candidate_volatility.sql` | Declare candidate selection STABLE to match its PostgreSQL text helpers |
| `0315_fms_global_search_module_snapshot.sql` | Resolve the same stable FMS module check once in global task search while preserving instance/work authorization |
| `0316_fms_batch_equivalent_record_names.sql` | Batch identical naming inputs within one authorized read; keep submitted visits and differing ancestry separate |
| `0317_fms_global_search_filter_before_names.sql` | Apply existing non-name search filters before projecting historical names, preserving cross-status counts |

The only added table column is `form_templates.record_name_field_key`; its
Row/Insert/Update types and the three public RPC types are checked against local
schema generation. No new work table, Storage policy, bucket, cron or Edge
Function is introduced. Existing RLS remains in force; the feed view retains
`security_invoker=true`. Private naming/projection/original-writer functions
have no anonymous, authenticated or service-role execution grants. The public
hierarchy RPCs accept no employee ID and authorize the current active actor.

Form naming changes use existing save/revision/duplicate lifecycles and a
transactional `form_record_name_updated` audit event. Used published versions
remain immutable. Naming reads causal historical snapshots; submissions and
running instances are not backfilled or rewritten. Existing transactional
form/stage completion, handoff, evidence and notification closure remain the
execution source of truth.

The feature plan records exact local validation and release limitations.

After the confirmation, the employee returns to Tasks -> FMS (`/tasks?view=fms`)
with a short notice naming who has the next step. There is no separate result
page; next work is opened from the FMS list.
