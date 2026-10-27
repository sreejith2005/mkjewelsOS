# CRM FMS Customer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist reviewed customer information from existing Forms/FMS transactions into the existing CRM customer identity and history through recoverable asynchronous delivery.

**Architecture:** Dedicated immutable customer outbox, protected CRM receiver and dual-approved versioned mappings around the current FMS engine. CRM remains the only customer master. Existing customer profiles, bounded reads and private report exports are extended.

**Tech Stack:** TypeScript/React/Vitest, PostgreSQL/pgTAP, Supabase/Deno Edge Functions, existing pnpm monorepo.

**Spec:** `docs/architecture/CRM_FMS_INTEGRATION_DESIGN.md` (owner approved in chat).

## Global constraints

- No changes to routing, assignment, completion, notifications or original submission data.
- No hosted writes, deployment, production backfill, destructive cleanup or Sheet writes.
- Preserve existing dirty changes. JewelOS work stays in the repository root; CRM work uses `C:/crm`. No new worktree/checkout is needed to preserve those explicit locations.
- Restore applied 0347-0349 files byte-for-byte from same-repository commits; add a new free migration number only after ledger verification.
- Default-disabled mappings, explicit CRM approval, server destination allowlist, no blank overwrite and no global option-token interpretation.
- Schema and permissions are tested against synthetic local databases; report unavailable evidence honestly.

## Review focus

- Identical concurrent event deliveries create one identity/contribution; conflicting event-ID reuse errors.
- Out-of-order answers cannot advance their business timestamps or overwrite authoritative store values.
- Reviewer/worker service authority never substitutes for denied source actor/branch authorization.
- Partial sections, hidden answers, repeated visits and archived snapshots retain their actual meaning.
- Restricted FMS answers never leak through company-wide CRM reads/exports.

## Task 1: Baseline and shared mapping contract

**Files:** Restore `supabase/migrations/0347_fms_optional_otherwise_and_form_handoff.sql`, `0348_fms_form_assignment_allows_handoff.sql`, `0349_fms_run_names.sql`; create `packages/core/src/forms/customerIntegration.ts` and `.test.ts`; export from forms index.

**Interfaces:** Versioned `CustomerFormMapping`, destination/mode catalog, validation against existing `FormTemplateDefinition`, snapshot extraction and safe CSV cells. TypeScript is a preview mirror of SQL validation; it does not authorize writes.

- [ ] Confirm linked migration versions; restore missing applied files without touching 0346.
- [ ] Write/run failing tests for scoped field keys, mismatched destinations/types, operational assignees, ignored blanks/hidden/section answers, original option values/labels, false/zero/nested history and CSV injection.
- [ ] Implement pure helpers; run focused core tests and typecheck.

## Task 2: JewelOS persistence and transactional capture

**Files:** Create `supabase/migrations/0350_customer_form_events.sql`, `supabase/tests/0350_customer_form_events.test.sql` (verify 0350 is free first); update generated public RPC types narrowly.

**Interfaces:** `save_form_customer_mapping(uuid,jsonb)`, `get_form_customer_mapping(uuid)`, immutable mapping versions; `crm_sync_claim_customer_events(integer)`, `crm_sync_finish_customer_event(uuid,uuid,jsonb,text)`, protected health/retry/backfill preview RPCs.

- [ ] Add synthetic pgTAP fixtures for active/inactive/cross-tenant roles and denied direct writes.
- [ ] Add RLS/minimal grants, audited mapping save and immutable payload delivery state with leased claims.
- [ ] Capture relevant submitted fields and stage-log evidence through deferred triggers in the successful operational transaction; preserve existing functions.
- [ ] Test replay, blank/hidden/section rules, exact source IDs, completion without CRM, lease expiry/stale finish, retry/dead and historical dry run.

## Task 3: CRM identity, approved mappings and ingestion

**Files:** Create `C:/crm/supabase-crm/supabase/migrations/20261027000100_crm_fms_customer_events.sql` and matching pgTAP suite. Use the released migration baseline from this repository for local replay, not C:/crm's divergent older files.

**Interfaces:** `crm_apply_customer_event(text,jsonb)`, `crm_register_customer_mapping(text,jsonb)`, authenticated approval/review/read APIs, private digest inbox, scoped external identities/journeys/contributions, incremental customer projection.

