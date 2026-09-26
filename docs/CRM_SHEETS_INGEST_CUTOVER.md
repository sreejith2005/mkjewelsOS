# CRM Google Sheets walk-in ingest: cutover to Supabase (owner handoff)

Status (2026-09-26): built and verified **locally only**. Nothing is deployed, no hosted
secret is set, and Apps Script still points at whatever it pointed at before. This document
is the exact change to make later, by the owner.

## What replaces what

| Original CRM | JewelOS |
| --- | --- |
| `POST https://<original-host>/crm/api/ingest/walkin` (Next route) | `POST https://<project-ref>.supabase.co/functions/v1/crm-walkin-ingest` (Edge Function `crm-walkin-ingest`) |
| header `x-mk-legacy-api-key` | header `x-mk-legacy-api-key` (unchanged) |
| Vercel env `LEGACY_WALKIN_INGEST_API_KEY` | Supabase function secret `CRM_LEGACY_WALKIN_INGEST_API_KEY` |
| Apps Script Script Property `MK_CRM_INGEST_API_KEY` | same property name, new value (the new key) |

The request body, the response codes and messages, the 30-requests-per-minute limit, the
1 MB limit and the attempts ledger are the same as the original (verified case by case, see
"How this was verified"). The function needs **no JWT** (`verify_jwt = false`): the key is
the only gate, checked in constant time before anything else happens.

## Read this first: two facts about the original

1. **The Apps Script that calls the endpoint is not in the repository.** `FORM CODE.GS`
   (`sreejith-crm/web-app`) has `submitForm(formDataObj, filesPayload)`, the same shape as the
   endpoint's body, but no `UrlFetchApp` call. The original `.env.example` says the key lives in
   the Apps Script Script Property `MK_CRM_INGEST_API_KEY`, so a caller exists somewhere: open
   the walk-in form script (spreadsheet "01 WALKIN DATA") and search for `MK_CRM_INGEST_API_KEY`
   or `ingest/walkin`. If nothing matches, the call was never added and step 2 below is an
   addition, not an edit.
2. **The original endpoint answers a cookie-less caller with a redirect to the login page.**
   `sreejith-crm/web-app/proxy.ts` sends every request without a signed-in session to
   `/crm/login`, and its matcher excludes only static files, so `/crm/api/ingest/walkin` is
   covered. Apps Script sends no session cookie. On the parity stack a key-only POST gets
   `HTTP 307 -> /crm/login`. Whether production behaves the same depends on its deployment;
   check the ledger table `legacy_walkin_ingest_attempts` in the original database: if it has no
   `success` rows, Sheets never ingested through this endpoint. The Edge Function does not have
   this problem: it is served without a session by design.

## The Apps Script change

Script: the walk-in form script (`FORM CODE.GS`, spreadsheet "01 WALKIN DATA").
Function to edit: `submitForm(formDataObj, filesPayload)` (line ~1113). Add the call **after**
the sheet row has been written, and never let it break the form:

```javascript
// Script Properties (File > Project settings > Script properties):
//   MK_CRM_INGEST_URL     = https://<project-ref>.supabase.co/functions/v1/crm-walkin-ingest
//   MK_CRM_INGEST_API_KEY = <the new key; the same value as the function secret>
function pushWalkinToCrm_(formDataObj) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('MK_CRM_INGEST_URL');
  const key = props.getProperty('MK_CRM_INGEST_API_KEY');
  if (!url || !key) return { skipped: true };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-mk-legacy-api-key': key },
    // Proof uploads are saved to Drive by saveUploads_. The endpoint rejects a request that
    // carries files (422, "no visit was saved"), exactly like the original, so send none.
    payload: JSON.stringify({ formDataObj: formDataObj, filesPayload: [] }),
    muteHttpExceptions: true,
  });
  return { status: response.getResponseCode(), body: response.getContentText() };
}
```

and, inside `submitForm`, after the sheet write succeeds:

```javascript
try {
  const crm = pushWalkinToCrm_(formDataObj);
  if (crm.status && crm.status !== 201) console.error('CRM ingest HTTP ' + crm.status + ' ' + crm.body);
} catch (error) {
  console.error('CRM ingest failed: ' + error);
}
```

Notes:

- `formDataObj` must contain `branch` equal (case-insensitive, trimmed) to the name of an
  **active** CRM branch, otherwise the response is `422 INVALID_BRANCH`.
- A `201` body is `{"ok":true,"requestId":"...","code":"INGESTED","clientId":"...","timelineId":"...","referenceNumber":"..."}`.
- The endpoint does not de-duplicate: sending the same submission twice records two visits
  (the original does the same). Do not retry a `201`. A `422 INGEST_FAILED` may be retried once.
- Limits: 30 requests per minute for the key, 1 MB per request, 8 files (which are refused).

## Test with one synthetic row (local, then hosted)

Local (safe, nothing hosted): `supabase.cmd start`, then serve with an untracked env file
(never commit it; `supabase/functions/.env` is already ignored):

