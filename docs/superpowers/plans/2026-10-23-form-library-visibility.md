# Form Library Visibility Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans. Track checks below.

**Goal:** Hide selected forms from staff library browsing without disrupting assigned work.

**Architecture:** Default-true `form_templates.library_visible`; audited author-only setter; separate server library eligibility from broader read access. Keep exact task/FMS submission contracts intact.

**Tech Stack:** PostgreSQL/RLS/pgTAP, Supabase, React/TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-form-library-visibility-design.md`

## Global Constraints

- Preserve historical records, pinned versions, module checks, and role scopes.
- Work in the user-specified repository; preserve unrelated dirty files.
- No hosted writes or Git publication are implied by implementation approval.

## Review Focus

- Assignment/history read access must not allow standalone hidden-form submissions.
- Hidden forms must stay absent from the library even for their assigned users.
- Author permission overrides must work without new role lists.
- Revisions/duplicates must not accidentally expose hidden forms.
- Failed visibility writes must retain the displayed saved state.

## Tasks

- [ ] Add failing pgTAP authorization/assignment/history tests and UI toggle/filter/error tests; confirm failures.
- [ ] Add the next available forward-only migration, eligibility helper and audited visibility RPC. Preserve active task/FMS reads and linked submissions. Inherit visibility on revisions/duplicates. Update database types.
- [ ] Add author toggle with pending/error behavior and staff library filtering. Retain bundle access for submission history and starter links.
- [ ] Update Kiara help/review documentation, test related core/web/data/SQL contracts, typecheck/build, inspect phone/desktop rendering, and review scoped diff.

## Execution notes

Owner approved the proposed behavior. Execute inline without another routine confirmation. Existing unrelated Tasks and Kiara edits are preserved. Local database checks must use synthetic data only; do not reset another session's stack.
