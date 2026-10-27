# Customer integration implementation and release gates

2026-10-27. Owner-approved design: `architecture/CRM_FMS_INTEGRATION_DESIGN.md`.

## What changed

CRM remains the only customer master. JewelOS retains complete original submissions and FMS work. A non-deferred mapping pin and deferred capture triggers add immutable, versioned customer events to successful existing transactions. No runtime routing, assignment, completion or notification function is replaced. Failure to reach CRM never rolls back completed work.

The separate customer sender leases ten events at a time, registers immutable mapping descriptors, validates each acknowledgement and retries uncertain delivery with the same event identity. CRM independently approves the source and exact descriptor digest, resolves trusted actor/branch mappings, serializes identities, preserves immutable receipts, and applies mapped contributions once. Missing starter journeys retry; ambiguous identity, invalid attribution or unapproved mappings remain reviewable. Rejection preserves evidence. Accepted attribution cannot be silently edited or retargeted.

Country-aware existing phone helpers remain authoritative. Exact IDs, established journeys, verified scoped external identities and unambiguous phone/accepted phone aliases resolve customers. Shared family phones do not merge identities. External handles are not automatically verified. Original names/phones and source answers remain evidence. New no-phone enquiries receive normal MKC identities, without fabricated visits or purchases.

Profile projections are incremental and ordered by original business instant plus event identity. Empty/hidden/unsubmitted/operational answers do not become customer answers. Native cumulative store/explicit profile evidence keeps precedence. Source contributions fill supported empty profile fields and retain all other mapped information in readable history. Confirmed customer contact requires exact reviewed option values and an actual contact kind/channel; an assignment or failed attempt is not a completed contact or provider delivery.

Commercial classification extends the existing browse cache and filter without changing lifecycle or rollups. It reuses `walkin_purchase_evidence` and saved outcome vocabulary, including mixed repair/purchase outcomes. Verified purchase dates come from original timeline instants. Repair alone remains separately classified.

## Files and ownership

| Location | Responsibility |
| --- | --- |
| Root `supabase/migrations/0350_customer_form_events.sql` | Versioned mappings, transactional capture, leases, opaque links, health, retry and historical reconciliation |
| Root `0351_customer_private_exports.sql` | Immutable export layouts and adapters into existing export jobs/private retention |
| Root `supabase/functions/crm-customer-sync/` | Dedicated immutable-event sender using existing server secret names |
| Root `process-report-exports/` | Existing worker extended for customer adapters, safe text/phone/JSON and India business timestamps |
| Root `packages/core/src/forms/customerIntegration*` | Shared mapping validation, snapshots, public RPC/table types |
| Root `packages/core/src/reports/customerExports.ts` | Eight export names, stable headers and cell presentation |
| Root Forms, FMS runner, Settings, Reports components | Optional mapping, authorized profile link, bounded diagnostics/retry and reusable Sheet layouts |
| `C:/crm/supabase-crm/.../20261027000100_crm_fms_customer_events.sql` | CRM receipts, actor authorization, identity review, immutable history, projection, commercial cache and reconciliation preview |
| `C:/crm/.../20261027000200_crm_customer_exports.sql` | Independently authorized bounded CRM export adapter |
| `C:/crm/.../functions/sync-receive/customer.ts` | Existing authenticated receiver extended; staff/master paths retained |
| `C:/crm/packages/crm-ui/` | Readable journeys/answers, review/candidate picker, commercial classification/filter and narrow generated type extensions |
| Root `scripts/crm-fms-reconcile.ts` | Explicit-selection dry-run/apply CLI, maximum 200 sources and reviewed fingerprint |
| Root `scripts/validate-crm-fms-integration.ts` | Real persisted two-local-database synthetic test; no hosted connection |

Restored 0347-0349 are exact same-repository applied migration blobs. They are not new migration actions. Existing dirty Forms 2.0 and CRM changes are preserved. The CRM worktree is older than the maintained release baseline: reconcile **named changed paths and additive theme rules** when preparing a release. The missing maintained document/wide host and full theme were restored from this checkout during regression validation, with customer-specific rules appended. Never publish the divergent CRM migration directory wholesale.

Two minimal pre-existing CRM failures were repaired because they blocked the required regression gate: import the existing phone formatter for returning-client prefill, and use PromiseLike's rejection callback for optional dashboard health. No intended behavior was redesigned.

## Exports and Sheets

Reports → **Customer & Stage Exports** queues Master Customer Database, Leads / Enquiries, FMS Stage History, Form Answers by Stage, Customer Activity Timeline, Follow-ups, Purchase / Repair History and Synchronization Exceptions. Downloads remain in **Your exports**, using the existing private bucket, cancellation/retry/download authorization, expiry and cleanup lifecycle.

Customer data is read from CRM by a server adapter only after checking the persisted requester is still active and has JewelOS `reports.export` and CRM access, plus an independent active CRM super-admin grant and source membership. Root permissions never grant CRM export authority. Full original stage answers instead recheck the source requester's current `can_read_fms_work_context` for every visit. Being able to read a CRM customer does not authorize its restricted FMS answers. Exceptions additionally require integration administration.

