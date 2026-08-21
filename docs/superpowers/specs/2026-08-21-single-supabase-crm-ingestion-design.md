# Single-Supabase CRM and Google Sheets Ingestion Design

## Status and decision

Approved architecture. This document supersedes the separate-Supabase direction in
`2026-08-20-crm-embedded-sso-design.md`. It does not delete, alter, or deploy to
either legacy Supabase project.

`jewelos-prod` is the sole eventual production database and application data
authority. A separate hosted JewelOS staging project is mandatory for worker and
database-contract verification. The existing `mkjewels-sync` codebase remains an
independent, server-side worker initially; only its database destination changes.

The existing Sreejith CRM Supabase and existing sync Supabase become read-only
migration/archive sources after their data and behaviour have been reconciled.
Google Sheets and approved external APIs remain the live source while the native
JewelOS CRM is brought to operational parity.

## Boundaries

```text
Google Sheets / approved external APIs
             |
             v
independent hosted sync worker (no browser credentials)
             |
             v
JewelOS staging, then jewelos-prod
  - immutable source records, checkpoints, locks, run summaries, exceptions
  - canonical people, contacts, relationships, and client projections
  - CRM clients, walk-ins, timeline, follow-ups, referrals, documents
  - branches, staff, roles, audit logs, web and future mobile application
```

The worker must never write business, raw-ingestion, checkpoint, or review tables
directly. It calls narrowly scoped database RPCs using a server-only worker
credential. The worker credential is not a `VITE_*` value, is not committed, and
is not available to the browser. Each RPC validates the source identity and its
payload, handles idempotency and branch/staff mapping, writes audit records, and
creates review records rather than guessing.

There is no permanent cross-project database connection, dual-write path, shared
database credential, or user-facing dependency on either legacy app. Any temporary
read-only export/preflight connection is operated outside the browser and is
removed after cutover.

## Authoritative source and source-to-target mapping

The exact source-header manifest is `mkjewels-sync/field-mapping-proposal.json`
(proposal v2) together with `table-mapping.json` and the source-structure report.
It is the implementation input; no source table, tab, header, sheet ID, or mapping
may be invented. The manifest currently defines the complete included/excluded tab
decision and the approved physical-header mapping. It contains no production
credential and must not be copied into client code.

| Source concept | Existing source contract | JewelOS target | Rule |
| --- | --- | --- | --- |
| Source row | `raw_sheet_rows`: source identity, row number, `row_data` | `crm_source_records` | Immutable row snapshot keyed by `(source_system_id, source_locator, source_row_key)`; retain source checksum and observed timestamp. |
| Checkpoint/lock | `tab_sync_state`, `sync-run.lock`, run summaries | `crm_sync_checkpoints`, `crm_sync_runs` | One active run per source scope; checkpoint advances only after all source-row RPC calls commit. |
| Raw row change | Source payload hash/version | `crm_source_records.source_checksum` | Same checksum returns a replay outcome; changed checksum creates a new source observation and schedules only affected canonical identities. |
| Canonical client | `clients`, normalized `primary_phone`, preserved manual fields | Existing JewelOS `clients` plus contact/relationship extensions | Do not infer an identity from name, surname, address, generic secondary phone, or shared phone. Primary marketing phone remains the source primary phone unless explicitly changed by the customer. |
| Contact points | Primary/secondary/billing/other phones and email history | Existing `client_contact_aliases`, with source/contact provenance extension | Normalize with the current approved Indian-number algorithm; shared or invalid contacts create review records, never an unsafe automatic merge. |
| Wide business details | `client_full_details` and `field_*` columns | `crm_client_source_details` with the approved `field_*` physical columns | Generate columns deterministically from the approved manifest, including collision-safe shortening. A `wide_details_hash` identifies convergence. |
| One-to-many history | `timeline_history`, `source_records`, provenance/history arrays | Existing `client_timeline` plus source-detail tables | Preserve append-only source events and provenance as structured history; do not flatten them into a client record. |
| Walk-ins and visit forms | Google Sheets/API source plus legacy CRM `client_timeline`/`visit_forms` | Existing `walkin_entries`, `client_timeline`, and legacy detail table | Import only after branch/staff mapping resolves; retain original payload and legacy external ID. |
| Follow-ups/referrals | Legacy CRM queues and source workflow data | Existing `client_followups` plus referral extension | Preserve lifecycle/history; unresolved client, branch, or staff references remain quarantined. |
| Branch/staff references | Sync labels and legacy CRM UUIDs | Existing `crm_branch_mappings`, `crm_staff_mappings`, `crm_legacy_people` | Stable external IDs are required. Display names are review aids only. |
| Invalid/ambiguous data | `invalid_phone_review`, mapping exceptions | Existing `crm_import_records`, `crm_import_exceptions`, plus `crm_identity_review` | Retain raw evidence and reason code; only an authorized administrator resolves or ignores it, with audit. |

