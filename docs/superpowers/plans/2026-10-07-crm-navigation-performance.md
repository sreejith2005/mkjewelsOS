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
