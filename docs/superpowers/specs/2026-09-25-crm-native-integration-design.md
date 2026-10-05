> Partly superseded on 2026-10-01 by `2026-10-01-crm-two-project-client-database-design.md`.
> CRM data moves to the separate CRM Supabase project, and the JewelOS `crm` schema is
> retired. The ported UI, parity rules and authorization model in this document still
> apply.

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

Working location (owner decision, 2026-09-28): all CRM work happens only in the
dedicated Git worktree `C:\crm` on branch `feat/crm-native`. The main checkout
`C:\Users\MIS\Downloads\MKJewelOS` belongs to other sessions and is not used for
CRM work. The original CRM stays at
`C:\Users\MIS\Downloads\MKJewelOS\sreejith-crm\web-app` (git-ignored, not copied
into `C:\crm`); tooling reads it from `CRM_ORIGINAL_DIR`, which defaults to that
path.

Migration numbers (2026-09-28): the CRM migrations are `0182`-`0191`, after
main's `0181_office_leave_summary` (`0190` deterministic order and `0191`
provisioning come from the Phase 5 decisions below). They have never been
applied to a hosted database, so they may be renumbered again (by `git mv`,
keeping order) until Phase 7 applies them.

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
  schema crm          original CRM tables, enums, RPCs, triggers, RLS (0182-0187)
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
| `0183_crm_schema_tables.sql` | schema `crm`, 8 enums, 38 tables, 2 sequences, constraints, indexes |
| `0184_crm_identity_bridge.sql` | link columns, `crm_private`, identity resolver, re-implemented identity helpers, audit writer, link RPCs |
| `0185_crm_functions_triggers.sql` | 49 original functions and 27 triggers |
| `0186_crm_rls_grants.sql` | RLS on every table, 107 original policies, section gate, grants |
| `0187_crm_lookup_seed.sql` | the original lookup and lead-form seed statements |
| `0188_crm_storage_bucket.sql` | bucket `crm-legacy-documents` and the 4 original object policies |
| `0189_crm_direct_write_audit.sql` | audit rows for direct (non-RPC) writes (Phase 3) |
| `0190_crm_ingest_service_grants.sql` | service-role ingest RPCs (Phase 4) |
| `0191_crm_deterministic_order.sql` | D5 tie-breakers in `browse_clients`, `search_clients` and the follow-up trigger |
| `0192_crm_ensure_my_crm_user.sql` | D2 first-use provisioning RPC |

