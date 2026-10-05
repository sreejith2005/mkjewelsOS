# CRM walk-in form (Google Sheets) -> CRM project: live push and backfill (owner guide)

Status (2026-10-05): built and verified **locally only** (see "How this was verified").
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
| Apps Script code | `supabase-crm/apps-script/crm-walkin-push.gs` (paste as a new file in the form's project) |

Responses: `201 INGESTED` (saved), `200 ALREADY_INGESTED` (this REFERENCE NUMBER is already
in the CRM: nothing saved), `422 INVALID_BRANCH`, `422 INGEST_FAILED`, `429 RATE_LIMITED`,
`401 UNAUTHORIZED`, `413`, `400`. Same limits as the original: 1 MB, 8 files (refused), 30
requests per minute (the backfill has its own 30 per minute).

**No duplicates.** The form stamps every entry with its REFERENCE NUMBER before it writes the
Sheet row. The CRM saves a reference number once, and it also recognises the reference numbers
of the original import. So the live push can be retried safely and the backfill can run any
number of times.

Known limitation: an entry **edited in the Sheet form** after it reached the CRM is not
updated in the CRM (the edit is recognised as the same reference and ignored). Correct such a
visit in `/crm`. This goes away when staff record walk-ins in `/crm` (phase 6).

## Before you start: confirm three things (owner)

1. The live form script is still `FORM CODE.GS` with the WALKIN DATASET headers of
   `getExpectedHeaders_()` (REFERENCE NUMBER at column 129) and the helpers
   `getWalkinHeadersForEdit_` and `convertWalkinRowToFormData_`. If the live script differs,
   send me its header row (names only, no data) before going further.
2. The Sheet's `BRANCH` values equal the names of **active** CRM branches (case-insensitive).
   Any other value is answered `INVALID_BRANCH` and counted in the backfill log.
3. Rows since 2026-08-17 carry a REFERENCE NUMBER. Rows without one are skipped and counted.

## The Apps Script change

1. Open the walk-in form script (spreadsheet "01 WALKIN DATA"). Add a script file
   `crm-walkin-push` and paste `supabase-crm/apps-script/crm-walkin-push.gs`.
2. Project settings > Script properties: add `MK_CRM_INGEST_URL` and `MK_CRM_INGEST_API_KEY`.
3. In `submitForm(formDataObj, filesPayload)`, in the **new entry** path, directly after
   `sh.appendRow(row);` (around line 1224) add:

   ```javascript
   pushWalkinToCrm_(formDataObj);
   ```

   Do not add it to the edit path (the branch that ends with
   `sh.getRange(targetRowNumber, ...).setValues([row])`). `pushWalkinToCrm_` never throws, so
   the Sheet keeps working if the CRM is unreachable; failures go to the script's execution
   log as an HTTP status and a code only.

## Backfill (history since 2026-08-17)

Run `backfillWalkinsToCrm` from the Apps Script editor.

- It sends every WALKIN DATASET row submitted on or after `MK_CRM_BACKFILL_SINCE` (Script
  property, optional; default `2026-08-17T00:00:00+05:30`) through the same endpoint.
- Each run stops itself after about 5 minutes and remembers where it stopped; run it again
  (or add a 10-minute time trigger) until the log says `done`. Then remove the trigger.
- The log shows counts only, for example
  `{"ingested":412,"already_ingested":37,"skipped_no_reference":2,"failed_422_invalid_branch":1}`.
  Paste only that line if you want me to check it.
- Running it again later is safe: everything already sent comes back `already_ingested`.
  `resetCrmBackfill()` starts from the first row again.

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

- Clear `MK_CRM_INGEST_URL` in Script properties: `pushWalkinToCrm_` then skips the call and
  the Sheet works on its own. No redeploy needed.
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
- The real `FORM CODE.GS` helpers and `crm-walkin-push.gs` ran in a Node VM against a
  synthetic sheet (mocked Sheets/Properties, real HTTP to the local function): the first
  backfill run ingested the new row, recognised the already-sent one, skipped the row without
  a reference and counted the unknown branch; the second run saved nothing new.

Not verified: the hosted function, the live Apps Script project, and the real Sheet headers
(owner checks above).
