# CRM navigation performance

Scope: improve the existing CRM on desktop, phone browsers, and the Android CRM WebView without changing screens, persisted records, or authorization.

Evidence: app-router eagerly imports all ten CRM page modules; link prefetch is ignored; layout and page loaders concurrently call the same JewelOS auth endpoint; FollowupsPage awaits independent followup and history reads sequentially. Dashboard fetches client/salesperson joins which neither its calculations nor recent-visits table consume.

1. Add behavioral regressions for page module loading, code-only prefetch, concurrent identity reads, sequential fresh identity checks, rejected identity reads, and concurrent followup/history requests.
2. Load page modules on demand and preload code on link hover/focus/touch. Keep existing loader invocation, refresh reconciliation, redirects, denial handling, and draft retention.
3. Share only pending auth requests inside each CRM facade; never cache settled identity results or replace server authorization with local identity.
4. Run independent Follow Up reads together and remove unused dashboard joins. Keep all existing calculations and complete history.
5. Run CRM and web tests/typechecks/build, compare production CRM chunk sizes, and check desktop/phone browser rendering where available. Inspect Android WebView consumers and release gates; report device/hosted evidence separately.

Working location: C:/crm, as required by the CRM owner decision. Existing uncommitted CRM work is preserved; these changes are reviewed against a saved pre-task snapshot, not absorbed into a release.

## Validation evidence

- CRM regression tests reproduced eager module loading, duplicate concurrent login reads, and sequential followup/history reads before the fixes.
- CRM suite: `pnpm.cmd -C C:/crm --filter @jewelos/crm-ui test` passed 135 tests, including browser and embedded-auth regressions. CSS regeneration added one missing existing grid utility (four lines); no existing CSS was removed.
- Web suite: `pnpm.cmd -C C:/crm --filter web test` passed 380 tests. Expected synthetic error-boundary logs were emitted by existing tests.
- `pnpm.cmd -C C:/crm --filter @jewelos/crm-ui typecheck`, `pnpm.cmd -C C:/crm --filter web build`, and scoped `git -C C:/crm diff --check` passed. The CRM entry chunk changed from 336.48 kB to 98.02 kB (gzip 85.27 kB to 21.43 kB); shared dependencies and page chunks are additional. This is a chunk-size comparison, not a live navigation timing claim. Existing large spreadsheet chunk warning remains; that chunk is dynamically imported by the task import action.
- Browser tooling: Browser MCP is unavailable in this session; Playwright Chromium fallback used a temporary harness outside the repository, importing the actual CRM source and intercepting network reads with synthetic responses. At 1440 and 390 px, Dashboard -> Client Database -> Follow Up -> Referrals -> Walk-In rendered correctly, with no console/page errors and no document overflow. Screenshots are outside the repository. These checks do not prove hosted RLS or production data latency.
- Android CRM already consumes this exact web route through `CrmWebViewScreen`; no native binary/source or shared core code was changed. `adb devices` returned no connected device, so physical Android UX remains unverified.
- No schema/RPC/RLS/Storage/audit/generated-type changes were made by this task. No hosted writes, commit, deployment, or APK publication was performed. Owner-supervised web deployment and authenticated production/device verification remain the next gates; ongoing unrelated CRM work must be reviewed separately before publication.

## Publication preflight, 2026-10-08

The owner authorized deploying necessary migrations and pushing to main. Release integration uses an isolated branch based on origin/main at 8ed50618854392cd86fb39b6b09cbe4c743313f4. Only the five source deltas and three regression files from this performance task were transferred from C:/crm. Current main's removed Allocation route and dashboard Sync Health were preserved. No generated stylesheet change was needed; the current main stylesheet passes its generation check. Other worktrees and ongoing CRM changes were left intact.

Hosted preflight confirmed JewelOS project yimafxhuwgfhvzczqqdd through migration 0201 and CRM project fsydcsyqnddacjfoutfe through 20261007001400. Both migration lists and linked db-push dry runs match current main and report up to date. This performance change has no migrations; no database writes or migration-ledger repairs are required. The initial preflight from the older feature checkout found remote 0201 missing locally; repeating against current main resolved that mismatch without modifying migration history.

Fresh release checks from the isolated current-main checkout: `pnpm.cmd --filter @jewelos/crm-ui test` passed 133 tests in 31 files; `pnpm.cmd --filter @jewelos/crm-ui typecheck` and `pnpm.cmd --filter web build` passed. The first default-worker web run had 408 passes and one unchanged FMS builder test timeout at its five-second limit. `pnpm.cmd --filter web exec vitest run src/features/fms/FmsFlowBuilder.test.tsx --maxWorkers=1` passed all 25 tests, then `pnpm.cmd --filter web exec vitest run --maxWorkers=2` passed all 409 tests in 85 files without changing tests or application source. Existing error-boundary tests emit expected synthetic failure logs. The CRM entry chunk in the current-main build is 101.17 kB, gzip 21.31 kB; the earlier 98.02 kB result above was from the older CRM worktree. Named staged-path review, `git diff --cached --check`, and a credential-safe scan passed. Production deployment checks follow the push.

Deployment target: the existing Git-integrated Vercel projects mkjewels-os and jewelos, deployed from main. Prior production SHA is 8ed50618854392cd86fb39b6b09cbe4c743313f4. Approver: owner instruction in this session. No configuration, secrets, database data, Edge Functions, or Android binary changes. The compatible prior web deployment remains the rollback path. Verify Git remote SHA and Vercel deployment status after push, then run public desktop/phone smoke checks. Authenticated live-data latency and physical Android UX remain separate evidence gates.