The existing `crm_source_systems`, `crm_branch_mappings`, `crm_staff_mappings`,
`crm_import_runs`, `crm_import_records`, `crm_import_exceptions`,
`crm_legacy_people`, `crm_field_definitions`, and
`crm_legacy_timeline_details` contracts are retained and extended. New data model
work is additive and forward-only. It cannot replace or reinterpret an existing
historical CRM row.

## Ingestion RPC contract

The implementation exposes a versioned worker-only RPC family, owned by
Postgres. Execution is revoked from `public`, `anon`, and `authenticated`;
only the server-side `service_role` may invoke it.
The worker authenticates through a dedicated server-side mechanism approved for
the hosting environment; service-role credentials alone are not authorization.
The RPC verifies a worker identity/secret or signed request before reading the
payload and records an audit event for every accepted run and state change.

```sql
begin_crm_sync_run(
  p_source_key text,
  p_scope_key text,
  p_request_key uuid,
  p_worker_assertion jsonb
) returns jsonb

ingest_crm_source_batch(
  p_run_id uuid,
  p_source_key text,
  p_scope_key text,
  p_rows jsonb,
  p_request_key uuid,
  p_worker_assertion jsonb
) returns jsonb

finalize_crm_sync_run(
  p_run_id uuid,
  p_checkpoint jsonb,
  p_request_key uuid,
  p_worker_assertion jsonb
) returns jsonb

fail_crm_sync_run(
  p_run_id uuid,
  p_safe_error_code text,
  p_request_key uuid,
  p_worker_assertion jsonb
) returns jsonb
```

`p_rows` contains only the approved transport envelope: source locator, stable
row key, source timestamp/version where available, checksum, and JSON source
payload. Batches are limited to 500 rows. The worker logs only run IDs, counts,
durations, safe error codes, and source scopes; it never prints customer names,
phones, row payloads, credentials, or tokens.

`ingest_crm_source_batch` performs the entire atomic operation for each row:

1. verifies the active run, source, scope, caller, request idempotency, JSON
   shape, checksum, and stable source key;
2. stores the immutable source observation or returns a safe replay result;
3. normalizes dates and contacts under the current shared domain rules;
4. resolves only explicit source mappings, then creates a targeted exception for
   invalid phone, missing branch, duplicate contact, invalid date, missing
   reference, or unsupported value;
5. updates the canonical client/contact projection only where the mapping and
   identity rules permit it, preserving manual fields and provenance;
6. updates the physical `field_*` detail projection and wide-details hash;
7. appends source timeline/provenance rather than overwriting historical facts;
8. emits tenant-scoped audit rows containing IDs, counts, reason codes, and
   checksums but no raw customer payload.

Successful finalization updates the source checkpoint and run summary in the
same transaction. A failed or interrupted run leaves the prior checkpoint in
place; retrying the same row/batch is safe. A new run cannot start for the same
source scope while another active lock exists. Stale locks are expired only by a
privileged server-side recovery operation that is separately audited.

## Worker deployment and scheduling

The worker remains in `mkjewels-sync` for the first release. It uses its existing
incremental source reading, source-identity handling, canonical normalization,
and overlap lock behaviour, but replaces Supabase `.from(...).upsert()` business
writes with the RPC client above. Source reads, mapping artifacts, and unit tests
stay outside the JewelOS browser build.

The current interactive-machine Windows Task Scheduler job is not an acceptable
production scheduler. Deploy the worker to an always-on hosted job runner with:

- a staging configuration bound only to hosted JewelOS staging;
- a production configuration bound only to `jewelos-prod` after signed cutover;
- server-side secret management and least-privilege outbound network access;
- an explicit schedule, jitter/retry policy, single-scope concurrency lock, and
  timeout below the scheduler retry window;
- alerts for failed runs, stale checkpoints, exception growth, and missed
  schedule windows; and
- a health endpoint/report that exposes aggregate counts only.

The worker is deployed independently from the Vite web application. A web
deployment neither starts, stops, nor proves a sync run.

