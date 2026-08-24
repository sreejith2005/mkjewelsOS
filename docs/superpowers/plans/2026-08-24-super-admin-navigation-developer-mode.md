# Super Admin Navigation Developer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Developer Mode controls into the top navigation and restrict all maintenance control authority and bypasses to Super Admins.

**Architecture:** Reuse the current tenant control record and audited RPC. Add a forward migration that narrows the RPC authorization. The web shell owns the navigation control state and route guard; pure role decisions stay in core.

**Tech Stack:** React 18, TypeScript, Vitest, Supabase Postgres/pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-24-super-admin-navigation-developer-mode-design.md`

## Global Constraints

- Only active Super Admins can change or bypass section maintenance.
- Every setting save remains optimistic, idempotent, and audited.
- Use a forward-only migration; never alter `0051`.
- Availability-read failure remains fail-open.

### Task 1: Establish Super Admin-only maintenance decision

**Files:**
- Modify: `packages/core/src/settings/sectionAvailability.ts`
- Modify: `packages/core/src/settings/settings.test.ts`

- [ ] Add a failing core test that distinguishes Super Admin from Admin bypass.
- [ ] Run the focused test and confirm it fails for the missing helper.
- [ ] Add the minimal pure helper and rerun the focused test.

### Task 2: Restrict the database mutation contract

**Files:**
- Create: `supabase/migrations/0093_super_admin_section_maintenance.sql`
- Create: `supabase/tests/0093_super_admin_section_maintenance.test.sql`

- [ ] Add a pgTAP contract that expects Admin denial and Super Admin audited success.
- [ ] Add a forward migration replacing only the save RPC authorization condition.
- [ ] Run the focused database test after a local reset.

### Task 3: Render and persist top-navigation controls

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/settings/SettingsView.tsx`
- Modify: relevant web test files

- [ ] Add failing focused web coverage for Super Admin-only navigation controls.
- [ ] Add a labelled top-navigation Developer Mode toggle and per-navigation-item switches.
- [ ] Remove the duplicate Settings editor, preserve the read-only settings display, and change the route guard to the shared Super Admin-only helper.
- [ ] Run focused web tests, typecheck, and build.

### Task 4: Publish and deploy

- [ ] Review named-path diff, staged whitespace, and secret scan.
- [ ] Commit and push the approved paths to `main`.
- [ ] Confirm linked Supabase target, review migration list and dry run, then apply `0093`.
- [ ] Deploy the exact web commit and record local, Git, database, and web-host evidence separately.
