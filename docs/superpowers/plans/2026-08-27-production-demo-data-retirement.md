# Production Demo Data Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire a tenant's demo operational data while retaining the complete app, identity and organisation setup, Availability, CRM, configuration, and audit history.

**Architecture:** A forward migration creates a service-role-only, tenant-derived inventory/reset contract. It records an expiring count manifest and deletes only an explicit dependency allowlist. An authenticated Edge Function passes the verified Auth UUID to that contract, and a super-admin Settings card makes preview/review/typed confirmation possible without changing navigation. Storage and worker handling are verified through a separate operations runbook.

**Tech Stack:** Supabase Postgres/PLpgSQL/RLS/pgTAP, Deno Edge Functions, React 18/Vite/TypeScript, `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-08-27-production-demo-data-retirement-design.md`

## Global Constraints

- Never remove or modify routes, app sections, migrations, Auth/users, branches, departments, Availability, buddy assignments, CRM tables/files, Dropdown Master, section controls, Settings, provider configuration, preferences, or existing audit logs.
- Derive tenant and actor only from a verified active super-admin identity. No browser payload includes a tenant or profile ID.
- A preview is read-only. Execution requires an unexpired preview, identical hash and live counts, exact phrase `RETIRE DEMO DATA`, backup reference, and maintenance acknowledgement.
- No direct `DELETE`/`TRUNCATE` privilege is granted to `authenticated`. Sensitive work is server-side and audited.
- Production execution is a separately approved human operation. Automated tests, local reset, and staging rehearsal must never target production.

---

### Task 1: Add the guarded database contract

**Files:**
- Create: `supabase/migrations/0104_production_demo_data_retirement.sql`
- Create: `supabase/tests/0104_production_demo_data_retirement.test.sql`
- Modify: `packages/api-client/src/database.types.ts`

**Interfaces:**
- `preview_production_demo_data_retirement(p_actor_auth_user_id uuid, p_backup_reference text)` returns operation ID, SHA-256 manifest hash, expiry, removal counts, retained counts, and safe Storage counts.
- `execute_production_demo_data_retirement(p_actor_auth_user_id uuid, p_operation_id uuid, p_manifest_hash text, p_confirmation text)` returns operation ID and actual removal counts.

- [ ] **Step 1: Write failing pgTAP authorization and fixture coverage**

Create two tenant fixtures containing active super admin/admin/inactive-super-admin profiles, a CRM client/document, retained organisation/Availability data, and task/form/FMS/notification/report rows. Assert the new RPC is unavailable to `authenticated` and returns `42501` for non-super-admin, inactive, unknown, and cross-tenant actors.

- [ ] **Step 2: Run focused pgTAP to demonstrate it fails**

Run `supabase.cmd test db --local supabase/tests/0104_production_demo_data_retirement.test.sql`.

Expected: FAIL because migration `0104` does not exist.

- [ ] **Step 3: Implement the operation ledger and inventory RPC**

Create `production_demo_data_retirements` with tenant, actor profile, state (`previewed`, `running`, `completed`, `expired`), manifest JSON, hash, non-secret backup reference, expiry, maintenance acknowledgement, execution timestamp, and removal counts. Enable RLS, revoke all browser privileges, and prevent two pending/running operations per tenant with a partial unique index.

Resolve `p_actor_auth_user_id` against `user_profiles.auth_user_id`; require active account, active working status, enabled login, and `user_role = 'super_admin'`. Build the manifest only from these child-before-parent removal groups:

```text
Tasks: task_attachments, task_watchers, task_assignees, task_checklists,
task_comments, task_revisions, task_import_items, task_import_batches,
task_instances, task_templates.
FMS: fms_evidence, fms_instance_checklist_items, fms_instance_stage_assignees,
fms_stage_logs, fms_instance_stages, fms_starter_assignments, fms_instances,
fms_branch_rules, fms_stage_assignees, fms_stages, fms_flows.
Forms: form_submissions, form_links, form_fields, form_templates.
Notifications: notification_deliveries, notification_events, notifications,
notification_logs, notification_rules, notification_templates.
Reports/runtime: export_logs, performance_snapshots, tenant_realtime_events,
daily_checklist_acknowledgements, designation_daily_checklists.
```

