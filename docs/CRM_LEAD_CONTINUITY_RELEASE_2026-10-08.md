# CRM lead continuity release — 2026-10-08

Authorized by the owner's request: "deploy necessary migrations and push to main".

## Scope

The release is assembled on current `origin/main` in an isolated release worktree. The original dirty `C:/crm` checkout is preserved. Newer phone layouts, country-code input and company-wide active-user follow-up permission are retained. New migrations use unoccupied versions; no applied migration was edited or repaired.

| Target | Project reference | Pending migrations |
| --- | --- | --- |
| CRM | `fsydcsyqnddacjfoutfe` | `20261008000600_crm_lead_continuity.sql`, `20261008000700_crm_jewelos_master_options.sql` |
| JewelOS | `yimafxhuwgfhvzczqqdd` | `0204_crm_dropdown_master_sync.sql` |

Changed functions: CRM `sync-receive`, JewelOS `crm-staff-sync`. Existing credentials and schedules are reused. JewelOS master projection must be populated before the new web UI is exposed. Missing communication preferences are initialized with the existing CRM vocabulary alongside the other missing configurable lists.

## Validation

- CRM UI: 171 tests / 37 files passed on the integrated release; focused checks repeated after preserving phone normalization.
- Web: 409 tests / 85 files passed.
- All six workspace typechecks passed; web build passed with the existing bundle-size warning.
- Sync workers: 19 tests passed; both Edge Function entrypoints passed Deno checks.
- Final CRM migrations were applied transactionally to a fresh schema-only local candidate with current hosted-baseline migration changes. Lead continuity 63 assertions and CRM masters 23 assertions passed. JewelOS sync has 12 passing assertions. Existing tests are supplied synthetic master fixtures where required.
- Hosted preflight: both migration ledgers read and matching dry runs reviewed; only the three named migrations pending. Both existing JewelOS sync cron schedules active, with zero pending outbox events before deployment.
- Before-write schema snapshots for both hosted projects were saved outside Git under the task's private temporary directory. These are schema snapshots, not customer-data backups. Automatic data-backup status was not independently verified.

Earlier local legacy two-way Sheet failures were reproduced on the pre-change baseline. That retired test file is not included in current `main`; current maintained workflow tests are used for this release.

## Compatibility and recovery

Old lead direct INSERT is revoked by the CRM migration; the new lead UI uses the audited save RPC. Deploy migrations, bootstrap masters and publish the compatible web commit within the release window. No historical customer profile reconciliation or fabricated interaction backfill is part of this deployment.

Migrations remain forward-only. Preserve recorded history and correct failures with an audited forward migration. The prior web build is not fully compatible with the revoked lead INSERT, so a web rollback alone is insufficient for that registration path. Restore compatible UI or use a forward corrective contract rather than rewriting migration history.

Rendered authenticated browser and physical-phone evidence remains open. Native CRM loads the hosted `/crm` page and no native binary/shared mobile contract is changed. Git publication, database/function deployment and web-host readiness are verified separately; none establishes physical-device behavior.

The deployment outcome and exact remote SHA are recorded after the release actions.
