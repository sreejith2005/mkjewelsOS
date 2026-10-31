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
1. [ ] Client Database: tests for 50-row page boundaries, collapsed filters, no local search, row click/keyboard navigation and independent actions. Extend client-database.tsx and existing paging tests. Run focused Vitest tests.
2. [ ] Queues: reusable FilterPanel and responsive labelled records; remove local person searches; retain tabs, sort, server paging, follow-up forms/history/sync and saved validation. Extend Not Bought, Referrals, Entry Queue and their regression tests.
3. [ ] Universal search: preserve selection-mode consumers; add accessible full-record result links, complete-result navigation, short names, request/error/dismissal handling. Extend one invoker matching contract for linked identities, saved names/phones and references; use the same predicate for client pages. Forward-only migration and allowed/denied pgTAP cases.
4. [ ] Remaining CRM surfaces: inspect profile/history, dashboard, registration/lead/walk-in forms and navigation; fix demonstrated overflow/density using scoped CSS and expandable secondary details without hiding required inputs.
5. [ ] Verify: focused and full CRM tests, CSS generation/check, CRM/web typecheck and build, database tests, desktop/phone browser workflows, WebView contract tests. Self-review final diff, preserve baseline edits, document exact local/hosted/device evidence and release gates.

## Execution ledger
- Started with owner design approval; inline execution. C:\crm is already a linked worktree on feat/crm-native.
- Existing work is dirty in both roots. Task baselines will be kept outside tracked source; no unrelated edits will be staged or discarded.
