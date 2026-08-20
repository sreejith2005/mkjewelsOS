# Embedded CRM SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the independent CRM under JewelOS `/crm/*` with one JewelOS sign-in and CRM-enforced role/branch access.

**Architecture:** JewelOS remains the authoritative identity and roster source. CRM retains its Next.js runtime and separate Supabase project; CRM stores an additive link from its authenticated SSO identity to its existing historical CRM staff record and enforces access in CRM database functions and RLS.

**Tech Stack:** React/Vite, Next.js App Router, Supabase Auth/OIDC, Postgres/RLS/RPC, Prisma migrations, Vitest, Vercel rewrites.

**Spec:** `docs/superpowers/specs/2026-08-20-crm-embedded-sso-design.md`

## Global Constraints

- Preserve the separate CRM Supabase project, its data, migrations, Storage, and server-only integrations.
- JewelOS work-email roster and role are authoritative; CRM cannot elevate access locally.
- Do not share database credentials, service-role keys, or JWT signing keys with browser code.
- All CRM access changes and sensitive writes must be audited and enforced server-side.
- Use forward-only additive database migrations and stop before any destructive account retirement.
- Stage files explicitly; both repositories contain unrelated user changes.

---

### Task 1: Establish the CRM access-link contract

**Files:**
- Create: `sreejith-crm/web-app/lib/sso/access.ts`
- Create: `sreejith-crm/web-app/tests/sso-access.test.ts`
- Modify: `sreejith-crm/web-app/prisma/schema.prisma`
- Create: `sreejith-crm/web-app/prisma/migrations/<timestamp>_crm_sso_access_foundation/migration.sql`

**Interfaces:**
- Produces `mapJewelosRole(role)` and `canPerformCrmAction(grant, action)` for application/UI checks.
- Produces CRM SQL tables and functions resolving `auth.uid()` to the legacy CRM `users.id` record.

- [ ] Write a failing unit test for role mapping and destructive-action denial.
- [ ] Run `npm.cmd test -- tests/sso-access.test.ts` and confirm the test fails because the module is absent.
- [ ] Implement the pure role/action helper and rerun the focused test until it passes.
- [ ] Add an additive CRM migration for access grants, identity links, audit rows, resolver functions, indexes, and RLS policy changes; retain all existing CRM staff IDs.
- [ ] Run `npm.cmd run db:validate`, the focused unit test, and a local database/RLS harness if available.
- [ ] Commit only the Task 1 CRM files.

### Task 2: Add protected CRM SSO entry and callback behavior

**Files:**
- Create: `sreejith-crm/web-app/app/auth/jewelos/route.ts`
- Create: `sreejith-crm/web-app/app/auth/jewelos/callback/route.ts`
- Modify: `sreejith-crm/web-app/app/login/page.tsx`
- Modify: `sreejith-crm/web-app/lib/supabase/proxy.ts`
- Test: `sreejith-crm/web-app/tests/sso-route.test.ts`

**Interfaces:**
- Consumes the active grant resolver from Task 1.
- Produces a CRM session only after the configured OIDC provider returns an identity with an active CRM grant.

- [ ] Write failing route tests for an unprovisioned identity denial and a provisioned identity continuation.
- [ ] Run the focused test and confirm each failure is caused by the missing route behavior.
- [ ] Implement the OIDC launch/callback routes with state/PKCE handled by Supabase Auth and a generic failure message that exposes no token detail.
- [ ] Replace password login UI with a JewelOS sign-in continuation only; retain an administrator-only fallback behind explicit configuration if required for rollback.
- [ ] Run focused tests, `npm.cmd run typecheck`, and `npm.cmd run build`.
- [ ] Commit only the Task 2 CRM files.

### Task 3: Provision CRM grants from the authoritative JewelOS roster

**Files:**
- Create: `jewelos/supabase/functions/sync-crm-access/index.ts`
- Create: `jewelos/supabase/functions/sync-crm-access/deno.json`
- Create: `jewelos/supabase/functions/sync-crm-access/index.test.ts`
- Modify: `jewelos/supabase/migrations/<timestamp>_crm_access_sync_outbox.sql`
- Modify: `jewelos/apps/web/src/pages/TeamDirectoryPage.tsx` only if an existing authorized user-management mutation needs to enqueue the sync event.

