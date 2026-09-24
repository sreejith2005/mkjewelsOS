# Super Admin Organization Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Super Admin reliable tenant-wide control of all implemented permissions and organization units on web and native.

**Architecture:** Forward-only migrations add a protected organization permission, audited branch/department RPCs, section gating, and organization integrity guards. Shared TypeScript mirrors permission resolution, and both clients expose a small organization manager in Users.

**Tech Stack:** PostgreSQL/Supabase, pgTAP, TypeScript, React, React Native, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-super-admin-organization-control-design.md`

## Global Constraints

- Preserve tenant isolation, history, existing user editing, and unrelated work.
- Use the existing permission resolver, audited RPC style, and design tokens.
- Keep mobile and web in parity; release mobile only after the required gates pass.

## Review Focus

- An Admin or inactive Super Admin must be denied by direct RPC invocation.
- A cross-tenant ID must not expose or mutate another organization's unit.
- Deactivating a unit with active people or departments must fail without partial writes.
- Moving a scoped department must not strand active people in another branch.
- A configurable deny must not remove effective Super Admin authority.

---

### Task 1: Permission authority and tenant scope

**Files:** `packages/core/src/permissions/{catalog,resolve,permissions.test}.ts`, `supabase/migrations/0171_super_admin_organization_control.sql`, `supabase/tests/0171_super_admin_organization_control.test.sql`.

- [x] Add failing core and pgTAP cases for Super Admin immunity and tenant-scoped reads.
- [x] Add catalog entry and SQL resolver change; preserve Admin/user override behavior.
- [x] Run focused core and database tests.

### Task 2: Audited organization operations

**Files:** migration and pgTAP test above; `packages/api-client/src/database.types.ts`.

- [x] Add failing pgTAP cases for actor, tenant, scope, manager/head, and deactivation validation.
- [x] Implement narrowly granted audited branch and department save RPCs.
- [x] Add section-gated wrappers, serialized department code uniqueness, and leader assignment guards in migrations 0172-0173.
- [x] Regenerate function declarations and run focused pgTAP/lint.

### Task 3: Web and native management

**Files:** `packages/data/src/users/organization.ts`, `apps/web/src/pages/UserManagementPage.tsx`, `apps/mobile/src/screens/UsersScreen.tsx`.

- [x] Add focused web tests for organization save behavior.
- [x] Add small organization editors to both Users screens using the same server contracts.
- [x] Run web, core, and native tests/typechecks.
- [ ] Verify rendered responsive web and native behavior with authenticated browser/device sessions.

### Task 4: Release

**Files:** reviewed files above and generated mobile version files from `scripts/release-mobile.ps1`.

- [x] Check required gates from the production playbook; the full local database suite fails in existing 0006, 0106, and 0139 tests.
- [ ] Resolve the full local database gate and confirm the hosted migration target.
- [ ] Commit named paths, apply hosted migration, run the signed Android release script, push and verify `latest.json` and APK.
