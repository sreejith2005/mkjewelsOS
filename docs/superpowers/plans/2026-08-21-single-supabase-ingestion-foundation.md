# Single-Supabase Ingestion Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the staging-safe JewelOS ingestion boundary and adapt the independent Google Sheets worker to use it without changing any production destination.

**Architecture:** Additive JewelOS migrations introduce immutable source observations, checkpoints, review records, and worker-only audited RPCs. The worker keeps Google Sheets reads and mapping artifacts, but all destination changes go through the RPC client. This plan ends at staging approval; it never targets production.

**Tech Stack:** PostgreSQL/Supabase migrations and pgTAP, TypeScript/Vitest, Node.js CommonJS, `@supabase/supabase-js`, Google Sheets API.

**Spec:** `docs/superpowers/specs/2026-08-21-single-supabase-crm-ingestion-design.md`

## Global Constraints

- New ingestion logic is validated locally and against hosted JewelOS staging only.
- The worker calls audited ingestion RPCs only; it never writes raw, checkpoint, canonical, or review tables directly.
- Credentials are server-side only and are never `VITE_*`, committed, browser-visible, or logged.
- Source records are immutable and idempotent; ambiguity produces review records, never a guessed merge.
- Use forward-only migrations, RLS, minimum grants, fixed-search-path `SECURITY DEFINER` functions, tenant audits, and pgTAP denial tests.
- Preserve unrelated dirty Task Bulk Import work in JewelOS and `sheet-structure-report.json` in mkjewels-sync.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `jewelos/supabase/migrations/0081_crm_sync_ingestion_contract.sql` | Tables, RLS, worker assertions, audited RPCs, indexes, and grants. |
| `jewelos/supabase/tests/0081_crm_sync_ingestion_contract.test.sql` | pgTAP authorization, replay, checkpoint, quarantine, and audit tests. |
| `jewelos/packages/core/src/crm/syncIngestion.ts` | Pure source-envelope validation and safe result summaries. |
| `jewelos/packages/core/src/crm/syncIngestion.test.ts` | Core validation tests. |
| `mkjewels-sync/sync-ingestion-client.js` | Server-side RPC client and batch splitter. |
| `mkjewels-sync/sync-ingestion-client.test.js` | RPC-only write and 500-row batching tests. |
| `mkjewels-sync/sync-raw.js` | Existing Sheets reader adapted to the RPC client. |
| `jewelos/docs/CRM_SYNC_STAGING_RUNBOOK.md` | Staging preflight, reconciliation, rollback, and production approval gate. |
| `mkjewels-sync/DEPLOYMENT.md` | Hosted worker schedule, alert, secret, and stop-switch requirements. |

Later plans cover wide-detail/contact projection, legacy CRM historical import, native CRM rollout, and archive retirement. They must not begin until this plan is accepted in staging.

## Task 1: Define the pure worker-ingestion contract

**Files:**
- Create: `packages/core/src/crm/syncIngestion.ts`
- Create: `packages/core/src/crm/syncIngestion.test.ts`
- Modify: `packages/core/src/crm/index.ts`

**Interfaces:**

```ts
export type CrmSourceRowEnvelope = Readonly<{
  sourceLocator: string; sourceRowKey: string; observedAt: string | null;
  sourceChecksum: string; payload: Record<string, unknown>;
}>;
export type CrmSyncBatchInput = Readonly<{
  sourceKey: string; scopeKey: string; requestKey: string;
  rows: readonly CrmSourceRowEnvelope[];
}>;
export function validateCrmSyncBatch(input: CrmSyncBatchInput): CrmSyncBatchInput;
export function safeCrmSyncSummary(result: unknown): {
  accepted: number; replayed: number; quarantined: number; reviewCodes: string[];
};
```

- [ ] **Step 1: Write failing tests**

