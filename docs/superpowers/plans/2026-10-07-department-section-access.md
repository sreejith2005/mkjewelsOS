# Department section access implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Super Admin controls each employee from Users and each department from Settings, with Sales/CRM department CRM access.
**Architecture:** Extend the existing database resolver, audited configuration contracts, and shared previews. Preserve action permissions and dashboard authority. Connect department changes to CRM staff sync.
**Tech Stack:** Postgres/pgTAP, TypeScript/Vitest, React, React Native.
**Spec:** docs/superpowers/specs/2026-10-07-department-and-individual-section-access-design.md

## Global constraints
- Individual choice > department > designation > role, with existing Super Admin and protected permission semantics.
- Forward-only migrations; audited server writes; no historical record or role changes.
- Users contains individual Section access; Settings contains Departments.
- Web and native share semantics; preserve existing permission management.
- CRM work is authored in C:/crm; preserve all unrelated edits.

## Review focus
- Saving section access must preserve dashboard authority and unrelated overrides.
- Duplicate department names require branch context and tenant isolation.
- Delayed load/save responses cannot overwrite another selected employee.
- Revocations affect new CRM sessions; issued tokens retain their existing expiry boundary.
- Department moves, deactivation and reset invalidate access and CRM eligibility.

### Task 1: Shared department resolution
Files: packages/core/src/permissions/resolve.ts; permissions.test.ts; packages/data/src/permissions/api.ts; api.test.ts; apps/web/src/features/permissions/api.ts.
Interfaces: AccessSubject.departmentOverrides?: PermissionOverrides; PermissionExplanation.department; admin departments/overrides; UserAccessBreakdown department fields.
- [x] Add precedence, action isolation, Super Admin tests; run pnpm.cmd --filter @jewelos/core test -- permissions/permissions.test.ts and observe failure.
- [x] Extend resolver and explanations only for module permissions; rerun focused tests.
- [x] Extend shared API parsing and add saveDepartmentPermissions and saveUserSectionAccess; tests prove authority is not changed by a section-only save.

### Task 2: Database contracts and CRM eligibility
Files: supabase/migrations/0199_department_section_access.sql; supabase/tests/0199_department_section_access.test.sql; packages/core/src/database.types.ts (resolve actual generated path).
Interfaces: save_department_permissions_with_audit(uuid,jsonb); save_user_section_access_with_audit(uuid,jsonb); existing admin/breakdown RPCs extended compatibly.
- [x] Add pgTAP for precedence, inherit, audits, invalid payloads, protected keys, inactive/unauthenticated/cross-tenant/ordinary/service-role denial, same-name departments, direct grants and global switch.
- [x] Add department table, constraints, resolver, admin/breakdown extensions, realtime and audited RPCs. Section-only RPC preserves authority under row lock.
- [x] Author CRM sync extension in C:/crm as a separate forward migration: module department events and other employee roles map to salesperson only when crm.view allows. Copy only the reviewed new file to active repo; do not merge unrelated CRM work.
- [x] Run local migrations and pgTAP if Docker is available; otherwise record the blocking environment and do not deploy.
- [x] Update generated database types and typecheck shared packages.

### Task 3: Web controls
Files: apps/web/src/features/permissions/{DepartmentPermissionsTab,UserSectionAccess}.tsx and focused tests; PermissionManagementPage.tsx/test; pages/TeamDirectoryPage.tsx/test.
- [x] Add rendered tests for individual grant/deny/inherit from Users, preserved action/authority, self lockout, delayed responses and department changes.
- [x] Implement focused Users modal backed by shared API; add Departments tab and department explanation to existing user breakdown. Preserve drafts through realtime refresh.
- [x] Run focused web tests and typecheck/build; inspect desktop and phone widths when browser tooling exists.

### Task 4: Native parity
Files: apps/mobile/src/features/users/UserSectionAccess.tsx; features/settings/DepartmentPermissionsTab.tsx; screens/{UsersScreen,PermissionManagementScreen,SettingsScreen}.tsx; shared section editor model/tests.
- [x] Exercise shared section editor behavior and native navigation permission tests.
- [x] Add individual sheet in Users and department tab in Settings using shared contracts. Update native breakdown preview for departments.
- [x] Run mobile tests/typecheck and inspect on connected device if available.

### Task 5: Verification and release
- [x] Run relevant full core/data/web/mobile tests, typecheck and build; git diff --check; independent security/code review and correct material findings.
- [x] Record local/hosted/device evidence separately. Initialize Sales/CRM only by verified IDs through audited RPC after hosted gates pass.
- [x] Commit named reviewed paths; follow production playbook and Android release guide. Stop publication if any required gate is unverified.

## Execution outcome
Implemented and locally verified on `feat/department-section-access`. Local commit and acceptance evidence are recorded in `docs/DEPARTMENT_SECTION_ACCESS_ACCEPTANCE_2026-10-07.md`. Phone testing and hosted release remain pending; the release step stopped at the required device gate. No hosted department grants were made.
