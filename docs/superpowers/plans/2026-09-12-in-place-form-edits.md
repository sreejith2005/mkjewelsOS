# In-Place Form Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit one published form ID across linked Task and FMS work while preserving completed submissions' original definitions.

**Architecture:** Migration `0157` snapshots all new submissions atomically, backfills snapshots for current rows, and permits the existing audited published-form save RPC to modify the same template ID. Forms Library direct editing and snapshot-first submission rendering make the behavior visible.

**Tech Stack:** PostgreSQL/Supabase RPC, pgTAP, React 18, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-in-place-form-edits-design.md`

## Global Constraints

- Add only a forward migration; never modify applied migrations.
- Retain server-side authorization, existing grants, pinned search paths, audited writes, and task/FMS IDs.
- Do not remove the user-created v2 draft.

---

### Task 1: Snapshot and in-place database contract

**Files:**
- Create: `supabase/migrations/0157_allow_in_place_published_form_edits.sql`
- Modify: `supabase/tests/0009_forms_engine_contract.test.sql`

**Interfaces:**
- Consumes: `save_published_form_with_audit(uuid,jsonb,jsonb)`, `submit_form_with_audit(uuid,jsonb,text,uuid)`.
- Produces: `template_snapshot` at submission time and in-place published edits.

- [ ] Write pgTAP assertions that an authorized author can update the submitted published template ID and that the submission snapshot retains the original form name/field definition.
- [ ] Run `supabase.cmd test db --local --file supabase/tests/0009_forms_engine_contract.test.sql`; verify the in-place update fails with `23503` before the migration.
- [ ] Add `0157`: backfill null snapshots from each linked template and ordered fields; redefine `submit_form_with_audit` to insert the snapshot atomically; redefine `save_published_form_with_audit` by retaining its authorization, validation, `jewelos.allow_published_form_edit`, audit log, grants, and only removing the submission/active-FMS rejections.
- [ ] Re-run the focused database test and verify the authorization and cross-tenant assertions still pass.
- [ ] Commit only the migration and pgTAP test.

### Task 2: Direct editor and immutable submission display

**Files:**
- Modify: `apps/web/src/pages/FormsPage.tsx`
- Modify: `apps/web/src/pages/FormsPage.delete.test.tsx`
- Test: `apps/web/src/features/forms/api.test.ts`

**Interfaces:**
- Consumes: unchanged `savePublishedForm(id,payload,fields)` and the Task 1 snapshot contract.
- Produces: original published bundle editing and snapshot-first historical rendering.

- [ ] Write a failing test that clicks published Edit, asserts the revision API is not called, and asserts the builder receives the original ID.
- [ ] Run `pnpm.cmd --filter web exec vitest run src/pages/FormsPage.delete.test.tsx --run`; verify it fails against the revision behavior.
- [ ] Remove the revision helper/import from `FormsPage`; restore `setEdit(form)` for published Edit; use `deletedFormBundle(submission)` when a snapshot exists before falling back to the live bundle in submission details.
- [ ] Run `pnpm.cmd --filter web exec vitest run src/pages/FormsPage.delete.test.tsx src/features/forms/api.test.ts --run` and `pnpm.cmd --filter web exec tsc --noEmit`.
- [ ] Commit only the web files.

### Task 3: Release gates

**Files:**
- Verify only.

- [ ] Run `supabase.cmd test db`, `pnpm.cmd --filter web test`, `pnpm.cmd exec turbo run typecheck --force --concurrency=1`, `pnpm.cmd exec turbo run build --force --concurrency=1`, and `git diff --check`.
- [ ] Run `supabase.cmd migration list --linked` and `supabase.cmd db push --linked --dry-run`; review that only `0157_allow_in_place_published_form_edits.sql` is pending.
- [ ] Apply `supabase.cmd db push --linked`, re-list migrations, and push the reviewed `main` commit. Report hosted migration proof separately from Vercel/browser proof.
