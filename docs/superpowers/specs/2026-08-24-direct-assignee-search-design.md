# Direct Assignee Search Design

## Goal

Replace branch-then-department assignment cascades with one searchable, tenant-wide person selector across Tasks, FMS, and CRM. A selected person visibly identifies their department and branch, while the protected server-side mutation derives and validates the persisted organizational context.

## Scope and user flow

The change applies only to controls whose purpose is assigning a person. It does not remove branch or department fields that describe an independent business record or workflow scope.

Every applicable assignment control will open a searchable roster. Search matches employee name, employee code, role, branch, and department. Each result presents the employee name and a secondary line in the form `Department · Branch · Role`. The selector supports keyboard navigation, an accessible search label, empty-result feedback, and selected-user context after a choice is made.

The selector includes active, login-enabled profiles in the current tenant that the actor may assign under the server-side authorization contract. It will not offer inactive, resigned, suspended, cross-tenant, or otherwise ineligible profiles.

These assignment flows are included:

- normal Task creation, delegation, and read-only in-loop/watcher selection;
- FMS named default-step assignment, any manual first-assignee selection, and live reassignment where present;
- CRM client creation/edit/reassignment, walk-in Assigned CRM and Salesperson selection, and CRM follow-up assignment/rescheduling.

FMS workflow scope configuration remains a branch/department business decision. CRM home/visit branch remains when it describes the client or the visit itself rather than merely locating an assignee. In an assignment flow that also stores a branch or department for authorization/history, the selected profile supplies that context and the UI shows it read-only beside the selected person.

## Shared web architecture

Create a reusable strict-TypeScript assignee picker in the web application rather than duplicating local filtered `<select>` controls. Its small input contract accepts a roster of eligible profiles, selected ID or IDs, single- or multi-select mode, excluded IDs, a visible label, and an `onChange` callback. It renders organizational labels from the supplied branch and department references without making those references interactive filters.

The control searches locally over already-authorized reference data and uses deferred query handling if the roster is large enough to affect input responsiveness. No roster data is logged, persisted in browser storage, or fetched with a service credential. Existing task `UserPicker` behavior becomes the foundation, but its callers stop filtering by preselected branch and department. FMS and CRM consume the same component or a thin adapter rather than retaining separate, non-searchable native selects.

Selecting a person updates the associated assignment ID and derived branch/department display atomically in component state. Changing an assignee clears only dependent assignment state that is genuinely invalid; it does not silently discard unrelated form fields.

## Database and authorization contract

Add a forward-only migration; do not alter applied migrations. Protected assignment RPCs must treat caller-supplied branch and department values as untrusted compatibility inputs.

For direct individual assignment, each RPC loads the selected `user_profiles` row under its security-definer authorization boundary, then verifies:

1. authenticated actor and active tenant profile;
2. selected profile belongs to the same tenant and is active, login-enabled, and assignable for the relevant role;
3. actor has the specific all-branch assignment authority for that module;
4. the persisted task/FMS/CRM branch and department equal the selected profile's current organization values where the record's scope is assignee-derived;
5. role-specific workflow rules, availability/coverage, optimistic concurrency, and existing audit rules still pass.

The change intentionally enables authorized cross-branch assignment. It does not make cross-tenant assignment possible and does not weaken ordinary-user, inactive-user, or workflow-specific restrictions. Where a record has an independently meaningful branch (for example a CRM visit), the RPC validates that branch separately and does not overwrite it merely because an assignee works elsewhere.

Every affected sensitive mutation keeps its audit write in the same transaction, recording the selected profile and the derived organizational context without storing excess profile data. Direct table writes remain unavailable; the browser continues to call only the narrowly granted RPCs.

## Compatibility and migration behavior

Existing Tasks, FMS instances, CRM clients, walk-ins, and follow-ups retain their historic branch/department values. Their display does not change until someone makes a new assignment. Existing RPC signatures may retain branch/department arguments for client compatibility, but the forward migration will either derive their authoritative values from the selected assignee or reject mismatches explicitly. New web callers use the simplified direct-assignee contract once available.

Bulk import, recurring templates, role-based FMS stage rules, manager/department-head resolution, reports, user administration, and FMS workflow scope are out of scope unless an affected protected RPC requires a narrow compatibility adjustment. They are not converted into person pickers merely because they store organization fields.

## Testing and acceptance criteria

- Component tests prove name/code/department/branch/role search, accessible labels, keyboard selection, result context, no-results feedback, and selection without an initial branch or department.
- Task, FMS, and CRM tests prove that their former cascades are absent from assignment controls and that selecting a profile displays the correct organization context.
- Database contract tests prove authorized cross-branch assignment, derived scope persistence, audit entries, inactive/login-disabled rejection, ordinary-user denial, cross-tenant denial, and rejection of incompatible independent record scope.
- Existing FMS availability, coverage, role-rule, and client concurrency tests remain valid; failures are investigated rather than bypassed.
- Focused web tests, relevant pgTAP tests, TypeScript checks, production build, `git diff --check`, staged secret scan, and authenticated browser verification using safe test accounts are run before any production claim.

## Non-goals

- No global client-side authorization store or mock roster.
- No service-role credential in the web app.
- No change to the underlying tenant/branch/department data model.
- No removal of independent branch/department business fields.
- No hosted migration, deployment, or production claim without a separately approved release operation and evidence.
