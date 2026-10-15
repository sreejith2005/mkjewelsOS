# CRM mobile usability — implementation and verification

Date: 2026-10-14, Asia/Calcutta. Status: CRM interface published in concurrent commit 48c39c2; production CRM migration applied and verified; main publication authorized.

## Delivered behavior

- Client Database requests 50 records and retains top/bottom pagination and URL filters.
- Its record content and Enter open the persisted client/lead profile; call, walk-in, profile links and detail toggles retain independent actions.
- Client Database, Not Bought, Referrals and the walk-in queue have compact filter disclosures. Person searches in the Client Database/Not Bought/Referrals are consolidated into the header. Registration phone matching and referring-client selection remain available.
- Phone listings use labelled records with expandable secondary data. Desktop tables retain the existing fitted scroller, sticky headings and pinned actions. Authored labels are protected from the legacy table observer; legacy 11px swipe styles exclude these records.
- Profile secondary sections collapse on phones; desktop sections start expanded. Timeline and edit-log data remain available in responsive records.
- Universal search supports short names, complete paged results, whole-result profile links, keyboard selection/dismissal, retryable failures and obsolete-response cancellation. Surrounding whitespace does not erase finished results. Paged Clear filters actually refreshes the URL/records.
- Database matching covers existing canonical profiles, alternate names, saved lead/referral names, phone indexes, visit references and MKC/MKF/MKREF codes. Complete phone input keeps the existing country-code normalization; partial phones can correctly match multiple people. Exact primary names receive priority over recent partial matches.
- Referral calling exposes the existing referred-client identity, so an unconverted prospect can open their own profile.

## Files and contracts

UI changes are in `packages/crm-ui/src/components/{client-database,client-search,followup-queue,referral-queue,entry-queue,client-profile}.tsx`, new `filter-panel.tsx`/`responsive-disclosure.tsx`, `src/app/crm-usability.css`, and the existing scoped CSS/table adapters. Generated `crm.generated.css` was rebuilt.

Migration `supabase-crm/supabase/migrations/20261014000100_crm_universal_person_search.sql` adds the shared invoker match function, extends the existing search/paged-browse contracts and appends the prospect identity to the invoker calling view. Generated CRM types and the calling-row parser were updated. This migration changes no customer/source/history rows, Storage policies, audited write RPCs or authorization rules. The existing server page cap remains compatible with older callers.

CRM authoring used `C:\crm`; named task changes were transferred to the current JewelOS source. Unrelated concurrent Task/Leave work and retired copies were preserved. The concurrent UI release published these CRM interface changes in commit `48c39c2`. This release adds the remaining CRM migration, database regression test, updated legacy fixture and verification notes. No native source or APK change is needed for the hosted CRM WebView.

## Completed local gates

- `pnpm.cmd --filter @jewelos/crm-ui test --maxWorkers=1 --reporter=dot`: 205 tests, 46 files passed. Existing intentional failure-path logging and controlled-input warnings remain in the legacy form tests.
- `pnpm.cmd --filter @jewelos/crm-ui typecheck`: passed.
- `pnpm.cmd --filter @jewelos/crm-ui build:css` and CSS check: passed; stylesheet remains CRM-scoped.
- `pnpm.cmd --filter web build`: passed; existing bundle-size warning remains.
- Web embedded CRM tests (`nativeCrmBridge`, `EmbeddedCrmRoot`, `embeddedCrmClient`): 20 passed.
- `pnpm.cmd --dir apps/mobile exec vitest run src/features/crm/crmWebViewBridge.test.ts --maxWorkers=1`: 11 passed. Mobile is intentionally outside the pnpm workspace; the initial workspace-filter attempt matched no project and was replaced by this actual run.
- `git diff --check -- packages/crm-ui supabase-crm`: passed. A whole-worktree check also found unrelated concurrent RecurringTodo whitespace, which was preserved.
- Focused local PostgreSQL tests proved short/alternate/source names, partial phones, references, identifier lookup, same paged-result coverage, anonymous denial and inactive-reader denial (16 assertions). Three additional international-phone assertions failed before correction and passed afterward.
- Independent read-only review found whitespace search, paged filter clearing and country-aware phone regressions. All were corrected with focused red/green regressions.
- Playwright rendered Client Database at 390px using synthetic local records and real local CRM reads: 50 rows, filters initially collapsed, no document overflow. Browser style inspection confirmed 16px record names after removing the legacy 11px override.

## Database release verification

Owner instruction: deploy necessary migrations and push to main. CRM production is `walk-in_crm`, reference `fsydcsyqnddacjfoutfe`; JewelOS is a separate project and has no migration in this release.

Hosted ledger and `supabase.cmd db push --linked --dry-run --workdir supabase-crm` showed exactly `20261014000100_crm_universal_person_search.sql` pending. A completed physical CRM backup dated 2026-10-14 was confirmed. Customer-table counts and checksums were recorded without exporting records; prior read-function/view definitions were captured for a forward correction if needed. Previous web deployment remains compatible; do not edit migration history for rollback.

A temporary, schema-only CRM staging branch was created for the required staging gate. The new migration applied once to its October 13 baseline. Direct PostgreSQL pgTAP suites passed: universal search 20, client paging 19, country-aware phones 56, lead continuity 63, follow-up roster writes 19, department staff choices 13 (190 total). All test fixtures rolled back. The older follow-up fixture was updated with current synced department metadata and separate CRM/Sales choices; no application authorization was relaxed.

The HTTP SQL runner initially made the lead-history timestamp assertion fail because it sent all statements as one request. The direct PostgreSQL rerun passed. A later run while browser fixtures existed failed global-count assertions; removing those synthetic staging client fixtures restored the clean 63-assertion pass. A local schema-clone attempt stopped on a restricted `log_min_messages` function setting; the successful hosted staging run is the migration evidence.

The isolated release worktree repeated all 205 CRM tests (46 files), CRM typecheck, generated-CSS check and production web build successfully. The build retained its existing large-chunk warning. Concurrent UI changes were preserved; comparison found only corrected positioning of existing `use client` directives in four files.

Staging browser inspection proved Client Database at 390px, initially collapsed filters, 50 first-page records, expandable details and 10 remaining records on page two. A broader harness timed out waiting for the profile heading; it is not a completed desktop/phone end-to-end pass. No physical Android device is connected. Component tests and WebView bridge tests do not prove physical device behavior.

Production application, post-deploy checksums, remote commit verification and temporary-branch cleanup are recorded below when completed.

## Production result

`supabase.cmd db push --linked --workdir supabase-crm --yes` applied exactly `20261014000100`. Hosted migration-ledger verification passed. The match helper and calling view retain invoker security; the prospective profile column is present. Anonymous HTTP calls to search and paged browse both returned 401; anonymous SQL execution grants are denied. Helper execution is denied to service_role.

Customer counts and whole-row checksums were unchanged across deployment: 1,587 clients, 9 leads, 43 referrals and 2,184 visit-history rows. No customer data, history, Storage policy, write RPC, Edge Function, job, secret, host configuration or native binary was changed by this migration release. The staging branch and temporary credentials are removed after verification.

The scoped release is published on main; Git and web-host deployment are verified separately in the task handoff. Full authenticated profile/queue browser coverage and physical Android behavior remain unverified.
