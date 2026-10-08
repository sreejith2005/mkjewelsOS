# CRM lead continuity implementation plan

> Execute inline using superpowers:executing-plans and test-driven-development. The owner approved the design and instructed implementation.

**Goal:** Preserve lead answers through walk-ins, unify client browsing/history, and source configurable CRM dropdowns from JewelOS.

**Architecture:** Extend existing audited RPCs and identity links with forward migrations. Use invoker read projections over durable history sources rather than putting contacts into visit tables. JewelOS owns master options; CRM receives a validated server projection through the existing sync transport.

**Tech Stack:** PostgreSQL/RLS/pgTAP, Supabase Edge Functions, React/TypeScript/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-crm-lead-continuity-design.md`.

## Constraints and review focus

- Preserve unrelated dirty work, source answers, historical timestamps, private media, visit counters, branch writes, task outbox, and original CRM styling.
- Empty lead answers must not overwrite filled store/manual values; conflicting shared-phone identities must not be merged.
- Converted leads appear once and every filter/count operates before pagination.
- Scheduling future work and editing a profile do not constitute customer contact.
- Master deactivation preserves historical labels; failed master reads cannot silently substitute defaults.
- No hosted writes or APK publication before their required gates pass.

## Task 1: Lead persistence and form continuity

Files: new `supabase-crm/supabase/migrations/20261008000600_crm_lead_continuity.sql`, new `supabase-crm/supabase/tests/20261008_crm_lead_continuity.test.sql`, `src/components/lead-form.tsx`, `src/lib/client-phone-lookup.ts`, `src/components/walk-in-form.tsx`, generated CRM types, UI regressions.

- [x] Write/run failing pgTAP cases for DOB/anniversary/preferences mapping, preserved original JSON and store values, inactive/cross-branch denial, audited save, and repeated recovery.
- [x] Implement `save_crm_lead(p_phone text,p_name text,p_fields jsonb)` returning the saved lead, fill-missing projection with source references, and `lookup_client_profile_by_phone(p_phone text)` extending the existing safe lookup. Retain old RPC compatibility.
- [x] Reuse one autofill mapping in every walk-in lookup path. Preserve all supported profile values and display unmapped saved lead answers.
- [x] Run focused database/UI tests and confirm transaction/audit behavior.

## Task 2: Unified history and filtered client list

Files: migration/test above, new `src/components/client-activity.tsx`, `src/components/client-database.tsx`, clients list/profile pages, paging/history UI tests.

- [x] Write/run failing cases for one record after conversion, interleaved lead/client sorting, filter totals beyond one page, actual versus future contact dates, follow-up/lead-call visibility, unauthorized direct writes, and contact idempotency.
- [x] Implement invoker `crm_client_activity` projection, audited `record_crm_contact`, and `browse_crm_records(p_filters jsonb,p_offset integer,p_limit integer)` returning one JSON envelope with total and rows. Types/validation must match UI.
- [x] Expose URL-preserved record/lifecycle/branch/location/source/potential/purchase/count/date filters and ordering, profile links for all rows, recorded contacts and source answers in profiles.
- [x] Run focused tests with synthetic persisted flows; verify contacts do not alter visit counters.

## Task 3: JewelOS Dropdown Master authority

Files: new JewelOS forward migration and pgTAP test for master snapshots, existing `crm-staff-sync` worker/index/tests; new CRM master projection migration/test, existing `sync-receive` worker/index/tests; central `src/crm-port/master-options.ts`; lead/visit/profile page loaders and dropdown regressions.

- [x] Write/run failing transport/database/UI cases for Sugar, scoped snapshots, inactive values, legacy labels, out-of-order/repeated events, malformed snapshots, and failed reads.
- [x] Extend the existing protected sync transport for master snapshots without changing staff-event behavior. JewelOS authenticated read authority and service-only CRM application remain distinct.
- [x] Map configurable vocabularies centrally; retain authorized Users/branch selectors and constrained workflow enums. Load master-backed options on every CRM form and reject invalid new values at server contracts while preserving saved labels.
- [x] Run transport tests and pgTAP for both projects.

## Task 4: Regression, review, and handoff

- [x] Run full CRM tests, affected core/web tests, typechecks, CSS generation/check, web build, `git diff --check`, and all CRM pgTAP against an isolated local database. Check anonymous, inactive, cross-branch, ordinary, admin and service-role paths.
- [ ] Run rendered desktop/phone/embedded-mode synthetic flows: unavailable in this session; retained as a release gate.
- [x] Review scoped changes and document exact results, historical repair preview, hosted release gates, and device limits. Do not stage or publish unrelated work.

## Execution ledger

2026-10-08: Owner authorized implementation. Existing `C:/crm` feature worktree retained by repository instruction. Isolated database created inside the local `crm-workflow-perf` container from its schema only; no production/customer data copied, no shared database reset. Implementation proceeds inline.

2026-10-08 completion: Tasks 1–3 implemented and reviewed. Fresh schema-only databases accepted final migrations transactionally. New pgTAP: continuity 61/61, CRM masters 23/23, JewelOS sync 12/12. Existing current CRM tests passed; legacy two-way Sheet test retains 19 baseline-reproduced failures. CRM UI 151, web 380, core 768 and sync worker 19 tests passed; six workspace typechecks, CSS check, web build and whitespace check passed. Final reviewer found no unresolved Important finding. Browser runtime unavailable; mobile bridge runner lacks separate dependencies. No hosted actions, customer recovery, staging, publication or APK release performed. Detailed scope and rollout gates: docs/CRM_LEAD_CONTINUITY_IMPLEMENTATION.md.

2026-10-08 release: Owner explicitly authorized migrations and main publication. Integrated with newer origin/main in an isolated release checkout; original dirty C:/crm preserved. Applied CRM 20261008000600/00700 and JewelOS 0204 without changing applied history. Current CRM pgTAP 602/602 across 17 files, JewelOS master sync 12/12, CRM UI 171, web 409, workers 19 and six workspace typechecks passed. Application commit 54374308394a74a9746f5c03a55efabfe874fab2 pushed to main; both changed functions deployed, scheduled master sync delivered, scoped Sugar/communication and count/paging reads verified, originals preserved, and Vercel production READY. See docs/CRM_LEAD_CONTINUITY_RELEASE_2026-10-08.md for exact evidence and remaining browser/device limits.
