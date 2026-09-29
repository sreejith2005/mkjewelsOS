# CRM cutover checklist (production switch-over day)

The exact procedure for switching JewelOS production to the ported original CRM (schema `crm`,
web `/crm`, mobile CRM tab in a WebView). Every step starts with a **GATE**: the owner types
`go` before anything in that step runs. A step is finished only when its **Verify** list is
green. If a Verify item fails, stop and use that step's **Rollback**; do not continue.

Prepared 2026-09-28 on branch `feat/crm-native` (worktree `C:\crm`). Background and details:
`docs/CRM_DATA_MIGRATION_RUNBOOK.md` (import), `docs/CRM_SHEETS_INGEST_CUTOVER.md` (Apps Script),
`docs/MOBILE_RELEASE_GUIDE.md` (APK), `PRODUCTION_SWITCH_PLAYBOOK.md` (production rules),
design `docs/superpowers/specs/2026-09-25-crm-native-integration-design.md`.

Production project: **`yimafxhuwgfhvzczqqdd`** (`jewelos-prod`). Every `--linked` / `--project-ref`
command below must target exactly that ref.

## Rules for the whole day

- Hosted commands run in front of the owner. URLs, passwords and keys are typed into the running
  PowerShell session (`Read-Host`) or pasted into the Supabase dashboard. Never into a command
  line, a file in Git, chat or a screenshot. Close the PowerShell window at the end.
- Output shown in chat is counts, ids and statuses only. Customer data, reports, dumps and
  manifests stay in `C:\crm-private` (outside every Git worktree).
- `psql` and `pg_dump` are not installed on this PC. The commands below run them from the local
  Docker image `postgres:17-alpine` (client 17, same major as production). `-e NAME` without
  a value hands the session variable to the container, so the value is never on a command line.
- The old JewelOS CRM tables (`public.clients`, `public.client_timeline`, ...) and their
  migrations/RPCs are never touched. They stay as an archive.
- `mkjewels-sync` is unchanged by this cutover. Upload MIME rules are unchanged.
- Gates 2 through 7 run in **one sitting**. Between gate 2 (migrations become permanent in
  production) and gate 7 (merge to `main`), no other session may `db push` or merge migrations to
  `main` — a migration landing on `main` in that window collides with the CRM series' numbers,
  since Postgres/Supabase would silently skip a later migration that reuses an already-applied
  number. The owner confirms this with any other active session before gate 2's `go`. See gate 2's
  hard precondition for the fresh re-check right before it. After gate 7, `main`'s next free
  migration number is `0193`.

## Findings from the read-only preflight (2026-09-28)

| Check | Result |
| --- | --- |
| Linked ref | `yimafxhuwgfhvzczqqdd` (`jewelos-prod`), confirmed in `supabase projects list` |
| Applied migrations | `0001`-`0181`, identical to `main` (0121, 0122, 0136 do not exist on either side) |
| Migrations the cutover applies | exactly `0183_crm_schema_tables` ... `0192_crm_ensure_my_crm_user` (10 files, renumbered 2026-09-29: `main` took `0182_form_dependencies_fms_draft_safety.sql` first). Nothing else from `main` is pending. |
| Schema `crm` / `crm_private` | do not exist (correct) |
| Bucket `crm-legacy-documents` | does not exist (correct). `crm-documents` exists: it is the OLD JewelOS CRM bucket, not touched. |
| Exposed schemas (Data API) | `public,graphql_public`; max rows 1000 |
| Edge Functions | 10 deployed; `crm-walkin-ingest` and `crm-runo-push` are not |
| `crm` section | exists in the section defaults and is currently **OFF** (the only disabled section); Developer Mode flag is off |
| `crm.view` | module permission for page `crm`, default roles `super_admin, admin, manager, crm`; no role, designation or user overrides |
| Profiles with `crm.view` (counts) | admin 4 (4 active), super_admin 2 (2 active), crm 1 (0 active), staff 0 of 75. No `manager` profiles exist. |
| `developer_mode.manage` | 2 holders (the 2 super_admins). They can use a DISABLED section (see step 1). |
| Link file `C:\crm-private\work\crm-link-proposal.sql` | 5 branch links + 1 user link (exact email, owner-confirmed); 2 flagged user links commented out. Its 5 JewelOS branch ids and 1 profile id exist in production. That profile is an active **staff** member **without `crm.view`**: they need an individual grant (step 5). |

## 0. Pre-checks and production backup

**GATE 0: owner types `go`.**

