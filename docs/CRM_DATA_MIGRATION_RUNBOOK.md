# CRM data migration runbook (Phase 7)

Moves the original MK Jewels CRM's data (Supabase project `walk-in_crm`, schema `public`, bucket
`crm-documents`) into JewelOS production (schema `crm`, bucket `crm-legacy-documents`).
Design: `docs/superpowers/specs/2026-09-25-crm-native-integration-design.md`. Tooling:
`scripts/crm-import/` (see its README). The Phase 5 rehearsal (2026-09-28) ran this procedure end to
end against local stacks; its private record is in `C:\crm-private\work` and is never committed.

Owner decisions (2026-09-28, recorded in the design as D1-D8): copy ALL source Storage objects
(D1); first-use provisioning by `crm.ensure_my_crm_user` with the historical-user link list run
BEFORE go-live (D2, step 9); JewelOS decides CRM roles (D3); CRM "Zaveri Bazaar" -> JewelOS
"ZAVERI BAZAR", JewelOS "EXHIBITION" without a CRM branch (D4); deterministic ORDER BY in the
port (D5, migration 0190); `lead_call_history` kept empty (D6); SSO rows/tables not imported
(D7); stored source rollups kept, including the one client whose stored `last_branch_id` differs
from a recomputation (D8).

Order at a glance: freeze -> backup -> dry run -> import -> Storage copy -> reconciliation ->
identity and branch links -> only then open `/crm` (web) and ship the APK. Nobody may open the
production `/crm` between the migration apply and step 9: `crm.ensure_my_crm_user` would
provision a NEW CRM user for an eligible historical person who is not linked yet (it never
matches by email; an email already in `crm.users` only blocks provisioning).

Every step here is an owner-approved production action. Follow `PRODUCTION_SWITCH_PLAYBOOK.md` for
the approvals. Nothing in this runbook stores a URL, key or password: the owner types them into the
PowerShell session at run time, and the session is closed at the end.

## 0. Data-handling rules

- Customer data, exports, reports, manifests, downloaded files and screenshots live only in
  `C:\crm-private` (the tools refuse to write report/manifest/file paths inside a Git working tree).
- Console output is counts, table names, ids and hashes. Never paste a report, a CSV or a psql error
  containing values into chat, a commit, an issue or a document.
- Never run `--linked` from an agent session. Hosted commands are run by, or in front of, the owner.

## 1. Pre-checks (owner and operator, before the freeze)

1. JewelOS production has the CRM migrations applied through the production playbook. Their numbers
   must follow main's highest migration at that time (they are `0182`-`0191` today; renumber first if
   main moved). `crm` is in the API's exposed schemas and bucket `crm-legacy-documents` exists.
2. The target `crm` schema holds only the rows seeded by `0186_crm_lookup_seed.sql`. In the SQL editor:

   ```sql
   select relname, n_live_tup from pg_stat_user_tables where schemaname = 'crm' and n_live_tup > 0 order by 1;
   ```

   Only the nine `lookup_*` tables seeded by 0186, `lead_form_fields` and `lead_form_field_options` may be listed
   (the importer re-checks with exact counts and refuses otherwise).
3. Identity/branch mapping has been reviewed: the owner has approved (or corrected)
   `C:\crm-private\work\identity-mapping-proposal.csv` and `branch-mapping-proposal.csv`, and every
   CRM user who needs access has an active JewelOS profile with a role that maps to the right CRM role
   (`super_admin`/`admin` -> super_admin, `manager` -> branch_manager, `crm`/`staff` -> salesperson) and `crm.view`.
4. A source Storage key that can read the private `crm-documents` bucket is available to the owner
   (service role key of `walk-in_crm`; it is used for GET requests only).
5. Tooling is current: `git -C C:\crm pull --ff-only`, `pnpm.cmd install`, then
   `node --test scripts/crm-import/lib.test.mjs`.

## 2. Freeze the original CRM

1. Announce the cut-over window. Stop writes to the original CRM: disable the Google Apps Script
   trigger (see `docs/CRM_SHEETS_INGEST_CUTOVER.md`) and ask staff to stop using the old app, or put it
   in maintenance.
