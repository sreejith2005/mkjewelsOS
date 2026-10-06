# CRM <- Google Sheet sync: production runbook (one-way first)

For the owner. Design: "CRM Sheet Sync Design" (https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D).

**Owner decision (2026-10-06): one-way first.** The Sheets are the production record. Until two-way
is approved, data flows **Sheet -> CRM only**:

- the sync script runs in its **own new Apps Script project** with **read-only** access to Sheets
  (`appsscript.json`); Google refuses any write, and the script keeps no state in the Sheets;
- MK JEWELS CRM SYSTEM (Code.gs, Index.html) is **not changed**;
- in the CRM, `crm_private.sheet_sync_settings.two_way = false`: web-app changes are not queued for
  the Sheet and nothing is handed out to write.

Run every command from `C:\crm-sync` in PowerShell (a separate checkout of `feat/crm-sheet-sync`;
the main folder's other work is not disturbed). Hosted steps are on the **CRM project** (ref starts
`fsyd`, never `yima`). Never paste keys, passwords or output containing them into chat.

## A. Database

1. `cd C:\crm-sync`
2. `supabase.cmd link --project-ref fsydcsyqnddacjfoutfe --workdir supabase-crm`
   (asks for the CRM database password, hidden). Expect `Finished supabase link.`
3. `supabase.cmd db push --linked --workdir supabase-crm --dry-run`
   Expect exactly four: `20261006000200_crm_phone_name_identity.sql`,
   `20261006000300_crm_sheet_sync_storage.sql`, `20261006000400_crm_sheet_sync_functions.sql`,
   `20261006000500_crm_sheet_sync_one_way.sql`. Anything else: stop.
4. `supabase.cmd db push --linked --workdir supabase-crm`
   Expect four `Applying migration ...` lines and `Finished supabase db push.`

## B. New Apps Script project (read-only)

1. https://script.google.com > **New project** (signed in as an account that can view the three
   spreadsheets). Rename it `MK CRM SHEET PUSH (READ-ONLY)`.
2. Project Settings (gear) > tick **Show "appsscript.json" manifest file in editor**. Open
   `appsscript.json`, select all, paste:
   `Get-Content C:\crm-sync\supabase-crm\apps-script\appsscript.json -Raw | Set-Clipboard`
3. Open `Code.gs` of this new project, select all, paste:
   `Get-Content C:\crm-sync\supabase-crm\apps-script\crm-sheet-push.gs -Raw | Set-Clipboard`
   Save (Ctrl+S).
4. Project Settings > Script Properties > add:
   - `MK_CRM_SHEET_SYNC_URL` = `https://fsydcsyqnddacjfoutfe.supabase.co/functions/v1/crm-sheet-sync`
   - `MK_CRM_FILE_ID` = `CRM_SPREADSHEET_ID` in MK JEWELS CRM SYSTEM's Code.gs (the CRM file)
   - `MK_WALKIN_FILE_ID` = the walk-in file in use: in the CRM file, menu **MK CRM > Check Walk-in
     Source File** shows "EFFECTIVE SPREADSHEET ID"
   - `MK_REFERRALS_FILE_ID` = `REFERRAL_CALLING_CONFIG.SPREADSHEET_ID` in Code.gs ("REFERENCES GIVEN BY CLIENT")
   (`MK_CRM_SHEET_SYNC_KEY` is added in C2.)

## C. Edge Function and its key

1. `cd C:\crm-sync`
2. Key (to the clipboard, never shown):
   ```powershell
   $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
   $k = [Convert]::ToBase64String($b) -replace '[+/=]', ''
   supabase.cmd secrets set "CRM_SHEET_SYNC_KEY=$k" --workdir supabase-crm --project-ref fsydcsyqnddacjfoutfe
   Set-Clipboard $k; Remove-Variable k, b
   ```
   Expect `Finished supabase secrets set.` At once add the script property
   `MK_CRM_SHEET_SYNC_KEY` = Ctrl+V in the new project, and save.
3. `supabase.cmd functions deploy crm-sheet-sync --workdir supabase-crm --project-ref fsydcsyqnddacjfoutfe --no-verify-jwt`
   Expect `Deployed Functions on project fsydcsyqnddacjfoutfe: crm-sheet-sync`.
4. `curl.exe -s -X POST https://fsydcsyqnddacjfoutfe.supabase.co/functions/v1/crm-sheet-sync -H "content-type: application/json" -d "{}"`
   Expect `{"ok":false,"code":"UNAUTHORIZED"}`.

## D. Dry run, import, schedule

1. In the new project choose `crmspDryRun` > **Run**. Authorise: the permission screen must list
   **"See all your Google Sheets spreadsheets"** (read-only), "Connect to an external service" and
   "Allow this application to run when you are not present", and nothing that edits Sheets.
   Repeat **Run** until the log says `dry run complete`. Send Claude that line (counts only).
   Dry-run counts for FAMILY DATA and REFERRALS HISTORY are upper bounds.
2. After Claude reviews the counts: `crmspImport` > Run; repeat until `import complete`; send the line.
3. `crmspInstall` > Run (every 5 minutes, Sheet -> CRM). `crmspStop` turns it off.
4. `https://mkjewels-os.vercel.app/crm/allocation` (super admin) > CRM SYNC HEALTH >
   "GOOGLE SHEET: LAST CHANGE PER TAB" shows recent times. ("LAST TWO-WAY SYNC" stays NEVER.)

## E. Web app

Tell Claude when A is done; it merges `feat/crm-sheet-sync` into `main` (Google Sheet block in
Sync health; Sheet referrer names on the referrals page). Not before A: the referrals page reads a
new column.

## F. After everything works

`Remove-Item C:\crm-private\crm-project.secrets.env, C:\crm-private\jewelos.secrets.env`

## Later: two-way (only after approval)

Not now. Claude will give exact steps then: set `two_way = true` in
`crm_private.sheet_sync_settings`, stop this script (`crmspStop`), install
`supabase-crm/apps-script/crm-sheet-sync.gs` in MK JEWELS CRM SYSTEM with the Code.gs guard lines.

## While one-way runs

- The Sheet is the record. A change made only in the web app stays in the CRM; if the Sheet later
  changes the same client field, the Sheet's value replaces it.
- A Sheet rebuild that renumbers MKC codes shows those rows as `mkc_identity_conflict` in the health
  panel; nothing is changed for them until reviewed.