```powershell
# supabase/functions/.env  (untracked)  ->  CRM_LEGACY_WALKIN_INGEST_API_KEY=<any local value>
supabase.cmd functions serve --env-file supabase/functions/.env
curl.exe -i -X POST http://127.0.0.1:54321/functions/v1/crm-walkin-ingest `
  -H "x-mk-legacy-api-key: <local value>" -H "content-type: application/json" `
  --data-binary "@synthetic-walkin.json"
```

`synthetic-walkin.json` (invented person and phone, no customer data):

```json
{"formDataObj":{"branch":"<an active crm.branches name>","client_name":"Synthetic Ingest Test","client_phone":"9100099999","visit_date":"2026-09-26","buy_status":"NO","remark":"synthetic cutover test"},"filesPayload":[]}
```

Expected: `HTTP 201` with `"code":"INGESTED"`. Then, as a JewelOS super admin, confirm the visit
in `/crm` (client "Synthetic Ingest Test"), and in SQL: `select outcome, result from
crm.legacy_walkin_ingest_attempts order by created_at desc limit 3;` shows `success`, and
`select action, new_value from public.audit_logs where action like 'crm.legacy_walkin_ingest_%'
order by created_at desc limit 3;` shows only the request id, outcome and code (no name or phone).
After the hosted cutover, repeat the same with the hosted URL and key, then delete nothing:
mark the synthetic client in the CRM as a test client instead.

## Secrets to set later (names only; never write values into Git, chat or logs)

| Where | Name | Purpose |
| --- | --- | --- |
| Supabase function secret | `CRM_LEGACY_WALKIN_INGEST_API_KEY` | key Apps Script must send in `x-mk-legacy-api-key` (generate a new random value; do not reuse the original's) |
| Supabase function secret | `RUNO_API_KEY` | Runo `Auth-Key` for `crm-runo-push` (the same Runo key the original used) |
| Apps Script Script Property | `MK_CRM_INGEST_API_KEY` | same value as `CRM_LEGACY_WALKIN_INGEST_API_KEY` |
| Apps Script Script Property | `MK_CRM_INGEST_URL` | the function URL above |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` are provided by the Edge
runtime. `CRM_RUNO_API_URL` exists only so local tests can point at a stub: **do not set it in
the hosted project.**

## Order of the hosted cutover (owner; each step needs your explicit go)

1. Follow `PRODUCTION_SWITCH_PLAYBOOK.md`; apply migrations `0181`-`0188` to the hosted project
   and add `crm` to its Exposed schemas.
2. Run the Phase 5 data migration so the CRM branches and clients exist in `crm`.
3. `supabase functions deploy crm-walkin-ingest` and `crm-runo-push` (`config.toml` carries
   `verify_jwt = false` / `true`), then set the two function secrets.
4. Send one synthetic row (above) directly to the hosted function.
5. Set `MK_CRM_INGEST_URL` / `MK_CRM_INGEST_API_KEY` in Apps Script and submit one synthetic
   row through the real form. Check the ledger and `/crm`.

## Rollback

- Point `MK_CRM_INGEST_URL` back at the previous address (or clear the property: the helper
  above then skips the call and the Sheet keeps working on its own). No redeploy needed.
- To stop the function accepting anything without deleting it: remove the
  `CRM_LEGACY_WALKIN_INGEST_API_KEY` secret. Every call then returns `503 SERVER_MISCONFIGURED`.
- If the key leaked: set a new `CRM_LEGACY_WALKIN_INGEST_API_KEY` and the same value in
  `MK_CRM_INGEST_API_KEY`.
- Visits already written stay in `crm` (they are audited and appear in
  `crm.legacy_walkin_ingest_attempts`). Do not replay them.

## How this was verified (local)

`pnpm.cmd crm:parity -- --ingest` posts the same synthetic payloads to the original route
(`next dev`, original schema) and to the local Edge Function, and compares the HTTP status,
the response JSON (request ids masked), every table's rows in both databases, and, for the
Runo push, the outbound request each one sends to a local Runo stub. Result and the exact
cases are in the phase report. It also records the redirect described above.

## Other writers of Sheets data into the ORIGINAL CRM

Searched this repository, the original codebase (`sreejith-crm`) and the sibling
`mkjewels-sync` project. Findings, report only (nothing was changed):

- **Only this endpoint** ingests a live Sheets walk-in into the original CRM database.
- `sreejith-crm/web-app/scripts/migration-*.ts` and `prisma/seed.ts` are one-off imports from
  exported `.xlsx` files (owner-run), not a live sync.
- `mkjewels-sync` (a separate project, `../mkjewels-sync`) reads the Google Sheets tabs and
  writes to its **own** Supabase project (a different project ref from the original CRM's; its
  older scripts use `SUPABASE_URL`) and, through `jewelos-ingestion-sync.js`, to JewelOS's CRM
  sync-ingestion RPCs (`JEWELOS_SUPABASE_URL`). It does not write to the original CRM database. It keeps running until the owner retires it; it is unaffected by this cutover.
- `scripts/import-legacy-crm-*.ts` in this repository read the original CRM and write into
  JewelOS's OLD CRM tables (`public.clients`, ...); they never write to the original CRM.