2. Take the source snapshot after the freeze. Either:
   - **A. Restored copy (as rehearsed, recommended):** export `walk-in_crm` (`supabase db dump` for schema
     and `--data-only` for data) into `C:\crm-private`, restore it locally exactly as in the rehearsal
     (Prisma migrations, production-only drift tables, data with triggers off, Storage rows in
     `source_storage`), and use the local URL as the source. The Storage object list then comes from
     `source_storage.objects`.
   - **B. Direct read:** use the `walk-in_crm` database URL as the source. The importer opens a
     `repeatable read, read only` transaction on it and never writes. The object list comes from
     `storage.objects`.

## 3. Back up JewelOS production

Before any write: take an on-demand backup in the Supabase dashboard (Database -> Backups) or confirm
point-in-time recovery covers the window, and record the backup time. Optionally also dump the target
`crm` schema and `public.audit_logs` with the owner's URL into `C:\crm-private\backups`.

## 4. Supply the URLs (owner, at run time)

In a new PowerShell window in `C:\crm`:

```powershell
$env:CRM_IMPORT_SOURCE_URL = Read-Host "source database URL"            # restored copy or walk-in_crm (read-only use)
$env:CRM_IMPORT_TARGET_URL = Read-Host "JewelOS production database URL" # owner role; session pooler or direct
```

Use the database owner role (`postgres`) for the target: the load sets
`session_replication_role = replica` so no trigger regenerates client codes, rollups, phone
indexes, edit logs or per-row audit rows. Do not use `--replace-local` (it is refused for a remote target).

## 5. Dry run

```powershell
node scripts/crm-import/import.mjs --dry-run --report=C:\crm-private\work\prod-dryrun.json
```

It copies everything inside one transaction, reconciles, and rolls back. Accept only if it ends with
`DRY RUN: reconciliation passed` and:

- every table line shows `rows =` and `hash =`;
- `excluded` lists only `_prisma_migrations` and the SSO tables (`crm_sso_access_grants`,
  `crm_sso_access_audit`; the committed SSO migration's names `crm_access_grants`/`crm_sso_audit_logs` are
  excluded too); a target-only table (e.g. `lead_call_history`, whose original migration was never
  applied in production) is reported and left empty;
- seeded lookups show `seed-only removed` 0 unless the owner accepts the listed difference;
- `FK orphans: none`; sequences show `next` = highest value in use + 1.

Record the printed `source checksum sha256`.

## 6. Real run

```powershell
node scripts/crm-import/import.mjs --report=C:\crm-private\work\prod-import.json
```

It must end with `IMPORT COMMITTED` and print the same source checksum as the dry run (the source was
frozen). One transaction: any failure rolls everything back, and the run can be repeated. What it does:

- copies every source table (except the excluded ones) into `crm.*` with the same columns, ids and
  stored values, including rollups, client codes, edit logs, timestamps and `created_by` fields;
- replaces the seeded lookup and lead-form rows with the source rows, so every row keeps its SOURCE
  id; each seeded row is matched by `label` (lead form fields by `field_key`, options by field key
  and value) and its seed id -> source id remap is recorded in the report (no other row references a
  seed id at that point, because the rest of `crm` is empty);
- moves each `crm` sequence to the greater of the source position and the highest value in use;
- writes exactly one `public.audit_logs` row, action `crm.legacy_data_import` (counts, seeded-lookup
  counts, sequences and the source checksum; no customer values). The tenant is the only tenant, or
  `--tenant-id=<uuid>`.

## 7. Storage copy

```powershell
$env:SOURCE_SUPABASE_KEY = Read-Host "walk-in_crm key that can read crm-documents"
$env:TARGET_SUPABASE_URL = Read-Host "JewelOS project URL"
$env:TARGET_SUPABASE_SERVICE_KEY = Read-Host "JewelOS service role key"
node scripts/crm-import/storage-copy.mjs --source-env=C:\crm-private\source.env `
  --files-dir=C:\crm-private\work\files --manifest=C:\crm-private\work\storage-manifest.json `
  [--objects-table=source_storage.objects]   # option A in step 2
```

Path rule: the object path is unchanged; only the bucket changes (`crm-documents` ->
`crm-legacy-documents`, migration 0187), so the imported `crm.documents.storage_path` values need no
change. Every object in the source bucket is copied, including objects no document row references
(D1: all 22 at the rehearsal, of which 9 are referenced).
Each download is checked against the source size and eTag (MD5), each upload is read back and compared
by size and SHA-256. It can be re-run: files already downloaded are reused and objects already in the
target are verified, never overwritten. Accept only `failed 0` and `verified` = source objects.