Filters include dates, workflow/stage, employee, channel and status as applicable; RPC adapters also accept exact client/branch/instance scope. A saved stage layout pins its configuration/version in the export job and selects stable question keys/header order. Submission IDs, workflow/visit IDs, original template snapshots and source instants remain traceable. Phones are text; arbitrary text is formula-neutralized; nested answers remain JSON text; display instants use Asia/Kolkata while source UTC remains unchanged. Mutable CRM master exports are a live bounded read at worker time, not a historical database snapshot. Original form/event evidence remains immutable.

No Sheet tab, ingestion contract, Apps Script feed, cron setting, source-of-truth policy or `two_way=false` switch is changed. CRM **Preview reconciliation** compares retained source answers with current imported CRM values and classifies new/matched/missing/incomplete/possible-duplicate source events. Conflicting values remain separate evidence; preview performs no merge or overwrite. Do not infer that a mismatch means either source should be replaced.

## Safe historical reconciliation

1. Select original source submission UUIDs deliberately, excluding synthetic/demo sources unless intentionally requested. Select a reviewed mapping for the exact historical form/version.
2. Put `{ "mappingId": "...", "submissionIds": ["..."] }` in a local private manifest. Do not commit it.
3. Set `JEWELOS_URL`, `JEWELOS_ANON_KEY` and a signed-in integration administrator's `JEWELOS_ACCESS_TOKEN` through the environment. Never use a service-role token in this tool.
4. Run `deno run --allow-env=JEWELOS_URL,JEWELOS_ANON_KEY,JEWELOS_ACCESS_TOKEN --allow-read --allow-net scripts/crm-fms-reconcile.ts manifest.json`. Default is dry run. Output contains counts and source fingerprint only.
5. Review eligible/existing/invalid counts, historical mapping semantics and source fingerprint. A dry run does not enqueue or deliver customer events.
6. Only after explicit owner authorization for that backfill, place the returned `sourceDigest` in `expectedDigest` and rerun with `--apply`. SQL locks the sources and refuses changed fingerprints. Restarting uses original source IDs; already emitted sources are counted, not duplicated.
7. Deliver approved events, inspect CRM identity/reconciliation review, then retry selected source events after decisions. Historical actors/times remain original. Unknown attribution stays pending; no current-date contact or purchase is invented.

## Production sequence — not executed

Follow `PRODUCTION_SWITCH_PLAYBOOK.md` and `CRM_TWO_PROJECT_PRODUCTION_RUNBOOK.md` in front of the owner. This implementation does not authorize hosted writes, deployment, secret changes, production backfill, Sheet writes or cleanup.

1. Reconcile named implementation paths against each maintained checkout and inspect dirty/staged changes. Confirm both linked project references and migration ledgers. Dry-run both database pushes; do not apply unrelated divergent CRM migrations. Clear the pre-existing 0345 full-chain Forms guard before claiming a full migration replay.
2. Apply the two CRM migrations first; deploy the backwards-compatible existing `sync-receive` receiver. New sources/mappings remain unapproved by default.
3. Apply JewelOS 0350/0351 only after ledger checks. Regenerate/verify public types. Deploy web and the existing report worker, then `crm-customer-sync`. Web/shared changes need no APK under the current Android shell contract.
4. Verify existing server-only secret names in the approved secret store: customer sender reuses `CRM_STAFF_SYNC_CRON_SECRET`, `CRM_SYNC_RECEIVE_URL`, `CRM_SYNC_OUTBOUND_SECRET`; CRM receiver uses `CRM_SYNC_INBOUND_SECRET`; report worker retains its existing scheduler secret. Never expose or echo values.
5. Create/verify a bounded schedule for the new customer worker using the existing approved scheduler/Vault pattern. This migration installs no production cron or secret. Existing staff, master and Sheet schedules remain unchanged.
6. Test a synthetic reviewed form with no production customer details. Approve its exact source/mapping in CRM, enable only the reviewed source form, verify delivery, source/CRM counts, true contact evidence, opaque links and private export expiry. Test denied accounts/direct RPCs as well as successful paths.
7. Review the saved production forms in `architecture/CRM_FMS_FIELD_MAPPING_REVIEW.md`. Never interpret tokens globally: negotiation `not_interested` is **DECISION PENDING**. Approve exact versions separately. Production historical apply is a separate named gate.

## Rollback and evidence boundaries

Pause the new customer schedule and disable future source mappings to stop new capture/delivery. Keep immutable events, receipts, identities, mappings, original submissions, histories and audit rows. Do not delete source evidence to undo a projection. Accepted-attribution correction/retargeting is deliberately unavailable pending its own tested audited design. Old FMS work remains actionable; optional customer-link metadata fails open for authorized work.

No production migration, function/web deployment, cron/secret change, customer-data backfill, Sheet write, Git publication or physical Android verification has been performed. Local schema-only copies omit the platform cron extension/ACLs and do not prove hosted cron/Storage/provider execution. Rendered component QA uses synthetic RPC fixtures; persisted E2E uses real isolated databases. These are separate evidence levels.