Inventory must query the live catalog for tenant-scoped dependencies and raise `P0001` when a dependency is neither retained nor in this allowlist. It must never include CRM, `audit_logs`, users, organisation/Availability/buddy data, configuration, or `auth.users`.

- [ ] **Step 4: Implement the execute RPC**

Lock the operation row with `FOR UPDATE`, reauthorize the actor, require state `previewed`, 20-minute validity, a matching SHA-256 hash, exact phrase, nonblank backup reference, maintenance acknowledgement, and an unchanged fresh manifest. Delete only listed tenant rows in the documented order, write one `audit_logs` row with action `production_demo_data_retired`, persist actual counts, and mark completed. Grant these functions only to `service_role`; revoke public/anon/authenticated and reload the PostgREST schema.

- [ ] **Step 5: Regenerate types and extend pgTAP assertions**

Use the repository's existing package command to generate `packages/api-client/src/database.types.ts` from local Supabase. Test invalid hash/phrase, expiry, repeat, inactive/admin/cross-tenant denial, successful removal, one audit event, and preservation of CRM, user profiles, branches, departments, Availability, Dropdown Master, and Settings.

- [ ] **Step 6: Run focused verification and commit**

Run `supabase.cmd db reset`, then the focused test, then `supabase.cmd db lint --local --level warning`. Stage only migration/test/generated type files, inspect `git diff --cached --check`, and commit `feat: add guarded demo data retirement contract`.

### Task 2: Add the authenticated Edge Function boundary

**Files:**
- Create: `supabase/functions/production-demo-data-retirement/index.ts`
- Create: `supabase/functions/production-demo-data-retirement/index.test.ts`
- Modify: `supabase/config.toml` only if required; leave JWT verification enabled.

**Interfaces:**
- Preview input: `{ action: 'preview', backup_reference: string, maintenance_acknowledged: true }`.
- Execute input: `{ action: 'execute', operation_id: string, manifest_hash: string, confirmation: 'RETIRE DEMO DATA' }`.

- [ ] **Step 1: Write failing Deno tests**

Mock caller `auth.getUser` and service `rpc`. Cover missing/invalid Bearer token, invalid action, extra JSON keys, malformed UUID/hash, missing backup/acknowledgement, and success forwarding. Assert only `verifiedUser.id` becomes `p_actor_auth_user_id`, and neither tenant nor profile ID may be supplied.

- [ ] **Step 2: Run Deno tests to prove the boundary is absent**

Run `deno test --allow-env --allow-net supabase/functions/production-demo-data-retirement/index.test.ts`.

Expected: FAIL because the Edge Function does not exist.

- [ ] **Step 3: Implement strict request validation and safe errors**

Follow the identity/CORS mechanics in `supabase/functions/delete-user/index.ts`. Accept POST/OPTIONS only. Verify the session with the anon client, validate exact object shapes, then call the service client with the verified Auth UUID and validated arguments. Return `401` for identity failure, `403` for database authorization denial, `409` for expiry/hash/state conflict, and safe `400` messages otherwise. Never return raw SQL error details, Storage paths, backup references, customer data, or credentials.

- [ ] **Step 4: Re-run Deno tests and commit**

Run the focused Deno test. Stage only the named function/test/config paths, inspect staged whitespace, and commit `feat: secure demo data retirement edge function`.

### Task 3: Add the super-admin Settings control

**Files:**
- Create: `apps/web/src/features/settings/ProductionDemoDataRetirementCard.tsx`
- Create: `apps/web/src/features/settings/ProductionDemoDataRetirementCard.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsView.tsx`
- Modify: the existing typed Edge Function client module under `packages/api-client/src/`

**Interfaces:**
- `previewProductionDemoDataRetirement(backupReference: string): Promise<RetirementPreview>`.
- `executeProductionDemoDataRetirement({ operationId, manifestHash, confirmation }): Promise<RetirementResult>`.

- [ ] **Step 1: Write failing client/component tests**

