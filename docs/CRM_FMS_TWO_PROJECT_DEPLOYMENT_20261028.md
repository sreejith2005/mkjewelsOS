# Customer/FMS two-project deployment - 2026-10-28

This completes the earlier [JewelOS-only release](CRM_FMS_RELEASE_20261028.md).
The owner subsequently authorized the CRM deployment and checking both projects
together, superseding the earlier JewelOS-only target limit.

## Targets and deployment

- JewelOS: `jewelos-prod` / `yimafxhuwgfhvzczqqdd`.
- CRM: `walk-in_crm` / `fsydcsyqnddacjfoutfe`.
- Source was advanced to maintained main `11c83e0`, preserving the intervening
  performance, employee app, Forms and Dropdown releases.
- CRM backup verified: completed physical backup `2026-10-28T01:05:33.649Z`
  (06:35 IST). No restore was performed.
- Linked CRM ledger and dry run listed exactly
  `20261027000100_crm_fms_customer_events.sql` and
  `20261027000200_crm_customer_exports.sql`. Both applied successfully.
- CRM `sync-receive` was deployed. Final linked dry runs on both projects
  report no pending migrations.

The CLI emitted an optional pg-delta catalog-cache warning after CRM apply.
Migration results, resulting objects and the final dry run were independently
verified. No history repair or applied-migration edit was used.

## Preservation and authorization

CRM client/timeline/visit counts before and after are **1593 / 2186 / 1997**.
New customer receipts remain zero. New private customer tables have RLS enabled;
anon administration and direct authenticated ingestion are denied.
No identity merge, historical rewrite, backfill, business mapping approval or
live customer fixture was performed. No secrets were changed or printed.

## Linkage evidence

Verified without displaying credential values:

- JewelOS `CRM_SYNC_RECEIVE_URL` targets the CRM receiver endpoint.
- CRM `JEWELOS_SUPABASE_URL` targets JewelOS.
- Outbound/inbound shared-credential digests match.
- Required bridge, sender and report-worker secret names exist.
- A Vault-authenticated JewelOS customer-worker call returned HTTP 200 with
  zero claimed events and no timeout, verifying the Vault/worker credential.
- The deployed web entry and lazy CRM configuration asset reference the
  expected project references. The initial bounded scan did not reach the
  lazy CRM configuration; following its actual imports verified the CRM target.
- CRM login bridge OPTIONS from `https://mkjewels-os.vercel.app` returns 200
  with matching CORS origin. Missing-session POST returns 401.
- CRM receiver GET returns 405; uncredentialed POST returns 401.

Installed **crm-customer-sync-deliver**, once per minute, reusing the existing
`crm_staff_sync_cron_secret` Vault reference. Each invocation is bounded to two
batches of ten events and uses durable two-minute leases. The operational helper
[configure-crm-customer-delivery.sql](../scripts/ops/configure-crm-customer-delivery.sql)
checks the exact target/prerequisites, configures only that named job and records
an audit entry in the same transaction. It contains no secret value. Existing
staff/master/Sheet schedules are unchanged.

Scheduled cron execution succeeded. Subsequent worker responses were HTTP 200,
without timeouts; claimed/delivered/retry counts were zero. Technical delivery
is installed and running without creating a fabricated customer contribution.

## Validation and limits

Fresh receiver tests: **15 passed**. Fresh customer sender tests: **8 passed**.
Hosted checks validate schema, grants, targets, matching credentials, browser
origin and scheduled execution. The earlier isolated two-database end-to-end
and 155 database assertions remain the customer-flow evidence.

These checks do not establish an authenticated staff session, an approved live
customer contribution or a private export's complete upload/download/expiry
cycle. Form mappings and independent CRM approval remain the business boundary;
historical reconciliation requires explicit selection. No source mappings were
activated by this deployment.

Containment pauses only the new customer-delivery job and future mappings while
retaining immutable source/CRM evidence and audit history. Schema corrections
remain forward-only. This follow-up changes only this record, the earlier
record's link and the operational helper; no application/native code changed.
