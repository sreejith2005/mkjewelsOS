# Advanced Forms/FMS release database evidence

Release base: `dcee3bde97c9359913df9de883cb0dad910ccdab` on `origin/main`.
This supersedes the earlier feature-branch database evidence for release purposes.

## Scope

- `0358_advanced_form_routing.sql` extends the installed main normalizers and
  candidate validator. Its private compatibility copies use `_legacy_0358`.
  Main 0352's Other answers and sorted recipient contract remain installed.
- The existing 0353 `list_fms_built_forms()` gains optional author-only `links`
  containing exact workflow/step ids and names. Existing family classification,
  workflow/step arrays, module/profile/permission checks and grants are preserved.
- `0359_advanced_fms_scheduling_task_scope.sql` extends existing atomic activation,
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