1. Code state (in `C:\crm`):

   ```powershell
   cd C:\crm
   git fetch origin
   git status --short --branch            # clean, "## feat/crm-native...origin/feat/crm-native"
   git rev-parse HEAD origin/feat/crm-native   # identical; record the SHA
   git log --oneline HEAD..origin/main    # must be empty; if main moved, STOP (merge main, and
                                          # renumber 0183+ if main added a migration; re-run the gates)
   ```

2. Production still matches the preflight (read-only; run in the main checkout, which is linked):

   ```powershell
   cd C:\Users\MIS\Downloads\MKJewelOS
   Get-Content supabase\.temp\project-ref                      # yimafxhuwgfhvzczqqdd
   supabase.cmd migration list --linked                        # remote ends at 0181
   supabase.cmd db query --linked "select count(*) from pg_namespace where nspname in ('crm','crm_private')"   # 0
   supabase.cmd db query --linked "select count(*) from storage.buckets where id = 'crm-legacy-documents'"    # 0
   supabase.cmd db query --linked "select section_availability->'crm' as crm, developer_mode_enabled from public.tenant_section_controls"
   supabase.cmd functions list --project-ref yimafxhuwgfhvzczqqdd
   ```

3. Supabase backup: open https://supabase.com/dashboard/project/yimafxhuwgfhvzczqqdd/database/backups/scheduled
   and confirm the latest daily backup (or point-in-time recovery) covers today. Record its time.

