# CRM workflow performance implementation plan

**Goal:** Reduce opening, registration-to-queue, and completed walk-in delays across desktop, phone web, and Android's embedded CRM.

**Evidence:** QueuePage serializes identity, options, roster, queue, and completed-client reads. EntryQueue waits for router.refresh after an audited registration. WalkInForm gives no saved confirmation while the next queue loader runs. Native uses this same hosted CRM route.

**Architecture:** Keep the existing audited write contracts and RLS. Add an invoker queue snapshot RPC to consolidate independent reads. Return the persisted queue row from a wrapper around the existing audited registration. Optimize statement-constant permission checks and repeated audit JSON conversion without changing their decisions or records. Do not cache settled authorization or invent persisted records.

1. Add failing client tests for a committed row appearing before refresh, failure creating no row, branch/filter scope, save confirmation, and read failures. Add database assertions for new RPC grants and inactive/cross-branch/ordinary/admin behavior.
2. Add forward CRM migration with the invoker queue read and audited registration wrapper; preserve IDs, writes, private Storage, outbox, and audits. Regenerate types and validate JSON boundaries.
3. Consume the snapshot in QueuePage, parallelize independent visit-form lookups, show registration's returned database row, and confirm a successful full save immediately while disabling resubmission.
4. Rebuild an isolated local CRM stack, run all CRM pgTAP and UI tests, typechecks, web regressions/build, and rendered desktop/phone workflow checks. Measure request phases with controlled latency; separate synthetic results from production/device evidence.
5. Integrate only reviewed paths onto current main, check hosted ledger and exact migration dry-run, deploy CRM migration, publish main and verify Vercel. Do not reset shared local stacks or include unrelated dirty work. Native source changes require the standing signed APK release gates; hosted CRM-only changes reach its existing WebView.


## Release evidence (2026-10-08)

- Baseline current main `9751f78`: 469 pgTAP assertions passed. With CRM migration `20261008000200`: 491 passed, including anonymous/inactive denial, ordinary/admin branch scope, the original single audit and task outbox, and all pending work despite 1,005 recent completed rows.
- Tests ran through `docker exec ... psql -At -v ON_ERROR_STOP=1` against isolated `crm-workflow-perf`, with parsed TAP failures/plan checks. The CLI reset rebuilt the current migration chain but its Storage restart health check failed; its TCP test runner also timed out. Shared stacks were not reset. Tests from unpublished CRM work were excluded; current main tests were used.
- Identical local queue benchmark, 3,000 synthetic rows: 6,747.92 ms before the policy optimization; 37.46 ms after. This measures database work, not employee network/device latency.
- CRM UI: 136 tests/32 files passed; final affected files: 28 tests passed. Web: 409 tests/85 files passed with one worker. CRM typecheck/CSS check and web build passed.
- Playwright exercised real isolated CRM REST writes at 1440px, 390px, and the embedded auth adapter at 390px. JewelOS host/login exchange were synthetic. Registration, the full purchase form, saved queue, and persisted profile counts/forms all succeeded; no page errors or document overflow. Latest full-submit HTTP responses were 585-693 ms locally; the saved RPC alone measured 538.80 ms. These are not production/device benchmarks.
- CRM production target: `fsydcsyqnddacjfoutfe`; dry run contains only `20261008000200_crm_workflow_performance.sql`. JewelOS target: `yimafxhuwgfhvzczqqdd`; ledger/dry run current, no migration needed there.
- Schema impact: two invoker RPCs and two queue indexes; existing policy roles/commands and helper decisions retained. Field-level audit conversion optimized with identical records. No historical data rewrite or private Storage change. RPC types updated and JSON snapshot validated at the client boundary.
- Authorization: owner requested performance fixes, required migrations and main publication in this conversation. Deployment is additive/backward-compatible with the prior UI. Web rollback is to `9751f78`; if database correction is needed, use a forward migration restoring the prior policy expressions/audit definition. Existing function/data paths remain available.
- Android uses the same hosted CRM in its WebView; no native/shared-mobile source changed, so no new APK is required. Physical phone and production authenticated timing remain unverified.
