# Integrated Form, FMS, and Task Workflow Engine

## Current architecture assessment

JewelOS is already a real Supabase-backed, multi-tenant application. Forms use
`form_templates`, versioned/published lifecycle metadata, `form_fields`,
`form_submissions`, audited SECURITY DEFINER RPCs, shared TypeScript validation,
and an authenticated renderer. A field currently carries one visibility
condition; the shared and SQL evaluators support `equals`, `not_equals`,
`contains`, and `not_empty`. Supported published field types do not yet include
time, URL, yes/no, hidden/system fields, or real upload storage. A draft-only
`file` field is deliberately rejected at publication.

Dropdown Master is `dropdown_masters`, keyed by immutable UUID with a
tenant/type/value uniqueness constraint. Only its audited RPC mutates it.
Forms currently copy labels/values to `form_fields.options`; this pins
historical forms safely but does not provide a live master option source.

FMS is a versioned graph stored in `fms_flows`, `fms_stages`,
`fms_stage_assignees`, and `fms_branch_rules`. Runtime state is in
`fms_instances`, `fms_instance_stages`, stage assignees, checklist/evidence
rows, and immutable stage logs. It already supports graph validation,
published revisions, parallel/join structural stages, named assignments,
deadlines, outcome/form-answer branch rules, and audited protected runtime
actions. An entry form is currently submitted first, then a separate
`start_fms_from_form_submission_with_audit` call creates an instance. A stage
form is likewise submitted before a separate stage-completion action. Those
two-call flows are the primary reliability gap.

Normal work is stored in `task_instances` and correctly remains independent of
FMS stage work. `TasksPage` separates My and Delegated normal work; FMS has a
dedicated `FMSTasksPage` with personal, started, and branch scopes, runner, and
timeline. The app router mistakenly maps the `fms_tasks` menu identifier to
`FMSBuilderPage`, making that dedicated task UI unreachable. Current FMS runtime
reads use capped bulk queries, appropriate for existing scale but not the
specified server-side aggregates/paginated dashboard.

Authentication is Supabase Auth plus active `user_profiles`. RLS and
SECURITY DEFINER RPC checks use the active profile, tenant, branch and role;
roles are `super_admin`, `admin`, `manager`, `hr`, `crm`, `staff`, `doer`, and
`housekeeping`. The UI role menu is presentational only. Protected writes
already add `audit_logs` rows transactionally.

## Target design

Preserve the existing IDs, lifecycle versions, submitted answers, FMS
instances, stage histories, normal tasks, and audited RPC boundaries. Extend
rather than replace their definitions.

Introduce one versioned `WorkflowRule` tree shared by form visibility and FMS
routing: leaf predicates have a stable field key, operator and typed value;
groups are explicit `all`/`any` trees. Form actions target a field/section by
stable key and can show, hide, require, optionalize, set a safe configured
value, or end the form. The initial delivery evaluates show/hide/required and
preserves existing legacy `conditional_logic` as a compatible single-leaf rule.
The engine never uses `eval`.

Option fields gain `option_source` (`manual` or `dropdown_master`) and
`dropdown_master_type`. Published versions persist a snapshot of option IDs,
labels and values for historical validation; new submissions resolve current
active master options only when the field is explicitly live. Inactive/deleted
master values remain valid only for historical submissions, never new choices.

Create a single idempotent server RPC for FMS form work. It locks the supplied
active stage (or entry submission), validates the form and authorization,
writes the submission, completes the stage, evaluates ordered matching routes,
creates zero or more next stages/tasks, writes stage/audit timeline entries,
and returns the updated state. A client-provided UUID idempotency key is stored
with the logical action. First-match is the default for ordinary routes;
parallel transitions explicitly create all ordered targets. A retry transition
creates a new `fms_instance_stages` row for the same stage definition, preserving
the earlier attempt and deriving the next attempt number from history.

FMS task work remains separate from normal delegated tasks. A server RPC
returns only the caller-authorized FMS task dashboard counts grouped by flow and
stage, plus paginated matching stage tasks. The repaired FMS Tasks route uses
that data and opens the existing stage runner. Admin monitoring is a separately
scoped aggregate view/RPC, never a browser-side scan.

## Compatibility, safety, and migration strategy

Use new nullable columns/tables and a forward migration after `0111`; do not
rewrite historical `options`, conditional JSON, forms, flows or stages.
Backfill only deterministic metadata, keep legacy RPC signatures, and add new
versioned RPCs. RLS remains deny-by-default; new writes use active-profile,
tenant, flow/stage/task authorization and audit entries in the same transaction.
Add partial composite indexes for active-stage/task dashboard access. Do not
apply a linked migration, deploy functions, or mutate production data without
the production playbook, linked-target confirmation, dry run, and separate
approval evidence.

## Scope phases

1. Shared rule model and backward-compatible form/dropdown definition
   extensions, with pure tests and pgTAP authorization/validation tests.
2. Idempotent transactional FMS entry and stage-form progression, retries,
   terminal paths, ordered transitions and full audit/timeline tests.
3. Authorized paginated FMS task dashboard/monitoring RPCs and the currently
   unreachable FMS Tasks route, using the existing stage runner.
4. Builder/renderer UX for rule groups, option-source selection, expanded
   field types and system context; regression and responsive browser checks.

The Instagram workflow is a test fixture built exclusively through the generic
form, dropdown, assignment, routing, and task configuration paths.
