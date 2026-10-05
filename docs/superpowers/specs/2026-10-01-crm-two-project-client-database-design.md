# CRM as a separate client-database project, linked to JewelOS

## Status

Draft for owner approval (2026-10-01). This document records the owner's decision and
proposes the design. It does not authorize a hosted change, a migration apply, a deploy or
a data move by itself. Implementation starts only after the open questions at the end are
answered and the phases are approved.

It supersedes `2026-09-25-crm-native-integration-design.md` **for where CRM data lives and
how CRM users sign in**. These parts of that design still apply:
- the ported CRM screens in `packages/crm-ui`, served at `/crm`, and their parity rules;
- the authorization model: company-wide read, branch-scoped write;
- the mobile WebView approach.

## Owner decisions (2026-10-01)

1. Keep **two Supabase projects** and do not merge them.
   - The **CRM project** is the client database: clients, leads, families, referrals,
     timeline, visits, documents, follow-ups.
   - The **JewelOS project** holds all users and every other internal record: roster,
     roles, tasks, FMS, forms, leave, notifications, reports.
2. The two projects are linked by a **two-way sync**, and both must keep working on their own.
3. The CRM screens inside JewelOS read and write the **CRM project** (option A). The JewelOS
   project keeps no copy of CRM data.
4. Identifiers: clients `MKC-`, families `MKF-`, referrals `MKREF-`. All of them can be
   searched.
5. Every inquiry (Instagram, WhatsApp, website, Runo) gets an `MKC` record at first contact.
6. A client can exist without a phone number.
7. A person belongs to at most one family.
8. When two sources disagree on a field, the latest value wins, but store (walk-in) data
   takes priority over channel data.
9. Long-term goal: every FMS channel contributes to one master client database in the CRM
   project.

## Current reality (owner answers, 2026-10-01)

- Staff do **not** use the original CRM web app (Vercel). They record walk-ins in the Apps
  Script form, which writes to the Google Sheet "01 WALKIN DATA".
- That Apps Script does not send anything to the CRM Supabase project. The
  `crm-walkin-ingest` push in `docs/CRM_SHEETS_INGEST_CUTOVER.md` was never switched on.
- Consequence: the CRM project has **no live writer today**.
  - Its data is whatever was imported or entered earlier.
  - The Sheet is the current operational record.
- This makes option A safer: nobody is writing to the CRM project, so its schema can be
  baselined and changed without a freeze.
- It adds two pieces of work:
  1. walk-in capture moves to the CRM screens in JewelOS. This is required anyway for
     queue registration to create tasks.
  2. Sheet history since the last import is backfilled into the CRM project.
- Both projects are on a paid Supabase plan.
- Hosted check (owner, 2026-10-01):
  - **JewelOS production** latest migration is `0192`. So the JewelOS `crm` schema is
    **live in production**, and `/crm` there may already hold imported and new data.
  - **CRM project:** `crm_access_grants` is absent (Prisma migration `20260820110000` is
    not applied). It has 1,568 clients, and the newest `last_visit_date` is 2026-08-17.
    The CRM project is behind on both data and schema.
- Staff move walk-in capture to `/crm` once the CRM and FMS task work is done (phase 6).

### Consequence for the data move

The CRM project becomes the home, so its data has to be made complete before `/crm` is
repointed at it. The plan depends on what the JewelOS `crm` schema holds (counts are
requested in the preflight):

| JewelOS `crm` holds | Plan |
|---|---|
| Only the import of the CRM project (nothing created since) | Upgrade the CRM project schema. Repoint `/crm`. Retire the JewelOS copy. |
| Records created in JewelOS `/crm` after the import | Upgrade the CRM project schema, then run a one-time, id-preserving, repeatable copy of those records from JewelOS `crm` to the CRM project, with a count reconciliation. Then repoint and retire. |
| Nothing (schema applied, never imported) | Upgrade the CRM project schema. Repoint `/crm`. |

**Result (owner, 2026-10-01): the first row applies.**
- JewelOS `crm` has 1,568 clients and 12,970 import keys.
- Its newest visit (2026-08-17 07:22) and newest timeline row (2026-08-17 09:54) match the
  CRM project.
- No client data has been created in JewelOS `/crm` since the import.

Before the switch, the preflight still compares `entry_queue` (1,123 rows) and `leads` (5
rows) by count and newest `created_at` in both projects. Any row newer than the import is
copied.

