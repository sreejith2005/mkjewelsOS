# Customer integration implementation and release gates

2026-10-27. Owner-approved design: `architecture/CRM_FMS_INTEGRATION_DESIGN.md`.

## What changed

CRM remains the only customer master. JewelOS retains complete original submissions and FMS work. A non-deferred mapping pin and deferred capture triggers add immutable, versioned customer events to successful existing transactions. No runtime routing, assignment, completion or notification function is replaced. Failure to reach CRM never rolls back completed work.

The separate customer sender leases ten events at a time, registers immutable mapping descriptors, validates each acknowledgement and retries uncertain delivery with the same event identity. CRM independently approves the source and exact descriptor digest, resolves trusted actor/branch mappings, serializes identities, preserves immutable receipts, and applies mapped contributions once. Missing starter journeys retry; ambiguous identity, invalid attribution or unapproved mappings remain reviewable. Rejection preserves evidence. Accepted attribution cannot be silently edited or retargeted.

Country-aware existing phone helpers remain authoritative. Exact IDs, established journeys, verified scoped external identities and unambiguous phone/accepted phone aliases resolve customers. Shared family phones do not merge identities. Review and ingestion lock the same journey key, and recheck an established parent/journey link before attaching or creating a distinct customer. Stale reviews cannot move already accepted work. External handles are not automatically verified. Original names/phones and source answers remain evidence. New no-phone enquiries receive normal MKC identities, without fabricated visits or purchases.

A changed live form definition pauses new customer capture until its mapping is reviewed and saved again; Settings shows **Review form changes**. Original submissions remain intact for explicit historical recovery. This prevents changed option meanings from silently reusing an old contact approval.

Profile projections are incremental and ordered by original business instant plus event identity. Empty/hidden/unsubmitted/operational answers do not become customer answers. Native cumulative store/explicit profile evidence keeps precedence through one effective profile composer used by profile reads, bounded master export pages and the city browse cache. Native source changes invalidate affected indexed shared-phone profiles. Source contributions fill supported empty profile fields and retain all other mapped information in readable history. Confirmed customer contact requires exact reviewed option values and an actual contact kind/channel; an assignment or failed attempt is not a completed contact or provider delivery.

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

Filters include dates, workflow/stage, employee, channel and status as applicable; RPC adapters also accept exact client/branch/instance scope. Empty reports retain the same reviewed headers and order. A saved stage layout pins its configuration/version in the export job and selects stable question keys/header order. Submission IDs, workflow/visit IDs, original template snapshots and source instants remain traceable. Phones are text; arbitrary text is formula-neutralized; nested answers remain JSON text; display instants use Asia/Kolkata while source UTC remains unchanged. Mutable CRM master exports are a live bounded read at worker time, not a historical database snapshot. Original form/event evidence remains immutable.

No Sheet tab, ingestion contract, Apps Script feed, cron setting, source-of-truth policy or `two_way=false` switch is changed. CRM **Preview reconciliation** compares retained source answers with current imported CRM values and classifies new/matched/missing/incomplete/possible-duplicate source events. Conflicting values remain separate evidence; preview performs no merge or overwrite. Do not infer that a mismatch means either source should be replaced.

## Safe historical reconciliation

1. Select original source submission UUIDs deliberately, excluding synthetic/demo sources unless intentionally requested. Create an explicitly reviewed historical mapping with `save_historical_customer_mapping(p_submission_id, p_config)` as an active integration administrator and form author. The server reads the immutable stored snapshot, derives original labels/options, and pins its digest; the client cannot supply a replacement snapshot. This mapping never becomes the live mapping for new submissions. Reuse it only for submissions with the identical original snapshot. A live mapping with the same form ID/version but a different definition is invalid for backfill.
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

## Final local validation ? 2026-10-28

- Fresh schema-baseline application of exact maintained JewelOS 0347?0349 plus final 0350/0351, and both final CRM migrations: passed in new empty `crm_fms_release_20261028` databases. This is not a full chain reset and does not clear the pre-existing 0345 replay guard.
- Focused pgTAP: **155/155** assertions across customer form capture (34), FMS/work/export integration (32), repeated customer-stage visits (11), and CRM ingestion/profile/review/export cases (78).
- Maintained pgTAP regression: **420/420** assertions across thirteen suites: 0212, 0240, 0249, 0258, 0264, 0318, 0113, 0142; CRM cumulative profiles, lead continuity, walk-in persistence, phone-country handling and universal search.
- Actual sender/receiver handlers against two isolated SQL databases: **passed**. Three original submissions produced five delivered source/CRM events, one customer, one confirmed contact, one opaque workflow link, budget 120000, zero fabricated purchases and zero operational-answer leaks. Concurrent review versus first acceptance produced one journey, zero wrong-client events and zero wrong-client aliases. Each invocation's temporary databases were removed afterward.
- Deno: sender/reconciliation **10/10**, receiver **15/15**, report worker **10/10**. The empty saved-layout report preserves the configured headers and order.
- Full application suites: core **1292/1292**, web **691/691**, separate CRM worktree **211/211**. CRM typecheck passed. Final monorepo command `pnpm.cmd exec turbo run typecheck build --force --concurrency=1`: **12/12 tasks passed**. Build warnings about bundle size and the CRM task's absent output directory remain non-failing build-tool notices.
- Rendered actual components/styles: **390px and 1440px**, no page/console errors or horizontal overflow, one queued export, readable original DECISION PENDING label, nested zero/false values, and Review form changes notice. Synthetic RPC fixtures are confined to the temporary QA harness outside the repository. This does not prove authenticated full-app or physical Android behavior.

