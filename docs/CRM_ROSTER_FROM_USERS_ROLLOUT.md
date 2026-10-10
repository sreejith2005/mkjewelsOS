# CRM roster from JewelOS Users and Availability: rollout

Owner decision 2026-10-07. The CRM ROSTER / ALLOCATION page is removed. Who appears as a CRM
person in a branch (walk-in form, queue dropdowns, round robin) and who is absent today now
come from JewelOS:

- **On the roster**: JewelOS Users > Department is **CRM** (department code `CRM`; since 0202)
  or Role is **CRM**, the person has CRM access (login enabled,
  active, not resigned, `crm.view`), and their JewelOS branch is mapped to a CRM branch. Staff,
  managers and admins keep their CRM access but are not on the roster.
- **Absent on a date**: JewelOS Availability says they are not available that day: an absent
  entry (including approved leave), their weekly off, or a non-active working status. A half
  day counts as available, as it does for tasks.
- Changes reach the CRM within about two minutes (the existing staff sync), and the 02:30 IST
  reconciliation re-sends everyone, which also covers the next day.

Migrations: JewelOS `supabase/migrations/0201_crm_roster_from_users.sql`; CRM project
`supabase-crm/supabase/migrations/20261007000900_crm_roster_from_users.sql`. No Edge Function
changes. Either project may be migrated first: the CRM keeps the old behaviour until snapshots
carry the roster fields.

Every step on a hosted project follows `PRODUCTION_SWITCH_PLAYBOOK.md` and is run by, or in
front of, the owner.

## 1. Preflight (read-only)

CRM project SQL editor: what is on the roster today.

```sql
select b.name as branch, count(*) filter (where a.active) as active_rows,
  count(*) filter (where a.active and a.crm_user_id is null) as active_without_synced_person
from crm_allocation a join branches b on b.id = a.branch_id group by 1 order by 1;
```

JewelOS project SQL editor: who will be on the roster.

```sql
select b.name as branch, count(*) as crm_role_people
from user_profiles p join branches b on b.id = p.branch_id
where p.user_role = 'crm' and p.account_status = 'active' and p.working_status <> 'resigned'
  and coalesce(p.is_login_enabled, false)
group by 1 order by 1;
```

If a branch's CRM staff are not role **CRM** in JewelOS Users, change their role there first,
or they will drop out of that branch's walk-in dropdown. A row "without synced person" is a
name typed in before the sync: it is kept if a CRM-role person with exactly that name exists
in that branch, otherwise it becomes inactive (kept as history, never deleted).

## 2. Apply the migrations

```powershell
supabase.cmd db push --linked --workdir supabase-crm --dry-run   # CRM project: expect 20261007000900_crm_roster_from_users
supabase.cmd db push --linked --workdir supabase-crm
supabase.cmd db push --linked --dry-run                          # JewelOS project: expect 0201_crm_roster_from_users
supabase.cmd db push --linked
```

Confirm the linked project ref before each push (JewelOS ref starts `yima`, CRM project
`fsydcsyqnddacjfoutfe`). Each dry run must list only the migration above.

0201 enqueues every person once; the worker delivers them within a few minutes.

## 3. Reconcile once and check

JewelOS SQL editor (as runbook step d3):

```sql
select net.http_post(url := 'https://<jewelos-ref>.supabase.co/functions/v1/crm-staff-sync',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_staff_sync_cron_secret')),
  body := '{"mode":"reconcile"}'::jsonb);
```

CRM SQL editor:

```sql
select counts from crm_private.staff_sync_runs order by created_at desc limit 1;
```

Expected: `roster_rows_without_user` 0, `roster_conflicts` 0, `active_for_ineligible` 0, and
`active_roster_rows` equal to the CRM-role count from step 1 (for mapped branches). A conflict
means two CRM-role people in one branch have the same name: make the names distinct in
JewelOS Users. Re-run the preflight CRM query to see the new roster per branch.

## 4. Deploy the web app

Merge the branch to `main`; Vercel (project `mkjewels-os`) deploys it. The CRM menu no longer
shows ROSTER / ALLOCATION; CRM SYNC HEALTH moves to the CRM dashboard for super admins.
No APK is needed: the Android app loads `/crm` from the web.

## 5. Smoke test

1. JewelOS Users: set a test person's role to CRM (branch mapped, CRM access on). Within two
   minutes they appear in that branch's CRM walk-in dropdown.
2. JewelOS Availability: mark them absent today. Within two minutes they disappear from the
   dropdown and the round robin; remove the absence and they return.
3. Change their role to Staff: they leave the dropdown but can still open `/crm`.
4. As a CRM super admin, the CRM dashboard shows CRM SYNC HEALTH with no failing events.

## Rollback

Promote the previous Vercel deployment to restore the page. The roster and availability then
stay as JewelOS last set them; manual editing would need a forward migration that re-grants
`manage_crm_roster` and the table writes to `authenticated`. Nothing is deleted.
