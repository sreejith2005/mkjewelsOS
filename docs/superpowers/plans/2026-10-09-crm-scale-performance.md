# CRM scale performance implementation plan

**Goal:** Keep Not Bought, Referrals, Client Database and Dashboard responsive at 100,000 records while preserving fields, filters, counts, history, writes and authorization.

**Architecture:** Database filtered pages (50 follow-ups/referrals, existing 200 clients), statement-scoped authorization, indexed per-client activity projections maintained by source triggers, and dashboard aggregates. Read history in 100-row pages only when opened. No whole-database browser downloads or authorization cache. Existing write/audit/outbox/Storage contracts remain unchanged.

**Spec:** Owner's 2026-10-09 performance request; existing CRM two-project and parity designs apply. Work is isolated under C:/crm/.worktrees/crm-scale to preserve concurrent changes in C:/crm and the root checkout.

- [x] Add failing UI/database tests for bounded reads, filters/counts beyond 1,000 rows, history pagination, existing tab/status semantics, inactive/anonymous denial and projection refresh after all source writes/deletes.
- [x] Add forward CRM migration: invoker paged queue/history RPCs and indexes; private trigger-owned activity projection with company-wide active-user SELECT RLS; optimize existing client browse without removing filters; server dashboard aggregates with existing status calculations.
- [x] Update Followups/Referrals loaders and controls to use server pages, reset page on filter change, debounce search, retain sort/filter options and correct global tab counts. History loads on demand; failed reads show retry and never silently empty the result.
- [x] Use aggregated Dashboard results; bound profile history sections with explicit next/previous controls so all saved evidence remains reachable. Parallelize independent context/identity reads.
- [x] Rebuild isolated current-main CRM database, run pgTAP and UI/web/type/build gates. Run reproducible 100,000-row benchmarks under authenticated RLS and rendered desktop/phone/embedded checks. Document request sizes, timings and query plans, including deeper pages and selective search.
- [x] Review exact staged paths and secret-safe scan; confirm both hosted ledgers and exact CRM dry run; apply only this migration, push main, verify production deployment/public smoke. No native change means existing Android WebView consumes hosted CRM; do not claim physical-phone timing without a device.

**Compatibility:** Additive reads and a derived projection only; source/history/document data is retained. Projection triggers run in the source transaction and are not granted to clients. A forward corrective migration can restore the prior browse function; previous UI remains compatible.

**Acceptance:** All current tests pass; full counts and pages include records past the REST cap; browser transfers/rendered lists are bounded; local 100,000-row pages/search/dashboard target below one second after warm-up. Production network/device speed is a separate measurement, not inferred from local results.

## Verification status (2026-10-10)

See docs/CRM_SCALE_PERFORMANCE_2026-10-10.md for counts, measured latency and proof limits. The subsecond target is not uniformly achieved; bounded payloads, complete counts, preserved evidence and access controls are verified. Final CRM suite: 41 files / 182 tests, exit 0. Web: 85 files / 409 tests, exit 0. Both typechecks, scoped CSS and web build passed. CRM migration is applied and application release `e2caa0a` is on main and Ready in production. Public and anonymous denial checks passed. Authenticated hosted/device timing and consistently subsecond lakh-scale performance remain unproven; see the evidence record.
