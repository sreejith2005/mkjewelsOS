# CRM two-project production runbook (owner)

Design: `docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md`.
Rules: `PRODUCTION_SWITCH_PLAYBOOK.md`. Every step here is a hosted action: **the owner runs
it**, in this order, and stops at the first surprise. Nothing in this file has been run.

Two projects are involved. Confirm which one you are on before **every** command:

| Project | Ref | Holds |
| --- | --- | --- |
| JewelOS | starts with `yima` | users, tasks, FMS, forms, leave, notifications |
| CRM | does **not** start with `yima` | clients, leads, families, referrals, visits, documents |

Never paste a password, key, token, dump or terminal output that contains customer values into
chat. Counts are fine.

## 0. Before you start

1. Release record (playbook section 8): commit SHA of `feat/crm-native`, approver, window,
   rollback owner.
2. Backups: both projects are on a paid plan; note the time of the latest automatic backup of
   each, or take a manual one from the dashboard.
3. Hidden prompt for any database URL (copy exactly):

   ```powershell
   $s = Read-Host "Database URL" -AsSecureString; $db = [System.Net.NetworkCredential]::new('', $s).Password
   ```

   Check the project ref inside the URL before pressing Enter on the next command.
4. Freeze: nobody uses the old CRM web app (it is unused today) and nobody edits CRM staff in
   the CRM dashboard during the window.

## a. Preflight (read-only)

### a1. CRM project: counts

Run in the CRM project's SQL editor (Dashboard > SQL). Each query returns counts only.

```sql
-- 1. CRM users without an auth user of the same id (the login bridge creates them on first sign-in).
select count(*) as users_without_auth from public.users u where not exists (select 1 from auth.users a where a.id = u.id);
-- 2. Existing SSO grants, and grants that would violate the new NOT VALID checks.
select count(*) as grants,
  count(*) filter (where crm_auth_user_id is not null and crm_auth_user_id <> legacy_crm_user_id) as session_check_violations,
  count(*) filter (where work_email <> lower(btrim(work_email))) as email_check_violations
from public.crm_sso_access_grants;
-- 3. Data still as expected (no live writer since the last import).
select (select count(*) from public.clients) as clients,
       (select max(last_visit_date) from public.clients) as newest_visit,
       (select count(*) from public.entry_queue) as queue_rows,
       (select count(*) from public.leads) as leads,
       (select count(*) from public.users) as crm_users,
       (select count(*) from public.branches where active) as active_branches;
-- 4. Lookup data present (the walk-in form needs it).
select (select count(*) from public.lookup_product_categories) as categories, (select count(*) from public.lookup_relations) as relations;
-- 5. Extensions the sync needs.
select extname from pg_extension where extname in ('pg_cron', 'pg_net');
```

Expected: (3) 1,568 clients and newest visit 2026-08-17, unless something wrote since; (4) not
zero; (5) both listed, otherwise enable `pg_cron` and `pg_net` (Dashboard > Database >
Extensions) before step c4. Any `session_check_violations` or `email_check_violations` above 0:
stop and send me the two numbers.

### a2. CRM project: schema still equals the baseline

```powershell
Set-Location C:\crm
$s = Read-Host "CRM project database URL" -AsSecureString; $db = [System.Net.NetworkCredential]::new('', $s).Password
supabase.cmd db dump --db-url "$db" --schema public -f C:\crm-private\crm-public-schema-preflight.sql
```

Then tell me it is there; I compare it with
`supabase-crm/supabase/migrations/20261001000000_crm_project_baseline.sql` (schema only, no
data) and report table, policy and function counts. Do not go on until the comparison is clean.

### a3. JewelOS project

```sql
-- Latest applied migration (expected: 0192, or 0193 if the FMS change already shipped).
select max(version) from supabase_migrations.schema_migrations;
-- Nothing was created in the JewelOS crm schema after the import (counts only).
select (select count(*) from crm.clients) as clients,
       (select max(created_at) from crm.client_timeline) as newest_timeline,
       (select count(*) from crm.entry_queue where created_at > '2026-08-17') as queue_after_import,
       (select count(*) from crm.leads where created_at > '2026-08-17') as leads_after_import;
```

Expected: 1,568 clients; newest timeline 2026-08-17; 0 and 0. If the last two are not 0,
staff used `/crm` on JewelOS after the import: stop, those rows must be copied first.