(Renumbered 2026-09-29: `main` took `0182_form_dependencies_fms_draft_safety.sql` before gate 0,
so this series shifted from `0182`-`0191` to `0183`-`0192`. Test file names below that mirror a
migration's OLD number are unchanged — see the note where each is cited.)

Method. All original Prisma migrations `20260723000000` .. `20260803010000`
(including the uncommitted `20260803010000_lead_calling_foundation`) were replayed
in timestamp order into schema `crm` of a throwaway local database, with only
`"public".` rewritten to `"crm".`. The resulting final state was captured with
`pg_dump` and split into 0182/0184/0185; seed statements were copied verbatim.
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

## Authorization model (owner decision, 2026-09-29)

Client reads are company-wide by original design, not a porting gap. The
original CRM's own foundation migration says so explicitly
(`sreejith-crm/web-app/prisma/migrations/20260723000000_phase_0_foundation/migration.sql`,
just above `active_staff_read_clients`):

> Clients and their complete history are globally readable by all active CRM
> staff. `last_branch_id` remains informational and is never used as an
> ownership boundary.

The Phase 7 dress rehearsal (P3, 2026-09-29) initially treated a salesperson
reading another branch's clients/timeline as a database-authorization defect
(`current_user_role() IS NOT NULL` with no branch predicate, seemingly
contradicting `AGENTS.md`'s "database is the authorization boundary" rule) and
stopped the rehearsal. **Owner decision, 2026-09-29: this is not a defect. The
port keeps the original's company-wide read exactly as designed and approved.**
It is required for cross-branch lookup of a returning client. CRM access now
also extends to the Sales and CRM departments (see the cutover checklist), so
more staff gain this company-wide read than under the original's narrower
roster, and the owner approved that with this decision.

**The contract, stated once:** for every `crm` table, **read** is either
company-wide for any active, correctly-provisioned CRM user (`crm.view`,
linked, active, section enabled — see the identity bridge above) regardless of
branch, or restricted further (branch-scoped or `super_admin`-only) exactly
where the original restricted it; **write** (insert/update/delete) follows the
original's branch/ownership rules unchanged — a salesperson or branch manager
writes only their own branch's or their own records, `super_admin` writes
anything. The database enforces both halves; the web app's own branch filter
on the client list is a usability convenience on top, never the boundary.
Nothing in the port is broader than the original — every read/write pair
below matches `sreejith-crm/web-app/prisma/migrations/**` unless a "New"
scope note says otherwise (the new note is always narrower, never broader).

Every table in schema `crm`, classified from `0186_crm_rls_grants.sql`
(policy names in backticks are the permissive policy that decides it; every
table also carries the restrictive `<table>_section_available` gate, omitted
below since it applies uniformly):

| Table | Read | Write |
| --- | --- | --- |
| `clients` | Company-wide (`active_staff_read_clients`) | Insert/update company-wide (`active_staff_insert_clients`, `active_staff_update_clients`); delete `super_admin` only |
| `client_timeline` | Company-wide (`active_staff_read_timeline`) | Branch-scoped (`branch_staff_insert/update/delete_own_timeline`) |
| `visit_forms` | Company-wide (`active_staff_read_visit_forms`) | Branch-scoped via the parent timeline row's branch |
| `client_phone_index` | Company-wide (`active_staff_read_phone_index`) | Company-wide insert/update/delete (`active_staff_insert/update/delete_phone_index`) |
| `client_edit_log` | Company-wide (`active_staff_read_client_edit_log`) | Trigger-owned only; no staff write policy |
| `client_campaign_tags` | Company-wide (`active_staff_read_campaign_tags`) | Insert by any active staff (`tagged_by` = self); update/delete by the tagger only, or `super_admin` |
| `documents` | Company-wide (`active_staff_read_documents`) | Insert by any active staff (`uploaded_by` = self, not branch-scoped, matches the original); update/delete by the uploader only, or `super_admin` |
| `referrals` | Company-wide (`active_staff_read_referrals`) | Branch-scoped (`branch_staff_insert/update/delete_origin_referrals`) |
| `referral_calling` | Company-wide (`active_staff_read_referral_calling`) | Branch-scoped via the parent referral's branch |
| `referral_calling_history` | Company-wide (`active_staff_read_referral_calling_history`) | Insert-only, branch-scoped via referral; immutable (no update/delete policy for staff) |
| `leads` | Company-wide (`active_staff_read_leads`) | Insert by any active staff (`created_by` = self, not branch-scoped, matches the original: leads aren't branch property); update by the creator or `super_admin`; delete `super_admin` only |
| `lead_call_history` | Company-wide (`active_staff_read_lead_call_history`) | Insert by any active staff (`entered_by` = self); update by the enterer or `super_admin` |
| `lead_stage_history` | Company-wide (`active_staff_read_lead_stage_history`) | Insert-only (`changed_by` = self); immutable, not even `super_admin` may update/delete |
| `not_bought_followups` | Company-wide (`active_staff_read_followups`) | Branch-scoped (`branch_staff_insert/update/delete_origin_followups`) |
| `not_bought_history` | Company-wide (`active_staff_read_followup_history`) | Insert-only, branch-scoped via the parent followup; no staff update/delete (immutable) |
| `campaigns` | Company-wide (`active_staff_read_campaigns`) | `super_admin` only |
| `branches` | Company-wide (`active_staff_read_branches`) | Branch manager limited to own branch (`branch_manager_own_branch`); `super_admin` full |
| `users` (CRM roster) | Company-wide (`active_staff_read_users`) | Branch manager limited to own branch (`branch_manager_own_users`); `super_admin` full; no salesperson write |
| `entry_queue` | Branch-scoped (`branch_staff_entry_queue`, salesperson and manager) | Same policy, `FOR ALL`: branch-scoped |
| `crm_allocation` | **Branch-scoped** (`branch_staff_read_own_allocations`) — narrower than the client tables above | Branch manager only, own branch (`branch_manager_write/update_own_allocations`); no staff delete; `super_admin` full |
| `crm_daily_availability` | **Branch-scoped** (`branch_staff_read_own_availability`) | Branch manager only, own branch, including delete (`branch_manager_write/update/delete_own_availability`); `super_admin` full |
| `lead_form_fields` | Company-wide (`active_staff_read_lead_fields`) | `super_admin` only (`super_admin_manage_lead_fields`) |
| `lead_form_field_options` | Company-wide (`active_staff_read_lead_field_options`) | `super_admin` only |
| `lookup_relations` | Company-wide | `super_admin` only (`super_admin_manage_lookup_relations`) |
| `lookup_source_of_leads` | Company-wide | `super_admin` only |
| `lookup_sugar_options` | Company-wide | `super_admin` only |
| `lookup_beverages`, `lookup_cities`, `lookup_communities`, `lookup_gifts`, `lookup_not_bought_reasons`, `lookup_pincodes`, `lookup_product_categories`, `lookup_snacks` | Company-wide | `super_admin` only (`super_admin_all`) |
| `legacy_walkin_ingest_attempts` | **`super_admin` only** (`super_admin_read_legacy_walkin_ingest_attempts`) | None for staff; written only by the service-role ingest path |
| `crm_queue_round_robin` | **No direct access** for any authenticated role (no policy, no grant); state is read/written only by `SECURITY DEFINER` functions (e.g. `assign_next_available_crm`) | Same: no direct access |
| `legacy_import_keys` | **No direct access**; import ledger, owner/service-role only (New hardening beyond the original, which had no RLS at all here — narrower, not broader) | Same |
| `legacy_walkin_ingest_rate_limits` | **No direct access**; written only by the service-role ingest path | Same |

`anon` and `PUBLIC` have zero privileges on schema `crm` (revoked in
`0186_crm_rls_grants.sql`); every policy is `TO authenticated`. A JewelOS user
without `crm.view`, not linked to an active `crm.users` row, inactive, or
whose branch has no linked CRM branch (non-`super_admin` only) resolves
`crm.current_user_role()` to `NULL` and every `active_staff_*`/`branch_staff_*`
policy denies them — see `crm_private.current_crm_identity()` in
`0184_crm_identity_bridge.sql`. This is unchanged by this decision; it governs
whether someone is a CRM user at all, not what a CRM user may read.

`supabase/tests/0183_crm_identity_bridge.test.sql` (test filename unchanged: it mirrored the
migration's number for reading convenience before the 2026-09-29 renumbering; renaming it to
`0184` would collide with the existing `0184_crm_original_behaviour.test.sql`, so its filename
stays `0183` even though the migration it covers is now `0184_crm_identity_bridge.sql`) already
asserted company-wide client reads (`'salesperson reads clients of every branch'`) before this
decision; `0193_crm_authorization_model.test.sql` (Phase 7) enumerates the
full table above.

## Owner decisions on the Phase 5 questions (2026-09-28)

| # | Decision |
| --- | --- |
| D1 | Storage: copy ALL source objects of `crm-documents` (22, not only the 9 that `crm.documents` references) to `crm-legacy-documents` at the same paths. Copied objects have no Storage owner; accepted (a CRM super_admin can still delete them). |
| D2 | Provisioning: `crm.ensure_my_crm_user()` (0191, below). Historical users are linked only through the owner-approved link list, which Phase 7 runs BEFORE go-live. |
| D3 | JewelOS decides roles. No special-casing for the CRM super_admin who is JewelOS staff; the owner changes that JewelOS role if needed. |
| D4 | Branches: CRM "Zaveri Bazaar" -> JewelOS "ZAVERI BAZAR". JewelOS "EXHIBITION" gets no CRM branch. |
| D5 | Deterministic order: a unique tie-breaker (the table's primary key, same direction) on every ORDER BY in the port that can tie (below). |
| D6 | `lead_call_history` is kept (empty). |
| D7 | The original SSO rows and tables are not imported. |
| D8 | The source rollup value is kept (the one client whose stored `last_branch_id` differs from a recomputation stays as stored). |

### Provisioning (D2)

`crm.ensure_my_crm_user()` is an audited `SECURITY DEFINER` RPC that the CRM root loader
(`crm-port/app-router.tsx`, `crm-port/provisioning.ts`) calls once per mount, before the layout
and page queries. When the caller has an active JewelOS profile, holds `crm.view`, the `crm`
section is available (the same checks and Developer Mode rule as `current_crm_identity`), the
JewelOS role maps to a CRM role, and (non-super roles) the JewelOS branch is linked to a CRM
branch, AND no `crm.users` row is linked to the profile yet, it creates one `crm.users` row
(name and email from the profile, the derived role, the mapped branch, active), links it, and
writes one `public.audit_logs` row (`crm.ensure_my_crm_user`), in one transaction under a
per-profile advisory lock. It returns `created`, `already_linked`, `not_eligible` or
`email_in_use`; the UI ignores the result.

It never matches or links existing CRM users: when a `crm.users` row already has the profile's
email (case-insensitive), nothing is created (`email_in_use`), so a historical user is never
duplicated or taken over. Every other case creates nothing. Access is decided only by the 0184
identity functions, which are unchanged and stay `STABLE`. An already-linked but inactive CRM
user is not re-activated. Tests: `supabase/tests/0191_crm_ensure_my_crm_user.test.sql` (test
filename unchanged, same reason as the identity-bridge test above: it mirrored `0191` before the
renumbering; the migration it covers is now `0192_crm_ensure_my_crm_user.sql`).

### Deterministic order (D5)

The original sorts by non-unique keys (`created_at`, `event_date`, `display_order`, ...), so
tied rows could come back in any order, and the dashboard's 1000-row paging
(`.range(offset, offset + 999)`) could skip or repeat a row between pages. The port adds the
table's primary key, in the direction of the last sort key, to every such ORDER BY: 11 UI
edits in 8 pages (marked `crm-port: deterministic order`) and 3 functions in 0190. Sorts that
cannot tie (unique lookup labels, `branches.name`, `crm_allocation.crm_name` within one
branch) are unchanged. The single list of edits is `scripts/crm-parity/deterministic-order.mjs`;
the parity harnesses apply the same edits to the ORIGINAL at run time only (a patched copy
of its sources in the harness workdir, and its local database), never to `sreejith-crm`.

## Mobile WebView (Phase 6)

The Android app's CRM tab shows the web `/crm` route (this port) in a
`react-native-webview`, full-screen with the CRM's own shell, already signed in. This is the
approved exception to the mobile playbook's "no WebView" rule; everything else stays native.
The old native CRM screens stay in the tree, unrouted, until Phase 7 retires them.

Configuration: `EXPO_PUBLIC_JEWELOS_WEB_ORIGIN` (build time; https in a release, http only
for a local debug stack). Without it the tab shows "CRM not configured".

Session handoff (the app remains the only session holder and refresher):

1. The WebView loads `<origin>/crm` with `JewelOSCrmEmbed/1` appended to its user agent. The
   page enters embedded mode only when that token AND the `window.ReactNativeWebView` bridge
   exist on a `/crm` path (`apps/web/src/embedded`). It never loads the JewelOS web shell,
   login or session-holding client.
2. The page's Supabase client uses supabase-js's `accessToken` option
   (`createJewelosAccessTokenClient`); supabase-js then builds no auth client at all, so the
   page cannot refresh, persist or hold a refresh token. `supabase.auth.getUser()` for the
   ported code is a GoTrue `/auth/v1/user` call with the current token (`CrmAuth` host override).
3. The page posts `ready`; the app answers with `{accessToken, expiresAt}` (never the refresh
   token) through `WebView.postMessage`, and pushes each token it refreshes itself
   (`TOKEN_REFRESHED`). A token within 60 s of expiry makes the page ask again (`expired`); a
   401 makes it ask with `unauthorized`, the app then refreshes its own session and answers,
   and the request is retried once. Without a token a request runs as anon and is denied.
4. Protocol, validation and the navigation allowlist are one module shared by both sides:
   `packages/core/src/crmEmbed.ts`.

Threats and mitigations:

| Threat | Mitigation |
| --- | --- |
| Token leaks through a URL, history, referrer, logs, storage or cookies | The token travels only through the bridge and is held in page memory; it is never written to storage or put in a URL or cookie; the app logs no payloads; the page has `persistSession: false` and no auth client. |
| Refresh-token theft through XSS in the CRM | The page never receives it. An XSS can at most use the current access token (short-lived, the signed-in user's own RLS-bound power) while the page is open. |
| A foreign page in the WebView obtains a token | Navigation is limited to `<origin>/crm` and below; everything else goes to the system browser or dialer, or is blocked (`javascript:`, `data:`, `file:`, `blob:`, `intent:`); `setSupportMultipleWindows={false}`. The app sends a token only while the loaded page is on the origin, and accepts messages only from frames on the origin (Android's WebMessageListener reports the sender's real origin). |
| Another window or frame feeds the page a forged token or `clear` | The page listens on `document` only and accepts only the synthetic, sourceless, originless event the native bridge dispatches; a cross-window `postMessage` goes to `window`, is trusted and carries its origin. Messages are schema-checked (version, size, JWT shape). A forged token is still verified by the server. |
| The page asks the app to do something dangerous | Page-to-app messages are limited to `ready`, `token-request`, `home`, `sign-out` and `cleared`; the app takes no URL or data from them. |
| The session survives sign-out or an account switch | On `SIGNED_OUT` or a different user the app tells the page to clear (it forgets the token, refuses new ones, wipes local/session storage and the Cache API, and confirms), clears the WebView cache, history and form data, and unmounts it (the WebView is keyed by user). Every new WebView is `incognito` (cookies removed, no HTTP cache), and the page wipes its storage again at boot. |
| A stale token after background/resume | The page checks expiry before use and retries on 401; the app refreshes on resume as before and pushes the new token. |
| A tampered build or a spoofed user agent in a browser | The user-agent token only selects the mode; without the native bridge there is no embedded mode, and without a token no access. Authorization stays in the database (RLS, `crm.view`, section gate, identity bridge). |
| Mixed content or downgrade | A release build accepts only an https origin; `mixedContentMode="never"`. |

Other behaviour: `tel:` links (the call button's non-Capacitor fallback) open the dialer; the
walk-in proof file input uses the WebView's file chooser (camera and gallery; `CAMERA` and
`READ_MEDIA_IMAGES` are already declared); the original has no signed-URL document viewer,
and any signed Storage URL is on the Supabase origin, so it opens in the system browser. The
Android back button walks WebView history, then leaves the tab. "← JewelOS" posts `home` and
the app switches to its Home tab. A load or 5xx failure shows a native "CRM unavailable"
screen with Retry. `textZoom=100` keeps the layout identical to the web at phone width.

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
2. **Database port** - 0182-0187, pgTAP 0183/0184, `[api] schemas` includes
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
   handoff ("Mobile WebView" above); the APK is released with the Phase 7 go-live
   through `scripts/release-mobile.ps1`, because it depends on the web `/crm` route and
   the `crm` schema being live.
7. **Cutover and retirement** - menu/Home/notification links point to the port,
   the old JewelOS CRM UI retires in a separate change; old tables stay until a
   separately approved data-retirement plan.

The implementation plan with files, tests and gates is
`docs/superpowers/plans/2026-09-25-crm-native-integration.md`.

## Rollback

- Phase 2: the schema is additive and unused until Phase 3. Rolling back the
  code is enough; a forward migration can revoke `crm` grants if needed. Never
  drop `crm` after Phase 5 data exists.
- Phases 3/6: the `crm` section maintenance switch blocks CRM data server-side
  immediately. The old JewelOS `CRMPage` and native CRM screens were deleted in the
  Phase 7 preparation; bringing them back means reverting the cutover merge on
  `main` (web) and a new APK (no `-Mandatory` without approval). See
  `docs/CRM_CUTOVER_CHECKLIST.md`.
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
   Resolved in Phase 3 by `0189_crm_direct_write_audit.sql`, which audits direct
   (non-RPC) writes to clients, crm_daily_availability, leads, lead_call_history and
   the lookup tables. It records entity, operation and changed column names, never
   values. Other RLS-writable tables (campaign tags, documents, entry_queue, ...)
   have no UI direct write and are not yet audited.
7. Does the Google Sheets worker from the 2026-08-21 design stop, or later feed
   `crm` instead of `public`?
8. After cutover, are Home "CRM Tasks", dashboard CRM metrics and CRM reports
   hidden, labelled legacy, or re-sourced from `crm`?

## Out of scope

Modifying or dropping `public` CRM tables; any hosted change, deploy or import;
porting the Capacitor call-monitor plugin; changing CRM behaviour beyond the
listed bridge differences.