Test that non-super-admin profiles do not render the card; super admins see retained/removal boundaries; preview requires backup reference and maintenance acknowledgement; returned count/hash/expiry renders without raw record data; execute stays disabled until exact phrase; stale/session errors clear preview state.

- [ ] **Step 2: Run the focused test to show it fails**

Run `pnpm.cmd --filter web test -- ProductionDemoDataRetirementCard.test.tsx`.

Expected: FAIL because the UI/client is absent.

- [ ] **Step 3: Implement the smallest isolated UI**

Keep all Settings/navigation sections unchanged. Render a super-admin-only warning card showing that Users, organisation, Availability, CRM, configuration, and audit are retained. Show removal groups/counts only. Use the existing client/session handling, refresh the session before execute, and make the Edge Function/RPC—not UI gating—the authorization boundary.

- [ ] **Step 4: Run focused web checks and commit**

Run the focused Vitest file and `pnpm.cmd exec turbo run typecheck --filter=web --force --concurrency=1`. Stage exactly the named card/test/Settings/client paths, inspect staged whitespace, and commit `feat: add production demo data retirement control`.

### Task 4: Add Storage/worker validation and the operational runbook

**Files:**
- Modify: `supabase/tests/0104_production_demo_data_retirement.test.sql`
- Create: `docs/operations/production-demo-data-retirement-runbook.md`

- [ ] **Step 1: Add failing Storage/maintenance tests**

Add CRM and non-CRM paths to the fixture. Assert that preview lists only task/FMS/form/report paths, never CRM document paths, and execution rejects a missing maintenance acknowledgement. Assert completed operations cannot replay.

- [ ] **Step 2: Confirm new assertions fail, then add only necessary guards**

Run the focused pgTAP test. Implement the narrow operation fields/validation required by the failures; do not attempt to stop cron jobs from a browser RPC.

- [ ] **Step 3: Write the no-secrets cutover runbook**

Require: interactive target/SHA confirmation; provider backup and staging restore rehearsal; protected pause of recurring/deadline/notification/report/CRM-sync workers; read-only maintenance; preview count/hash recording outside Git; final written approval of exact counts/hash; one execution; count/Storage comparison; retained CRM/Availability/user smoke tests; worker re-enable and monitoring. State recovery uses worker containment plus tested restore/forward correction, never a raw retry/delete.

- [ ] **Step 4: Run full local validation and commit**

Run `supabase.cmd db reset`, `supabase.cmd test db`, `supabase.cmd db lint --local --level warning`, core/web tests, full typecheck, full build, and `git diff --check`. Record unavailable Docker/browser checks honestly. Stage only the test and runbook, inspect staged whitespace, and commit `docs: add demo data retirement operations runbook`.

### Task 5: Staging rehearsal and separate production approval

**Files:**
- Modify: `PROJECT_HANDOFF.md` only after real hosted evidence exists.

- [ ] **Step 1: Run staging read-only preflight**

After interactive staging confirmation, run `git rev-parse HEAD`, `git status --short`, `supabase.cmd migration list --linked`, and `supabase.cmd db push --linked --dry-run`. Verify only reviewed migration `0104` is pending.

- [ ] **Step 2: Deploy and rehearse only in staging**

Apply the reviewed migration, deploy exactly `production-demo-data-retirement`, deploy the matching web SHA with staging browser-safe variables, and execute the complete runbook with safe data. Capture denials, preview, execution, post-counts, Storage scope, worker states, retained CRM/Availability, and signed-in rendered proof.

- [ ] **Step 3: Obtain fresh, separate production approval**

Present the production preview hash/count report, backup/restore rehearsal, worker-pause checklist, staging evidence, release SHA, and maintenance window. Stop unless the named approver accepts this exact evidence.

- [ ] **Step 4: Execute once, verify, and close**

Confirm the production target interactively; repeat preflight; make the fresh backup; pause workers; preview; compare hash/counts to approval; execute once via the signed-in super-admin control. Verify audit, CRM documents/counts, staff login/profile/branch/department/Availability, and empty operational modules. Re-enable workers, monitor, and add only non-sensitive evidence pointers to `PROJECT_HANDOFF.md`. On any invariant failure, contain workers and use the rehearsed restore/corrective path without retrying raw deletes.