### a4. Owner lists (needed in step d)

1. **Branch map**: each active CRM branch name -> the JewelOS branch whose staff work there.
2. **Staff link list**: each historical CRM user who is a current JewelOS person -> that
   person (JewelOS user). People not on the list get a new CRM user; historical CRM users stay
   as history either way. Proposals from the earlier design are in `C:\crm-private\work`
   (`branch-mapping-proposal.csv`, `identity-mapping-proposal.csv`); they need your approval.

## b. Apply the migrations

### b1. CRM project (from `C:\crm`, branch `feat/crm-native`)

```powershell
Set-Location C:\crm
supabase.cmd link --project-ref <crm-project-ref> --workdir supabase-crm
# The CRM project was built with Prisma: record the baseline as already applied (it IS the hosted schema).
supabase.cmd migration repair --status applied 20261001000000 --linked --workdir supabase-crm
supabase.cmd migration list --linked --workdir supabase-crm
supabase.cmd db push --linked --workdir supabase-crm --dry-run
```

The dry run must list exactly these, in order:

```
20261001000100_crm_lead_call_history
20261001000200_crm_private_audit_log
20261001000300_crm_rpc_audit_and_deterministic_order
20261001000400_crm_minimal_grants
20261001000500_crm_identity_session_bridge
20261001000600_crm_documents_storage
20261005000100_crm_staff_roster_sync
20261005000200_crm_walkin_ingest
20261005000300_crm_client_identity
20261005000400_crm_walkin_task_outbox
```

Then `supabase.cmd db push --linked --workdir supabase-crm`. Re-run query a1-3: the counts are
unchanged except that every client now has an MKREF code
(`select count(*) from clients where referral_code is null` returns 0).

Effect on day one: nothing user-visible yet. The old CRM web app's sign-in no longer opens
data (the identity gate needs a JewelOS grant), which is intended.

### b2. JewelOS project (from `C:\crm`, without merging)

Do **not** push `main` yet: a push to `main` starts the Vercel production build, and `/crm`
must not switch to the CRM project before steps c to e are done (that happens in step f).
The JewelOS migrations are applied from the worktree, which has them.

```powershell
Set-Location C:\crm
supabase.cmd link --project-ref <jewelos-ref>
supabase.cmd migration list --linked
supabase.cmd db push --linked --dry-run         # expected: 0195_crm_staff_sync_outbox, 0196_crm_walkin_tasks
supabase.cmd db push --linked
```

0195 queues one event per existing JewelOS profile. Nothing is sent until c4. Both migrations
are additive: the current production web keeps working unchanged.

## c. Functions, secrets and schedules

Generate each secret yourself (for example `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`
in a PowerShell window you then close) and type it into the dashboard (Edge Functions >
Secrets). Never on a command line. Pairs that must be equal are marked.

### c1. CRM project functions

```powershell
Set-Location C:\crm
foreach ($f in 'crm-session-exchange','crm-runo-push','crm-walkin-ingest','sync-receive','sync-deliver') { supabase.cmd functions deploy $f --workdir supabase-crm --use-api }
```

CRM project secrets:

| Secret | Value |
| --- | --- |
| `JEWELOS_SUPABASE_URL` | `https://<jewelos-ref>.supabase.co` |
| `JEWELOS_SUPABASE_ANON_KEY` | JewelOS anon key |
| `CRM_BRIDGE_ALLOWED_ORIGINS` | the production web origin(s), comma separated, e.g. `https://<jewelos-web-domain>` |
| `RUNO_API_KEY` | the Runo key the original used |
| `CRM_LEGACY_WALKIN_INGEST_API_KEY` | new random value (A) |
| `CRM_SYNC_INBOUND_SECRET` | new random value (B) |
| `CRM_SYNC_OUTBOUND_SECRET` | new random value (C) |
| `CRM_SYNC_CRON_SECRET` | new random value (D) |
| `JEWELOS_SYNC_RECEIVE_URL` | `https://<jewelos-ref>.supabase.co/functions/v1/crm-sync-receive` |

Do not set `CRM_RUNO_API_URL` (local tests only).

### c2. JewelOS project functions

