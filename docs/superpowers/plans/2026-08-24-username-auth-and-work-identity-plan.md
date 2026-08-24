# Username Authentication and Work Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser email login with a secure username/password flow and normalize each active Auth identity to its MK Jewels work address.

**Architecture:** Add an audited username to `user_profiles`; a JWT-disabled but rate-limited Edge Function resolves only active accounts and exchanges username/password for the normal Supabase session. A dry-run-first operator script makes non-transactional Auth email changes safely, then calls an audited service-only profile RPC.

**Tech Stack:** PostgreSQL/Supabase RLS and RPCs, Supabase Edge Functions/Deno, React/Vite, TypeScript, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-24-username-auth-and-work-identity-design.md`

## Global Constraints

- Keep migrations forward-only and update generated types after schema changes.
- Never print or commit email addresses, passwords, service-role keys, or rate-limit secrets.
- The browser uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Sensitive profile identity writes are service-only and audited in the same database transaction.
- The operator must default to dry run, block ambiguous data, and use explicit `--apply` for hosted changes.

---

### Task 1: Shared identity derivation

**Files:**
- Create: `packages/core/src/identity.ts`
- Create: `packages/core/src/identity.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] Write failing tests for lowercase username derivation, first-name email fallback, full-name collision fallback, and invalid empty output.
- [ ] Run `pnpm.cmd --filter @jewelos/core test -- identity.test.ts` and confirm the tests fail because the module is missing.
- [ ] Implement pure `deriveUsername`, `deriveWorkEmail`, and `buildIdentityPlan` helpers with ASCII validation and collision rejection.
- [ ] Re-run the focused core test and confirm it passes.

### Task 2: Database identity and audit contract

**Files:**
- Create: `supabase/migrations/0095_username_auth_and_work_identity.sql`
- Create: `supabase/tests/0095_username_auth_and_work_identity.test.sql`
- Modify: `packages/core/src/database.types.ts`

- [ ] Write pgTAP assertions for the username column/index, service-only rate-limit and identity RPC grants, rejected duplicate usernames, and audit records.
- [ ] Run the focused pgTAP file after a local reset and confirm its initial failure is caused by missing migration objects.
- [ ] Add the forward migration: username constraint/index, salted rate-limit table/RPC, and `apply_work_identity_with_audit(jsonb)` service-only RPC.
- [ ] Regenerate types and re-run the focused pgTAP test.

### Task 3: Username login gateway and browser integration

**Files:**
- Create: `supabase/functions/username-password-login/index.ts`
- Create: `supabase/functions/username-password-login/index.test.ts`
- Modify: `supabase/config.toml`
- Modify: `apps/web/src/auth/AuthContext.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] Write failing tests for malformed bodies, generic invalid credentials, and rate-limit rejection without email disclosure.
- [ ] Run the function tests and confirm the missing handler fails.
- [ ] Implement the rate-limited gateway and change the browser to invoke it, set the returned session, label the field Username, and remove browser email-reset requests.
- [ ] Re-run function and focused web tests, then verify the web build.

### Task 4: Future user creation and controlled roster conversion

**Files:**
- Modify: `supabase/functions/invite-user/index.ts`
- Modify: `apps/web/src/pages/UserManagementPage.tsx`
- Create: `scripts/reconcile-work-identities.mjs`
- Create: `scripts/reconcile-work-identities.test.mjs`

- [ ] Write failing tests for dry-run identity plans, first-name address collisions, and rejected ambiguous/duplicate usernames.
- [ ] Run the focused script tests and confirm the unimplemented script fails.
- [ ] Make new-user creation derive canonical username/login email, retain personal email only as contact data, and add the dry-run/apply operational script.
- [ ] Re-run focused tests and inspect script output with `--dry-run` only.

### Task 5: Release evidence

**Files:**
- Modify: generated files and release documentation only if required by the checks above.

- [ ] Run local migration reset, focused pgTAP, core/web/function/script tests, typecheck, build, and `git diff --check`.
- [ ] Review named staged paths, staged whitespace, and secret-scan prompts.
- [ ] Confirm linked Supabase target and review `migration list --linked` plus `db push --linked --dry-run` before applying only migration `0095` and deploying `username-password-login` and updated `invite-user`.
- [ ] Set the rate-limit secret outside source, run the identity script first in dry-run mode, review its aggregate summary, then run `--apply` and perform a controlled username-login smoke test.
