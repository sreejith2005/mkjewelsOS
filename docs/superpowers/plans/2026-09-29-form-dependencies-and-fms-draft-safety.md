# Form Dependencies and FMS Draft Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve live FMS stage identities after form deletion and give authors a safe, explicit choice between editing a published form and switching its connections to a same-family revision.

**Architecture:** Forward SQL migration protects stage identity, exposes authorized form usage, and allows exact pinned archived versions in assigned work. Web and native clients use the existing API layers and shared form/version helpers. Every switch remains an audited server write.

**Tech Stack:** Postgres/pgTAP, Supabase RPC, TypeScript, React, Expo/React Native, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-form-dependencies-and-fms-draft-safety-design.md`

## Global Constraints

- Forward migration only; preserve historical submissions, tasks, FMS instances, and exact assignment IDs.
- Database authorization and audit are authoritative; warnings are explanatory.
- Both web and native builders need the same behavior; no silent form substitution.
- Preserve unrelated work and stage only reviewed paths.

## Review Focus

- A deleted form on a flow with active runs: saving a replacement retains referenced stage IDs.
- A malformed FMS payload that drops a referenced key: the RPC rejects it before deleting history.
- Publishing v2 while v1 is pinned: old assignments still submit v1, new work can choose v2.
- A field key or choice removed in v2: FMS routes show an error before publish.
- A cross-tenant or inactive author: usage details and every write are denied.

---

### Task 1: Reproduce and repair FMS stage replacement

**Files:** `supabase/tests/0117_delete_forms_with_history.test.sql`, `supabase/migrations/0182_form_dependencies_fms_draft_safety.sql`

**Interfaces:** `save_fms_flow_draft_with_audit(uuid,jsonb,jsonb) -> uuid` retains its signature; stage identity is `(fms_flow_id,stage_key)`.

- [ ] Add a synthetic pgTAP case that deletes a linked form, saves the returned draft with a replacement, and checks the live `fms_instance_stages.fms_stage_id` remains unchanged.
- [ ] Run `supabase.cmd test db --local supabase/tests/0117_delete_forms_with_history.test.sql` and confirm the expected FK failure.
- [ ] Implement keyed stage reconciliation, ordered reference rebuilding, and a clear rejection for removing a referenced stage; preserve the existing grants, checks, and audit.
- [ ] Re-run the focused pgTAP test and existing FMS engine/builder tests; inspect failures.

### Task 2: Form usage and published-edit decision

**Files:** same migration/test, `packages/data/src/forms/api.ts`, `apps/web/src/features/forms/api.ts`, `apps/web/src/features/forms/FormBuilder.tsx`, `apps/mobile/src/screens/FormBuilderScreen.tsx`.

**Interfaces:** `form_usage_impact(uuid) -> jsonb`; both clients expose `formUsageImpact(id)` with named connected work and counts.

- [ ] Add pgTAP denial/allowance tests for usage visibility and accurate named FMS/task references; run to observe the missing RPC failure.
- [ ] Implement tenant-scoped authorized usage RPC with minimal EXECUTE grant, then rerun focused tests.
- [ ] Add failing UI tests for the warning and its save confirmation, including failed impact read and version recommendation.
- [ ] Implement web/native warning before `save_published_form_with_audit`; rerun focused client tests.

### Task 3: Same-family version lifecycle and connection switches

**Files:** same migration/test, `packages/data/src/forms/api.ts`, `apps/web/src/features/forms/api.ts`, both Forms Library screens, both FMS stage editors, relevant task authoring screens and server contracts.

**Interfaces:** existing `create_form_revision_with_audit(uuid,jsonb)` creates the same-family draft; `duplicate_form_with_audit` remains a separate-family copy. Exact assignment submission validates the pinned ID.

- [ ] Add pgTAP tests for publishing a revision with pinned v1, submitting v1 on exact assigned work, rejecting free filling of archived v1, and authorizing each connection update.
- [ ] Run focused SQL tests to observe the current archive or submission rejection.
- [ ] Implement the narrow server lifecycle and submission changes; rerun focused SQL tests.
- [ ] Add failing web/native client tests for Create new version, the current/new version selectors, and invalid FMS route feedback.
- [ ] Implement version actions and selectors; rerun focused tests.

### Task 4: Cross-surface verification and release

**Files:** generated database types if changed; focused tests; reviewed implementation files only.

- [ ] Run focused pgTAP suites, `pnpm.cmd --filter @jewelos/core test`, web tests, mobile tests, monorepo typecheck/build, and `git diff --check`.
- [ ] Inspect desktop, phone-width web, and native navigation for form edits and version switches; separate unavailable evidence from passing evidence.
- [ ] Check linked migration history and dry run before any hosted write; follow the production playbook for approved hosted deployment.
- [ ] Review and stage named paths, scan the staged diff, commit, and follow `scripts/release-mobile.ps1` for a verified signed Android release if required gates pass.
