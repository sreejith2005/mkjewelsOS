# CRM data import (Phase 5 tooling, Phase 7 production run)

Copies the original MK Jewels CRM (schema `public` of `walk-in_crm`, or a restored copy of it) into the
JewelOS schema `crm`, and its Storage objects into bucket `crm-legacy-documents`. The production
procedure is `docs/CRM_DATA_MIGRATION_RUNBOOK.md`. No data, URL or key is stored here: URLs and keys
come from the environment at run time, and every report, manifest or downloaded file must be written
outside a Git working tree (the tools refuse otherwise), in `C:\crm-private`.

| File | Purpose |
| --- | --- |
| `import.mjs` | One-transaction import with triggers off (`session_replication_role = replica`), ids and stored values preserved, seeded lookups replaced by the source rows (source ids kept, remap recorded), sequences moved past the highest value in use, one `public.audit_logs` summary row, in-transaction reconciliation. `--dry-run` rolls back. Refuses a target whose `crm` tables hold data other than the 0186 seed, unless `--replace-local` on a local target. |
| `storage-copy.mjs` | Downloads every `crm-documents` object (GET only), checks size and eTag, uploads it to `crm-legacy-documents` at the same path, reads it back and compares SHA-256; writes a manifest. Re-runnable. |
| `reconcile.mjs` | Row counts and content hashes per table, foreign-key orphans, client rollups vs a recomputation from the timeline (reported, never fixed), Storage coverage; writes a Markdown report with a verdict. |
| `lib.mjs`, `db.mjs` | Pure logic (unit-tested) and catalog/hash queries. |
| `lib.test.mjs` | `node --test scripts/crm-import/lib.test.mjs` (synthetic rows only). |

Environment: `CRM_IMPORT_SOURCE_URL`, `CRM_IMPORT_TARGET_URL` (import, reconcile, and the object list for the
Storage copy), `SOURCE_SUPABASE_URL` or `--source-env=<file>`, `SOURCE_SUPABASE_KEY`, `TARGET_SUPABASE_URL`,
`TARGET_SUPABASE_SERVICE_KEY` (Storage copy).

Never imported: `_prisma_migrations` and the original SSO tables (`crm_sso_access_grants`,
`crm_sso_access_audit` in production; `crm_access_grants`, `crm_sso_audit_logs` in the committed SSO
migration). Their role is taken by the identity bridge (0183). CRM users are linked to JewelOS profiles
separately, after owner approval, through `crm.link_jewelos_profile` / `crm.link_jewelos_branch`.

Output is limited to counts, table names, ids and hashes; database errors are redacted before they are
printed (`redactError`).
