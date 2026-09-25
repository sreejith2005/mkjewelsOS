# Original CRM as a native part of JewelOS

## Status and decision

Approved owner decision, 2026-09-25 (final). It supersedes the embed/SSO design
drafted earlier the same day (never committed) and, for the CRM application and
data layer, `2026-08-20-crm-embedded-sso-design.md` and
`2026-08-21-single-supabase-crm-ingestion-design.md`.

Decision:

1. The original MK Jewels CRM (`sreejith-crm/web-app`, Next.js) becomes a native
   part of JewelOS. There is no standalone deployment, no separate Supabase
   project and no SSO/OIDC. JewelOS login is the only login.
2. It must be **identical** to the original: same screens, fields, order, labels,
   vocabularies, flows, validation, calculations and styling. Improving,
   renaming, re-labelling, re-ordering, or merging it with the old JewelOS CRM is
   forbidden. When in doubt, the original source code is the specification.
3. The CRM database is ported into the JewelOS Supabase in a dedicated Postgres
   schema `crm`, keeping the original table, column, enum, function and trigger
   names, so the original queries port 1:1 as `supabase.schema("crm")`.
4. The UI goes into a new workspace package `packages/crm-ui`, which the JewelOS
   web app renders at `/crm`. The Android app shows that route in an in-app
   WebView.
5. The old JewelOS CRM tables in `public` (`clients`, `client_timeline`, ...) are
   not modified or dropped.
6. Approved exception to AGENTS.md rule 7: the CRM UI keeps its original palette,
   fonts and CSS, scoped to the CRM surface.

`sreejith-crm/` in this checkout is a read-only reference, never a dependency.

This document authorizes the local database port (Phase 2). Every later phase
needs its own reviewed change; hosted actions (schema exposure, migration apply,
data import, deploy, APK release) each need their own approval.

## Relationship to earlier designs

| Document | Status |
| --- | --- |
| `2026-09-25-crm-original-app-embed-design.md` (uncommitted draft) | Deleted; replaced by this document. |
| `2026-08-20-crm-embedded-sso-design.md` | Superseded for the CRM application/data layer. Its roster-preflight idea (who maps to which historical CRM user) survives as the link preflight in Phase 5. |
| `2026-08-21-single-supabase-crm-ingestion-design.md` | Superseded for the CRM application/data layer. Its worker security rules (no browser credentials, RPC-only writes, idempotency, audit, safe logging) still apply to Phase 4. |
| `2026-08-20-jewelos-first-crm-migration-design.md` | Remains superseded for CRM. |

## Architecture

```text
Browser (JewelOS web)                 Android app
  /crm/*  -> packages/crm-ui           CRM tab -> WebView of https://<jewelos-origin>/crm
     |  supabase.schema("crm")            (same web route, same JewelOS session handoff
     v                                     as Phase 6 defines)
JewelOS Supabase (one project)
  schema public       JewelOS (users, tasks, old CRM tables ... unchanged)
  schema crm          original CRM tables, enums, RPCs, triggers, RLS (0179-0184)
  schema crm_private  internal helpers (identity resolver, audit writer); never exposed
  Storage bucket      crm-legacy-documents (original CRM files)
  Edge Functions      crm-walkin-ingest, crm-runo-push (Phase 4)
```

Principles:

1. **One identity.** The JWT subject is the JewelOS Auth user. CRM code resolves
   the acting historical CRM user through the identity bridge only.
2. **Database authorization stays the boundary.** The original CRM RLS policies
   and RPC checks are ported unchanged in meaning; JewelOS adds the section gate,
   `crm.view`, active-profile checks and audit rows. UI hiding is never security.
3. **Parity first.** The schema is the final cumulative state of the original
   Prisma migrations; the UI is a port of the original components. Behavioural
   differences are allowed only where the identity bridge or JewelOS hosting
   forces them, and each one is listed in this document.

## Database port (Phase 2, implemented locally)

| Migration | Content |
| --- | --- |
| `0179_crm_schema_tables.sql` | schema `crm`, 8 enums, 38 tables, 2 sequences, constraints, indexes |
| `0180_crm_identity_bridge.sql` | link columns, `crm_private`, identity resolver, re-implemented identity helpers, audit writer, link RPCs |
| `0181_crm_functions_triggers.sql` | 49 original functions and 27 triggers |
| `0182_crm_rls_grants.sql` | RLS on every table, 107 original policies, section gate, grants |
| `0183_crm_lookup_seed.sql` | the original lookup and lead-form seed statements |
| `0184_crm_storage_bucket.sql` | bucket `crm-legacy-documents` and the 4 original object policies |

Method. All original Prisma migrations `20260723000000` .. `20260803010000`
(including the uncommitted `20260803010000_lead_calling_foundation`) were replayed
in timestamp order into schema `crm` of a throwaway local database, with only
`"public".` rewritten to `"crm".`. The resulting final state was captured with
`pg_dump` and split into 0179/0181/0182; seed statements were copied verbatim.
A catalog diff (columns, defaults, constraints, indexes, enums, sequences,
function signatures/security/volatility/config, triggers, RLS, policies), a
function-body diff and a seed-data diff against the replayed original show only
the intended differences below.

