# CRM walk-in form (Google Sheets) -> CRM project: live push and backfill (owner guide)

Status (2026-10-06): built and verified **locally only** (see "How this was verified").
Nothing is deployed, no hosted secret is set, and the Apps Script is unchanged. Every step
below is run by the owner, in the order of `docs/CRM_TWO_PROJECT_PRODUCTION_RUNBOOK.md`.

Since the 2026-10-01 two-project decision, walk-ins go to the **CRM project** (the client
database), not to JewelOS. The function is `crm-walkin-ingest` in `supabase-crm/`. The
JewelOS copy in `supabase/functions/crm-walkin-ingest` targets the retired JewelOS `crm`
schema and must not be connected.

## What the owner gets

| | |
| --- | --- |
| Endpoint | `POST https://<crm-project-ref>.supabase.co/functions/v1/crm-walkin-ingest` |
| Key header | `x-mk-legacy-api-key` (checked in constant time before anything else) |
| Function secret | `CRM_LEGACY_WALKIN_INGEST_API_KEY` (CRM project) |
| Apps Script properties | `MK_CRM_INGEST_URL`, `MK_CRM_INGEST_API_KEY` (same value as the secret) |
| Apps Script code | `supabase-crm/apps-script/crm-walkin-push.gs`, pasted as a new file into the **MK JEWELS CRM SYSTEM** Apps Script project |

Responses: `201 INGESTED` (saved), `200 ALREADY_INGESTED` (this REFERENCE NUMBER is already
in the CRM: nothing saved), `422 INVALID_BRANCH`, `422 INGEST_FAILED`, `429 RATE_LIMITED`,
`401 UNAUTHORIZED`, `413`, `400`. Same limits as the original: 1 MB, 8 files (refused), 30
requests per minute (the backfill has its own 30 per minute).

**How it works (2026-10-06).** The walk-in form is not changed. The script reads WALKIN
DATASET by its header names (the live 137-column layout, REFERENCE NUMBER in column 129) and
sends each final walk-in to the CRM:

- `sbcrmLiveSync` runs every 5 minutes and sends the walk-ins of the last 3 days that were not
  sent yet. A new walk-in reaches the CRM within about 5 minutes.
- `sbcrmBackfill` sends the history since 2026-08-17 once, with the same rules.

**No duplicates.** The CRM saves a REFERENCE NUMBER once and also knows the numbers of the
original import, so both functions can run any number of times. A REFERENCE NUMBER that appears
on more than one row: the first row keeps it, later rows go as `<number>-R<row>`, so two real
visits are never merged. A row without a number goes as `AUTO-WALKIN-ROW-<row>`. Drafts
(`VISIT FINAL STATUS = DRAFT`) are never sent; they are sent once they become final.

**Status.** The full status (ORDER_PLACED, REPAIR_PICKUP, ...) is kept on the visit, so orders
and repairs never open a Not-Bought follow-up. The Sheet's own CRM CLIENT ID is not sent: the
CRM matches clients by phone and keeps its own MKC codes (new ones start at MKC-200001, apart
from the Sheet's numbers).

Known limitation: a walk-in **edited** in the form after it reached the CRM is not updated in
the CRM (same reference number). Correct such a visit in `/crm`.

## Before you start (owner)

1. The Sheet's `BRANCH` values must equal the names of **active** CRM branches
   (case-insensitive). Others are answered `INVALID_BRANCH`, counted in the log and retried at
   most 3 times. Check with `select name from public.branches where active;` (CRM project).
2. The Apps Script project must be able to open the "01 WALKIN DATA" spreadsheet (the MK JEWELS
   CRM SYSTEM project already does).

## Setting it up

1. Open the **MK JEWELS CRM SYSTEM** Apps Script project. File > New > Script file, name it
   `crm-walkin-push`, and paste `supabase-crm/apps-script/crm-walkin-push.gs`. Save.
2. Project settings > Script properties: add `MK_CRM_INGEST_URL` and `MK_CRM_INGEST_API_KEY`.
3. Backfill: choose `sbcrmBackfill` in the function list and click Run (allow the permissions
   it asks for). Each run stops after about 5 minutes and remembers where it stopped: run it
   again until the execution log says `done`. The log shows counts only, for example
   `{"ingested":412,"already_ingested":37,"duplicate_reference_rows":2,"skipped_draft":3,"failed_422_invalid_branch":1}`.
   Paste only that line if you want me to check it. `sbcrmResetBackfill` starts again from the
   first row (safe: everything comes back `already_ingested`).
4. Live: run `sbcrmInstallLiveSync` once. It adds a 5-minute trigger for `sbcrmLiveSync`.
   `sbcrmRemoveLiveSync` removes it.

Customer data never leaves Google and Supabase: nothing is exported to a file.

## Test with one synthetic row (hosted, after deploying)

```powershell
$s = Read-Host "Ingest key" -AsSecureString; $k = [System.Net.NetworkCredential]::new('', $s).Password
$body = '{"formDataObj":{"branch":"<an active CRM branch name>","client_name":"Synthetic Ingest Test","client_phone":"9100099999","visit_date":"2026-10-05","client_bought":"NO","remark":"synthetic cutover test","reference_number":"SYNTHETIC-CUTOVER-0001"},"filesPayload":[]}'
curl.exe -s -X POST "https://<crm-project-ref>.supabase.co/functions/v1/crm-walkin-ingest" -H "x-mk-legacy-api-key: $k" -H "content-type: application/json" --data-raw $body
```

Check that the project ref is the **CRM project's** (JewelOS's starts with `yima`). Expected:
`"code":"INGESTED"`; sending it again: `"code":"ALREADY_INGESTED"`. Then mark the synthetic
client in `/crm` as a test client; delete nothing.

## Rollback

- Run `sbcrmRemoveLiveSync` (or clear `MK_CRM_INGEST_URL`): nothing more is sent. The Sheet and
  the walk-in form are unaffected either way.
- To make the function refuse everything without deleting it: remove the
  `CRM_LEGACY_WALKIN_INGEST_API_KEY` secret (every call answers `503`).
- If the key leaked: set a new secret value and the same value in `MK_CRM_INGEST_API_KEY`.
- Visits already saved stay in the CRM (audited, listed in `legacy_walkin_ingest_attempts`).

## How this was verified (local, 2026-10-05)

- pgTAP (`supabase-crm/supabase/tests/20261005_crm_walkin_ingest.test.sql`): grants
  (service_role only), INVALID_BRANCH, ALREADY_INGESTED against an original-import reference,
  no second visit, no key after a failed save, ledger outcomes, audit rows without customer
  values, and the identity gate's ingest branch (service_role + ingest system user only).
- Deno: 21/21 for the function (including ALREADY_INGESTED = 200 and the backfill budget).
- End to end on the local CRM stack (`mkcrm`): a synthetic walk-in answered 201, the same
  entry again 200, one visit saved with an MKC code; a wrong key 401.
- `crm-walkin-push.gs` ran in a Node VM against a synthetic WALKIN DATASET with the live
  137-column header row (mocked Sheets/Properties, real HTTP to the local function): the first
  backfill saved the 4 final visits (an ORDER_PLACED visit, two rows sharing one reference, a row
  without a reference), skipped the old row and the draft, and reported the unknown branch; the
  second backfill and the live sync saved nothing again. The ORDER_PLACED visit kept its status
  and opened no Not-Bought follow-up; the companion joined the client's family.

Not verified: the hosted function, the live Apps Script project, and the real Sheet headers
(owner checks above).