```ts
it("accepts one stable source row", () => expect(validateCrmSyncBatch({
  sourceKey: "google_sheets", scopeKey: "sheet-a|tab-b",
  requestKey: "1b7e0e34-4e13-4f05-b8fd-3c3c3ebd8d17",
  rows: [{ sourceLocator: "sheet-a|tab-b", sourceRowKey: "sheet-a|tab-b|42",
    observedAt: "2026-08-21T00:00:00.000Z", sourceChecksum: "a".repeat(64), payload: {} }],
})).toMatchObject({ sourceKey: "google_sheets" }));
it("rejects more than 500 rows", () => expect(() => validateCrmSyncBatch({
  sourceKey: "google_sheets", scopeKey: "scope", requestKey: crypto.randomUUID(),
  rows: Array.from({ length: 501 }, () => ({ sourceLocator: "x", sourceRowKey: "x", observedAt: null, sourceChecksum: "a".repeat(64), payload: {} })),
})).toThrow("1-500"));
```

- [ ] **Step 2: Verify failure**

Run: `pnpm.cmd --filter @jewelos/core test -- syncIngestion.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the validator**

Use source key `/^[a-z][a-z0-9_]{2,62}$/`, UUID request IDs, SHA-256 checksums, 1–500 rows, nonempty locators/row keys, and object-only payloads. `safeCrmSyncSummary` returns only non-negative counts and allowlisted review codes: `invalid_phone`, `missing_branch`, `duplicate_contact`, `invalid_date`, `missing_reference`, and `unsupported_value`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm.cmd --filter @jewelos/core test -- syncIngestion.test.ts; pnpm.cmd --filter @jewelos/core typecheck`

Then:

```powershell
git add packages/core/src/crm/syncIngestion.ts packages/core/src/crm/syncIngestion.test.ts packages/core/src/crm/index.ts
git commit -m "feat: define CRM sync ingestion contract"
```

## Task 2: Add protected ingestion RPCs and database tests

**Files:**
- Create: `supabase/migrations/0081_crm_sync_ingestion_contract.sql`
- Create: `supabase/tests/0081_crm_sync_ingestion_contract.test.sql`
- Modify: `packages/api-client/src/database.types.ts` after local generation

**Interfaces:**

```sql
begin_crm_sync_run(text,text,uuid,jsonb) returns jsonb;
ingest_crm_source_batch(uuid,text,text,jsonb,uuid,jsonb) returns jsonb;
finalize_crm_sync_run(uuid,jsonb,uuid,jsonb) returns jsonb;
fail_crm_sync_run(uuid,text,uuid,jsonb) returns jsonb;
```

- [ ] **Step 1: Write failing pgTAP cases**

```sql
select throws_ok($$ select begin_crm_sync_run('google_sheets','sheet-a|tab-b',gen_random_uuid(),'{}'::jsonb) $$, '42501', '.*worker.*', 'browser caller denied');
select lives_ok($$ select begin_crm_sync_run('google_sheets','sheet-a|tab-b',gen_random_uuid(),jsonb_build_object('test_worker',true)) $$, 'test worker starts a run');
select is((select count(*) from audit_logs where module='crm_sync'), 1::bigint, 'start audited');
```

Add fixtures and assertions for cross-tenant denial, duplicate replay, invalid checksum quarantine, missing branch review, and checkpoint unchanged after failure.

- [ ] **Step 2: Verify failure**

Run: `supabase.cmd test db --local supabase/tests/0081_crm_sync_ingestion_contract.test.sql`

Expected: FAIL because the new objects are absent.

- [ ] **Step 3: Implement the forward migration**

Create:
- `crm_sync_runs`: tenant/source/scope/request identity, `running|completed|failed|blocked` status, summary and checkpoint;
- `crm_source_records`: immutable tenant/source/scope/row/checksum/payload/run observations, unique by tenant/source/row/checksum;
- `crm_sync_checkpoints`: tenant/source/scope checkpoint, changed only by finalization;
- `crm_identity_review`: source record, allowlisted reason, `open|resolved|ignored`, resolution actor/reason/timestamps;
- hashed, expiring, source/scope-restricted worker assertions.