**Queue and leads check (owner, 2026-10-01):** both projects have 1,123 queue rows and 5
leads, with identical newest timestamps (2026-08-14). **Nothing has to be copied** from
JewelOS `crm`.

**Baseline captured (2026-10-01).**
- File: `supabase-crm/supabase/migrations/20261001000000_crm_project_baseline.sql`.
- It is a schema-only dump of the CRM project's `public` schema: 40 tables, no data, no
  connection strings.
- Compared with the JewelOS port (0183-0192):
  - Missing in the CRM project: `lead_call_history` and `create_post_call_lead()`. These
    come from the original's unapplied lead-calling migration `20260803010000`.
  - Present only in the CRM project:
    - `_prisma_migrations`;
    - an already applied SSO link, `crm_sso_access_grants(jewelos_user_id,
      legacy_crm_user_id, crm_auth_user_id, work_email, active)` and
      `crm_sso_access_audit`;
    - `current_crm_user_id()`, which currently resolves the CRM user through an OIDC
      identity `sub`.
  - Port-only changes still to bring over: the direct-write audit (0189), the ingest grants
    (0190), the deterministic ordering (0191), and provisioning, which is now replaced by
    roster sync.
- **Login bridge on this schema.** The session exchange links the minted CRM auth user via
  `crm_sso_access_grants.crm_auth_user_id`. `current_crm_user_id()` gains a branch for
  `crm_auth_user_id = auth.uid()`. This is additive, and the OIDC branch is kept.
- **Local rebuild of the baseline: verified 2026-10-01.**
  - Command: `supabase.cmd db start --workdir supabase-crm`. This starts the database only,
    using about 90 MiB, alongside five existing stacks; none of them were stopped.
  - The baseline applied cleanly.
  - Object counts match the dump: 40 tables, 40 with RLS, 104 policies, 53 functions and
    27 triggers.

**Step 1 (CRM-project upgrade migrations): done locally, 2026-10-01.**

Migrations in `supabase-crm/supabase/migrations/`:

| Migration | Content |
|---|---|
| `...0100_crm_lead_call_history` | The original's unapplied lead-calling migration, without its Storage policy (reviewed in step 3). `anon` is revoked. |
| `...0200_crm_private_audit_log` | `crm_private.audit_logs`, `write_audit_log` (same signature as the port), direct-write audit triggers on 15 tables. |
| `...0300_crm_rpc_audit_and_deterministic_order` | The port's versions of 20 RPCs, converted back to `public`, with the identity swap reversed. |
| `...0400_crm_minimal_grants` | The port's exact grants. `anon` gets nothing; `service_role` is unchanged; default privileges are revoked. |
| `...0500_crm_identity_session_bridge` | `current_crm_user_id()` = active grant whose `crm_auth_user_id` = `legacy_crm_user_id` = `auth.uid()`, with an active CRM user. Grant checks are `NOT VALID`. |

Verification:
- **Function bodies** compared with the CRM baseline: 19 functions only gain audit calls
  or tie-breakers (no tokens removed), and the gate is replaced.
- **Compared with the port:** after mapping the port's identity helper to `auth.uid()`,
  the only remaining differences are the intended identity helpers (`current_crm_user_id`,
  `current_user_role`, `current_user_branch_id`, `get_my_profile`).
- **Permissions:** table grants and triggers match the port exactly. Column grants differ
  only by the port's JewelOS link columns. `anon` has 0 table privileges and 0 callable
  functions.
- **Tests:** `supabase-crm/supabase/tests/20261001_crm_project_upgrade.test.sql`, 36
  passing.
- **Lint:** `supabase.cmd db lint --local --workdir supabase-crm --level warning` reports
  only unused-variable warnings in the original `submit_walkin_visit` and
  `save_referral_followup` bodies. These are pre-existing and left for parity.

Still open:
- The baseline covers only the `public` schema. The CRM project's Storage bucket and
  policies (`crm-documents`), Auth settings and any event triggers (for example
  `rls_auto_enable`) are reviewed in step 3.
- The JewelOS section on/off switch (`*_section_available` policies in the port) has no
  CRM-project equivalent yet. It is planned with the roster sync.
- Preflight before applying anything hosted:
  - count CRM `users` without an `auth.users` row of the same id (the bridge creates
    missing ones);
  - count existing `crm_sso_access_grants` rows, and rows violating the new `NOT VALID`
    checks.

