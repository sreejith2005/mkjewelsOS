# CRM <-> Google Sheet sync: production runbook

For the owner. Design: "CRM Sheet Sync Design" (https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D),
plan: `docs/superpowers/plans/2026-10-06-crm-sheet-sync.md`. Every hosted step below is run by you,
from `C:\Users\MIS\Downloads\MKJewelOS` in PowerShell, on the **CRM project** (ref starts `fsyd`,
never `yima`). Never paste keys or terminal output that contains them into chat.

## What ships

| Part | Where |
| --- | --- |
| 3 CRM migrations: phone + name identity, sync storage, sync functions | `supabase-crm/supabase/migrations/20261006000200..400` |
| Edge Function `crm-sheet-sync` | `supabase-crm/supabase/functions/crm-sheet-sync` |
| Apps Script `crm-sheet-sync.gs` (replaces `crm-walkin-push.gs`) | `supabase-crm/apps-script/crm-sheet-sync.gs` |
| Web app: Google Sheet block in Sync health; referrer name for Sheet referrals | `packages/crm-ui` (deployed with `main`) |

Order matters: database first, then the function, then the web app, then the Apps Script.

## 1. Database

1. Link this folder to the CRM project (once; asks for the database password without echo):
   `supabase.cmd link --project-ref fsydcsyqnddacjfoutfe --workdir supabase-crm`
   Expect: `Finished supabase link.`
2. Preview: `supabase.cmd db push --linked --workdir supabase-crm --dry-run`
   Expect exactly three files: `20261006000200_crm_phone_name_identity.sql`,
   `20261006000300_crm_sheet_sync_storage.sql`, `20261006000400_crm_sheet_sync_functions.sql`.
   Anything else: stop and send the list.
3. Apply: `supabase.cmd db push --linked --workdir supabase-crm`
   Expect: three `Applying migration ...` lines, then `Finished supabase db push.`

## 2. Edge Function and its key

1. Make a key and keep it out of the terminal (it goes to the clipboard):
   ```powershell
   $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
   $k = [Convert]::ToBase64String($b) -replace '[+/=]', ''
   supabase.cmd secrets set "CRM_SHEET_SYNC_KEY=$k" --workdir supabase-crm --project-ref fsydcsyqnddacjfoutfe
   Set-Clipboard $k; Remove-Variable k, b
   ```
   Expect: `Finished supabase secrets set.` Keep the clipboard for step 4.2.
2. Deploy: `supabase.cmd functions deploy crm-sheet-sync --workdir supabase-crm --project-ref fsydcsyqnddacjfoutfe --no-verify-jwt`
   Expect: `Deployed Functions on project fsydcsyqnddacjfoutfe: crm-sheet-sync`.

## 3. Web app

Tell Claude the database and function are done; it merges `feat/crm-sheet-sync` into `main`
and pushes, and Vercel project `mkjewels-os` deploys. (The referrals page reads the new
`given_by_name` column, so the web app must not go out before step 1.)

## 4. Apps Script (MK JEWELS CRM SYSTEM project)

1. If `crm-walkin-push.gs` is in the project: run `sbcrmRemoveLiveSync`, then delete that file.
2. Project settings > Script properties: add
   `MK_CRM_SHEET_SYNC_URL` = `https://fsydcsyqnddacjfoutfe.supabase.co/functions/v1/crm-sheet-sync`
   `MK_CRM_SHEET_SYNC_KEY` = paste from the clipboard (step 2.1).
3. Add a new script file `crm-sheet-sync.gs` with the contents of
   `supabase-crm/apps-script/crm-sheet-sync.gs`.
4. In `Code.gs`, add this as the **first line** inside each of `rebuildCrmFromWalkinSource`,
   `resetCrmCompletely` and `clearWalkinCrmClientIdsManual`:
   `crmssAssertSyncPaused_();`
5. Run `crmssDryRun` (authorise when asked). Run it again until the execution log says
   `dry run complete`. The log and the Sync health panel ("LAST IMPORT REPORT") show counts
   only. Note: each tab's dry run is rolled back on its own, so FAMILY DATA and REFERRALS HISTORY
   cannot see the clients and referrals the earlier tabs would create; their dry-run "inserted"
   and "calling_not_found" counts are upper bounds. The client counts are exact.
   Review especially `skipped_mkc_identity_conflict`: a Sheet MKC that the CRM holds for a
   different person. Send Claude the counts before continuing.
6. Run `crmssImportRun`; run it again until the log says `import complete`. Re-running is harmless.
7. Run `crmssInstallSync`. From now on every 5 minutes: Sheet changes go to the CRM, web-app
   changes come back into the right rows.
8. Check `/crm` > Allocation (super admin) > CRM SYNC HEALTH > the GOOGLE SHEET rows: a recent
   "LAST TWO-WAY SYNC", no "OVERDUE".
9. When all of the above works: delete `C:\crm-private\crm-project.secrets.env` and
   `C:\crm-private\jewelos.secrets.env`.

## Pausing (for a Sheet rebuild or an incident)

`crmssPauseSync` stops the trigger; REBUILD TOTAL DATABASE and the other two guarded menu items
work again. Afterwards run `crmssImportRun` (it re-matches every client by phone + name), then
`crmssResumeSync`.

## Rules to tell staff

- Never sort or delete rows in WALKIN DATASET: rows without a REFERENCE NUMBER are known by
  their row number.
- The Sheet wins: when the same thing is changed in both places, the Sheet's change is kept and
  the conflict is counted in the health panel.
