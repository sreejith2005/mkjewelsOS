# Management and CRM insights release — 2026-10-10

The owner explicitly authorized: “DEPLOY NECESSARY MIGRATIONS AND PUSH TO MAIN”.

## Integrated source

Dashboard implementation `0d0543a` was integrated with published main changes through
`94051e3`, including the newer CRM paging, history and scale contracts. The new CRM
dashboard preserves the Super Admin sync-health panel and shared refresh coordinator.
Duplicate analytics declarations introduced by regenerated CRM types were removed;
the generated RPC signatures remain intact. Unrelated changes in `C:\crm` were not
staged or published.

## Hosted migrations

| Project | Applied migration | Effect |
| --- | --- | --- |
| `jewelos-prod` (`yimafxhuwgfhvzczqqdd`) | `0206_management_insights.sql` | Versioned management summary/options/drilldown reads and effective dashboard authority for interactive reporting. |
| `jewelos-prod` | `0207_dashboard_saved_views.sql` | Owner-scoped saved preferences, restrictive module RLS, audited save/delete RPCs and retirement-manifest classification. |
| `walk-in_crm` (`fsydcsyqnddacjfoutfe`) | `20261010000100_crm_insights.sql` | CRM-only summary/options/drilldown reads and analytics indexes. |

The dashboard migrations were never previously hosted. They were moved from the
proposed `0202`/`0203` versions because production already used those versions.
The CRM proposal moved from `20261009000100` after the concurrent CRM scale release
used that version. No applied migration was edited or repaired.

Both linked project identities and migration ledgers were verified before writes.
Final dry runs contained exactly these three migrations, no seeds and no role
configuration. Both applies completed successfully; subsequent migration lists and
dry runs report both projects up to date.

No historical task, form, FMS, employee or client data was migrated, repaired or
retargeted. No Storage, secret or Edge Function deployment was required. Saved-view
mutations write their audit record in the same server transaction. Management
database types and CRM generated RPC definitions cover the deployed contracts.

## Hosted verification

- Management metadata checks passed: both versions present, saved-view RLS enabled,
  restrictive module policy present, anonymous read denied, authenticated direct
  writes denied, private row helper inaccessible, audited save granted, and the
  retirement manifest includes saved views.
- CRM metadata checks passed: version present, authenticated summary/detail/options
  granted, anonymous summary/detail denied and private row helper inaccessible.
- Both projects passed read-only summary/options/detail smoke queries using an
  existing authorized actor context. Output was limited to shape/version booleans;
  drilldowns were bounded to 25 records. No customer or employee row content was
  printed or retained as release evidence.
- Both new summary RPCs denied calls without an actor. These SQL context checks and
  grant checks do not prove browser login, session exchange, or physical Android UX.

## Local validation

- Focused transactional pgTAP rerun: management 41, saved views 14, CRM 18 assertions
  passed on the two existing local databases. This was not a clean database reset.
- `pnpm.cmd --filter @jewelos/crm-ui exec vitest run --maxWorkers=1 --testTimeout=20000`:
  189 tests in 43 files passed after integrating the latest CRM release.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1`: all six packages passed
  after resolving the regenerated-type duplication.
- `pnpm.cmd exec turbo run build --force --concurrency=1`: all six packages passed,
  including the scoped CRM CSS check. Existing bundle-size and Turbo output advisory
  warnings do not establish runtime UX.
- `pnpm.cmd --filter web exec vitest run --maxWorkers=1 --testTimeout=20000`:
  all 414 tests in 88 files passed on the final merged source.
- Initial overloaded-machine runs hit web timeouts; the bounded final run uses one
  worker and a longer timeout. No test assertions or product behavior were weakened.
- Staged whitespace and credential-pattern checks are required before publication.

Ignored operational logs are under
`.superpowers/sdd/2026-10-09-management-crm-insights/deploy/`.
Earlier native, core/data, browser-width and regression evidence remains in
`docs/MANAGEMENT_INSIGHTS_PARITY.md`; those results are distinct from this hosted run.

## Remaining evidence boundaries

`adb devices -l` still reports no connected device. The employee Android release
stops at its required device gate; no APK or update manifest is published by this
release. Authenticated browser session-bridge QA, physical-device interaction,
TalkBack/large-text/offline checks, a clean isolated database rebuild/full pgTAP/lint
and realistic analytics query-volume measurements remain open. Source publication
and hosted migration success do not by themselves establish production-ready UX.