**Step 2 (login bridge): built and verified locally, 2026-10-01.**

Function: `supabase-crm/supabase/functions/crm-session-exchange/` (`worker.ts` logic,
`index.ts` wiring, `verify_jwt = false` in `supabase-crm/supabase/config.toml`).

How it works:
- **JewelOS decides access.** The bridge verifies the JewelOS token with JewelOS Auth
  (`/auth/v1/user`). It then asks JewelOS, as the caller, using existing RPCs that need no
  JewelOS change: `current_profile`, `current_profile_is_active`,
  `has_permission('crm.view')`, `module_accessible('crm', false)`. The last one is the CRM
  section switch, which closes the earlier open item about the switch for sign-in.
- **The CRM project finds the person.** `crm_sso_access_grants.jewelos_user_id` holds the
  **JewelOS `user_profiles.id`**.
- **The session.** The bridge creates a missing CRM auth user with id = `users.id`, links
  the grant, and opens a session through a server-side magic link that is never sent. It
  returns **only the access token**: no refresh token leaves the function, so revocation in
  JewelOS applies within one token lifetime (`jwt_expiry` 3600 s), even before roster sync.
- **Audit.** Every grant, denial and failure is audited in `crm_sso_access_audit`, without
  tokens or emails.
- **Browser origins.** A browser `Origin` must be in `CRM_BRIDGE_ALLOWED_ORIGINS`. Native
  callers send no `Origin`.

Verification:
- **Unit tests:** `deno test` passes 9/9; `deno check` and `deno lint` are clean.
- **End-to-end** (local `mkcrm` stack, with a scratch JewelOS stand-in that answers exactly
  the four JewelOS calls and rejects any other path or body): 18/19 pass. Covered:
  - the minted token passes the gate and RLS;
  - a missing auth user is created with the CRM user id;
  - the grant is linked;
  - each denial is refused (no `crm.view`, unprovisioned, invalid token, foreign origin);
  - a native caller without `Origin` is served;
  - after a grant is deactivated: an old-password session and an already minted token
    both see nothing, and the exchange is refused;
  - audit rows are clean.
- **The one failure:** the local Kong gateway overwrites `Access-Control-Allow-Origin`
  with `*`. This is not a security issue: disallowed origins are refused by the function,
  and the token is a header, not a cookie. Re-check the header on the hosted project in
  step 3.

Still open for production:
- set the three function secrets;
- decide whether to disable email/password sign-in on the CRM project. The bridge does not
  need it, and the gate already denies sign-ins without an active grant;
- add rate limiting per JewelOS user if abuse appears.

**Step 3 (repoint `/crm`): code done and verified locally at the data layer, 2026-10-01.**

What changed:
- **`packages/crm-ui/src/crm-port/crm-project.ts` (new).** The CRM-project client. It:
  - uses supabase-js `accessToken`, so there is no auth client and nothing is persisted;
  - gets its token from `crm-session-exchange` and reuses it until 60 s before expiry;
  - runs one exchange at a time;
  - re-exchanges when the JewelOS token changes;
  - caches a refusal for 30 s, only for 401/403. Server errors are retried on the next
    request;
  - retries a CRM-project 401 once with a fresh token.
- **`crm-port/runtime.ts`.** `crmSupabase()` sends `from`/`rpc`/`schema`/`storage` to the
  CRM project. `auth` stays the JewelOS session (layout sign-in check, `getCrmUser` email),
  and the CRM user id still comes from `current_crm_user_id()`. New: `crmProjectClient()`
  and `forgetCrmSession()`, which sign-out calls.
- **`CrmApp` props.** Adds `crmProject` (required) and `jewelosAccessToken` (embedded mode:
  the native token broker). `public-api.d.ts` and the compile-time guard are updated.
- **Web app.**
  - `apps/web/src/lib/crmProject.ts` reads `VITE_CRM_SUPABASE_URL` and
    `VITE_CRM_SUPABASE_ANON_KEY`.
  - `App.tsx` and `EmbeddedCrmRoot.tsx` pass them in.
  - `.env.example` and the Vite test environment are updated.
  - AGENTS.md allows the two variables.
- **Removed:**
  - the `ensure_my_crm_user` (D2) provisioning call and its module and test. In the CRM
    project, users are provisioned by grants and the bridge;
  - the bucket rename. `crm-legacy-documents` is back to the original `crm-documents`.
