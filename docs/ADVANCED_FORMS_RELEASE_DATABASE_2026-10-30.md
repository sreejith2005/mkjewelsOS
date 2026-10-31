# Advanced Forms/FMS release database evidence

Release base: `dcee3bde97c9359913df9de883cb0dad910ccdab` on `origin/main`.
This supersedes the earlier feature-branch database evidence for release purposes.

## Scope

- `0361_advanced_form_routing.sql` extends the installed main normalizers and
  candidate validator. Its private compatibility copies use `_legacy_0358`.
  Main 0352's Other answers and sorted recipient contract remain installed.
- The existing 0353 `list_fms_built_forms()` gains optional author-only `links`
  containing exact workflow/step ids and names. Existing family classification,
  workflow/step arrays, module/profile/permission checks and grants are preserved.
- `0362_advanced_fms_scheduling_task_scope.sql` extends existing atomic activation,
  coverage and authorized workspace projections. Calendar filtering occurs before
  counts and pagination; Overall/legacy requests avoid per-row calendar helpers.
- Main customer-event activation (0356) and original-doer coverage fix (0357)
  remain installed. Customer capture gains active-answer pruning only.
- Forms 2 history/provenance/import-workspace APIs and tables are excluded. These
  two migrations require no missing 0346 migration and add no tables or columns.
  No Storage, RLS-policy, secret, provider, or Android-shell change is included.

## Local baseline and commands

All commands ran from the authorized release worktree. Existing databases and
active user sessions were preserved. Container: `supabase_db_jewelos-fms-workspace`.

A new `template0` database, `advanced_forms_main_release_tx_20261030`, received
the existing local 0319 schema through a schema-only dump and the 42 static
permission-catalog records. No user/customer/operational records were copied.
The schema restore used one transaction and local `supabase_admin` to preserve
vendor extension grants/event triggers; public/CRM object ownership was then
restored to `postgres` inside this new database before ordinary test fixtures.

The source baseline had one ad-hoc FMS membership predicate absent from repository
migrations. Only in this new database it was normalized to the exact 0300 source
predicate before replay. No repository or hosted migration history was edited.

Exact current-main migrations 0340–0345, 0347–0349 and 0352–0359 applied
successfully in one transaction. There are no 0320–0339 files in this repository;
the unmerged feature-branch 0346/0350/0351 files were not imported. This is an
incremental replay from the local 0319 schema, not fresh replay from 0001.

```powershell
docker exec supabase_db_jewelos-fms-workspace createdb -U postgres -T template0 advanced_forms_main_release_tx_20261030
docker exec supabase_db_jewelos-fms-workspace psql -X -q -1 -U supabase_admin -d advanced_forms_main_release_tx_20261030 -v ON_ERROR_STOP=1 -f /tmp/jewelos-0319-schema.sql
docker exec supabase_db_jewelos-fms-workspace psql -X -q -1 -U supabase_admin -d advanced_forms_main_release_tx_20261030 -v ON_ERROR_STOP=1 -f /tmp/jewelos-main-release-replay.sql
docker exec supabase_db_jewelos-fms-workspace sh /tmp/jewelos-main-release-tests.sh advanced_forms_main_release_tx_20261030
```

`pg_prove` is unavailable. The runner executes each transactional pgTAP file with
`psql -X -qAt -v ON_ERROR_STOP=1`, checks for SQL errors and `not ok` lines, and
records the final TAP plan. Logs remain at `/tmp/main-release-test-<filename>.log`
inside the container. Temporary databases and schema-only files are retained.

## Results

All 30 related pgTAP files passed 559 assertions. New routing passed40/40, exact workflow links20/20, and scheduling/scope44/44. Current-main Other/sorted recipients21/21, built forms15/15, activated CRM36/36 and original-doer coverage16/16 remained green.

The two performance fixtures initially exceeded their unchanged8-second budgets in the schema-only database with empty planner statistics. Refreshing public-table planner statistics after bulk synthetic inserts produced12/12 and7/7 passing assertions with the same queries, expected totals and timing limits. That fixture setup is included in the two existing test files. Parent logs are `%TEMP%/jewelos-release-stats-<test>.log`; the other28 results remain in the container batch logs.

No hosted write or deployment was performed by the database verifier. Parent release operations are recorded separately.

