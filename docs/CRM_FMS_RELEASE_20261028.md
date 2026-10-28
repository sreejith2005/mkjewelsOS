# Customer / FMS release preflight — 2026-10-28

Owner request: deploy necessary migrations and push to `main`.

## Scope

Release is assembled from current `origin/main` (`3a31c72`) in an isolated
worktree. The original Forms and CRM checkouts remain untouched. The unrelated
Forms import/history feature and unapplied migration 0346 are excluded.
Current Forms usability, workflow-form grouping, task checklist behavior,
profile edit history and CRM theme are retained. The CRM administration panel
is attached to the maintained CRM Dashboard's privileged health area; the
retired roster/allocation route is not restored.

Unapplied JewelOS migrations were renumbered to follow deployed 0353:

- `0354_customer_form_events.sql` — reviewed mappings, durable customer events,
  audited recovery, source access and immutable original evidence.
- `0355_customer_private_exports.sql` — protected customer/stage export
  adapters and versioned layouts using the existing private export lifecycle.

CRM project migrations:

- `20261027000100_crm_fms_customer_events.sql` — protected receipts, identities,
  journey links, profile composition and administrative review.
- `20261027000200_crm_customer_exports.sql` — independently authorized,
  bounded export reads.

The already-applied `0349_fms_run_names.sql` is restored from its exact
repository version so local history agrees with the hosted ledger. No applied
migration is changed and no hosted history repair is used. Existing contract
test filenames beginning with 0350 remain executable test identifiers.

## Confirmed targets and preflight

| Project | Hosted reference | Result |
| --- | --- | --- |
| JewelOS `jewelos-prod` | `yimafxhuwgfhvzczqqdd` | Ledger checked; dry run lists only 0354 and 0355 |
| CRM `walk-in_crm` | `fsydcsyqnddacjfoutfe` | Ledger checked; dry run lists only the two 20261027 migrations |

The hosted CRM profile/browse functions inspected in preflight are owned by
`postgres`. These checks are read-only. No customer rows, secrets or backup
contents are printed or published.

## Evidence and outstanding gates

- Combined release: 12/12 typecheck/build tasks passed with
  `pnpm.cmd exec turbo run typecheck build --force --concurrency=1`.
- Combined core: 1,314 tests passed with
  `pnpm.cmd --filter @jewelos/core test`.
- Customer database contracts: 155/155 assertions passed again after applying
  the maintained 0352/0353 migrations in the isolated validation database.
- CSS generated from the maintained theme plus the scoped customer additions;
  build verifies the generated file is current.
- Combined CRM: 227/227 tests across 51 files passed with
  `pnpm.cmd --filter @jewelos/crm-ui exec vitest run --maxWorkers=2`.
- Focused web integration/regression: 7/7 tests across three files passed with
  `pnpm.cmd --filter web exec vitest run src/features/forms/CustomerIntegrationPanel.test.tsx src/features/reports/CustomerExports.test.tsx src/features/fms/FmsStageRunner.inline.test.tsx --maxWorkers=1`.
- Focused CRM profile/table/dashboard/history: 15/15 passed after including the
  previously validated Commercial classification header/filter expectation.
- The full web rerun was stopped after stalling without a completion summary;
  it is not reported as passing. Initial concurrent frontend runs were also
  stopped. Existing error-boundary tests printed their expected synthetic errors.
- Raw hosted metadata catalog/configuration JSON snapshots remain local audit
  artifacts and are excluded from publication along with scratch logs/caches.

Production apply is gated by `PRODUCTION_SWITCH_PLAYBOOK.md` Gate D: no
separate hosted staging target/evidence is established for this release.
The owner has been asked to identify the staging projects or explicitly waive
that gate. The existing full-chain 0345 replay guard also remains distinct
from the passing schema-baseline and focused contract evidence. Backup/recovery
recency and controlled hosted smoke checks are not yet established.

No production migration, function deploy, cron/secret change, mapping approval,
historical backfill or Sheet write has occurred in this preflight. Capture
requires reviewed mappings and independent CRM approval. The feature installs
no new production schedule automatically. Rollback pauses the new delivery
schedule and future mappings while preserving all historical evidence;
database corrections use forward migrations.

Required function deployment names after the database gates are cleared:
CRM `sync-receive`; JewelOS `crm-customer-sync` and `process-report-exports`.
Web/shared changes require no Android APK under the current WebView shell.
