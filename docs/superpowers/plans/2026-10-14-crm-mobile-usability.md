# CRM mobile usability implementation plan

> **For agentic workers:** Implement inline using executing-plans; preserve unrelated work.

**Goal:** Make every existing CRM workflow usable on phones, with one complete person search, compact controls, profile navigation, and 50-record client pages.

**Architecture:** Extend the existing CRM UI and database search contracts. Reuse persisted client identities for leads/referrals, existing audited writes, RLS, paging, and navigation. Responsive records preserve all fields and actions; desktop keeps tables.

**Tech Stack:** React 18, TypeScript, existing CRM CSS, Supabase PostgreSQL, Vitest, browser QA.

**Spec:** Owner approved the in-chat design on 2026-10-14.

## Constraints
- CRM implementation in C:\crm; current JewelOS source is the release baseline. Preserve pre-existing changes in both checkouts; transfer only reviewed task changes.
- Existing palette, fields, permissions, saved history and audited writes remain authoritative.
- One header person search; registration phone lookup and form selectors retain their distinct purposes.
- Client pages have 50 records and navigation at both ends.
- No hosted writes until local gates and production playbook checks pass.

## Review focus
- Search errors and obsolete responses must not display misleading empty or stale results.
- Search must find linked leads/referrals and alternate names/phones/references without copying records.
- Clicking an embedded action must not also navigate the record.
- Filter changes, clearing, pagination and browser history must preserve consistent URL state.
- Long values, keyboards, narrow phones and expanded follow-up forms must remain usable.

## Tasks
1. [x] Client Database: tests for 50-row page boundaries, collapsed filters, no local search, row click/keyboard navigation and independent actions. Extend client-database.tsx and existing paging tests. Run focused Vitest tests.
2. [x] Queues: reusable FilterPanel and responsive labelled records; remove local person searches; retain tabs, sort, server paging, follow-up forms/history/sync and saved validation. Extend Not Bought, Referrals, Entry Queue and their regression tests.
3. [x] Universal search: preserve selection-mode consumers; add accessible full-record result links, complete-result navigation, short names, request/error/dismissal handling. Extend one invoker matching contract for linked identities, saved names/phones and references; use the same predicate for client pages. Forward-only migration and allowed/denied pgTAP cases.
4. [x] Remaining CRM surfaces: inspect profile/history, dashboard, registration/lead/walk-in forms and navigation; fix demonstrated overflow/density using scoped CSS and expandable secondary details without hiding required inputs.
5. [ ] Verify: focused and full CRM tests, CSS generation/check, CRM/web typecheck and build, database tests, desktop/phone browser workflows, WebView contract tests. Self-review final diff, preserve baseline edits, document exact local/hosted/device evidence and release gates.

## Execution ledger
- Started with owner design approval; inline execution. C:\crm is already a linked worktree on feat/crm-native.
- Existing work is dirty in both roots. Task baselines will be kept outside tracked source; no unrelated edits will be staged or discarded.
- Tasks 1–3 implemented; profile/history/queue mobile changes implemented for Task 4. Dashboard already has a collapsed filter panel; existing registration/lead/walk-in field contracts were retained.
- Client validation: 205 CRM tests in 46 files passed; CRM typecheck/CSS and web build passed; embedded-web CRM tests 20 passed; native CRM bridge tests 11 passed. No connected adb device.
- Review fixes: whitespace-only query edits retain finished results; compound Clear filters navigates immediately; full phone matching/ranking uses the existing country-code canonicalizer. All corresponding focused tests passed.
- Browser inspection revealed legacy mobile-table rules overriding authored records. Corrected the observer/style interaction while keeping desktop fitted/sticky support; 16 focused layout tests passed and phone name text measured 16px.
- Database evidence: initial 16 assertions passed and three international-phone cases passed after their red/green correction. The expanded matrix added a second person sharing a partial phone suffix: its two partial-match expectations were corrected from one to two. A complete fresh execution of the expanded matrix remains pending; slow scale-stack reads and overlapping obsolete validation runs prevented a clean final result before handoff.
- Browser: Client Database rendered at 390px with 50 records, collapsed filters and no document overflow. Full multi-screen authenticated QA was blocked by the resumed local session reporting AuthSessionMissingError. No physical device or hosted validation claimed.
- Ruling: the older swipe-table adapter continues to size/pin desktop listings but does not rewrite authored record labels; its phone swipe rules exclude authored records. This preserves desktop interaction and prevents competing phone layouts.
- Ruling: temporary local request timeout was increased only for the 100,000-record synthetic QA stack and restored to its original 8 seconds. No production request-budget or authorization change was made.
- User requested finish; stopped additional preview/validation attempts and delivered the current verified local scope. Release remains gated on the expanded DB matrix and authenticated browser checks; no commit/push/deploy/APK was performed.

## Authorized release continuation
- Owner requested necessary migration deployment and main publication. Concurrent commit 48c39c2 already contains the CRM UI task scope; the isolated release preserves it and adds only the migration, database tests and verification notes.
- Hosted schema-only staging applied the migration and passed 190 direct PostgreSQL assertions across search, paging, country phones, lead continuity, follow-up writes and department choices. Legacy follow-up fixtures now match the department-aware roster contract.
- Isolated source validation repeated 205 CRM tests, typecheck, CSS check and web build successfully. Staging Client Database phone paging/details passed; full profile/queue browser and physical Android evidence remain incomplete.

- Production migration 20261014000100 applied once. Invoker/grant/view checks and anonymous HTTP denial passed. Customer/history counts and full-row digests unchanged. The main publication is scoped to five reviewed migration/test/document paths.
