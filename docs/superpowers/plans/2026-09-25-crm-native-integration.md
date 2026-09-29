# Plan: original CRM as a native part of JewelOS

Design: `docs/superpowers/specs/2026-09-25-crm-native-integration-design.md`.
Reference source (read-only): `sreejith-crm/web-app`. Parity with it is the
acceptance criterion for every phase.

Worktree (2026-09-28): all CRM work is done in `C:\crm` (`git worktree` of this
repository, branch `feat/crm-native`); the main checkout is not used for CRM work.
The parity harness reads the original from `CRM_ORIGINAL_DIR` (default
`C:\Users\MIS\Downloads\MKJewelOS\sreejith-crm\web-app`). On 2026-09-28 the branch
merged `origin/main` (`ce4ff1c`, which added `0181_office_leave_summary`) and the CRM
migrations and tests were renumbered +1 to `0182`-`0189` with `git mv`. They have
never been applied to a hosted database; repeat the renumber if main adds more
migrations before Phase 7.

Each phase is a separate reviewed change. "Gate" lists what must pass before the
phase is handed over; hosted steps additionally need owner approval.

## Phase 2 - Database port (done locally, 2026-09-25)

Files:

- `supabase/migrations/0183_crm_schema_tables.sql` .. `0188_crm_storage_bucket.sql` (renumbered
  again 2026-09-29 from `0182`-`0187`: `main` took `0182_form_dependencies_fms_draft_safety.sql`
  first, caught by the cutover checklist's gate-2 precondition before any hosted action)
- `supabase/tests/0183_crm_identity_bridge.test.sql` (privileges, bridge,
  fail-closed cases, branch scoping, link RPCs, ingest path, old CRM untouched)
- `supabase/tests/0184_crm_original_behaviour.test.sql` (port of
  `sreejith-crm/web-app/tests/database-foundation.test.ts`)
- `supabase/config.toml` (`[api] schemas` adds `crm`)
- `packages/api-client/src/database.types.ts`, `packages/core/src/database.types.ts`
  (generated `crm` block spliced in; `public` untouched)

Gate (met locally): `supabase.cmd db reset`, `supabase.cmd test db`,
`supabase.cmd db lint --local --level warning` (only inherited original warnings in
`crm`), `pnpm.cmd exec turbo run typecheck --force --concurrency=1`,
`git diff --check`; catalog, function-body and seed diffs against a replay of the
original migrations show only the documented differences.

Hosted (owner action, later): add `crm` to Exposed schemas; apply 0183-0188 with
the production playbook.

## Phase 3 - Web UI port (`packages/crm-ui`)

Status (2026-09-25, branch `feat/crm-native`, local only): implemented. Record:
`packages/crm-ui/PORTING.md` (every `crm-port:` edit, styling/isolation) and
`scripts/crm-parity/README.md` (harness). As built, it differs from the plan below in these ways:

- `/crm/*` renders `CrmApp` full-screen (its own original shell) behind the existing
  JewelOS gates. The old `CRMPage` is unrouted; rollback is reverting the App.tsx change.
  The `/crm/*` path mapping lives in `apps/web` (`packages/core` is shared with mobile and
  is unchanged).
- The original server pages run unchanged as client loaders
  (`src/crm-port/app-router.tsx`). The original `app/` tree keeps its layout.
- The stylesheet uses id-tier scoping (`.crm-root#crm-root…`), not class prefixing alone,
  because Tailwind 4's cascade layers would otherwise lose to JewelOS's unlayered CSS.
- Audit addendum: `0189_crm_direct_write_audit.sql` (design open question 6).

Stack facts: original = Next 16 / React 19 / Tailwind 4 with async server-component
pages and `next/navigation`, `next/link`, one `next/image`, one server action
(`signOut`). JewelOS web = Vite / React 18.3 / Tailwind 3 with its own pathname
router. No React-19-only hooks are used by the original.

Files:

1. `packages/crm-ui/package.json`, `tsconfig.json` (strict), `src/index.ts`
   exporting `CrmApp` (props: the JewelOS Supabase client, base path `/crm`).
2. `packages/crm-ui/src/next-shim/` - `navigation.ts` (`useRouter`,
   `usePathname`, `useSearchParams`, `redirect`, `notFound`), `link.tsx`,
   `image.tsx`, all mapped onto the `/crm` base path. The original components
   import these instead of `next/*`; nothing else in them changes.
3. `packages/crm-ui/src/app/` - one module per original route (`/`, `/dashboard`,
   `/queue`, `/visits/new`, `/clients`, `/clients/new`, `/clients/[clientId]`,
   `/followups`, `/referrals`, `/allocation`, `/leads/new`) and the layout/shell.
   Each server page becomes a client loader that runs the same queries, in the
   same order, through `supabase.schema("crm")`, then renders the original
   component tree unchanged.
4. `packages/crm-ui/src/components/` - the original components, copied with only
   these edits: `next/*` imports -> shim; `createClient()` -> injected client with
   `.schema("crm")`; storage bucket id -> `crm-legacy-documents`;
   `auth.getUser().id` used as a CRM user id -> `rpc("current_crm_user_id")`
   (users lookup, `leads.created_by`, `lead_call_history.entered_by`, Runo owner
   check); `signOut` -> JewelOS sign-out. Each edit is listed in
   `packages/crm-ui/PORTING.md`.
5. `packages/crm-ui/src/styles/crm.css` - the original `globals.css` compiled with
   Tailwind 4 and wrapped under `.crm-root` (build-time selector prefixing), so the
   original palette, fonts (Jost, Playfair Display) and utilities apply only inside
   the CRM surface and beat the JewelOS Tailwind 3 base there. Fonts self-hosted or
   loaded with the same families.
6. `apps/web/src/App.tsx` / route table - `/crm/*` renders `CrmApp` (lazy) behind
   one reviewed configuration switch; the old `CRMPage` stays reachable as the
   fallback until Phase 7. `packages/core/src/roleMenu.ts` path mapping must treat
   `/crm/<deep path>` as the CRM page.
7. `scripts/crm-parity/` - synthetic fixture generator (one source, two outputs:
   original `public` schema and JewelOS `crm` schema, identical ids), Playwright
   config and specs that capture each route for each CRM role at desktop and phone
   width in both apps, and a DOM-text/screenshot comparer.

Tests and gates:

- Unit: port the original component tests (`tests/*.test.tsx`: walk-in form,
  entry queue, follow-up queue, referral queue, client database/profile/search,
  allocation manager, lookups, dashboard, followup logic, business date, queue
  visibility, potential category, available CRM names) into
  `packages/crm-ui/src/**/*.test.tsx`, same inputs and assertions.
- Parity harness: DOM text identical for every route x role; screenshots within
  the agreed threshold; workflow run (queue -> walk-in -> follow-up -> referral ->
  conversion) yields identical rows in both databases.
- Regression: `pnpm.cmd --filter web test`, turbo typecheck and build, every
  non-CRM route unchanged; users without CRM access see the JewelOS access-denied
  state, not the CRM.
- No new colour/token outside `crm.css`; `crm.css` selectors all start with
  `.crm-root` (automated check).

## Phase 4 - Edge Functions

Files:

- `supabase/functions/crm-walkin-ingest/` - port of `app/api/ingest/walkin/route.ts`
  and `lib/legacy-walkin-ingest.ts`: same request/response contract, same
  validation, same rate limit (`crm.consume_legacy_walkin_ingest_rate_limit`),
  same attempts ledger (`crm.legacy_walkin_ingest_attempts`), same write path
  (`crm.submit_legacy_walkin_visit`). Shared secret from Edge Function config;
  `verify_jwt = false` with the secret checked before body parsing.
- `supabase/functions/crm-runo-push/` - port of `app/api/leads/[leadId]/runo/route.ts`;
  caller JWT verified, owner/super-admin check through the bridge, Runo
  credentials server-side only.
- `supabase/migrations/0190_crm_ingest_service_grants.sql` - `service_role`:
  USAGE on `crm`, EXECUTE on the two ingest RPCs, INSERT/SELECT on the attempts
  ledger, and only what `crm-runo-push` needs.
- Tests: Deno tests per function (bad secret, malformed body, rate limit,
  idempotent `request_id`, success) and a pgTAP file for the grants.

Gate: function tests; pgTAP; local end-to-end call with a synthetic payload.
Hosted: deploy functions, set secrets, repoint Apps Script (owner).

Delivered (local only): `crm-walkin-ingest`, `crm-runo-push`, migration
`0190_crm_ingest_service_grants.sql` (service_role: USAGE on `crm` and EXECUTE on three RPCs, no
table privilege; the ingest RPC does branch lookup + visit + ledger + audit in one transaction),
pgTAP 0189, Deno tests, `crm:parity -- --ingest`, `docs/CRM_SHEETS_INGEST_CUTOVER.md`.
Intentional differences from the originals: the Runo lead id is sent in the JSON body, not the URL;
"the creator" is the caller's CRM user id from the identity bridge; a non-POST is a bare 405; a
rate-limit database outage is a JSON 500 (the original threw); a body over 1 MB without a
Content-Length is also refused; ledger `source_ip` is cut to its 64-character column; the ingest
writes `crm.legacy_walkin_ingest_attempt` audit rows (request id, outcome, code only); an optional
`CRM_RUNO_API_URL` secret exists for local stubs only. The original's `proxy.ts` redirects a
session-less request (including Apps Script) to the login page; the Edge Function does not.

## Phase 5 - Data migration from the CRM Supabase

Status (2026-09-28, local rehearsal done): tooling in `scripts/crm-import/` (README there), production
procedure in `docs/CRM_DATA_MIGRATION_RUNBOOK.md`. The rehearsal restored the owner's export of the
original into an isolated local stack, imported it into an isolated JewelOS stack built from HEAD,
and reconciled it; its reports, the identity/branch proposal and the link SQL are private
(`C:\crm-private\work`). As built, it differs from the list below:

- `scripts/crm-import/{import,storage-copy,reconcile}.mjs` replace `scripts/crm-migration/*`. The
  source is a database URL (restored copy or the original, read-only transaction); no export script.
- Every trigger is off for the load (`session_replication_role = replica`), not a subset, so every
  stored value (rollups, codes, edit log, phone index, audit fields) is copied as-is and no per-row
  audit is written; one `crm.legacy_data_import` summary row is.
- Seeded lookups and lead-form rows are replaced by the source rows (matched by `label` /
  `field_key` / field key + option value), so every row keeps its source id; the seed id -> source
  id remap is recorded in the report. Sequences move to the greater of the source position and the
  highest value in use.
- Storage keeps object paths (bucket id only changes). `owner_id` is not rewritten: the Storage
  API sets no owner on a copied object; CRM super_admin keeps delete rights.
- The link preflight is the owner-reviewed proposal (exact normalized email for users, exact name
  for branches; names shown, never matched) plus a commented link SQL file, both private.

Planned files (superseded as above):

- `scripts/crm-migration/export.ts` - read-only export from the CRM Supabase with
  an owner-provided read-only connection (never committed, never printed).
- `scripts/crm-migration/import.sql` / `import.ts` - id-preserving load into
  `crm` inside one transaction with triggers that would recompute or re-audit
  disabled only where the source already holds the derived values
  (`client_timeline` rollups, `client_edit_log`, history triggers); lookups and
  lead-form fields upserted by natural key (`label`, `field_key`), options mapped
  by `field_key`; `crm.client_code_sequence` and `client_edit_log_id_seq` reset to
  max + 1; `crm_queue_round_robin` copied.
- Storage copy from `crm-documents` (CRM project) to `crm-legacy-documents` with
  the same object paths; `owner_id` rewritten to the linked JewelOS Auth user where
  one exists.
- `scripts/crm-migration/link-preflight.ts` - read-only report: each `crm.users`
  row with candidate JewelOS profiles (for the owner to decide; no auto-link),
  unmapped CRM branches, JewelOS CRM-role users without a CRM user.
- Reconciliation report: per-table row counts and checksums (source vs target),
  orphan checks, sample-based field comparison. No customer data in output.

Gate: dry run into a local copy; reconciliation clean; owner-approved link list
applied through `crm.link_jewelos_profile` / `crm.link_jewelos_branch` (audited).

Status (2026-09-28, Phase 5 complete locally): owner decisions D1-D8 are recorded in the design
and the runbook. The rehearsal was repeated on a fresh isolated target built from HEAD (with
0191/0192, renumbered 2026-09-29): all 22 Storage objects copied and verified (size, eTag, SHA-256), import committed,
reconciliation ACCEPTED (38 tables equal in rows and hashes, 0 FK orphans, rollups identical,
Storage 9/9 documents and 22/22 objects, one audit row with the dry run's checksum), and the
read-only real-data parity with D5 applied to both apps. Evidence is private
(`C:\crm-private\work`).

## Phase 6 - Mobile WebView and APK

Files: `apps/mobile/src/features/crm/CrmWebViewScreen.tsx`,
`apps/mobile/src/navigation/AppTabs.tsx` (CRM tab), a reviewed session handoff
that never puts tokens in URLs, navigation allow-list limited to `/crm/*`,
`react-native-webview` dependency.

Gate: mobile typecheck/tests, device check at phone width for every CRM route,
sign-out clears WebView storage; release only via `scripts/release-mobile.ps1`
per `docs/MOBILE_RELEASE_GUIDE.md` (no `-Mandatory` without owner approval).

Status (2026-09-28, implemented on `feat/crm-native`, not released): as built,
`apps/mobile/src/features/crm/{CrmWebViewScreen.tsx,crmWebViewBridge.ts}`, the shared protocol
`packages/core/src/crmEmbed.ts`, the web embedded mode `apps/web/src/embedded/` and
`createJewelosAccessTokenClient` in `@jewelos/api-client`. The web origin is the build-time
`EXPO_PUBLIC_JEWELOS_WEB_ORIGIN`. The owner decided (2026-09-28) that the APK ships with the
Phase 7 go-live, because the tab depends on the web `/crm` route and the `crm` schema being live.
Design and threat model: the design's "Mobile WebView (Phase 6)".

## Phase 7 - Cutover and retirement

Status (2026-09-28, prepared on `feat/crm-native`, nothing hosted changed): merged `origin/main`
(`1b1b5d0`, no new migrations, so the CRM series stayed `0182`-`0191` at that point; renumbered
again 2026-09-29 to `0183`-`0192` when `main` took `0182_form_dependencies_fms_draft_safety.sql`).
Owner decisions: Home "CRM
Tasks" / "CRM Follow-ups Due", the four old CRM reports and the six old CRM dashboard metrics are
hidden on web and mobile (they read the archived `public` CRM tables, which stay untouched); the old
native CRM UI is deleted (web `features/crm` + `CRMPage`; mobile `Crm*`/`ClientDetail`/`ClientEditor`/
`Walkin` screens and `features/crm` except the WebView files; `packages/data/src/crm`;
`packages/core` CRM helpers except `crm/{phone,preflight,legacyImport}`, which the legacy import
scripts still use). `crm.view` keeps its defaults; staff are granted one by one. The release script
requires an https `EXPO_PUBLIC_JEWELOS_WEB_ORIGIN`. The production procedure, with the read-only
preflight findings, is `docs/CRM_CUTOVER_CHECKLIST.md`.


- Switch `/crm` to `CrmApp` for all CRM-permitted roles; Home "CRM Tasks",
  notifications and dashboard CRM entries decided per the design's open questions.
- Smoke test each mapped role, an unlinked user, a deactivated user, a disabled
  section, on web and Android; record evidence in `docs/REGRESSION_CHECKLIST.md`.
- Separate change retires the old JewelOS CRM UI (`CRMPage`, mobile CRM screens,
  `packages/data/src/crm`), keeping the `public` CRM tables, RPCs and history.
- Retire the original deployment and CRM Supabase only after an owner-approved
  archive.

## Rollback per phase

See the design document. In short: the `/crm` switch and the `crm` section
maintenance control are the immediate levers; migrations are forward-only; nothing
deletes CRM history or old JewelOS CRM data.