4. Owner's own `pg_dump` (full database, custom format), stored outside Git:

   ```powershell
   New-Item -ItemType Directory -Force C:\crm-private\backups | Out-Null
   $env:PROD_DB_URL = Read-Host "JewelOS production database URL (postgres role, session pooler)"
   $env:DUMP_NAME = "jewelos-prod-pre-crm-$(Get-Date -Format yyyyMMdd-HHmm).dump"
   docker run --rm -e PROD_DB_URL -e DUMP_NAME -v C:\crm-private\backups:/backups postgres:17-alpine `
     sh -c 'pg_dump --format=custom --no-owner --file=/backups/$DUMP_NAME $PROD_DB_URL'
   $env:DUMP_NAME
   ```

   The single quotes keep `$PROD_DB_URL` for the container's shell, so the URL is never on a
   command line (a database URL has no spaces; percent-encode special characters in the password).

**Verify**
- [ ] `C:\crm-private\backups\$env:DUMP_NAME` exists and is larger than a few MB.
- [ ] `docker run --rm -e DUMP_NAME -v C:\crm-private\backups:/backups postgres:17-alpine sh -c 'pg_restore --list /backups/$DUMP_NAME' | Measure-Object -Line` shows thousands of entries.
- [ ] `Get-FileHash "C:\crm-private\backups\$env:DUMP_NAME"` recorded in the release record.
- [ ] Every item of 1-3 matches; the release record (playbook section 8) has SHA, backup time and dump hash.

**Rollback:** nothing was changed. Keep `$env:PROD_DB_URL` in this window for steps 2-5, or clear it (`Remove-Item Env:PROD_DB_URL`).

## 1. CRM section OFF (existing maintenance control)

**GATE 1: owner types `go`.**

The preflight found the section already OFF. Keep it OFF until step 8.

1. Sign in to the production web app as a super_admin. In the **Developer Mode** strip in the page
   header, make sure **CRM** is disabled (if it is on, switch it off; the change writes a
   `save_section_availability_with_audit` audit row). Leave Developer Mode's other sections as they are.
2. Tell both super_admins: do not open `/crm` (web or app) until step 8. A disabled section still
   admits holders of `developer_mode.manage` (the 2 super_admins), and opening the new `/crm` before
   step 5 would provision a new CRM user for them (design decision D2).

**Verify**
- [ ] `supabase.cmd db query --linked "select section_availability->'crm' from public.tenant_section_controls"` returns `false`.
- [ ] Signed in as an admin (not super_admin), the CRM menu item is gone and `/crm` shows the maintenance notice.

**Rollback:** switch CRM back to its previous state in the same strip (it was already OFF, so nothing to undo).

## 2. Apply the CRM migrations (dry run first)

**GATE 2: owner types `go`.**

**Hard precondition, checked fresh right here (not just at P1/gate 0 — the migrations become
permanent in production at this gate, so a stale check is not good enough):**

```powershell
cd C:\Users\MIS\Downloads\MKJewelOS
git fetch origin
git log --oneline origin/main | head -1              # must still be topped by a migration <= 0182
git ls-tree -r --name-only origin/main -- supabase/migrations | tail -1   # must be 0182_*
cd C:\Users\MIS\Downloads\MKJewelOS
supabase.cmd migration list --linked                 # remote applied must still end at 0182
```

If `origin/main` or production has picked up ANY `0183+` migration since the last renumbering (from
another session's work landing on `main`), **STOP**: do not push. Renumber the whole CRM series
(`C:\crm\supabase\migrations\0183_*.sql`..`0192_*.sql`) to start after the new highest number,
update every in-repo reference to the old numbers (docs, this checklist, `0193_crm_authorization_model.test.sql`
if its number is now taken), re-run the isolated pgTAP suite, commit, push `feat/crm-native`, and
re-present gate 2 with the corrected numbers before continuing. (This exact collision already
happened once, 2026-09-29: `main` took `0182_form_dependencies_fms_draft_safety.sql` before gate 0,
caught by this precondition, and the CRM series was renumbered from `0182-0191` to `0183-0192`
accordingly — this note documents that it is not hypothetical.)

**From this gate through gate 7, no other session may run `db push` or merge migrations to `main`.**
The owner is responsible for that coordination (say so to any other active session before typing
`go` here). Gates 2-7 should run in one sitting for this reason — a migration landing on `main`
mid-window reopens this exact precondition. After gate 7 merges `feat/crm-native`, `main`'s next
free migration number is **0193**.

Only `C:\crm` contains the CRM migrations, so it is linked to production for this step
(`supabase/.temp` is git-ignored and never committed):

```powershell
cd C:\crm
git status --short                                   # empty
supabase.cmd link --project-ref yimafxhuwgfhvzczqqdd # enter the database password when asked
Get-Content supabase\.temp\project-ref               # yimafxhuwgfhvzczqqdd; anything else: STOP
supabase.cmd migration list --linked                 # remote 0001-0182; local-only 0183-0192
supabase.cmd db push --linked --dry-run              # must list exactly the 10 files below, nothing else
```

Expected dry-run list: `0183_crm_schema_tables.sql`, `0184_crm_identity_bridge.sql`,
`0185_crm_functions_triggers.sql`, `0186_crm_rls_grants.sql`, `0187_crm_lookup_seed.sql`,
`0188_crm_storage_bucket.sql`, `0189_crm_direct_write_audit.sql`,
`0190_crm_ingest_service_grants.sql`, `0191_crm_deterministic_order.sql`,
`0192_crm_ensure_my_crm_user.sql`.

**GATE 2b: owner compares the dry run with that list and types `go`.** Then, once:

```powershell
supabase.cmd db push --linked
```

**Verify**
- [ ] `supabase.cmd migration list --linked` shows `0183`-`0192` on both sides.
- [ ] `supabase.cmd db query --linked "select string_agg(nspname, ',' order by nspname) from pg_namespace where nspname in ('crm','crm_private')"` returns `crm,crm_private`.
- [ ] `supabase.cmd db query --linked "select id, public, file_size_limit from storage.buckets where id = 'crm-legacy-documents'"` returns one row, `public = false`, `file_size_limit = 10485760`.
- [ ] `supabase.cmd db query --linked "select count(*) from crm.users"` returns `0`, and `select relname from pg_stat_user_tables where schemaname = 'crm' and n_live_tup > 0` lists only `lookup_*`, `lead_form_fields`, `lead_form_field_options`.
- [ ] The web app and the current APK still work (sign in, Home, Tasks): the migrations only add objects.

**Rollback:** migrations are forward-only and cannot be un-applied. The new objects are unused:
`crm` is not exposed (step 3), the section is OFF, and production web still serves the old
`/crm`. Leaving them in place is safe. If they must go before any data is imported, write a
reviewed forward migration (revoke the `crm` grants, or drop `crm`/`crm_private` and the empty
bucket) and apply it through the playbook. Never drop `crm` after step 4.

## 3. Expose schema `crm` in the Data API

**GATE 3: owner types `go`.**

1. Open https://supabase.com/dashboard/project/yimafxhuwgfhvzczqqdd/settings/api (Project Settings ->
   **Data API**). If the dashboard redirects, the same form is at
   https://supabase.com/dashboard/project/yimafxhuwgfhvzczqqdd/integrations/data_api/settings
   (Integrations -> Data API -> Settings).
2. In **Exposed schemas**, keep `public` and `graphql_public` and add **`crm`**. Never add `crm_private`.
   Leave **Extra search path** (`public, extensions`) and **Max rows** (1000) unchanged.
3. **Save**.

**Verify**
- [ ] The form shows `public, graphql_public, crm` after a page reload.
- [ ] A request with the public anon key no longer reports an invalid schema:
      ```powershell
      $anon = Read-Host "anon key"   # the public key from apps/mobile/.env or the dashboard
      curl.exe -s -H "apikey: $anon" -H "Accept-Profile: crm" "https://yimafxhuwgfhvzczqqdd.supabase.co/rest/v1/lookup_cities?select=id&limit=1"
      ```
      The response must NOT be `PGRST106` / "The schema must be one of the following". A permission
      error (anon has no `crm` privileges) or `[]` is correct.
- [ ] `crm_private` still returns `PGRST106` with `Accept-Profile: crm_private`.

**Rollback:** remove `crm` from Exposed schemas and save. Nothing else changes.

## 4. Import the data, copy Storage, reconcile (must be ACCEPTED)

**GATE 4: owner types `go`.** From here the original CRM is frozen until go-live (step 8).

Follow `docs/CRM_DATA_MIGRATION_RUNBOOK.md` sections 2 and 4-8 exactly. In short, in a new
PowerShell window in `C:\crm`:

1. **Freeze the original CRM** (runbook section 2): disable the Apps Script trigger on "01 WALKIN DATA",
   tell staff to stop using the old CRM app, take the source snapshot (option A, restored copy, as
   rehearsed; or option B, read-only direct URL).
2. **Supply the URLs** (owner types them; the target is the production `postgres` role):
   ```powershell
   cd C:\crm
   git pull --ff-only; pnpm.cmd install; node --test scripts/crm-import/lib.test.mjs   # 12 pass
   $env:CRM_IMPORT_SOURCE_URL = Read-Host "source database URL"
   $env:CRM_IMPORT_TARGET_URL = Read-Host "JewelOS production database URL"
   ```
3. **Dry run:**
   ```powershell
   node scripts/crm-import/import.mjs --dry-run --report=C:\crm-private\work\prod-dryrun.json
   ```
   Must end with `DRY RUN: reconciliation passed`; record the `source checksum sha256`.
4. **GATE 4b: owner reviews the dry run (runbook section 5 list) and types `go`.** Real run:
   ```powershell
   node scripts/crm-import/import.mjs --report=C:\crm-private\work\prod-import.json
   ```
   Must end with `IMPORT COMMITTED` and the same checksum.
5. **Storage copy** (all 22 objects, D1):
   ```powershell
   $env:SOURCE_SUPABASE_KEY = Read-Host "walk-in_crm key that can read crm-documents"
   $env:TARGET_SUPABASE_URL = "https://yimafxhuwgfhvzczqqdd.supabase.co"
   $env:TARGET_SUPABASE_SERVICE_KEY = Read-Host "JewelOS service role key"
   node scripts/crm-import/storage-copy.mjs --source-env=C:\crm-private\source.env `
     --files-dir=C:\crm-private\work\files --manifest=C:\crm-private\work\storage-manifest.json
   ```
   (add `--objects-table=source_storage.objects` for option A). Must report `failed 0` and
   `verified` = source object count.