```powershell
Set-Location C:\crm
supabase.cmd functions deploy crm-staff-sync --use-api
supabase.cmd functions deploy crm-sync-receive --use-api
```

| Secret | Value |
| --- | --- |
| `CRM_STAFF_SYNC_CRON_SECRET` | new random value (E) |
| `CRM_SYNC_RECEIVE_URL` | `https://<crm-ref>.supabase.co/functions/v1/sync-receive` |
| `CRM_SYNC_OUTBOUND_SECRET` | **= B** (JewelOS -> CRM) |
| `CRM_SYNC_INBOUND_SECRET` | **= C** (CRM -> JewelOS) |

### c3. Check the functions answer before scheduling

```powershell
# Each must answer 401 (the function itself refusing), not 404/503:
curl.exe -s -o NUL -w "%{http_code}\n" -X POST https://<jewelos-ref>.supabase.co/functions/v1/crm-staff-sync
curl.exe -s -o NUL -w "%{http_code}\n" -X POST https://<jewelos-ref>.supabase.co/functions/v1/crm-sync-receive
curl.exe -s -o NUL -w "%{http_code}\n" -X POST https://<crm-ref>.supabase.co/functions/v1/sync-receive
curl.exe -s -o NUL -w "%{http_code}\n" -X POST https://<crm-ref>.supabase.co/functions/v1/sync-deliver
curl.exe -s -o NUL -w "%{http_code}\n" -X POST https://<crm-ref>.supabase.co/functions/v1/crm-walkin-ingest
```

A `503` means a secret is missing on that project.

### c4. Schedules (pg_cron)

Store the cron secrets in Vault first (Dashboard > Vault, "Add new secret"): on JewelOS a
secret named `crm_staff_sync_cron_secret` = E; on the CRM project `crm_sync_cron_secret` = D.
Then run in each project's SQL editor.

JewelOS (roster sync every minute, reconciliation daily at 02:30 IST = 21:00 UTC):

```sql
select cron.schedule('crm-staff-sync-deliver', '* * * * *', $job$
  select net.http_post(
    url := 'https://<jewelos-ref>.supabase.co/functions/v1/crm-staff-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_staff_sync_cron_secret')),
    body := '{"mode":"deliver"}'::jsonb, timeout_milliseconds := 30000);
$job$);
select cron.schedule('crm-staff-sync-reconcile', '0 21 * * *', $job$
  select net.http_post(
    url := 'https://<jewelos-ref>.supabase.co/functions/v1/crm-staff-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_staff_sync_cron_secret')),
    body := '{"mode":"reconcile"}'::jsonb, timeout_milliseconds := 60000);
$job$);
```

CRM project (walk-in events to JewelOS every minute):

```sql
select cron.schedule('crm-sync-deliver', '* * * * *', $job$
  select net.http_post(
    url := 'https://<crm-ref>.supabase.co/functions/v1/sync-deliver',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_sync_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$job$);
```

## d. Provision staff access (CRM project, SQL editor)

Do d1 and d2 **before** the first roster delivery finishes, or run the reconciliation again
afterwards (d3); either way the end state is the same.

d1. Branch map, one line per CRM branch from list a4-1:

```sql
update public.branches set jewelos_branch_id = '<jewelos branch id>' where name = '<CRM branch name>';
```

d2. Staff link list, one line per approved person from list a4-2:

```sql
insert into crm_private.staff_links (jewelos_user_id, legacy_crm_user_id, approved_by)
values ('<jewelos user_profiles.id>', '<crm users.id>', 'Owner, <date>');
```

d3. Run the reconciliation once now (JewelOS SQL editor):

```sql
select net.http_post(url := 'https://<jewelos-ref>.supabase.co/functions/v1/crm-staff-sync',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_staff_sync_cron_secret')),
  body := '{"mode":"reconcile"}'::jsonb);
```

d4. Check (CRM project): `select public.crm_sync_health();` does not work in the SQL editor
(it needs a CRM super admin); use the counts instead:

```sql
select outcome, reason, count(*) from crm_private.staff_sync_state group by 1, 2 order by 1, 2;
select counts from crm_private.staff_sync_runs order by created_at desc limit 1;
```

Expected: `granted` for every CRM-eligible JewelOS person; `blocked/needs_link` means a
historical CRM user has that email and is not on the link list (add it to d2, or confirm a new
CRM user is wanted by changing nothing and telling me); `blocked/unmapped_branch` means d1 is
missing a branch. `active_for_ineligible` must be 0.

