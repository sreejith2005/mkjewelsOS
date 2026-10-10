# Task scale and management validation - 10 October 2026

Owner approved implementation and explicitly requested migration deployment and
publication to main in chat. Production migrations are applied as recorded below;
local checks and hosted verification are reported separately. No Android publication.

## Changed behavior and files

- Web TasksPage/TaskCard and native TasksScreen/TaskDetailScreen use a selected
  server page of 50 tasks, complete status totals, All Tasks for authorized
  administrators, and direct detail lookup. Forms load when opened.
- Both task API layers use the shared taskPage decoder/edit validation in core.
  Watcher reads and child evidence/checklist hydration are scoped to page IDs.
- Web/native TaskAdminControls edit title, description, priority and dates, or
  explicitly confirm occurrence/series deletion. Schedule editing remains in
  Recurring / To-Do. UI permissions use the central access resolver.
- Business spreadsheet template and both import screens explain mandatory Task
  proof. The raw source row and replay fingerprint are unchanged by this policy.
- Migrations 0208, 0210 and 0211 add lifecycle columns, bounded page/admin RPCs,
  private guards/helpers, live indexes/views, operational reader filters and
  background caller handling. Concurrent migration 0209 is retained unchanged.
- Both generated database type files include new fields, RPCs and live views.
  pgTAP covers grants/authorization, proof, recurrence, retry, history, read and
  background contracts. Web/core/data/native tests cover page identity/order,
  empty pages, late responses, admin confirmation and scheduling timezone.

## Database, authorization, evidence and compatibility

No new Storage bucket or public objects. Imported delegation completion needs a
registered object in task-attachments under tenant/task scope, supported MIME and
1..10 MiB size. Attachment metadata alone does not qualify. Checklist completion
and historical completed imports retain their behavior.

Admin writes resolve current_profile and tasks.view_all, check the owning module,
validate supported fields, and audit in the same transaction. Staff, inactive,
cross-tenant, anonymous and service-role browser administration are denied.
Watcher-only completion remains denied even when an administrator can edit/delete.

Instances/templates use deleted_at tombstones; whole series deletion disables
future generation and removes unfinished work from active reads. Completed
history/evidence remain attached to the same identity. Deleted records cannot be
changed or generated; coverage/import repair skips them. Later CRM walk-in sync
acknowledges administrative deletion instead of recreating it. Retired batch hashes
and row fingerprints retain their originals; exact re-import creates replacement
work while unrelated rows still replay.

Unfinished imported delegation records with durable import provenance are repaired
with audit entries. Historical completions are not changed. Unmarked manual records
are not guessed to be imports. Deploy database contracts before the clients that
call them; existing client calls remain supported. No Edge Function change/secrets.

## Local evidence

- pnpm.cmd --filter @jewelos/core test: 67 files / 798 tests passed before the
  added timezone case; taskPage focused rerun: 5 passed.
- pnpm.cmd --filter web test: 89 files / 421 passed. Final selected task API,
  admin control and page tests: 3 files / 18 passed (includes 2 new paging tests).
- pnpm.cmd --filter @jewelos/data exec vitest run src/tasks/api.test.ts: 13 passed.
- npm.cmd --prefix apps/mobile run test: 24 files / 126 passed.
- pnpm.cmd exec turbo run typecheck --force --concurrency=1: all 6 passed.
- npm.cmd --prefix apps/mobile run typecheck: passed.
- pnpm.cmd exec turbo run build --force --concurrency=1: all 6 passed.
- pnpm.cmd --filter web build: passed after final web/API edits; existing large
  chunk warning remains.
- supabase.cmd test db supabase/tests/0208_task_scale_and_management.test.sql:
  77 passed, including current/canonical/legacy imports and open undated/future FMS.
- Focused task/dashboard/reporting/template/watcher contracts: 245 passed; later
  schedule/coverage/CRM tests: 122 passed; grants matrix: 75 passed.
- supabase.cmd test db --db-url <isolated-local-db>: 118 files / 2866 tests
  passed after final fixes. The isolated clone has no pg_cron job catalog; the
  cron-auth fixture explicitly skips that platform catalog check.
- Final changed schema/RPC files compiled transactionally in a separate local
  database reconstructed from the local baseline; not a clean full db reset.
  Shared local CRM migrations 0201..0205 were missing, so they were applied only
  in that isolated database. Its copied queued events were isolated from workers.
- Local SQL timing: task_feed_page averaged 74.92 ms over 10 requests / 10,121
  pending tasks. Dashboard 1,000-task benchmark measured 4772.64 ms before stable
  permission hoisting and 696.50 ms afterward. Hosted/network/UI timings unproven.
- Database lint executed; no new function errors. Existing platform/CRM lint
  diagnostics remain. Legacy importer had one unused variable, removed in source.
- git diff --check passed. 33 named paths staged; staged whitespace passed, credential-pattern scan found
  zero matches.

## Open release gates

The Browser execution tool is unavailable, so real browser desktop/phone-width QA
and authenticated E2E were not performed. Component interaction tests passed.
`adb devices -l` returned no devices. MOBILE_RELEASE_GUIDE requires running visual
changes on a phone and being on main. No connected phone was available.
The signed release script must not publish until those gates pass.

Separate staging validation, hosted role/Storage/import/recurrence smoke tests,
Android device proof, release-mobile.ps1 and public manifest/APK verification remain.
The owner explicitly requested the production migration deployment and main push.
No exploratory production imports, test records, seeds, resets, secrets or Edge
Function changes were performed. A source push does not prove rendered web behavior.

## Hosted deployment and publication - 10 October 2026

- Implementation commit: 434d98f; publication target: origin/main.
- Confirmed via supabase.cmd projects list: jewelos-prod, reference
  yimafxhuwgfhvzczqqdd, ACTIVE_HEALTHY and linked. CRM projects were untouched.
- supabase.cmd migration list --linked: only task migrations 0208, 0210 and
  0211 were missing; 0209 was already applied.
- supabase.cmd db push --linked --dry-run --include-all: listed exactly
  0208_task_scale_and_management.sql, 0210_task_deleted_read_paths.sql and
  0211_task_deleted_background_paths.sql. include-all inserts the approved
  missing 0208 before the already-applied 0209; it does not rerun 0209.
- supabase.cmd db push --linked --include-all --yes: all three applied, exit 0.
- Post-apply supabase.cmd db push --linked --dry-run --include-all: remote
  database up to date, no pending migrations.
- All source changes were directly ahead of origin/main and whitespace checked.
  Main publication uses a normal fast-forward push; no force push or rewriting
  of the main branch checked out in another worktree.
- Recovery is a reviewed forward migration, preserving history and tombstones.
  Hosted backup restore readiness and authenticated application smoke tests were
  not independently verified in this run.