6. **Reconcile:**
   ```powershell
   node scripts/crm-import/reconcile.mjs --out=C:\crm-private\work\prod-reconciliation.md `
     --storage-manifest=C:\crm-private\work\storage-manifest.json
   ```

**Verify**
- [ ] Reconciliation verdict **`ACCEPTED`**: every table equal in rows and hash, 0 FK orphans,
      rollups identical, every `crm.documents` path present, manifest 100% verified.
- [ ] Exactly one `public.audit_logs` row with action `crm.legacy_data_import`, whose checksum equals the dry run's.
- [ ] `select count(*) from crm.users where jewelos_profile_id is not null` = 0 (no links yet).

**Rollback** (before go-live only): runbook section 10. Truncate the `crm` tables in one transaction
with `session_replication_role = replica`, re-run the seed statements of
`supabase/migrations/0187_crm_lookup_seed.sql`, delete the copied objects from
`crm-legacy-documents`, add an audit note. `public.*` is never touched. Re-enable the original CRM
(Apps Script trigger, staff back on the old app). The import can then be repeated.

## 5. Identity and branch links (historical users + branches)

**GATE 5: owner types `go`.** This must finish before anyone opens the new `/crm` (D2).

Run the approved link file as an active **super_admin** (not an admin: while the `crm` section is
OFF, the link RPCs admit only holders of `developer_mode.manage`, i.e. the super_admins; an admin gets
"This section is currently unavailable"):

```powershell
$env:ADMIN_AUTH_USER_ID = Read-Host "auth.users id of an active JewelOS super_admin"
docker run --rm -e CRM_IMPORT_TARGET_URL -e ADMIN_AUTH_USER_ID -v C:\crm-private\work:/work:ro postgres:17-alpine `
  sh -c 'psql $CRM_IMPORT_TARGET_URL -v ON_ERROR_STOP=1 -v admin_auth_user_id=$ADMIN_AUTH_USER_ID -f /work/crm-link-proposal.sql'
```

