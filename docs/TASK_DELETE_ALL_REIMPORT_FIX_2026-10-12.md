# Full task deletion and reimport correction - 12 October 2026

## Confirmed cause

Read-only aggregates on the confirmed linked jewelos-prod project reproduced the
reported latest 31-row batch: 15 created and 16 replayed, all recurring records
for one employee. The 16 replayed schedules were inactive and had never generated
an occurrence. Whole-series deletion audits existed, but the previous bulk target
enumeration only read occurrences. It therefore omitted those underlying schedules.
No customer names, source rows, exports or credentials were recorded here.

## Change

- Full Delete All on web/native now also previews scoped recurring schedules,
  including inactive, future, undated and as-required records without occurrences.
  It is available even when the occurrence list is empty.
- The shared core predicate scopes schedule targets by employee, branch, department
  and checklist/upload work type; the authorized directory RPC applies search.
  Schedules have no occurrence date/status. Confirmation explicitly explains that
  full-series scope extends beyond the occurrence date/status view.
- Full Delete All defaults to series deletion, with a visible occurrences-only
  opt-out. Multi-select retains its prior occurrence-only default.
- Shared preparation adds schedule-only targets only when an occurrence does not
  already represent the same schedule. Execution uses the existing audited template
  deletion for those targets, preserving history and retiring the original import
  fingerprints/hashes. It does not weaken import duplicate detection or erase an
  identity while its schedule remains live.
- Confirmation separates occurrences and schedules. Template failures never enter
  the selected-task ID list; retry full Delete All to include remaining schedules.
- No schema, RPC, RLS, Storage, generated-type or Edge Function change/migration.
  Existing database actor/module/tenant authorization and atomic per-write audits
  remain intact. The bounded concurrency and partial-result behavior are unchanged.

## Validation

- supabase.cmd test db supabase/tests/0108_task_template_management.test.sql
  supabase/tests/0208_task_scale_and_management.test.sql
  supabase/tests/0217_task_delete_all_reimport.test.sql: 3 files, 114 assertions passed.
  The new synthetic test reproduces 15 generated + 16 inactive/as-required schedules,
  confirms the original omission, deletes the schedule-only records, then imports
  the identical sheet: 31 created, 0 replayed, all original fingerprints retained
  as retired history. Local fixtures rolled back; no hosted customer mutation.
- Core scope/view tests: 2 files, 15 passed. Data bulk orchestration: 8 passed.
- Web Task Control/page/admin tests: 6 files, 27 passed.
- Native suite, --maxWorkers=1 --testTimeout=15000: 25 files, 127 passed.
- Native typecheck and web build (includes TypeScript): passed. Existing large
  chunk warnings remain. Checks ran in the shared workspace with concurrent task
  assignment work; that work is excluded from the named publication paths.
- Browser execution tools unavailable: real authenticated browser QA is unverified.
  adb devices -l still lists no devices; no signed Android release was published.

## Existing affected import

The 15 newly imported schedules are legitimate current records. They were not
deleted during diagnosis or verification. To obtain a fresh 31-new-record import,
run the corrected full Delete All with series deletion enabled, then upload the
sheet again. Re-uploading without full deletion must still skip legitimate live
records. The correction applies generically to every account and employee scope.

## Web publication evidence

Source commit 1ec08ee3a93c8f50adb162879b59a432b932d1a5 was published to main
as a scoped child of the latest main. A separate Git index preserved concurrent
assignment work and avoided publishing its pending RPCs/migrations. Fourteen
reviewed paths passed whitespace and credential-pattern checks.

Both Vercel commit checks (jewelos and mkjewels-os) reported success. The production
origin https://mkjewels-os.vercel.app returned HTTP 200; its public Task Control
chunk TaskTemplatesPage-CJ-XeTMl.js contains the updated inactive/not-yet-generated
schedule deletion confirmation. This proves the updated web asset is served;
it does not replace authenticated browser or Android device verification.