- **Runo push.** It now invokes `crm-runo-push` on the CRM project. The function is copied
  to `supabase-crm/supabase/functions/crm-runo-push`, reading schema `public` under the
  caller's CRM token. Its 9 Deno tests pass.
- **Mobile.** No native code change. The WebView loads the web `/crm`, and its token broker
  now also feeds the bridge.

Verification:
- **`@jewelos/crm-ui`:** typecheck clean; 81/81 tests, including 11 new token-source tests.
- **`web`:** typecheck clean; 371/371 tests.
- **Data-layer E2E** (scratch script running the real `crm-project.ts` against the local
  CRM stack, the real bridge and the JewelOS stand-in):
  - `get_my_profile`, `browse_clients`, `search_clients`, `current_crm_user_id` and the
    audited `create_client_with_phone` all succeed, with one exchange for all of them, and
    the audit row is written;
  - a user without `crm.view` gets no profile, and no JewelOS session gets no data.

Not yet proven:
- **Rendered screens in a browser** (the parity harness against two stacks). This needs a
  JewelOS stack with its API gateway; the shared one was partly stopped by another session.
- ~~Document upload and view~~. Done 2026-10-05:
  - The owner's read of the hosted storage policies shows three, identical to the port's
    0188 apart from the bucket id.
  - `20261001000600_crm_documents_storage.sql` records them idempotently: the bucket is
    created only if missing (fresh default private, 10 MB; hosted settings untouched), and
    each policy only if missing. It also adds the missing original
    `lead_call_recordings_active_staff_upload` policy.
  - pgTAP is now 46/46, including storage: upload at original paths only, as yourself;
    company-wide read; only the uploader or a super admin deletes; no grant means no access.
  - The Storage-API E2E with the CRM UI client and a bridge token passes 7/7: the walk-in
    form's upload, a signed-URL view and download, remove; a bad path is refused; a user
    without CRM access cannot upload or view.
  - The hosted bucket's own settings (size limit, MIME list) were not read; the owner's
    query output showed only the policies.
- **Hosted CORS header** (see step 2).

The local CRM-project stack is in `supabase-crm/supabase/` (project id `mkcrm`, ports
5542x).

In every case the Sheet backfill (phase 6) also covers 2026-08-17 to the switch date.

**Schema upgrade.** The baseline captured from the CRM project is brought forward to the
structure the ported UI expects, which is the `crm` schema of 0183-0192 minus the
JewelOS-specific bridge. This is done with new forward-only migrations in `supabase-crm/`.
The access grants come from those migrations, not from the unapplied Prisma one.

## Architecture

```text
            JewelOS web app (Vite)  /  Android app (WebView for /crm)
             |                                   |
   JewelOS session                      CRM session (from the login bridge below)
             v                                   v
+------------------------------+      +----------------------------------+
| JewelOS Supabase project     |      | CRM Supabase project             |
| users, roles, branches       |      | clients (MKC), households (MKF), |
| tasks, FMS, forms, leave     |      | referral codes (MKREF), leads,   |
| notifications, reports       |      | timeline, visits, documents      |
| sync_outbox / sync_inbox     |<---->| sync_outbox / sync_inbox         |
+------------------------------+      +----------------------------------+
            ^  Edge Functions deliver events both ways (server-to-server)  ^
```

### Ownership rule

Every record has exactly **one home project**. The other project never edits that record.
It receives events about it and keeps only the reference it needs, such as an `MKC` code
on a task.

"Two-way sync" therefore means that events flow in both directions. It does not mean the
same rows are edited in both places. This removes write conflicts by design.

| Record | Home | The other project keeps |
|---|---|---|
| Staff accounts, roles, branches, activation | JewelOS | CRM: an access grant per user (`crm_access_grants`) |
| Clients, leads, families, referral codes, timeline, visits, documents | CRM | JewelOS: `MKC` code and display name on related tasks and FMS instances |
| Tasks, FMS instances, form submissions | JewelOS | CRM: a timeline entry when a submission contributes client data |

## What changes from the current build