- [ ] Write failing SQL cases for source tenant/branch/actor mapping, dual approval, same-payload replay/conflicting digest and ambiguous shared phone.
- [ ] Implement identity locking, existing UUID/MKC creation, country-aware lookup, review states, immutable evidence, ordering/precedence and denied authority.
- [ ] Extend existing activity/browse/profile reads without changing walk-in matching, lifecycle or purchase totals.
- [ ] Test no-phone/new/existing/multichannel, loop/parallel/out-of-order, historical review and explicit verified contact behavior.

## Task 4: Server transport and recovery

**Files:** Create `supabase/functions/crm-customer-sync/{worker.ts,index.ts,worker.test.ts,deno.json}`; extend `C:/crm/supabase-crm/supabase/functions/sync-receive/{worker.ts,index.ts,worker.test.ts}`; add named function config.

**Interfaces:** bounded `customer.mappings` and `customer.events`, constant-time existing secret gate, sanitized errors, claim lease tokens, exact event responses and no implicit success on missing results.

- [ ] Write/run failing Deno worker tests: anonymous/invalid secret, size/schema limits, partial responses, timeout after commit, unsupported kind, stale leases and retries.
- [ ] Implement separate customer sender; retain staff/master worker behavior and reuse existing secret names.
- [ ] Run focused sender/receiver tests and Deno checks.

## Task 5: Forms mapping editor

**Files:** Add `apps/web/src/features/forms/CustomerIntegrationPanel.tsx`, `customerIntegrationApi.ts`, tests; compose in existing `FormBuilder.tsx` without restructuring it.

**Interfaces:** stable field-key configuration, profile/history/both/operational modes, server validation/save, visible approval/version status, disabled preview.

- [ ] Test map/save/error/no-phone config and existing builder behavior.
- [ ] Implement optional integration panel using existing design tokens and controls; keep published question content unchanged.
- [ ] Check phone/desktop rendered layout and existing Forms tests.

## Task 6: CRM journeys, privileged health and review

**Files:** Add `C:/crm/packages/crm-ui/src/components/customer-workflows.tsx`, typed API/tests and integration admin component; compose in existing profile/admin surfaces. Add JewelOS authorized customer-link read/action through the shared FMS destination contract.

**Interfaces:** cursor-based history, readable original answers/actors/times, role-authorized mapping approval/identity review/retry, aggregates only in diagnostics.

- [ ] Test restricted link denial, bounded history, unknown/nested answers, duplicate decisions and administrator-only operations.
- [ ] Implement expandable journey/history and modest health/review panels; preserve existing profile sections and server pagination.
- [ ] Verify responsive rendering and existing CRM profile/walk-in regression tests.

## Task 7: Exports and historical reconciliation

**Files:** Extend existing protected report/export contracts with scoped customer/stage queries and layouts; add `scripts/crm-fms-reconcile.ts` dry-run helper/tests and runbook.

**Interfaces:** CRM exports only transported customer evidence; full original stage exports authorize source work in JewelOS. Original source IDs/times, deterministic headers, safe phone/text and Asia/Kolkata presentation. Historical source cursor/hash counts and no apply without audited approval.

- [ ] Test formula injection, original values/options, filters/page boundaries, actor vs assignee and unauthorized exports.
- [ ] Implement bounded reusable export configuration and dry-run count reconciliation; never enable two-way Sheets.
- [ ] Test restart/idempotency/source drift and unresolved attribution remaining in review.

## Task 8: Validation, documentation and review

**Files:** Update Kiara app help/review, architecture status and implementation/release runbook; generated database types for final signatures.

- [ ] Run focused core/web/CRM/Deno/pgTAP suites, then relevant monorepo typecheck/build and whitespace/credential-safe scans.
- [ ] Exercise the twenty requested scenarios using synthetic local cross-project persistence; record any environment failures and missing proof.
- [ ] Fresh whole-change security/code review; fix important findings with regression tests.
- [ ] Report implementation and evidence separately from hosted migration/deploy/backfill gates; no publication assumed.

## Execution ledger

Owner approval authorizes implementation of this design. Execute inline without another design approval prompt. Progress and deviations are recorded in `.superpowers/sdd/2026-10-27-crm-fms-integration/progress.md`; no automatic commit/staging of pre-existing dirty paths.
