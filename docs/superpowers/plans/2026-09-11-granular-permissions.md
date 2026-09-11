# Granular permissions, dashboard authority, and Developer Mode enforcement

Date: 2026-09-11. Status: implemented in working tree (see validation section of
the handoff for what was and was not proven).

## Phase 1 audit (what existed)

| Concern | Existing source of truth |
| --- | --- |
| Role model | `user_profiles.user_role` enum: `super_admin, admin, manager, hr, crm, staff, doer, housekeeping`. Job titles such as Process Coordinator are **designations** (`dropdown_masters.master_type = 'designation'`), already used by `create_delegation_task_with_audit` (0144). |
| Permission model | None. Authorization is role checks: `packages/core/src/roleMenu.ts` `ROLE_PAGES` on the client; `current_role_level()` (109 uses), `current_profile()` (134 uses) and 28 migrations with inline `user_profiles where auth_user_id = auth.uid()` lookups on the server. |
| Dashboard/navigation | `App.tsx` builds the menu from `getImplementedMenuForRole(profile.user_role)` and guards the route with `canAccessPage(role, page)`, falling back to `dashboard`. |
| Developer Mode | `tenant_section_controls` (0051/0093/0094/0108/0138). `get_section_availability()` / `save_section_availability_with_audit()` (Super Admin only). |
| Route guards | Client only (`App.tsx`). |
| API/RLS | RPC role checks + RLS; **nothing on the server reads section availability**. |

### Developer Mode root cause

1. `isSectionUnderMaintenance()` returns `developer_mode_enabled && !available`.
   The header "Developer Mode" switch is also the thing a Super Admin turns off
   to hide the control strip, which silently re-enables every disabled section.
2. No RPC, RLS policy or Edge Function checks section availability, so any
   direct API call (or a page that loads before the overlay) works.
3. The navigation menu is never filtered by availability; only the page body is
   replaced with a maintenance notice.

## Phase 2 design

### Concepts (kept separate)

* **Role** – unchanged `user_role`.
* **Designation** – unchanged; gains optional grant/deny overrides.
* **Dashboard authority** – new `user_access_profiles.dashboard_authority`
  (`staff | manager | admin | super_admin`, `null` = inherit role). The
  *effective role* is `coalesce(dashboard_authority, user_role)`.
  `current_profile()` / `current_role_level()` return the effective role, and
  inline `auth.uid()` profile lookups in functions are rewritten to read
  `current_profile()`. Every existing role-scoped RLS/RPC rule therefore honours
  authority without being rewritten, and the client mirrors it by exposing the
  effective role as `profile.user_role`.
* **Permissions** – `permission_catalog` (29 keys, derived from real modules).
  Kinds: `module` (section access), `action` (wired to an existing check),
  `authority` (read-only, follows dashboard authority because task visibility is
  enforced in ~30 RLS/RPC paths), `protected` (Super Admin authority only:
  `permissions.manage`, `developer_mode.manage`).
* **Feature availability** – `tenant_section_controls.section_availability`,
  now enforced whether or not the Developer Mode strip is showing.

### Resolution (single authoritative implementation: `permission_effective_for()`)

```
protected  -> effective_role = super_admin
authority  -> effective_role in default_roles
otherwise  -> role layer   = role_permissions[tenant, effective_role, key] ?? effective_role in default_roles
              designation  = designation_permission_overrides (grant/deny) overrides role layer
              user         = user_permission_overrides (grant/deny) overrides both
module access = section enabled (or developer_mode.manage) AND <page>.view
```

`packages/core/src/permissions` mirrors the same rules for live previews in the
admin UI; a vitest parity test parses the migration catalog seed.

### Enforcement

* Client: `get_my_access_context()` → menu, route guard (redirect to first
  permitted page), maintenance notice, and action controls use
  `hasPermission()`.
* Server:
  * `assert_module_enabled(page)` injected into module RPCs (Developer Mode).
  * `assert_module_access(page)` (enabled + permission) injected into RPCs used
    only by that page (reports, dashboard, home, CRM, Task Control, users,
    dropdown master, settings, notification admin).
  * Restrictive RLS policies on tables owned solely by CRM, reports and
    notification administration.
  * Action permissions replace the matching role check in:
    `assert_crm_actor`, `assert_notification_admin`, `can_manage_fms_flow`,
    `can_manage_form_template`, `save_form_draft_with_audit`,
    `update_user_profile_with_audit`, `prepare_unused_user_deletion`,
    `save_tenant_settings_with_audit`, `save_branch_settings_with_audit`,
    `record_availability_with_audit`, `change_dropdown_with_audit`,
    `list/save_designation_daily_checklist(s)`, `request_report_export_with_audit`,
    `save_section_availability_with_audit`, and the `invite-user` Edge Function.
* Shared runtime RPCs that other sections legitimately call (task, FMS stage,
  form submission, recurring schedule, availability, notification inbox) get
  the availability gate only; a per-user deny of those embedded sections hides
  and blocks the section in the app but does not break Home/Tasks flows.

### Super Admin protection

Only `permissions.manage` holders (Super Admin authority) can call the save
RPCs; protected/authority permissions cannot be overridden; an actor cannot
change their own authority or overrides; the last active effective Super Admin
cannot be downgraded; nothing is read from client-supplied role values.

### Migration strategy (0156, behaviour-preserving)

* Default role rows are **not** materialised; absent rows fall back to
  `default_roles`, which equal `ROLE_PAGES` and the existing role checks.
* Tenants whose Developer Mode was off have `section_availability` reset to all
  sections available (that was their effective state), with an audit row.
* New tenant-scoped tables are added to the retirement manifest allowlist and
  emit `settings` realtime events so clients refresh access.

### Testing

* `packages/core` vitest: resolver matrix, ROLE_PAGES parity, SQL seed parity,
  page-access decisions (disabled/denied/allowed/bypass).
* pgTAP `0156_granular_permissions.test.sql`: authority substitution, grants,
  denies, designation layer, protected keys, lockout guards, audit rows,
  Developer Mode enforcement on RPC and RLS, super admin bypass.
* `docs/REGRESSION_CHECKLIST.md` for manual/browser regression passes.
