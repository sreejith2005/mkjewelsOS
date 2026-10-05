# CRM two-project completion plan (2026-10-05)

Design: `docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md`.
Work happens only in `C:\crm` (`feat/crm-native`). Nothing here is a hosted action; every
hosted step is in the production runbook (`docs/CRM_TWO_PROJECT_PRODUCTION_RUNBOOK.md`) and
is run by the owner.

Starting point: steps 1-3 (CRM-project baseline and upgrade migrations, login bridge,
`/crm` repointed) are committed (`2d2ea05`). `main` (FMS `0193`) is merged in, so the next
JewelOS migration was `0194`; main then took `0194` (FMS), so the CRM ones are `0195` and `0196`.

## 1. Roster sync (JewelOS -> CRM)

JewelOS Users is the only source of truth for who can use the CRM.

### JewelOS project (`supabase/migrations/0195_crm_staff_sync_outbox.sql`)

- Private schema `crm_sync`, no API grants.
- `crm_sync.outbox(id, event_type, aggregate_id, created_at, changed_at, claimed_at,
  attempts, next_attempt_at, delivered_at, dead_at, last_error)`.
  - At most one open event per aggregate (partial unique index). A new change to an
    aggregate with an open event only bumps `changed_at` (coalescing).
  - Delivery sends a **snapshot computed at claim time**, never stale payload. If the
    aggregate changed while the event was in flight, the event stays open and is sent again.
- Triggers enqueue `staff.access_changed` in the same transaction as the change, so every
  writer is covered (Users page RPCs, invite, delete, roster reconciliation, imports):
  - `user_profiles` insert/delete, and updates of name, login email, role, branch,
    account status, working status, login switch, designation, tenant;
  - `user_permission_overrides` and `user_access_profiles` of a profile;
  - `role_permissions` and `designation_permission_overrides` for `crm.view` (all affected
    profiles).
- `crm_sync.staff_snapshot(profile)`: id, name, login email, JewelOS role (dashboard
  authority applied, as `permission_effective_for` does), mapped CRM role (the existing map:
  super_admin/admin -> super_admin, manager -> branch_manager, crm/staff -> salesperson,
  other -> none), JewelOS branch, and `eligible` = active login + not resigned + active
  account + `crm.view` + a mapped role. The section switch is not part of it: the bridge
  checks it at every sign-in.
- Service-role-only RPCs for the worker: `crm_sync_claim_staff_events`,
  `crm_sync_finish_staff_event` (exponential backoff; dead after 10 attempts, audited),
  `crm_sync_staff_roster` (full snapshot for reconciliation).
- `crm_sync_health()` for super admin/admin: open, failing and dead counts, oldest open.

### CRM project (`supabase-crm/.../20261005000100_crm_staff_roster_sync.sql`)

- `branches.jewelos_branch_id` (unique, nullable): the owner-approved branch map.
- `crm_private.staff_links(jewelos_user_id, legacy_crm_user_id, approved_by, approved_at)`:
  the owner-approved link list for historical CRM users. Nothing else ever links a JewelOS
  user to an existing CRM user (not name, not email).
- `crm_allocation.crm_user_id` (nullable FK to `users`): roster rows picked from synced users.
- `crm_private.sync_inbox` (event id primary key: a redelivered event is applied once) and
  `crm_private.staff_sync_state` (last applied snapshot time per JewelOS user: an older
  snapshot never overwrites a newer one).
- `crm_apply_staff_snapshot(event_id, snapshot)` (service_role only, audited):
  - eligible: resolve the CRM user (link list, else the existing grant's user, else a new
    CRM user); map the branch; upsert `users` (name, email, role, branch, active) and the
    grant; carry renames and branch moves to the user's roster rows (and to today's and
    later availability rows). Fail closed (grant inactive) with a reason when the branch is
    unmapped or the email belongs to another, unlinked CRM user (`needs_link`).
  - not eligible or deleted: grant inactive, CRM user inactive, roster rows inactive.
    Nothing is deleted: CRM users hold history.