Excluded from the port:

| Original object | Reason |
| --- | --- |
| `crm_access_grants`, `crm_sso_audit_logs`, `claim_jewelos_sso_access()` (20260820110000) | SSO artefacts; replaced by the identity bridge. |
| `GRANT USAGE ON SCHEMA auth TO authenticated` (phase 1) | JewelOS already grants it; a shared-schema grant is not a CRM concern. |
| `GRANT ALL ... TO service_role` on three lookups (20260727020000) | Grants go to `authenticated` only in this phase; Phase 4/5 add the minimal service-role grants they need. |
| The `crm_allocation` roster seed (20260727020000) | Joins `branches` by name; a no-op on the empty schema. Roster rows arrive with the data migration. |
| One-time data repairs (label case normalization, potential-category standardization, follow-up counter backfill, roster name normalization) | They rewrote existing rows. Their schema effects (triggers, indexes, functions) are ported; the data they produced arrives already repaired in Phase 5. |

## Identity bridge

- `crm.users` keeps its historical ids (every CRM history row references them)
  and gains `jewelos_profile_id` (nullable, unique, FK `public.user_profiles`,
  on delete set null). `crm.branches` gains `jewelos_branch_id` (nullable,
  unique, FK `public.branches`).
- `crm_private.current_crm_identity()` resolves the signed-in JewelOS user:
  1. `public.current_profile()` must exist, be active, hold `crm.view`, and the
     `crm` section must be available (`module_accessible('crm')`, so Developer
     Mode super admins keep access to a disabled section, as elsewhere);
  2. the CRM role is derived from the JewelOS effective role with the map from
     `sreejith-crm/web-app/lib/sso/access.ts`: `super_admin`, `admin` ->
     `super_admin`; `manager` -> `branch_manager`; `crm`, `staff` ->
     `salesperson`; any other role -> no access;
  3. an active `crm.users` row must be linked to the profile;
  4. for non-super-admins the CRM branch is the `crm.branches` row linked to the
     profile's JewelOS branch; without one there is no access.
  Anything else returns NULL, which every original policy and RPC already treats
  as "no access" (fail closed).
- `crm.current_crm_user_id()`, `crm.current_user_role()`,
  `crm.current_user_branch_id()` and `crm.get_my_profile()` keep their original
  names, signatures and return shapes and read that resolver.
- Server-side ingest only: when the verified JWT role is `service_role`, the
  resolver maps the JWT subject directly to an active `crm.users` id. This is
  what the original `submit_legacy_walkin_visit` relies on (it sets the subject
  to its synthetic ingest user). A browser JWT can never carry that role.
- Linking is explicit. `crm.link_jewelos_profile(crm_user_id, profile_id|null)`
  and `crm.link_jewelos_branch(crm_branch_id, jewelos_branch_id|null)` are
  restricted to active JewelOS `super_admin`/`admin` of the same tenant, audited
  in `public.audit_logs`, and the only write path to the link columns (column
  privileges). `crm.list_identity_links()` is their read side. Nothing links by
  name or email.

Behaviour that differs from the original (all forced by the bridge or hosting):

1. Who may enter and which CRM role/branch they have now come from JewelOS
   (role, dashboard authority, branch, `crm.view`, active state, section
   switch), not from `crm.users.role/branch_id/active` alone. `crm.users.active`
   still blocks access.
2. Every original `auth.uid()` that meant "the acting CRM user" (salesperson,
   uploader, editor, `created_by`, `entered_by`, `changed_by`, `tagged_by`,
   history `updated_by`) now reads `crm.current_crm_user_id()`. Stored values are
   the same kind of id as before.