Targeted `plpgsql_check_function_tb` checking of affected PL/pgSQL helper/RPC names on the final release schema reported **0 errors and 12 warnings** (not full-database CLI lint). The extension was installed only in the new local verification database for this check.

## Final current-main merge (2026-10-31)

Merged main through955c4971, including End Nodes, recorded outcomes, form-answer due dates, manager team boards and the phone handoff picker. Release migrations are0361/0362; main0358–0360 remain unchanged. Calendar `dateScope` is separate from FMS ownership `scope` (mine/all); ordinary task RPCs retain calendar `scope`. Scheduling extends the0360 causal due resolver; explicit `formDue` keeps precedence. New/compatibility due resolvers remain private.

The merged core suite passed1,395 tests across117files. Exact main0340–0362 replay succeeded atomically in isolated `advanced_forms_publish_20261030`, with no operational/customer rows copied. Focused board/staff scope regressions and final build/database gates are recorded by the final release outcome.

## Release hold (2026-10-31)

Final merged client checks passed: core1,395 tests/117files; affected board/staff/task/scheduling web35 tests/4files; monorepo typecheck/build12 successful tasks. All conflict markers were resolved and the staged credential/whitespace scans passed.

Production preflight lists ONLY0361/0362, but neither has been applied and no main push occurred. Docker Desktop lost its engine across the interrupted session. Supported start and graceful restart attempts timed out; a bounded docker ps also failed/timed out. No volume, existing database or WSL data was reset/deleted.

The new main0340–0362 schema replay succeeded in isolated advanced_forms_publish_20261030 before the final No due date and unified initial-coverage adjustments. Those final adjustments and their tests remain unverified at the database runtime boundary. The earlier559-assertion result belongs to the earlier main baseline; it is not substituted for the missing final regression run.

Resume with a functioning Docker engine: copy current migrations/tests into the retained local container, run the final exact migration replay plus034-file related regression set, confirm0360 form-due/board and0361/0362 contracts, then recheck linked production ledger/dry-run, apply the two approved migrations, push the reviewed merge to main and verify CI/Vercel. No new release approval is required by the existing user instruction.

## Docker resume and final regression findings (2026-10-31)

The resumed Docker engine successfully replayed current migrations0340 through0362 atomically in a new isolated schema-only database, `advanced_forms_release_final_20261031` (psql exit0). No existing database was reset and no operational/customer rows were copied. This remains incremental replay evidence, not a fresh0001 reset.

The final regression run found a real compatibility regression: the scheduling wrapper had removed authenticated execution of the existing read-only builder publish preflight. Migration0362 now restores that grant, keeping anonymous and compatibility-helper execution revoked. The exact final-schema grant was applied in the isolated database and the publisher contract passed9 assertions. The older structural assertion follows the delegated validator rather than assuming the entire validator remains in one function body.

The scheduling fixture inherited deadlineEnabled=false from the shared helper. It now explicitly enables a valid timing rule when testing scheduled activation; the separate No due date assertion remains. Its serial rerun passed51 assertions, including matching successor activation at11:00 IST, explicit formDue precedence, exact assignment retry, date scopes, unauthorized caller denials and helper grants. Advanced routing passed40 assertions; exact workflow links passed20; current-main outcome reports/journeys passed27 and form due dates/task boards passed60. Initial pgTAP extension setup errors and an overlapping fixture-lock collision were rerun after setup/serial isolation.

**Release remains held.** The0293 history-scale and0312 naming-cost fixtures exceeded their unchanged8-second search budgets. Production metadata confirms jit=off (local default was on); serial retries with jit=off still timed out. A separate synthetic diagnostic also reached a60-second cancellation in the historical name/context projection. A transaction-local function-timing diagnostic was queued to identify the cause, but Docker API/container commands and docker-desktop WSL health checks subsequently became unresponsive. No performance fix or attribution to the release versus the preceding main schema is claimed. Do not loosen the budgets or deploy until these failures are explained and the original fixtures pass.

Client evidence remains core1395 tests/117files, affected web35 tests/4files, and monorepo typecheck/build12 tasks. The only implementation correction after those checks is the SQL preflight grant. Production preflight still has only0361/0362 pending on jewelos-prod (`yimafxhuwgfhvzczqqdd`), with completed backup metadata at2026-10-30T20:24:05.229Z and PITR disabled. Neither migration has been applied and nothing has been pushed to main. CRM, Edge Functions, backfill and Android APK publication remain outside this release.