| Area | Today (2026-09-25 design) | Option A |
|---|---|---|
| CRM data | JewelOS project, schema `crm` (migrations 0183-0192) | CRM project, schema `public`, as the original CRM had it |
| CRM screens | `crmSupabase()` returns the JewelOS client scoped to `crm` | `crmSupabase()` returns a CRM-project client with a CRM session. It is the only seam, so the screens' queries need no changes (they were written against the CRM project's `public` schema). |
| Sign-in | JewelOS JWT plus the `crm.current_crm_user_id()` bridge (0184) | Login bridge to a CRM-project session, resolved through `crm_access_grants` (already in the original, migration `20260820110000`) |
| `crm-walkin-ingest`, `crm-runo-push` | JewelOS Edge Functions | CRM-project Edge Functions with the same contracts |
| Web configuration | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Also `VITE_CRM_SUPABASE_URL` and `VITE_CRM_SUPABASE_ANON_KEY`. Shipping the anon key is safe only because RLS is enforced. AGENTS.md must allow this explicitly. |
| JewelOS migrations 0183-0192 | Waiting for the cutover | No longer applied. If they are already applied in production, a forward migration revokes `crm` access, and the schema is kept until a separately approved retirement. The CRM data stays where it is today. |
| CRM data migration runbook | Copies the CRM project into JewelOS | Not needed |

## Login bridge

Requirements:
- the JewelOS login is the only login;
- no service key, JWT secret or database password ever reaches a browser or the APK;
- only an active, provisioned access grant can open the CRM;
- historical CRM `users.id` values are preserved.

**Chosen: server-side session exchange (mechanism 2).** It needs only the standard Auth
admin API and the JewelOS token check, so it does not depend on Auth features that vary
by plan or release.
- The exchange function verifies the caller by asking JewelOS Auth who the token belongs to
  (`/auth/v1/user`), so it holds no JewelOS signing secret.
- OIDC (mechanism 1) stays available as a later replacement if both projects support it.

The two mechanisms considered:

1. **OIDC, preferred if supported.**
   - JewelOS Auth acts as the identity provider and the CRM project is the relying party,
     with provider id `custom:jewelos`.
   - The original CRM already expects this: `claim_jewelos_sso_access()` links the
     identity to a grant on first sign-in.
2. **Server-side session exchange.**
   - A CRM-project Edge Function receives the caller's JewelOS access token and verifies
     it against the JewelOS project's published signing keys.
   - It finds the active grant for that JewelOS user and issues a session for the grant's
     CRM user through the Auth admin API, inside the function.
   - Every exchange is audited in `crm_sso_audit_logs`.

Either way:
- The CRM session is a separate Supabase client in the browser, using a storage key that
  does not collide with the JewelOS one.
- Signing out of JewelOS also clears the CRM session.
- The Android WebView receives the CRM session through the same reviewed handoff it uses
  today.

## Roster sync (JewelOS → CRM)

JewelOS is the source of truth for who may use the CRM. These JewelOS changes emit events:
- a user is created or activated;
- a user's role or branch changes;
- a user is deactivated.

A narrow service-role RPC in the CRM project applies each event to `crm_access_grants`. The
role mapping is the existing one: `super_admin`/`admin` are global; `manager`, `crm` and
`staff` are branch-scoped, with the `crm.view` rule. These rules apply:
- **Deactivation fails closed.** It removes CRM access as soon as it is delivered, and a
  daily reconciliation report lists any grant still active for an inactive JewelOS user.
- **No automatic retirement.** Grants are never created for, or taken over from, historical
  CRM users automatically. The owner-approved link list maps them, as the 2026-08-20
  design required.

## Sync mechanism

The same mechanism runs in both projects:

1. **Outbox.** A business transaction writes `sync_outbox(id, event_type, aggregate_id,
   payload, created_at, delivered_at, attempts, last_error)` in the same transaction as
   the change, so an event can never be lost or half-written.
2. **Delivery.** A delivery Edge Function, triggered by a database webhook with a cron
   sweep as a backstop, sends each event to the other project's `sync-receive` function.
   It authenticates with a server-only shared secret that is different for each direction.
3. **Receipt.** `sync-receive` validates the event and calls one narrowly granted,
   audited RPC per event type. It records the event id in `sync_inbox` first, so a
   redelivered event is applied exactly once.
4. **Failures.** Exponential backoff. After N attempts the event is marked dead, appears
   on an admin "sync health" view in JewelOS, and raises a notification. Nothing fails
   silently.
5. **Ordering.** Events are applied in order per `aggregate_id`. Across different
   aggregates no ordering is assumed.
