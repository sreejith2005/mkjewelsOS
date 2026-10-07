# Department and individual section access

Date: 2026-10-07 (Asia/Kolkata)
Status: behavior approved in chat; written specification pending review.

## Purpose and approved behavior

Sales and CRM employees need usable CRM access. Employees working across
departments need individual access to several sections without changing their
department or granting administrative authority. Super Admin manages section
access for departments and individuals.

- Individual controls live within Users: select an employee, open Section access.
- Department controls live in Settings > Permission management > Departments.
- Each section has Inherit, Enable, and Disable choices.
- Individual choice takes priority over department, designation, then role.
- Super Admin retains access to all implemented sections and permission management.
- Enable CRM for Sales and CRM departments; preserve individual exceptions.

## Current implementation and diagnosed gap

`packages/core/src/permissions/resolve.ts` mirrors the database resolver
`permission_effective_for()` (currently evolved through migration 0181).
Role defaults, designation overrides, individual overrides, dashboard authority,
and organization-wide section availability already exist. Department access
rules do not exist. Department membership therefore does not grant `crm.view`.
The reported employee's hosted profile and effective permissions have not been
inspected; this source finding does not establish their exact account issue.

Individual audited writes already use `save_user_access_with_audit()`.
Web and native Permission management currently expose Roles, Designations,
and Users tabs. Extend this system; do not create a second resolver.

CRM uses a separate project through `crm-session-exchange`. JewelOS's
`crm_sync.staff_snapshot()` currently maps only super_admin, admin, manager,
crm, and staff roles. Other roles with explicit CRM access can remain
ineligible for provisioning. Department rule changes currently have no CRM
outbox trigger. Both are part of this change's compatibility work.

## Access semantics

For ordinary configurable section permissions, resolve in this order:

1. Existing Super Admin bypass.
2. Individual Enable or Disable.
3. Active department Enable or Disable in the employee's tenant.
4. Existing active designation override.
5. Configured effective-role value, then catalog default.

Inherit removes the corresponding override. Department rules apply only to
catalog permissions of kind `module`; action permissions continue using
existing individual/designation/role resolution. Preserve protected permissions,
dashboard authority, and the explicit leave-exception contract unchanged.
Department membership is the profile's existing `department_id`; multi-department
membership is outside scope. Individual grants cover cross-department work.

Organization-wide section availability remains separate: a globally disabled
section is unavailable to ordinary users despite an access grant. Super Admin
retains the existing availability bypass. Section access does not increase
task authority, export permissions, CRM administrative role, or data scope.
Only implemented sections appear; do not invent Accounts, Sales, or Meeting AI
routes where no implementation exists.

## Server contracts and persistence

Add the next available forward-only JewelOS migration with a tenant-scoped
`department_permission_overrides` table. Store department, permission, effect,
updating actor, and timestamps. Enforce department/tenant consistency, module-only
keys, grant/deny effects, uniqueness, and suitable lookup indexes. Enable RLS;
do not permit direct authenticated writes. Configuration reads go through the
existing authorized admin contracts.

Add `save_department_permissions_with_audit(p_department_id uuid,
p_overrides jsonb)` with module-only grant/deny/null validation, active department
and same-tenant checks, active Super Admin authorization, section enforcement,
and old/new audit values in the same transaction. Reject unauthenticated,
inactive, ordinary, cross-tenant, and unapproved service-role callers.

Extend `get_permission_admin_context()` with departments and department overrides,
and `get_user_access_breakdown()` with department identity and per-row department
effect. Keep existing response fields compatible. Extend shared core previews,
data API parsing, web API consumers, and generated database types together.
The existing server access snapshot remains authoritative for navigation.

## User interfaces

Users exposes a Super Admin-only Section access action for each persisted
employee. A focused editor shows implemented sections, Inherit/Enable/Disable,
effective access, and its source. Save only section overrides using the audited
individual contract; preserve dashboard authority and unrelated action overrides.
Retain existing self-access and lockout safeguards. Do not force administrators
to leave Users to configure a person. Keep existing permission management
capabilities compatible and reuse its existing contracts and presentation logic.

The Departments tab lists department name and branch context (names can repeat),
then section choices. Show inherited and effective rules in employee breakdowns.
Use shared semantics on desktop web, responsive web, and native Android.
Preserve drafts during refresh and prevent an old employee's response/save from
updating a newly selected employee. Server changes refresh menus and open-route
access through existing realtime/catch-up mechanisms.

## CRM integration and initial grants

Department CRM changes enqueue affected employees through the existing audited
staff outbox; department moves and individual changes continue to enqueue them.
For active employees with effective `crm.view`, preserve existing administrator
and manager mappings and map other ordinary roles to CRM salesperson access.
Do not elevate ordinary employees to CRM administration. Preserve branch linkage,
historical identities, email-conflict safeguards, and original CRM data rules.
Missing/conflicting identity or branch mappings must remain actionable failures.

Implement CRM-related work only in `C:\crm` under repository instructions;
coordinate review and integration into main without silently switching that
worktree or merging unrelated changes. Do not add features to JewelOS's retired
CRM schema or merge the two databases.

Initialize CRM grants for actual active Sales and CRM department records using
verified tenant/department identifiers. Disambiguate duplicate names by branch.
Use the audited department contract; do not overwrite individual overrides,
change employee roles, create application records in clients, or retire accounts.
Hosted initialization follows the production playbook with the owner present.

CRM session exchange checks current JewelOS permissions before issuing a new
session. Existing issued CRM access tokens may remain valid until expiry unless
staff-sync revocation takes effect earlier. Preserve and test this boundary;
do not promise immediate invalidation of all issued sessions from a menu change.

## Compatibility and verification

Without a department override, existing access stays unchanged. Historical
task, FMS, form, CRM, notification, and audit data are preserved. No Storage
policy, customer data move, or destructive migration is intended.

Tests must prove individual deny beats department grant, individual grant beats
department deny, department beats designation/role, Inherit restores existing
rules, tenant isolation, inactive membership behavior, protected permission
rejection, Super Admin access, global availability, and audit atomicity.
Verify direct RPC/URL denial and navigation consistency across web and native.
Test CRM sync eligibility for every employee role, department grant/revoke/move,
branch/link conflicts, denied session exchange, and existing-session expiry.

Run focused pgTAP/core/data/web/mobile/CRM worker tests first, then relevant full
tests, typechecks and builds; verify rendered Users/Settings at desktop and phone
width and native device behavior. Keep local, hosted, browser, and device evidence
separate. Follow the production playbook before hosted changes, and the standing
Android release instruction after required gates pass. Stop and report failed
gates; documentation-only work needs no APK.