The file is one transaction: it links 5 branches
(`crm.link_jewelos_branch`, D4: "Zaveri Bazaar" -> "ZAVERI BAZAR", EXHIBITION unlinked), then 1
user by exact email (`crm.link_jewelos_profile`, owner-confirmed). The 2 flagged user rows stay
commented out.

Then grant CRM access (owner decision: `crm.view` stays at its defaults; staff are granted one by
one): as super_admin, **Settings -> Permission management** (`/settings/permissions`) -> **Users**
tab -> the linked staff member -> `crm.view` = **Grant**. Repeat for every salesperson who will
use the CRM; each one's JewelOS branch must be one of the 5 linked branches.

**Verify** (read-only, `supabase.cmd db query --linked "<sql>"` from the main checkout):
- [ ] `select count(*) from crm.branches where jewelos_branch_id is not null` = **5**.
- [ ] `select count(*) from crm.users where jewelos_profile_id is not null` = **1**.
- [ ] `select action, count(*) from public.audit_logs where action like 'crm.link_jewelos_%' group by 1` = branch 5, profile 1.
- [ ] `select count(*) from public.audit_logs where action = 'crm.ensure_my_crm_user'` = 0 (nobody opened `/crm`).
- [ ] `select count(*) from public.user_permission_overrides where permission_key = 'crm.view' and effect = 'grant'` = the number of staff granted.

**Rollback** (before go-live): unlink through the same audited RPCs, as the same super_admin:
`select crm.link_jewelos_profile('<crm user id>', null);` and
`select crm.link_jewelos_branch('<crm branch id>', null);` (with the same `set_config` lines as the
link file). Remove the `crm.view` grants in Permission management.

## 6. Edge Functions and their secrets

**GATE 6: owner types `go`.**

Deploy from `C:\crm` (its `supabase/config.toml` sets `verify_jwt = false` for
`crm-walkin-ingest` and `true` for `crm-runo-push`):

```powershell
cd C:\crm
supabase.cmd functions deploy crm-walkin-ingest --project-ref yimafxhuwgfhvzczqqdd --use-api
supabase.cmd functions deploy crm-runo-push --project-ref yimafxhuwgfhvzczqqdd --use-api
```