Enable RLS on all new tables. Browser roles have no direct mutation grant. Admins receive read-only review policies. The four `SECURITY DEFINER SET search_path=public` RPCs validate assertion, tenant/source/scope, bounded JSON, idempotency, and exact run ownership; use an advisory lock for each tenant/source/scope. Each accepted row stores an immutable observation, returns replay for the same checksum, or creates a review record. Every state transition writes `audit_logs` with IDs/counts/checksums only. Revoke execution from `public`, `anon`, and `authenticated`; grant it only to `service_role`, and require the hashed, expiring worker assertion inside every RPC. The worker code must use no direct table mutation even though its server-side credential could bypass RLS.

- [ ] **Step 4: Generate types and verify**

```powershell
supabase.cmd db reset
supabase.cmd test db --local supabase/tests/0081_crm_sync_ingestion_contract.test.sql
supabase.cmd db lint --local --level warning
supabase.cmd gen types typescript --local --schema public > packages/api-client/src/database.types.ts
pnpm.cmd --filter @jewelos/api-client typecheck
```

Expected: PASS with aggregate-only output.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0081_crm_sync_ingestion_contract.sql supabase/tests/0081_crm_sync_ingestion_contract.test.sql packages/api-client/src/database.types.ts
git commit -m "feat: add audited CRM sync ingestion RPCs"
```

## Task 3: Adapt the sync worker to RPC-only destination writes

**Files:**
- Create: `C:/Users/MIS/Downloads/mkjewels-sync/sync-ingestion-client.js`
- Create: `C:/Users/MIS/Downloads/mkjewels-sync/sync-ingestion-client.test.js`
- Modify: `C:/Users/MIS/Downloads/mkjewels-sync/sync-raw.js`

**Interfaces:**

```js
function createIngestionClient({ supabase, workerAssertion, requestId = crypto.randomUUID }) {}
// beginRun({ sourceKey, scopeKey })
// ingestRows({ runId, sourceKey, scopeKey, rows })
// finalizeRun({ runId, checkpoint })
// failRun({ runId, safeErrorCode })
```

- [ ] **Step 1: Write failing client tests**

Use a fake `supabase.rpc` recorder. Assert 501 input rows create two `ingest_crm_source_batch` calls (500 and 1), server results are summarized without payload fields, malformed results throw a generic error, and an ingest failure calls `fail_crm_sync_run`.

- [ ] **Step 2: Verify failure**

Run: `node --test sync-ingestion-client.test.js`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement and refactor**

The client calls only the four RPCs. It reads `JEWELOS_SYNC_WORKER_ASSERTION` at process startup and reports absent configuration by variable name only. In `sync-raw.js`, retain Google authentication, included-tab selection, header mapping, and source reads. Replace `raw_sheet_rows`, `tab_sync_state`, `clients`, and `client_full_details` destination writes/reads with the client.

Create envelopes exactly as:

```js
{
  sourceLocator: `${row.source_sheet}|${row.source_tab}`,
  sourceRowKey: row.row_key,
  observedAt: null,
  sourceChecksum: crypto.createHash('sha256').update(JSON.stringify(row.row_data)).digest('hex'),
  payload: { source_sheet: row.source_sheet, source_tab: row.source_tab, gid: row.gid, row_number: row.row_number, row_data: row.row_data },
}
```

Reject `--full-resync` with `Destructive destination reset is disabled; create a reviewed staging run instead.` Log scope-level and final aggregate counts only.

- [ ] **Step 4: Verify and commit**

```powershell
node --test sync-ingestion-client.test.js
node --test build-clients.test.js
node --check sync-ingestion-client.js
node --check sync-raw.js
git -C C:/Users/MIS/Downloads/mkjewels-sync add sync-ingestion-client.js sync-ingestion-client.test.js sync-raw.js
git -C C:/Users/MIS/Downloads/mkjewels-sync commit -m "feat: send Sheets sync through JewelOS RPCs"
```

Do not run `npm.cmd run sync:raw`; it could write a linked project.

## Task 4: Document hosted staging operation and reconciliation

**Files:**
- Create: `docs/CRM_SYNC_STAGING_RUNBOOK.md`
- Create: `C:/Users/MIS/Downloads/mkjewels-sync/DEPLOYMENT.md`
- Modify: `C:/Users/MIS/Downloads/mkjewels-sync/README.md`

- [ ] **Step 1: Document staging-only preflight**

Include:

```powershell
Set-Location C:\Users\MIS\Downloads\MKJewelOS\jewelos
supabase.cmd migration list --linked
supabase.cmd db push --linked --dry-run
Set-Location C:\Users\MIS\Downloads\mkjewels-sync
node --test sync-ingestion-client.test.js
node .\sync-raw.js --source-sheet=<approved-staging-fixture> --mapped-only
```

State that the final command is allowed only after the linked destination is confirmed as staging and its fixture is synthetic/masked.

- [ ] **Step 2: Define reconciliation and scheduler requirements**

The aggregate report includes scope, captured checkpoint, read/accepted/replayed/quarantined counts, canonical/detail/timeline totals, exception counts by code, run/audit totals, duration, and outcome—never customer payload. Acceptance requires zero unexplained mismatches, RLS denial proof, and administrator-reviewed masked samples.

Require an always-on hosted scheduler, one active scope run, stable retry IDs, alerts for failure/stale checkpoint/missed window/exception growth, and a manual stop switch. Mark the Windows Task Scheduler entry as local-only. Rollback stops the new worker and preserves run evidence; it never resets production tables.

- [ ] **Step 3: Verify and commit scoped documentation**

```powershell
git diff --check
git -C C:/Users/MIS/Downloads/mkjewels-sync diff --check
git add docs/CRM_SYNC_STAGING_RUNBOOK.md
git commit -m "docs: add CRM sync staging runbook"
git -C C:/Users/MIS/Downloads/mkjewels-sync add DEPLOYMENT.md README.md
git -C C:/Users/MIS/Downloads/mkjewels-sync commit -m "docs: define hosted sync worker operation"
```

## Task 5: Complete the local gate and stop for hosted approval

**Files:**
- Modify only real contract corrections discovered by the following checks.

- [ ] **Step 1: Run the local evidence gate**

```powershell
Set-Location C:\Users\MIS\Downloads\MKJewelOS\jewelos
supabase.cmd start
supabase.cmd db reset
supabase.cmd test db --local supabase/tests/0081_crm_sync_ingestion_contract.test.sql
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test -- syncIngestion.test.ts
pnpm.cmd --filter @jewelos/core typecheck
pnpm.cmd --filter @jewelos/api-client typecheck
node --test C:\Users\MIS\Downloads\mkjewels-sync\sync-ingestion-client.test.js
node --test C:\Users\MIS\Downloads\mkjewels-sync\build-clients.test.js
git diff --check
```

If Docker is unavailable, report that local database/RPC evidence is unavailable; do not claim it passed.

- [ ] **Step 2: Review named staged paths**

```powershell
git status --short --branch
git diff --cached --check
git diff --cached --name-only
git diff --cached | Select-String -Pattern 'service_role|SUPABASE.*KEY|password|secret|token' -CaseSensitive:$false
```

Never stage credentials, `.env`, `service-account.json`, `.supabase`, exports, or customer reports.

- [ ] **Step 3: Stop at the hosted authorization gate**

Do not run `supabase.cmd db push --linked`, deploy a worker, change a scheduler, or point any worker to production. Present the migration dry run, non-secret staging project reference, worker configuration names, reconciliation fixture, and rollback owner for approval.

## Plan self-review

- Tasks 1–2 implement the audited, RLS-scoped ingestion foundation.
- Task 3 adapts the independent worker without direct destination writes.
- Task 4 defines staging deployment, monitoring, reconciliation, and rollback.
- Task 5 supplies local evidence and an explicit hosted approval gate.
- All four RPC names, the 500-row bound, and source-envelope fields match the approved specification.
