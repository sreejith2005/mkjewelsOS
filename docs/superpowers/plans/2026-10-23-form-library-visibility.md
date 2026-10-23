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

- [x] Add failing pgTAP authorization/assignment/history tests and UI toggle/filter/error tests; confirm failures.
- [x] Add the next available forward-only migration, eligibility helper and audited visibility RPC. Preserve active task/FMS reads and linked submissions. Inherit visibility on revisions/duplicates. Update database types.
- [x] Add author toggle with pending/error behavior and staff library filtering. Retain bundle access for submission history and starter links.
- [x] Update Kiara help/review documentation, test related core/web/data/SQL contracts, typecheck/build, inspect phone/desktop rendering, and review scoped diff.

## Execution notes

Owner approved the proposed behavior. Execute inline without another routine confirmation. Existing unrelated Tasks and Kiara edits are preserved. Local database checks must use synthetic data only; do not reset another session's stack.

## Validation and release evidence

- Focused database runner: 153 assertions across seven suites passed (37 new visibility assertions). Migration and synthetic fixtures rolled back after every local suite; no existing local stack was reset.
- Web full suite: 612 passed before upstream reconciliation; 71 relevant Forms/FMS tests and then 29 focused tests passed after reconciliation. Data suite: 192 passed. Core: 1,141 passed with three recurrence timeouts; the complete recurrence file passed all 76 on focused retry.
- Monorepo typecheck and full build passed. Final release build after initial upstream reconciliation passed.
- Browser component harness: 390px and 1440px, light and dark, reveal/hide RPC confirmation and no overflow/runtime errors. Synthetic transport; this is not authenticated hosted user-flow evidence.
- Independent security/code review found no remaining issues. Existing form fill role eligibility is preserved separately from author visibility.
- Owner explicitly authorized migration and main publication in chat. Linked target confirmed jewelos-prod (yimafxhuwgfhvzczqqdd); dry run contained only 0343. Hosted apply of 0343 succeeded on 2026-10-23.
- New upstream commits already used 0342; this change uses 0343. Rebased onto current main and preserved newer guided Forms/FMS UI. Unrelated dirty workspace work is preserved in a named Git stash during publication.
- No native Android, Storage, Edge Function, secret, or customer-data migration. Existing forms default to visible. Kiara requires no new read tool.