Secrets, names only (values are entered by the owner in
https://supabase.com/dashboard/project/yimafxhuwgfhvzczqqdd/functions/secrets):

| Name | Value |
| --- | --- |
| `CRM_LEGACY_WALKIN_INGEST_API_KEY` | a NEW random key (do not reuse the original's). Generate it straight into the clipboard, never on screen: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_') \| Set-Clipboard`. Paste it here and keep it for step 11 (password manager). |
| `RUNO_API_KEY` | the same Runo `Auth-Key` the original CRM uses: its `RUNO_API_KEY` environment variable (the original's Vercel project -> Settings -> Environment Variables). |

Do **not** set `CRM_RUNO_API_URL` (local stubs only). `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` come from the Edge runtime.

**Verify**
- [ ] `supabase.cmd functions list --project-ref yimafxhuwgfhvzczqqdd` shows both ACTIVE, `crm-walkin-ingest` with `verify_jwt=False`, `crm-runo-push` with `verify_jwt=True`.
- [ ] The secrets page lists both names.
- [ ] No-key call is refused: `curl.exe -s -o NUL -w "%{http_code}" -X POST https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/crm-walkin-ingest` prints `401`.
- [ ] No-JWT call is refused: the same for `/functions/v1/crm-runo-push` prints `401`.

**Rollback:** delete the `CRM_LEGACY_WALKIN_INGEST_API_KEY` secret (the function then answers 503
to everything), or delete the functions in the dashboard (Edge Functions -> function -> Delete).
Nothing calls them yet.

## 7. Merge `feat/crm-native` into `main`, push, verify Vercel

**GATE 7: owner types `go`.** From this step on, production web serves the new `/crm`.

In the main checkout (other sessions share it: check its state first, and use no `git add -A`):

```powershell
cd C:\Users\MIS\Downloads\MKJewelOS
git status --short --branch             # on main; only unrelated untracked items (sreejith-crm/, temp files)
git fetch origin
git merge --ff-only origin/main         # local main = origin/main
git merge --no-ff origin/feat/crm-native -m "Merge feat/crm-native: original CRM as part of JewelOS"
git log --oneline -1                    # record the merge SHA
pnpm.cmd install
pnpm.cmd exec turbo run build --force --concurrency=1   # 6/6
git push origin main
```

Vercel deploys `main` to production (`vercel.json`: `pnpm --filter web build`, `apps/web/dist`).

**Verify**
- [ ] Vercel dashboard -> the JewelOS project -> Deployments: the production deployment for the merge SHA is **Ready**.
- [ ] On the production web origin (hard refresh): sign-in works; Home has no "CRM Tasks" group and no "CRM Follow-ups Due" panel; Reports lists no CRM report; Dashboard shows no CRM metric.
- [ ] As an admin, `/crm` still shows the maintenance notice (section OFF).
- [ ] The merge did not change any migration: `git diff --stat <previous main>..HEAD -- supabase/migrations` lists only `0183`-`0192`.

**Rollback:** `git revert -m 1 <merge SHA>`, push `main`, confirm Vercel redeploys (or promote the
previous production deployment in Vercel -> Deployments -> ... -> Promote to Production), and keep the
section OFF. Data in `crm` stays. From here the old `/crm` UI is gone from `main`; reverting the merge
brings it back.

Note: the AGENTS.md standing release instruction applies to `main` after this merge. The release
script now refuses to build without `EXPO_PUBLIC_JEWELOS_WEB_ORIGIN`, so no other session can ship
an APK with an unconfigured CRM tab before step 9.

## 8. Web smoke test, then CRM section ON

**GATE 8: owner types `go`.**

The section is still OFF, so do the test as a **super_admin** (admitted to a disabled section), then
switch the section ON and repeat the salesperson part.

A. As **super_admin** (maps to CRM super_admin), on the production web origin at desktop width and at
   phone width (browser devtools, 390 px):
- [ ] `/crm` opens the CRM with its own shell and title "MK Jewels CRM"; no "No CRM access".
- [ ] Every menu screen loads without an error: Home/queue (`/crm`), Dashboard, Queue, New visit,
      Clients, New client, a client profile (with imported history and a proof image), Follow-ups,
      Referrals, Allocation, New lead.
- [ ] Counts look plausible against the old CRM (e.g. the Clients total equals the reconciliation's `clients` rows).
- [ ] "← JewelOS" returns to the JewelOS Home.
- [ ] Test walk-in: **New visit** for a new client named `Synthetic Cutover Test`, phone
      `9100099998`, outcome **bought** (never "not bought": its follow-up history cannot be deleted),
      no referral, optionally one proof photo. It saves and appears on the client profile.
- [ ] Delete the test walk-in (read-only check first, then the delete in one transaction):
      ```sql
      -- run through the Supabase SQL editor (https://supabase.com/dashboard/project/yimafxhuwgfhvzczqqdd/sql/new)
      select c.client_id, c.primary_name,
             (select count(*) from crm.client_timeline t where t.client_id = c.client_id) as visits,
             (select count(*) from crm.not_bought_history h join crm.not_bought_followups f on f.id = h.followup_id where f.client_id = c.client_id) as not_bought_history,
             (select string_agg(d.storage_path, ' ') from crm.documents d where d.client_id = c.client_id) as proof_paths
      from crm.clients c join crm.client_phone_index p on p.client_id = c.client_id
      where p.phone = '9100099998';
      -- expect exactly 1 row, primary_name 'Synthetic Cutover Test', visits 1, not_bought_history 0.
      -- If not_bought_history > 0: do not delete; rename the client "TEST - ignore" instead.
      begin;
      insert into public.audit_logs(tenant_id, action, module, record_id, new_value)
      select (select id from public.tenants limit 1), 'crm.cutover_test_client_deleted', 'crm', c.client_id,
             jsonb_build_object('reason', 'cutover smoke test')
      from crm.client_phone_index p join crm.clients c on c.client_id = p.client_id
      where p.phone = '9100099998' and c.primary_name = 'Synthetic Cutover Test';
      delete from crm.clients c using crm.client_phone_index p
      where p.client_id = c.client_id and p.phone = '9100099998' and c.primary_name = 'Synthetic Cutover Test';
      -- expect DELETE 1, then:
      commit;
      ```
      Then delete the proof object(s) listed in `proof_paths` from bucket `crm-legacy-documents`
      (https://supabase.com/dashboard/project/yimafxhuwgfhvzczqqdd/storage/buckets/crm-legacy-documents).
      This delete was not rehearsed on a local stack; the transaction rolls back on any error.

B. Switch the section **ON**: Developer Mode strip in the header -> **CRM** enabled.

C. As a **salesperson-type account** (an active staff member with the `crm.view` grant from step 5
   and a branch linked in step 5), on a phone-width browser:
- [ ] `/crm` opens. Client search, client profiles and their history are visible **company-wide**
      (owner decision 2026-09-29, `docs/superpowers/specs/2026-09-25-crm-native-integration-design.md`
      "Authorization model": this matches the original CRM's own design, not a JewelOS narrowing).
      Writes (a new visit, follow-up, referral, allocation) stay limited to the salesperson's own
      linked branch, enforced by RLS. A person not linked in step 5 gets a new
      CRM user on the first open (one `crm.ensure_my_crm_user` audit row). A person whose email
      already belongs to a historical CRM user but who was not linked (the 2 flagged rows) gets
      no access until the owner decides and links them; this is by design (D2).
- [ ] Queue, New visit, Clients, client profile, Follow-ups and Referrals load.
- [ ] Sign out from the CRM menu ends the JewelOS session (back to the JewelOS sign-in).

D. Denied cases:
- [ ] A staff member WITHOUT `crm.view` sees no CRM menu; `/crm` lands on their first permitted section.
- [ ] An admin whose branch has no CRM branch (e.g. EXHIBITION) still enters as CRM super_admin (role map); a non-admin from EXHIBITION gets "No CRM access".

**Verify**
- [ ] `supabase.cmd db query --linked "select section_availability->'crm' from public.tenant_section_controls"` returns `true`.
- [ ] `select count(*) from crm.clients c join crm.client_phone_index p on p.client_id = c.client_id where p.phone = '9100099998'` = 0.
- [ ] `select count(*) from public.audit_logs where action = 'crm.ensure_my_crm_user'` matches the people who opened `/crm` for the first time.

**Rollback:** switch **CRM** OFF in the Developer Mode strip (immediately blocks CRM data
server-side for everyone but the super_admins). For a code problem, step 7's rollback.

## 9. Test APK on the owner's phone (not published)

**GATE 9: owner types `go`.**

1. The owner fills in the production web origin (the Vercel production domain from step 7), in
   the main checkout's untracked `apps/mobile/.env`:
   ```text
   EXPO_PUBLIC_JEWELOS_WEB_ORIGIN=https://<jewelos-web-origin>
   ```
   Origin only (no `/crm`, no trailing path). The value is not a secret but lives only in `.env`.
2. Build a signed test APK without publishing (main checkout, on `main`, source committed):
   ```powershell
   cd C:\Users\MIS\Downloads\MKJewelOS
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-mobile.ps1 -Notes "CRM test build" -NoPublish
   ```
   Check the printed line `CRM web origin (EXPO_PUBLIC_JEWELOS_WEB_ORIGIN, from apps/mobile/.env): https://...`
   before walking away (20-40 minutes).
3. Install on the owner's phone by USB (USB debugging on):
   ```powershell
   & C:\Android\platform-tools\adb.exe devices          # one device, "device"
   & C:\Android\platform-tools\adb.exe install -r "$HOME\JewelOS-releases\mobile-v<version>\JewelOS.apk"
   ```
   It is signed with the release key, so it installs over the published app and keeps the sign-in.

**Verify (device checklist)**
- [ ] Signed in, the **CRM** tab opens the CRM full-screen, already signed in (no second login).
- [ ] The client list loads; a client profile opens.
- [ ] A walk-in with a **camera photo** as proof saves (the file chooser offers the camera): new client `Synthetic Cutover Test`, phone `9100099997`, outcome **bought**. Delete it with the step 8 SQL (phone `9100099997`) and remove its proof object.
- [ ] Android **Back** goes back inside the CRM, then leaves the tab.
- [ ] A phone number (`tel:`) opens the dialer.
- [ ] **← JewelOS** returns to the JewelOS Home tab.
- [ ] **Sign out** of JewelOS, sign in as another user: the CRM shows the new user's data only, never the previous session.

**Rollback:** nothing was published. Uninstall is not needed: the next published release updates
over it. If the origin was wrong, fix `.env` and rebuild.

## 10. Release the APK

**GATE 10: owner types `go`** (and says whether this is `-Mandatory`; default: normal release).

```powershell
cd C:\Users\MIS\Downloads\MKJewelOS
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-mobile.ps1 -Notes "The CRM tab now opens the MK Jewels CRM."
git push origin main
```

**Verify**
- [ ] The script ends with `JewelOS <version> is live` and printed the right CRM web origin.
- [ ] `Invoke-RestMethod https://github.com/sreejith2005/mkjewelsOS/releases/latest/download/latest.json` reports the new `versionCode`, `requiredVersionCode` unchanged (0 unless `-Mandatory`).
- [ ] `(Invoke-WebRequest -Method Head https://github.com/sreejith2005/mkjewelsOS/releases/latest/download/JewelOS.apk).StatusCode` is 200 and its length equals the manifest's `sizeBytes`.
- [ ] `git rev-parse HEAD origin/main` are equal.
- [ ] Another phone on the previous version shows **Update available** and, after updating, the CRM tab works.

**Rollback:** phones cannot be downgraded. To stop the CRM on phones immediately, turn the CRM
section OFF (the tab shows the section notice). Fix forward with a new release. To stop phones that
have not updated yet: `gh release edit mobile-v<previous> --latest -R sreejith2005/mkjewelsOS`.

## 11. Apps Script walk-in feed

**GATE 11: owner types `go`.**

In the walk-in form script ("01 WALKIN DATA", `FORM CODE.GS`), follow
`docs/CRM_SHEETS_INGEST_CUTOVER.md` ("The Apps Script change"):

1. **Project settings -> Script properties**:
   `MK_CRM_INGEST_URL` = `https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/crm-walkin-ingest`,
   `MK_CRM_INGEST_API_KEY` = the key generated in step 6.
2. Paste the `pushWalkinToCrm_` function and its `try { ... }` call after the sheet write in `submitForm`. Save.
3. Re-enable the trigger disabled in step 4.
4. Submit one synthetic walk-in through the real form: name `Synthetic Ingest Test`, phone
   `9100099999`, branch = an active CRM branch, buy status **YES** (not NO; see step 8), no files.

**Verify**
- [ ] Apps Script -> Executions: no `CRM ingest HTTP` error logged (the response was `201`).
- [ ] `select outcome, count(*) from crm.legacy_walkin_ingest_attempts where created_at > now() - interval '1 hour' group by 1` shows `success 1`.
- [ ] `select action, count(*) from public.audit_logs where action like 'crm.legacy_walkin_ingest_%' and created_at > now() - interval '1 hour' group by 1` shows the ingest (ids and codes only, no name or phone).
- [ ] The client `Synthetic Ingest Test` is visible in `/crm`. Then delete it with the step 8 SQL (phone `9100099999`, name `Synthetic Ingest Test`). The ledger row stays as history.

**Rollback:** clear `MK_CRM_INGEST_URL` (the helper then skips the call; the Sheet keeps working on
its own), or remove the `CRM_LEGACY_WALKIN_INGEST_API_KEY` secret (503). Visits already written stay in
`crm`; do not replay them.

## 12. After the cutover

**GATE 12: owner types `go`** for each retirement item, separately, after the monitoring week.

Monitoring, one week:
- daily: Supabase -> Logs (Postgres errors mentioning `crm`, Edge Function logs of `crm-walkin-ingest` / `crm-runo-push`);
- daily: `select outcome, count(*) from crm.legacy_walkin_ingest_attempts where created_at > now() - interval '1 day' group by 1`;
- daily: `select action, count(*) from public.audit_logs where module = 'crm' and created_at > now() - interval '1 day' group by 1 order by 2 desc`;
- staff feedback on the CRM tab and web `/crm`; phones updating (GitHub release download count).

Retirement, only after the week is clean and each with the owner's go:
1. `sreejith-crm/` in the main checkout (read-only reference): archive it outside the repository, then delete it.
2. `C:\crm-private` (reports, manifest, files, backups): keep the production dump until the agreed retention ends; then archive or delete per the owner's decision.
3. The `C:\crm` worktree: `git worktree remove C:\crm` (after `feat/crm-native` is merged and pushed).
4. The backup branch of the CRM work (if one was created): `git push origin --delete <branch>` after confirming it is merged.
5. The original Supabase project `walk-in_crm` (`fsydcsyqnddacjfoutfe`) and the original CRM
   deployment: only after the agreed retention period and **written approval**; take a final
   `pg_dump` and Storage export first.

## Rollback strategy (summary)

| When | How | Data |
| --- | --- | --- |
| Before step 7 (steps 0-6) | Everything is reversible without data loss: section stays OFF; un-expose `crm`; runbook section 10 empties `crm` and the bucket; unlink through the audited RPCs; delete the function secrets/functions. The migrations stay (additive, unused). The old JewelOS `/crm` is still what production serves. | Nothing in `public` is touched. The original CRM is still the source of truth; unfreeze it. |
| After step 7 | Revert the merge commit on `main` (`git revert -m 1 <merge SHA>`, push; or promote the previous Vercel deployment) **and** turn the CRM section OFF. | Data in `crm` stays; do not truncate after go-live, fix forward with reviewed, audited changes. |
| After step 10 | Section OFF blocks the CRM tab server-side; fix forward with a new APK. | Same as above. |
| Apps Script (step 11) | Clear `MK_CRM_INGEST_URL` or remove the ingest secret. | Ingested visits stay in `crm`. |

No rollback deletes audit rows, CRM history, or the old JewelOS CRM tables.