6. **Privacy.** Payloads carry the minimum needed: codes, ids, a display name and field
   values only where a client field is being contributed. Logs never contain customer
   values.

### Event catalog (first version)

| Event | From → to | Effect |
|---|---|---|
| `staff.access_changed` | JewelOS → CRM | Upsert or deactivate the access grant |
| `walkin.registered` | CRM → JewelOS | Create the task "Complete walk-in form – {name} ({MKC})", assigned to the queue's salesperson. If not resolvable, assign it to the branch manager and flag it. |
| `walkin.form_completed` | CRM → JewelOS | Close that task (completion comes from durable state, as AGENTS.md requires) |
| `walkin.outcome` (bought / not bought / referral given) | CRM → JewelOS | Optionally start a configured FMS flow |
| `fms.client_contribution` | JewelOS → CRM | Find or create the client, add a timeline entry, merge fields (see "Client data merging") |

Risk: `entry_queue.assigned_crm_name` is a name, not a user id. Resolving it to a JewelOS
user goes through `crm_allocation`, then CRM `users`, then `crm_access_grants`. The
preflight must report every allocation name that does not resolve.

## Client identity

All of this lives in the CRM project.

- **`MKC-n`** already exists (`clients.client_code`, sequence, format check).
  - The header search (`search_clients`) must match it. Today only `browse_clients` does.
  - A code-shaped search must not be treated as a phone search.
  - An exact code match ranks first.
- **Leads get an `MKC` code at first contact.** Each lead either becomes a `clients` row
  with a lifecycle stage (`lead` → `engaged` → `visited` → `purchased`), or carries a
  `client_id` link. Which one is decided in phase 2, keeping the original lead screens
  working.
- **Optional phone.** `clients.primary_phone` becomes nullable.
  - The phone index and phone matching skip clients with no phone.
  - Duplicate detection for those clients uses name, family and referrer, and goes to
    review instead of auto-merging.
- **`MKF-n` families.**
  - A `households(id, household_code, created_at, created_by)` table, plus a nullable
    `clients.household_id`, so each client has at most one family.
  - The walk-in form gets an "Accompanied by" section. Each companion either links to an
    existing client or creates a new one, and joins the main client's family.
  - Membership changes are audited.
- **`MKREF-n` referral codes.**
  - Each client gets its own `referral_code` the first time they are recorded.
  - A referred client stores `referred_by_client_id` and `referral_relation`, chosen from
    `lookup_relations` or set to "Referral".
  - When a walk-in names referrals, each one is created as a client (stage `lead`) with
    its own `MKC` and `MKREF`. The existing `referrals` rows link to it, so the referral
    calling flow keeps working.
  - The owner's columns are derived, not stored twice:

    | Column | Main client row | Referred person row |
    |---|---|---|
    | Referral ID | own `MKREF` | the referrer's `MKREF` |
    | Referral person ID | none | own `MKREF` |
    | Relation | "Main client" (a role on the visit) | the relation, or "Referral" |

  - A referral chain ("who did C bring, and who did they bring") is a recursive query.
- **Search.** One search box recognises `MKC-`, `MKF-` and `MKREF-` prefixes, as well as
  name and phone. An `MKF` result lists the whole family.

## Client data merging

- Each contributed profile field records its value, `source` (store, Instagram, WhatsApp,
  website, Runo, manual), `contributed_at` and the contributing event.
- Rules:
  1. An empty value never overwrites a filled one.
  2. A store value can be replaced only by a newer store value or a manual edit.
  3. Otherwise the newest value wins.
- Every contribution also adds a timeline entry: channel, who, when and the form
  reference. "Latest interaction" is read from the timeline.
- Identity resolution order:
  1. exact `MKC` code;
  2. normalized phone (any known phone);
  3. Instagram handle or email;
  4. otherwise create a new client.

  Ambiguous matches go to a "possible duplicate" review queue that uses the existing
  merge safeguards. Nothing is auto-merged.

## Where CRM-project schema changes live

- The original CRM used Prisma migrations (41 in `sreejith-crm`, which stays read-only).
  From now on, CRM-project changes are Supabase SQL migrations in this repository, under
  `supabase-crm/` with its own `migrations/`, `tests/` (pgTAP) and `functions/`. They are
  forward-only, like `supabase/`.
