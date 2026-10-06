# CRM <-> Google Sheet two-way sync: implementation plan (2026-10-06)

Approved design (owner, 2026-10-06): https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D
("CRM Sheet Sync Design"). Owner answers to its open questions:

1. The family tab is **FAMILY DATA** (the script finds it by name in the walk-in or CRM file).
2. Calculated WALKIN DATASET columns: detected at run time. A column whose cell in the last
   data row holds a formula gets that formula copied down; otherwise the value is written the
   way the Sheet's Code.gs derives it.
3. Web-app walk-ins are appended to WALKIN DATASET with a unique Sheet-style reference
   `MK-WK-CRM-<BRANCH 3>-<CRM initials>-<number>`.
4. Guard on REBUILD TOTAL DATABASE / Reset CRM Completely / Clear CRM Client IDs: approved.
5. Not-bought follow-ups stay CRM-only.
6. The three blank WALKIN DATASET headers are ignored.

Identity (owner option 2): a client is phone + name; the Sheet MKC is the shared ID.

## Work items (supabase-crm, branch feat/crm-sheet-sync)

1. `20261006000200_crm_phone_name_identity.sql`
   - client_phone_index keyed by (phone, client_id); `crm_private.name_key()` (the Sheet's
     `deriveNameKey_`).
   - phone + name matching in find_or_create_known_client, create_entry_queue,
     submit_walkin_visit, convert_referral_to_client; deterministic single pick where the
     Sheet uses phone only (reconcile_referral_calling_conversions, save_referral_followup,
     lookup_client_by_phone).
   - Sheet-style reference numbers for web-app walk-ins; CRM-created MKF from MKF-500001.
2. `20261006000300_crm_sheet_sync_storage.sql`: new columns (households.main_client_id,
   clients.household_relation / marketing_message / communication_preference,
   referrals.given_by_name), crm_private sync tables (row state, key map, outbox, runs,
   errors, import reports), one sheet-shaped view per tab.
3. `20261006000400_crm_sheet_sync_functions.sql`: per-tab apply (Sheet wins, idempotent,
   dry run), outbox triggers (web-app writes only), pull / ack, run log, crm_sync_health()
   Sheet block. service_role only.
4. Edge Function `crm-sheet-sync` (key header, batches <= 200 rows, counts-only responses).
5. `supabase-crm/apps-script/crm-sheet-sync.gs` (prefix `crmss`), with its pure core tested by
   Vitest; replaces crm-walkin-push.gs.
6. Sync health panel: Google Sheet block.
7. pgTAP + Deno + Vitest tests; local rehearsal on the mkcrm stack with synthetic rows.

Production steps are run by the owner after review (see the final handoff).