## Review, authorization, and retention rules

Administrative review is a JewelOS CRM feature. Only `super_admin` and `admin`
can view raw migration payloads, edit branch/staff mappings, resolve exceptions,
trigger reprocessing, or export reconciliation reports. Each action uses a
protected RPC and writes an audit record. Managers and CRM/staff users operate
only within the CRM scopes already enforced by JewelOS RLS; UI visibility is not
authorization.

Review-required cases include absent/invalid contact data, duplicate or shared
contact points, unknown source schema/header, unapproved header change, missing
or ambiguous branch/staff mapping, invalid date, unsupported controlled value,
or a source record that would overwrite a protected manual edit. Resolution must
choose a specific target, retain the source evidence, and record actor, reason,
and timestamp. Ignoring is allowed only with an explicit reason; it never
deletes the raw source observation.

Storage stays private. Legacy documents are migrated only after their client and
timeline relationships have passed reconciliation, with MIME/size/path checks,
signed URLs, and an audit record. Document bulk transfer is not part of initial
worker cutover.

## Staging validation and reconciliation criteria

No new ingestion code is exercised against production data before it passes a
hosted staging rehearsal using synthetic or masked data. The rehearsal must
demonstrate the following before production authorization:

1. unauthenticated/browser/ordinary-user/cross-tenant/cross-branch calls are
   denied; the approved worker succeeds only with a valid assertion;
2. duplicate run/batch/row requests return idempotent outcomes without duplicate
   raw rows, contacts, clients, timeline events, audit rows, or checkpoints;
3. malformed payloads, altered checksums, invalid contacts, unmapped branches,
   unsupported values, and interrupted runs create safe exceptions or preserve
   the previous checkpoint;
4. canonical phone normalization and manual-edit preservation match the existing
   sync implementation's test corpus;
5. source-to-target reconciliation reports compare per source scope and overall:
   raw rows read/accepted/replayed/quarantined, client/contact projections,
   wide-detail rows and hashes, timeline/follow-up/referral counts, exceptions
   by code, checkpoint position, and audit/run totals;
6. approved aggregate totals match the existing sync destination and the live
   Sheets source at the same captured checkpoint. Any mismatch must have an
   explicit approved reason, not a hidden tolerance; and
7. authorized admins review masked samples from every included source scope and
   verify native JewelOS CRM read behaviour, role denials, and audit records.

The legacy Sreejith CRM is reconciled separately. Its stable IDs map through the
JewelOS registry, never by display-name matching. Imported historical authors
remain `crm_legacy_people` records unless an administrator explicitly links a
current JewelOS user; no import creates an Auth account or access grant.

## Cutover, rollback, and retirement

1. Back up and document the old sync and CRM projects, then confirm restore
   ownership. Do not delete source data.
2. Record an approved release SHA, staging evidence, reconciliation baseline,
   destination project reference, worker version, schedule, alert owner, and
   rollback owner.
3. Apply only reviewed forward migrations to production after linked-target and
   dry-run verification. Deploy the worker in stopped/manual mode first.
4. Run a production-safe preflight that proves the destination schema, RPC
   grants, source mappings, secret/config presence, and no active legacy writer
   conflict—without ingesting customer data.
5. Pause the old scheduler, capture its final successful checkpoint, and start
   the new worker from that checkpoint or an explicitly reconciled overlapping
   window. Do not run both destinations as normal writers.
6. Monitor aggregate run results and review exceptions for the agreed window.
   Make JewelOS CRM the only application read path only after signed acceptance.
7. Retain both old projects read-only for the agreed retention period. Retire a
   project only after backup/restore evidence, final reconciliation, legal and
   operational retention approval, and explicit written deletion approval.

Rollback before acceptance means stop the new worker, preserve its run and raw
records, restore the old worker from its captured checkpoint, and route users
back to the last accepted CRM read path. Do not delete JewelOS records or roll
back migration history. Any production schema correction is a reviewed forward
migration. After acceptance, rollback is limited to a compatible web/worker
traffic rollback; canonical data remains in JewelOS.

## Out of scope

- Importing source data directly from a browser, frontend bundle, or client
  service-role key.
- Testing unreviewed ingestion logic against production customer data.
- Deleting or resetting either legacy project in this program.
- Blindly copying old CRM/sync tables or treating their snapshot as current truth.
- Combining the Next.js CRM application into JewelOS's Vite component tree.
- Moving worker source code into the JewelOS repository before the staged
  database destination cutover succeeds.
