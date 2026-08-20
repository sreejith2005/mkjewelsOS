# JewelOS-first CRM foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the safe, change-tolerant foundation for moving CRM operations into JewelOS without data loss or two permanent authorities.

**Architecture:** JewelOS owns organization identity and authorization. Add an audited source-mapping and import ledger first; migrate one CRM capability at a time while the existing CRM remains the sole writer for capabilities not yet accepted.

**Tech Stack:** React/Vite, TypeScript, Supabase Postgres/RLS/RPC, Edge Functions, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-jewelos-first-crm-migration-design.md`

## Global Constraints

- Never auto-match branches or staff by name for authorization.
- Keep the legacy CRM and its Supabase project unchanged during read-only discovery.
- Use forward-only migrations, RLS, audited RPCs, and explicit staging.
- Keep field definitions versioned; historical field values retain their revision.

---

### Task 1: Canonical CRM source registry

**Files:**
- Create: `supabase/migrations/0071_crm_migration_registry.sql`
- Create: `apps/web/src/features/crm/migrationRegistry.ts`
- Create: `apps/web/src/features/crm/migrationRegistry.test.ts`

**Interfaces:** Produces immutable `crm_source_systems`, explicit
`crm_branch_mappings`, `crm_staff_mappings`, and idempotent `crm_import_runs`
records. No migration changes business CRM data.

- [ ] Write failing unit tests for rejecting name-only mappings and accepting stable external IDs.
- [ ] Run the focused test and confirm it fails because the registry helper is absent.
- [ ] Implement the minimal typed registry validation helper.
- [ ] Add the additive migration with RLS, admin-only audited mapping RPCs,
      unique source/external-ID constraints, and mapping/import indexes.
- [ ] Run focused tests, web typecheck, SQL lint/validation where available,
      and `git diff --check`.
- [ ] Commit only Task 1 files.

### Task 2: Change-tolerant CRM field definitions

**Files:**
- Create: `packages/core/src/crm/fieldDefinitions.ts`
- Create: `packages/core/src/crm/fieldDefinitions.test.ts`
- Create: `supabase/migrations/0061_crm_field_definitions.sql`

**Interfaces:** Produces a pure `validateCrmFieldDefinition` contract and
versioned field-definition/value tables that preserve a definition revision
with every historical value.

- [ ] Write failing tests for stable keys, revision creation, type validation,
      and historical revision retention.
- [ ] Run the focused test and confirm the failure is caused by the missing module.
- [ ] Implement the minimum pure validation contract.
- [ ] Add forward-only tables/RPCs/RLS/audits; do not replace existing typed
      client columns or alter historical CRM records.
- [ ] Run core tests, typecheck, migration validation, and diff checks.
- [ ] Commit only Task 2 files.

### Task 3: Read-only legacy CRM preflight and reconciliation

**Files:**
- Create: `scripts/crm-migration-preflight.ts`
- Create: `scripts/crm-migration-reconcile.ts`
- Create: `docs/CRM_MIGRATION_RUNBOOK.md`
- Test: `scripts/crm-migration-preflight.test.ts`

**Interfaces:** Produces a privacy-safe report of unmapped branches/staff,
duplicate external IDs, and source counts. It must not write to either CRM
business database without an explicitly reviewed import run.

- [ ] Write failing fixture tests for unmapped staff, duplicate external IDs,
      and branch mismatch classification.
- [ ] Run the focused test and confirm it fails because the script is absent.
- [ ] Implement the read-only report generator with masked personal data.
- [ ] Document operator inputs, approvals, rollback, and evidence required
      before any import.
- [ ] Run test, typecheck, and an empty/safe dry-run.
- [ ] Commit only Task 3 files.