- `crm_reconcile_staff_roster(run_id, snapshots)`: applies every snapshot, deactivates any
  active grant whose JewelOS user is absent or ineligible, and records counts only in
  `crm_private.staff_sync_runs`.
- `users` writes are revoked from `authenticated` (JewelOS is the source of truth).
- `manage_crm_roster` gains `p_crm_user_id`: ADD/UPDATE must pick an active synced user of
  the target branch; the stored name is that user's name. DELETE is unchanged.

### Functions

- JewelOS `crm-staff-sync` (cron, `x-cron-secret` = `CRM_STAFF_SYNC_CRON_SECRET`): claims
  events, posts snapshots to the CRM project, finishes them; `{"mode":"reconcile"}` sends
  the full roster (daily cron).
- CRM `sync-receive` (`x-crm-sync-secret` = `CRM_SYNC_INBOUND_SECRET`, constant-time):
  validates and calls the RPCs. One shared secret per direction.

### UI

- Allocation screen: the CRM NAME box becomes a picker of the branch's synced users.

## 2. Live data (Apps Script -> CRM project)

- Port `crm-walkin-ingest` to `supabase-crm` (schema `public`), with the 0190 RPCs
  (`legacy_walkin_ingest_log_attempt`, `legacy_walkin_ingest_submit`).
- Idempotency (approved addition): a submission carrying the Sheet's `REFERENCE NUMBER`
  (`formDataObj.reference_number`) is applied once; a repeat answers
  `200 ALREADY_INGESTED` with the same ids.
- Apps Script: the live hook (`pushWalkinToCrm_`) and a resumable backfill function that
  replays `WALKIN DATASET` rows since 2026-08-17 through the same endpoint, logging counts
  only. Customer data never leaves Google/Supabase, so nothing lands on disk.
- Owner input needed: confirm the live script and headers match `FORM CODE.GS`
  (`getExpectedHeaders_`, `convertWalkinRowToFormData_`), and the branch names.

## 3. Identity features (CRM project)

- `search_clients`: `MKC-n` / `MKF-n` / `MKREF-n` codes match exactly and rank first; a
  code-shaped query is never a phone search.
- Optional phone: `clients.primary_phone` nullable; phone index and matching skip empty.
- Families: `households(household_code MKF-n)`, `clients.household_id`; audited
  membership RPC; walk-in "Accompanied by" links companions to the family.
- Referral codes: `clients.referral_code MKREF-n`, `referred_by_client_id`,
  `referral_relation`; derived columns view.
- Leads get an `MKC` client at first contact (lead -> client link created in the same
  transaction).
- Walk-in -> JewelOS task: CRM outbox events `walkin.registered` (queue entry) and
  `walkin.form_completed` (visit submitted); JewelOS receiver creates/closes the task
  through an audited service RPC; completion is derived from durable state.
- Sync health: JewelOS `crm_sync_health()` and CRM `crm_sync_health()`.

## 4. Browser QA

Isolated stacks only: a separate JewelOS test stack (synthetic users) plus `mkcrm`, the
web dev server pointed at both, and Playwright at desktop and phone width. Check Docker
memory first (7.6 GB). Fix defects found (owner approved fixes even where the original had
them), e.g. the duplicated Referrals heading.

## 5. Production runbook

`docs/CRM_TWO_PROJECT_PRODUCTION_RUNBOOK.md`: preflight counts, migrations, functions and
secrets, grants/branch map/link list, Vercel env, web deploy, smoke test (including the
hosted CORS header), rollback. `feat/crm-native` is merged into `main` only when the CRM
project is ready. Retiring the JewelOS `crm` schema is a later forward migration.

## Validation per step

pgTAP on `mkcrm` (`supabase.cmd test db --workdir supabase-crm`), pgTAP for JewelOS
migrations on an isolated JewelOS stack, Deno tests for every function, `@jewelos/crm-ui`
and `web` Vitest, typecheck, and rendered browser QA. Results are reported with local and
hosted evidence kept separate.