- The first migration is a **baseline** of the CRM project's current schema, captured
  without data. It must be verified equal to the hosted schema before anything is
  applied on top.
- Generated types for the CRM project live in `packages/crm-ui`, as they do today.
- Prisma migrate is no longer run against the CRM project after the baseline.

## Phases

1. **Preflight (read-only, owner present for hosted reads).**
   - Hosted state of both projects: whether 0183-0192 are applied to JewelOS production,
     and whether `20260820110000` is applied in the CRM project.
   - CRM project row counts.
   - Date of the newest client and visit, compared with the Sheet, to size the backfill.
   - Staff link report.
   - Allocation-name resolution report.
2. **Docs and rules.** Update AGENTS.md (CRM section, the two allowed Vite variables,
   `supabase-crm/`), mark the 2026-09-25 design partly superseded, and add a two-project
   production playbook section.
3. **CRM-project baseline and login bridge.** `supabase-crm/` baseline, access grants,
   bridge, and `crmSupabase()` repointed. Local proof uses two local stacks.
4. **Roster sync.** Outbox, inbox, delivery and the `staff.access_changed` event.
5. **Identity features.** Search, `MKF`, `MKREF`, optional phone, lead codes, walk-in form
   changes (web and mobile WebView).
6. **Walk-in → task, and moving walk-in capture off the Sheet.**
   - The `walkin.*` events.
   - Backfill Sheet history into the CRM project. The import is repeatable, keyed by the
     Sheet row id, and reports counts only.
   - Staff switch from the Apps Script form to `/crm` queue and walk-in screens on an
     agreed date.
   - `crm-walkin-ingest` is used only as a temporary bridge if both are needed in parallel.
7. **FMS → client database.** The `fms.client_contribution` event and form-field → client-
   field mapping. This phase needs the owner's FMS sheets and the Runo sheet first.

   **Channel sheets as sources.** Runo writes call data to a Google Sheet. The existing
   `crm-runo-push` only sends CRM leads *to* Runo; nothing reads call results back. The
   Instagram, WhatsApp and website channels may also start in Sheets. Each such Sheet feeds
   the CRM project the same way:
   - **Delivery.** A small Apps Script on the Sheet posts new or changed rows to a
     CRM-project ingest function, `crm-channel-ingest`. It runs on a time trigger, with an
     on-change trigger where the sheet allows it.
   - **Authentication.** The ingest function is key-authenticated and rate-limited, with
     one key per source sheet, like `crm-walkin-ingest`.
   - **Idempotency.** Each row carries a stable source row id (for Runo, the Runo call id).
     The ingest is idempotent on (source, source row id), so a re-sent row is applied once.
   - **Effect.** The ingest applies the same identity resolution and merge rules as
     `fms.client_contribution`: find or create the client (`MKC`), add a timeline entry
     (type CALL for Runo), and merge fields at channel priority, below store.
   - **Failures.** Rejected rows are recorded with a reason, without customer values, and
     shown on the sync health view.
   - **Migration path.** A source can later move from its Sheet to a JewelOS FMS form
     without any change on the CRM side, because both paths produce the same contribution.
8. **Production rollout** per phase, through the production playbook. Each phase is
   reversible on its own.

## Rollback

- Repointing `crmSupabase()` is one reviewed switch. Before the CRM project is the live
  target, it can be reverted.
- Sync can be paused on either side (a flag checked by the delivery function). Events
  keep queuing in the outbox and drain when sync is re-enabled.
- No rollback deletes audit rows, CRM history, outbox history or old JewelOS CRM data.

## Open questions

Answered on 2026-10-01: the original web app is not in use, Apps Script does not reach the
CRM project, and both projects are on a paid plan. See "Current reality".

1. Are JewelOS migrations 0183-0192 applied in production? The owner runs a read-only check
   in the preflight. If they are not applied, they are never applied. If they are, a
   forward migration revokes access to `crm`.
2. Will staff record walk-ins in JewelOS `/crm` instead of the Apps Script form? Queue
   registration creating a task depends on this. On what date?
3. Lead lifecycle: should leads become `clients` rows with a stage, or stay in `leads` with
   a link? The recommendation is clients rows, decided in phase 2 against the lead screens.
4. ~~Runo: where does it send call data?~~ Answered 2026-10-01: to a Google Sheet. See
   "Channel sheets as sources" in phase 7.
