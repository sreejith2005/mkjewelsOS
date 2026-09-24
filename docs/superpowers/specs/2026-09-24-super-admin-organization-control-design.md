# Super Admin organization control design

## Intent

An active Super Admin can operate every implemented module in their own tenant and manage the organization's branches and departments from the web and employee app. Existing user editing remains the way to move people, set their role and designation, and change their reporting manager. Admin retains current configured access.

## Scope

- Add an audited, Super Admin-only contract to create and edit branches and departments. Names and codes can change; departments may be shared across branches or scoped to one branch. Managers and heads can be assigned to active people in the same tenant and compatible branch/department.
- Block deactivation when active employees or active child departments still depend on a unit. Never delete a unit or rewrite historical work.
- Add a concise organization manager inside Users on web and native. Keep person edits in the existing editor. Show each unit's scope, status, and employee count before editing.
- Make effective Super Admin authority win over configurable module/action denies, while leaving other roles' permission precedence intact.
- Restrict branch and department reads to the actor's tenant. No tenant-crossing Super Admin behavior.

## Boundaries

Supabase RPCs validate the actor with `current_profile()` and `has_permission()`, lock edited units, validate all identifiers and changes, and write an audit row in the same transaction. No browser write grants on organization tables. The permission catalog and its TypeScript mirror stay in parity. Web and native call the same RPCs. Existing user, FMS, task, form, and CRM history remains unchanged.

## Verification

pgTAP covers successful writes and unauthenticated, ordinary, Admin, inactive, cross-tenant, invalid-scope, and deactivation cases. Core tests cover Super Admin permission immunity and unchanged Admin overrides. Run focused web/native typechecks and relevant tests, then local DB checks when Docker is available. A signed mobile release follows the repository release gate only after migration and app checks pass.