Note: the Storage API sets no owner on copied objects, so the original uploader cannot delete an
imported proof; a CRM super_admin still can (policy `crm_legacy_documents_uploader_or_admin_delete`).

## 8. Reconciliation (acceptance)

```powershell
node scripts/crm-import/reconcile.mjs --out=C:\crm-private\work\prod-reconciliation.md `
  --storage-manifest=C:\crm-private\work\storage-manifest.json
```

Accept only when the verdict is `ACCEPTED`, i.e.:

1. every table: source rows = target rows and content hash equal (all copied columns, primary-key order);
2. zero foreign-key orphans in `crm`;
3. client rollups: the source and target results are identical. Differences from a recomputation
   from `client_timeline` are reported with client ids and are **not fixed**: the stored source
   values are the truth;
4. Storage: every `crm.documents` path exists in `crm-legacy-documents`, and the manifest verified 100%;
5. exactly one `crm.legacy_data_import` audit row, whose checksum equals the dry run's.

## 9. Identity and branch links (after owner approval, BEFORE go-live)

Run the approved link file (generated in the rehearsal as `C:\crm-private\work\crm-link-proposal.sql`;
regenerate it against production ids if JewelOS profiles changed) as an active JewelOS super_admin or admin:

```powershell
psql $env:CRM_IMPORT_TARGET_URL -v admin_auth_user_id=<auth.users id of that admin> -f C:\crm-private\work\crm-link-proposal.sql
```

It links branches first, then users, through `crm.link_jewelos_branch` / `crm.link_jewelos_profile`
(audited). Only exact normalized email matches (users) and exact name matches (branches) are
proposed; flagged rows are commented out until the owner decides. Owner decisions already in the
file: D4 links CRM "Zaveri Bazaar" to JewelOS "ZAVERI BAZAR" (EXHIBITION stays unlinked); D3
activates the exact-email user whose roles differed (JewelOS decides the role).

This step must complete before anyone opens `/crm` in production (D2). Afterwards, any other
eligible JewelOS user (crm.view, mapped role, linked branch) gets a CRM user on first open,
audited as `crm.ensure_my_crm_user`; check with
`select count(*) from public.audit_logs where action = 'crm.ensure_my_crm_user';` after go-live. Check with
`select * from crm.list_identity_links();`, then have each linked person open `/crm`.

## 10. Rollback

Before go-live (nobody has written through the new `/crm` yet), the import can be undone without
touching `public.*`:

```sql
begin;
set local session_replication_role = replica;
truncate crm.branches, crm.campaigns, crm.client_campaign_tags, crm.client_edit_log, crm.client_phone_index,
  crm.client_timeline, crm.clients, crm.crm_allocation, crm.crm_daily_availability, crm.crm_queue_round_robin,
  crm.documents, crm.entry_queue, crm.lead_call_history, crm.lead_form_field_options, crm.lead_form_fields,
  crm.lead_stage_history, crm.leads, crm.legacy_import_keys, crm.legacy_walkin_ingest_attempts,
  crm.legacy_walkin_ingest_rate_limits, crm.lookup_beverages, crm.lookup_cities, crm.lookup_communities,
  crm.lookup_gifts, crm.lookup_not_bought_reasons, crm.lookup_pincodes, crm.lookup_product_categories,
  crm.lookup_relations, crm.lookup_snacks, crm.lookup_source_of_leads, crm.lookup_sugar_options,
  crm.not_bought_followups, crm.not_bought_history, crm.referral_calling, crm.referral_calling_history,
  crm.referrals, crm.users, crm.visit_forms;
commit;
```

Then re-run the seed statements of `supabase/migrations/0186_crm_lookup_seed.sql` (idempotent
upserts) to restore the seeded lookups, delete the copied objects from `crm-legacy-documents`
(Storage API or dashboard), and add an audit note of the rollback. The import's audit row stays as
history. `public.*` (users, tasks, the old JewelOS CRM tables) is never touched by the import or by
this rollback. After go-live, do not truncate: fix forward with reviewed, audited changes.

## 11. Afterwards

- Close the PowerShell window (the URLs and keys were only in its environment).
- Keep `C:\crm-private\work` (reports, manifest, files) until the owner signs off, then archive or
  delete per the owner's retention decision.
- Update the plan's Phase 7 status and `docs/CRM_SHEETS_INGEST_CUTOVER.md` with the go-live date
  (no data).