3. The original UI uses `supabase.auth.getUser().id` as the CRM user id (users
   lookup by id, `leads.created_by`, `lead_call_history.entered_by`, the Runo
   route's owner check). The port must read `rpc("current_crm_user_id")`
   instead; this is the single mechanical UI adaptation the bridge requires.
4. Each mutating RPC also writes a `public.audit_logs` row (module `crm`, action
   `crm.<function>`) in the same transaction. Original history/edit-log triggers
   are unchanged.
5. Storage: bucket id `crm-legacy-documents` instead of `crm-documents` (the
   JewelOS id is taken); object paths and policies are unchanged, and the owner
   check stays on the Auth user. `file_size_limit` = 10 MB mirrors the original
   client-side cap.
6. Hardening without behaviour change: RLS enabled on `legacy_import_keys`
   (import-only ledger), no privileges for `anon`/`PUBLIC`, legacy-ingest RPCs
   owner-only until Phase 4, argument-free identity calls in policies wrapped in
   `(select ...)` so they run once per statement.

## Parity verification method

For every original route (`/`, `/dashboard`, `/queue`, `/visits/new`,
`/clients`, `/clients/new`, `/clients/[clientId]`, `/followups`, `/referrals`,
`/allocation`, `/leads/new`, plus the post-call inbox and dialogs):

1. One synthetic fixture (no customer data) is loaded with identical ids into
   (a) a local database with the original schema in `public` for the original
   app, and (b) the local JewelOS `crm` schema. The generator lives in
   `scripts/crm-parity/` and emits both variants from one source.
2. The original runs locally with `next dev` against (a) using a local-only env
   file created for the run (never copied from `sreejith-crm/.env*`); JewelOS web
   runs against (b).
3. Playwright visits each route in both apps as each CRM role (super_admin,
   branch_manager, salesperson), at desktop and phone widths, and records a
   full-page screenshot and a normalized DOM text/structure dump (visible text,
   labels, option lists, table headers, order).
4. Gate: DOM text dumps identical; screenshots within an agreed pixel threshold
   after masking dynamic values (dates, tokens, generated ids). Workflow checks
   (queue -> walk-in -> follow-up -> referral) must produce identical rows in both
   databases.

## Phases

1. Decision and design (this document) - done.
2. **Database port** - 0179-0184, pgTAP 0180/0181, `[api] schemas` includes
   `crm`, DB types include `crm`. Local only.
3. **Web UI port** - `packages/crm-ui`, rendered by `apps/web` at `/crm/*`
   (lazy route replacing `CRMPage` behind one reviewed switch), original CSS
   scoped under a CRM root, parity harness above.
4. **Edge functions** - `/api/ingest/walkin` (Apps Script walk-in bridge) and the
   Runo lead push as JewelOS Edge Functions with their original contracts,
   secrets in Edge Function configuration, service-role grants limited to the
   ingest RPCs.
5. **Data migration from the CRM Supabase** - read-only export, id-preserving
   import into `crm`, Storage copy to `crm-legacy-documents`, sequence reset,
   reconciliation report, owner-approved link preflight and links.
6. **Mobile** - CRM tab shows `/crm` in a WebView with a reviewed session
   handoff; APK release through `scripts/release-mobile.ps1`.
7. **Cutover and retirement** - menu/Home/notification links point to the port,
   the old JewelOS CRM UI retires in a separate change; old tables stay until a
   separately approved data-retirement plan.

The implementation plan with files, tests and gates is
`docs/superpowers/plans/2026-09-25-crm-native-integration.md`.

## Rollback

- Phase 2: the schema is additive and unused until Phase 3. Rolling back the
  code is enough; a forward migration can revoke `crm` grants if needed. Never
  drop `crm` after Phase 5 data exists.
- Phases 3/6: the `/crm` switch returns to the old JewelOS `CRMPage`; the mobile
  tab returns to the native CRM screens in a new APK (no `-Mandatory` without
  approval). The `crm` section maintenance switch blocks CRM data server-side
  immediately.
- Phase 4: point Apps Script back at the original deployment while it still
  exists.
- Phase 5: the original CRM Supabase remains the source of truth and stays
  read/write until cutover; an import is repeatable into an emptied `crm` schema
  before cutover only.
- No rollback deletes audit rows, CRM history or old JewelOS CRM data.

## Open questions

1. Hosted "Exposed schemas" must add `crm` (and never `crm_private`). Who applies
   it, and when (before Phase 3 preview)?
2. Which JewelOS roles get CRM access: `crm.view` defaults to `super_admin`,
   `admin`, `manager`, `crm`; the role map also admits `staff`, which therefore
   needs a `crm.view` grant (role or user override) to enter.
3. JewelOS users whose branch has no CRM branch (head office, multi-branch
   managers) have no CRM access as a non-super-admin. Confirm, or name the CRM
   branch they should work in.
4. Bucket MIME allowlist: the original bucket accepts any type; the UI accepts
   JPEG/PNG/WebP/HEIC/HEIF and MP4/WebM/MOV. Adding a server allowlist risks
   rejecting HEIC uploads that browsers send without a type. Keep unrestricted?
5. The uncommitted lead-calling work (`20260803010000`, Capacitor call monitor)
   is ported at schema level; its Android plugin cannot run in a WebView. Keep
   the tables idle until a native module is designed?
6. Direct table writes in the original UI (clients, availability, leads, lead
   call history, campaign tags, lookups) are RLS-authorized but not audited in
   `public.audit_logs`. Accept as original behaviour, or add audit triggers?
7. Does the Google Sheets worker from the 2026-08-21 design stop, or later feed
   `crm` instead of `public`?
8. After cutover, are Home "CRM Tasks", dashboard CRM metrics and CRM reports
   hidden, labelled legacy, or re-sourced from `crm`?

## Out of scope

Modifying or dropping `public` CRM tables; any hosted change, deploy or import;
porting the Capacitor call-monitor plugin; changing CRM behaviour beyond the
listed bridge differences.