See [the twenty-scenario evidence matrix](CRM_FMS_INTEGRATION_TEST_REPORT.md). The maintained SQL test files and `scripts/validate-crm-fms-integration.ts` are executable evidence. Task-only replay helpers and complete logs remain under `.superpowers/sdd/2026-10-27-crm-fms-integration/` for review; do not publish that scratch directory.

Final review findings were fixed in one author pass with failing-then-passing regression tests; no minor findings were deferred. The reviewer did not independently execute the tests. No merge, commit, push, hosted apply/deploy, secret/schedule change, production backfill or Sheet write was performed. Both prescribed feature checkouts retain unrelated work.

## Implementation decisions and review boundaries

- Execute inline in prescribed feature checkouts; preserve dirty work and do not add another approval checkpoint after approved design. No commit until named integration paths and existing changes can be reviewed independently.
- Local cron extension cannot install into secondary DB; schema-only test copies omit the platform cron extension/ACLs. No original database reset; no customer data copied. Older scratch restores v1-v3 failed on stale baselines/platform ACLs; current validation source schemas restored cleanly into task-specific DBs.
- CRM regression suite reproduced the pre-existing missing formatPhone import in returning-client prefill, and typecheck reproduced PromiseLike.catch in dashboard health. Apply the two minimal compatibility repairs to clear required regression gates without changing intended behavior. Cost if wrong: prefill or optional health UI regression; existing tests and typecheck will verify.
- C:/crm regression tests referenced absent maintained wide.css and responsive document exports. Restore only document.tsx and missing wide.css byte-for-byte from the authoritative current checkout; prepend the maintained full JewelOS theme to the new component-specific additions. Preserve dirty mobile CSS/table helpers. This restores released host behavior rather than inventing a theme; cost if wrong is a responsive host integration regression, checked by existing CRM layout tests and rendered QA.
- hosted deployment, migration, secrets, scheduling, provider and authenticated production checks remain outside this local implementation pass; no hosted action occurred. Cost if wrong: production behavior remains unproven until owner release gates.
- full-chain platform cron and private Storage upload/download/expiry/cancel are not proven by schema-only local copies. Keep separate platform gates. Cost if wrong: platform integration failure.
- reported tests are author-run evidence, not independently executed by reviewer; retain exact logs. Cost if wrong: overlooked test-environment limitation.
- production-scale latency/concurrency not benchmarked; bounded pages, leases and adversarial synthetic concurrency are local evidence only. Cost if wrong: load-related delays.
- rendered component QA does not prove authenticated whole-app or physical Android behavior. Cost if wrong: integration or device-specific UX issues.
- unrelated preexisting dirty Forms/CRM work remains excluded from integration scope. Cost if wrong: concurrent-change interaction needs release review.
- attribution correction, automatic backfill, two-way Sheets and provider delivery remain disabled by design. Cost if wrong: manual operator work is required.
- real historical data and mapping approval require business review; default disabled. Cost if wrong: incorrect business interpretation; immutable original evidence retained.
- task-specific schema copies restore original object ownership; six locally patched CRM cumulative-profile functions are normalized to the declared migration role postgres only in the empty validation copy. Their active-caller checks and bodies remain unchanged before applying this feature. Original local databases and hosted ownership are untouched; verify hosted function ownership in release preflight. Cost if wrong: hosted migration ownership may require an explicitly reviewed owner repair.
- extract the existing section walk into one snapshot-parameterized helper and have the live function delegate to it, preserving its algorithm rather than maintaining a second walk. Cost if wrong: section-routing regression; existing section/branching suites remain required.
- do not reuse live mappings across changed form interpretation. Pause new customer capture, retain original submissions for explicit historical recovery, and show Review form changes in Settings. Cost if wrong: delivery waits for renewed business review rather than risking a false contact or identity interpretation.
- baseline dump lacked the already-released 0347-0349 behavior and private crm-documents bucket metadata. Apply those exact maintained migrations and checked-in bucket definition only to task copies before final regression. Original local/hosted stacks are untouched. Cost if wrong: hosted baseline drift must be caught at release preflight.

## Deliverables index

- [Architecture and customer-master design, existing/missing capabilities and integration diagram](architecture/CRM_FMS_INTEGRATION_DESIGN.md).
- [Original read-only audit and evidence limits](architecture/CRM_FMS_AUDIT_VALIDATION.md).
- [Database inventory, dependencies, Storage assessment and cleanup proposal](architecture/SUPABASE_DATA_INVENTORY.md).
- [Field-by-field production mapping review](architecture/CRM_FMS_FIELD_MAPPING_REVIEW.md).
- [Twenty-scenario test matrix and evidence boundaries](CRM_FMS_INTEGRATION_TEST_REPORT.md).
- Historical dry-run/apply, coordinated deployment and rollback instructions are in this report above.

Final scoped credential-pattern scan: 67 reviewed code/document paths, zero matches. Git whitespace checks passed in both prescribed checkouts. Scratch artifacts, private manifests, generated caches and unrelated changes are not publication paths.
