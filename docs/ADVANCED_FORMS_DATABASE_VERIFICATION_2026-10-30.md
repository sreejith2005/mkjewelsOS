# Advanced Forms/FMS local database verification — 2026-10-30

This is local PostgreSQL evidence only. No hosted actions, existing-database reset,
customer export, commit, or publication occurred.

## Isolation and replay boundary

- Container: `supabase_db_jewelos-fms-workspace`.
- Existing local databases were preserved. New verification databases were named
  `advanced_forms_verify_20261030`, `advanced_forms_release_verify_20261030`,
  `advanced_forms_replay_20261030`, `advanced_forms_final_migration_20261030`,
  and `advanced_forms_final_scope_20261030`.
- The existing `postgres` database has migration ledger 0319. There are no
  repository migrations 0320–0339. A schema-only dump was restored into a new
  `template0` database, with only the 42 static `permission_catalog` rows copied.
  No operational or customer rows were copied by that bootstrap.
- The source database contained an ad-hoc completed-FMS membership predicate
  absent from repository migrations. In new verification databases only, that
  predicate was normalized to the exact 0300 repository predicate before replay.
- Migrations 0340–0353 applied in one transaction against that bootstrap. This
  proves incremental application from the local 0319 schema, not replay from 0001.
  Bootstrap vendor ACLs needed local `supabase_admin` for a reserved extension
  function grant. Vendor event-trigger ownership prevented the final event-trigger
  declarations from restoring; application migration replay and tests proceeded.
  This bootstrap is therefore not a byte-for-byte recreation of the source DB.
- After final 0353 adjustments, its exact source file applied atomically to a
  separate clone of the pre-0353 checkpoint. The latest 0352 definitions were
  reinstalled there using their preserved pre-0352 function definitions first.

Representative commands (all run from the repository root):

```powershell
docker exec supabase_db_jewelos-fms-workspace psql -U postgres -d postgres -Atc "select datname from pg_database where not datistemplate"
docker exec supabase_db_jewelos-fms-workspace createdb -U postgres -T template0 advanced_forms_replay_20261030
docker exec supabase_db_jewelos-fms-workspace pg_dump -U postgres -d postgres --schema-only --no-owner
docker exec supabase_db_jewelos-fms-workspace psql -U postgres -d advanced_forms_replay_20261030 -v ON_ERROR_STOP=1 -1 -f /tmp/jewelos-advanced-clean-replay.sql
docker exec supabase_db_jewelos-fms-workspace psql -U postgres -d advanced_forms_final_scope_20261030 -v ON_ERROR_STOP=1 -1 -f /tmp/jewelos-advanced-migrations/0353_advanced_fms_scheduling_task_scope.sql
docker exec supabase_db_jewelos-fms-workspace sh /tmp/jewelos-advanced-test-runner.sh advanced_forms_replay_20261030
docker exec supabase_db_jewelos-fms-workspace sh /tmp/jewelos-advanced-final-runner.sh advanced_forms_final_scope_20261030
```

The actual dump and test logs stayed inside the local container or task-specific
temporary files. `pg_prove` is unavailable in the image. The runner invokes
`psql -X -qAt -v ON_ERROR_STOP=1`, rejects SQL errors and every `not ok` TAP line,
and records each test's final TAP plan.

## Focused final checks

- `0352_advanced_form_routing.test.sql`: 40 assertions passed.
- `0353_fms_scheduling_task_scope.test.sql`: 44 assertions passed.
- `0293_fms_workspace_history_scale.test.sql`: 12 assertions passed after preserving
  explicit legacy completed-history access and reusing materialized workspace rows.
- `0312_fms_workspace_naming_cost.test.sql`: 7 assertions passed, including both
  existing 8-second summary/global-search budgets.

Together with the related batch below, 26 files passed 513 assertions. The final
four files above were rerun after the last source change; the 22 other files
contribute 410 assertions, or 429 when the two existing scale/cost files are
included. These totals count each assertion once, not every repeated execution.

Latest focused logs are in the container at `/tmp/final-test-<filename>.log`.
The related batch logs use `/tmp/advanced-test-<filename>.log`; pre-0353 comparison
logs use `/tmp/baseline-test-<filename>.log`. Temporary databases and logs were
retained for review.

The 0353 tests cover scheduling, exact activation retries, strict IST Today and
Overdue filtering, server totals/pagination, shared active totals, required-form
completion, completed-history search, unassigned/inactive/anonymous/service-role
denials, and private helper privileges.

The related batch also passed the following assertion counts:

| Test prefix / name | Assertions |
| --- | ---: |
| 0114 visibility rules | 24 |
| 0115 dynamic decisions/deadlines/assignments | 11 |
| 0150 starter submission | 5 |
| 0193 form-selected assignment | 25 |
| 0239 assignment contract | 10 |
| 0240 visit assignment | 19 |
| 0249 parallel preview | 6 |
| 0252 follow-up review hold | 11 |
| 0257 initial return assignment | 3 |
| 0261 route remap | 2 |
| 0286 task workspace visibility | 24 |
| 0291 FMS task workspace | 18 |
| 0296 workspace versions | 12 |
| 0297 workspace actionability | 8 |
| 0343 library visibility | 37 |
| 0345 stage form sections | 29 |
| 0346 forms history | 62 |
| 0347 optional Otherwise/form handoff | 15 |
| 0348 assignment handoff | 12 |
| 0350 customer FMS workflow | 32 |
| 0350 customer form events | 34 |
| 0350 customer loop journey | 11 |

## Findings and lint

The tests exposed and corrected a 0353 patch targeting the obsolete seven-argument
resolver, its search-filter marker removed by 0317, loss of explicit legacy
completed history, and duplicate expensive workspace projection for `activeTotal`.
0352 fixes preserve nested negation, explicit empty predicates, Continue precedence,
and the legacy/scoped FMS routing boundaries. The final 0353 additionally avoids
calling its non-inlineable SQL calendar helper for no-scope/Overall requests;
that restored the existing 0312 global-search budget without changing filters.

Targeted `extensions.plpgsql_check_function_tb` checks on 26 affected public/CRM
routine definitions (22 routine names, including overloads) reported 0 errors and
14 warnings. Warnings remained for JSON/text and
integer assignment conversions, unused variables/parameters, and the existing
STABLE resolver calling a VOLATILE expression. This is targeted function lint,
not a full CLI database lint or proof that every historical function is warning-free.

Some initial runs of the two 8-second search-budget tests timed out on this host.
Against the pre-0353 checkpoint, 0293 also timed out and 0312 passed 7 assertions.
Before the final no-scope guard, 0312 repeatedly timed out in the changed global
task query; it now passes. Full 0001 replay and hosted verification remain
outside this evidence.