**Interfaces:**
- Consumes a CRM server-only provisioning URL and HMAC secret from deployment configuration.
- Produces idempotent signed upsert/deactivate events and JewelOS audit logs.

- [ ] Write failing tests for a valid signed payload, replay rejection, invalid signature rejection, and inactive-user deactivation.
- [ ] Run the focused test and confirm missing implementation is the reason for failure.
- [ ] Implement an Edge Function that authenticates the JewelOS actor, validates the roster event, signs a timestamped nonce payload server-side, and records audit outcome without secrets.
- [ ] Add only forward JewelOS migration objects needed to emit/reconcile CRM access events; do not change existing applied migrations.
- [ ] Run the focused test, relevant web/core typecheck, and Supabase function lint/typecheck.
- [ ] Commit only the Task 3 JewelOS files.

### Task 4: Make CRM base-path aware and enforce CRM permissions

**Files:**
- Modify: `sreejith-crm/web-app/next.config.ts`
- Modify: `sreejith-crm/web-app/proxy.ts`
- Modify: `sreejith-crm/web-app/components/crm-shell.tsx`
- Modify: CRM client/server data call sites that currently assume `auth.uid() = users.id`
- Test: `sreejith-crm/web-app/tests/sso-access.test.ts`

**Interfaces:**
- Consumes CRM identity-link resolver from Task 1.
- Produces `/crm/*`-safe navigation, asset paths, API paths, redirects, and server-side role enforcement.

- [ ] Add failing tests for `/crm` path generation and manager/staff destructive-action denial.
- [ ] Run focused tests to verify the expected red state.
- [ ] Configure the Next application base path and update request-path checks and links to remain inside `/crm`.
- [ ] Replace every sensitive direct client write with protected CRM RPC/server action where database authorization is required.
- [ ] Run focused tests, `npm.cmd run typecheck`, `npm.cmd run build`, and `npm.cmd test`.
- [ ] Commit only the Task 4 CRM files.

### Task 5: Route JewelOS CRM navigation to the proxied application

**Files:**
- Modify: `jewelos/vercel.json`
- Modify: `jewelos/apps/web/src/App.tsx`
- Delete later, only after accepted smoke tests: `jewelos/apps/web/src/pages/CRMPage.tsx` and its dedicated feature surface
- Test: `jewelos/apps/web/src/App.test.tsx` or a focused routing test

**Interfaces:**
- Consumes the deployed CRM origin configured only in Vercel, not source.
- Produces proxy rewrites before the Vite fallback and a JewelOS navigation item that enters `/crm`.

- [ ] Write a failing routing test proving CRM navigation targets `/crm` rather than mounting the legacy CRM page.
- [ ] Run the focused test to establish the red state.
- [ ] Update the Vite-app navigation and Vercel rewrite ordering while preserving all non-CRM paths.
- [ ] Keep the legacy CRM code/data untouched until hosted acceptance is complete.
- [ ] Run JewelOS web typecheck/build/test and inspect rewrite configuration with a local/proxy smoke test where supported.
- [ ] Commit only the Task 5 JewelOS files.

### Task 6: Preflight, hosted configuration, and cutover verification

**Files:**
- Create: `sreejith-crm/web-app/scripts/sso-roster-preflight.ts`
- Create: `sreejith-crm/web-app/scripts/sso-reconcile.ts`
- Create: `jewelos/docs/CRM_SSO_CUTOVER.md`

**Interfaces:**
- Consumes read-only roster exports/connections and deployment-managed OIDC configuration.
- Produces a reviewable collision report and post-cutover reconciliation report.

- [ ] Write a failing fixture test for duplicate email, missing CRM staff, inactive roster member, and role/branch mismatch classification.
- [ ] Run the test and verify the red state.
- [ ] Implement read-only preflight/reconciliation scripts; no account creation, retirement, or data rewrites.
- [ ] Run preflight and stop for review if collisions exist.
- [ ] Configure live OIDC and Vercel environment values only after confirmed target-project identities and approval of the report.
- [ ] Perform authenticated browser tests for Admin, Manager, Staff, denied role, unprovisioned user, deep links, uploads, and normal JewelOS routes; document exact evidence and rollback steps.

## Review checkpoints

1. After Task 1, review the CRM identity-link migration before it is applied to any hosted database.
2. After Task 3, review the exact secret/configuration names and delivery/replay behavior before deployment.
3. After Task 6 preflight, review collision counts before provisioning or hosted OIDC cutover.