## e. Vercel environment

Project settings > Environment Variables, **Production** (and separately for Preview with the
staging values if a staging CRM exists):

| Name | Value |
| --- | --- |
| `VITE_CRM_SUPABASE_URL` | `https://<crm-ref>.supabase.co` |
| `VITE_CRM_SUPABASE_ANON_KEY` | the CRM project's anon key |

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` stay as they are (JewelOS).

## f. Merge and deploy the web app

Only after steps b to e (CRM functions answer, secrets set, Vercel variables saved, staff
provisioned):

```powershell
Set-Location C:\Users\MIS\Downloads\MKJewelOS
git fetch; git status --short --branch        # main must be clean apart from known untracked files
git merge --no-ff feat/crm-native
git push origin main
```

The push starts the Vercel production build. From this deployment on, `/crm` reads and writes
the CRM project.

## g. Smoke test (controlled accounts)

1. Sign in to JewelOS as a super admin, open `/crm`: dashboard and client database load; the
   header search finds a client by phone, by name and by its `MKC-` code.
2. A salesperson (granted in d): `/crm` opens, scoped writes work, the walk-in CRM dropdown
   lists only JewelOS CRM-role people of the branch (since 2026-10-07, see
   `docs/CRM_ROSTER_FROM_USERS_ROLLOUT.md`). A JewelOS user without CRM access cannot open `/crm`.
3. **Hosted CORS header** (local could not prove it):

   ```powershell
   curl.exe -s -i -X OPTIONS https://<crm-ref>.supabase.co/functions/v1/crm-session-exchange -H "Origin: https://<jewelos-web-domain>" -H "Access-Control-Request-Method: POST" | Select-String "access-control-allow-origin"
   curl.exe -s -o NUL -w "%{http_code}\n" -X POST https://<crm-ref>.supabase.co/functions/v1/crm-session-exchange -H "Origin: https://evil.example"
   ```

   Expected: the first prints your web origin (or `*`, which is acceptable: the function refuses
   foreign origins itself); the second prints `403`.
4. Walk-in ingest: the synthetic test of `docs/CRM_SHEETS_INGEST_CUTOVER.md` (201, then 200).
5. Roster: in JewelOS Users rename a test account that has CRM access; within two minutes the
   CRM walk-in dropdown shows the new name. Deactivate it: `/crm` refuses it within one token
   lifetime (1 hour) and immediately after the next sync.
6. Walk-in task: register a synthetic walk-in in `/crm` queue; within two minutes the salesperson
   has the task "Complete walk-in form - ..." in JewelOS; submit the walk-in form; the task
   closes.
7. CRM super admin: the `/crm` dashboard shows CRM SYNC HEALTH with no failing or dead events.
8. Android app: open the CRM tab on a phone; it loads `/crm` (no APK is needed: the app was
   not changed).

Then the Apps Script steps of `docs/CRM_SHEETS_INGEST_CUTOVER.md` (live push, then backfill).

## h. Rollback

- **Web**: promote the previous Vercel deployment. `/crm` then reads the JewelOS `crm` schema
  again (unchanged and still in place). Walk-ins and edits made in the CRM project during the
  window are not visible there; they stay in the CRM project for the next attempt.
- **Sync**: `select cron.unschedule('crm-staff-sync-deliver'); select cron.unschedule('crm-staff-sync-reconcile');`
  (JewelOS) and `select cron.unschedule('crm-sync-deliver');` (CRM). Events keep queuing and
  drain when re-scheduled.
- **Apps Script**: clear `MK_CRM_INGEST_URL`.
- **Functions**: removing a function's secret makes it refuse everything (503).
- **Migrations** are not rolled back. They are additive; a correction is a new forward
  migration. No rollback deletes CRM users, history or audit rows.

## Later (separate approvals)

1. Retire the JewelOS `crm` schema (0183-0192 are applied in production): a forward migration
   that revokes API access to `crm`, after a week of stable CRM-project operation. The data stays.
2. Staff move walk-in capture from the Sheet to `/crm` on an agreed date (phase 6).
3. Channel sheets (Runo, Instagram, WhatsApp, website) -> `crm-channel-ingest` (phase 7).
