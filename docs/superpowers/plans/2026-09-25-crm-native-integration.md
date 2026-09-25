# Plan: original CRM as a native part of JewelOS

Design: `docs/superpowers/specs/2026-09-25-crm-native-integration-design.md`.
Reference source (read-only): `sreejith-crm/web-app`. Parity with it is the
acceptance criterion for every phase.

Each phase is a separate reviewed change. "Gate" lists what must pass before the
phase is handed over; hosted steps additionally need owner approval.

## Phase 2 - Database port (done locally, 2026-09-25)

Files:

- `supabase/migrations/0179_crm_schema_tables.sql` .. `0184_crm_storage_bucket.sql`
- `supabase/tests/0180_crm_identity_bridge.test.sql` (privileges, bridge,
  fail-closed cases, branch scoping, link RPCs, ingest path, old CRM untouched)
- `supabase/tests/0181_crm_original_behaviour.test.sql` (port of
  `sreejith-crm/web-app/tests/database-foundation.test.ts`)
- `supabase/config.toml` (`[api] schemas` adds `crm`)
- `packages/api-client/src/database.types.ts`, `packages/core/src/database.types.ts`
  (generated `crm` block spliced in; `public` untouched)

Gate (met locally): `supabase.cmd db reset`, `supabase.cmd test db`,
`supabase.cmd db lint --local --level warning` (only inherited original warnings in
`crm`), `pnpm.cmd exec turbo run typecheck --force --concurrency=1`,
`git diff --check`; catalog, function-body and seed diffs against a replay of the
original migrations show only the documented differences.

Hosted (owner action, later): add `crm` to Exposed schemas; apply 0179-0184 with
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
- Audit addendum: `0185_crm_direct_write_audit.sql` (design open question 6).

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
- `supabase/migrations/0185_crm_ingest_service_grants.sql` - `service_role`:
  USAGE on `crm`, EXECUTE on the two ingest RPCs, INSERT/SELECT on the attempts
  ledger, and only what `crm-runo-push` needs.
- Tests: Deno tests per function (bad secret, malformed body, rate limit,
  idempotent `request_id`, success) and a pgTAP file for the grants.

Gate: function tests; pgTAP; local end-to-end call with a synthetic payload.
Hosted: deploy functions, set secrets, repoint Apps Script (owner).

## Phase 5 - Data migration from the CRM Supabase

Files:

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

## Phase 6 - Mobile WebView and APK

Files: `apps/mobile/src/features/crm/CrmWebViewScreen.tsx`,
`apps/mobile/src/navigation/AppTabs.tsx` (CRM tab), a reviewed session handoff
that never puts tokens in URLs, navigation allow-list limited to `/crm/*`,
`react-native-webview` dependency.

Gate: mobile typecheck/tests, device check at phone width for every CRM route,
sign-out clears WebView storage; release only via `scripts/release-mobile.ps1`
per `docs/MOBILE_RELEASE_GUIDE.md` (no `-Mandatory` without owner approval).

## Phase 7 - Cutover and retirement

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
