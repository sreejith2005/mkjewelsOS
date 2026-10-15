# Full task editing - web verification

Publication update (2026-10-15): production 0235 is the already-applied user
management migration. Task editing is released as **0238_full_task_edit.sql**.
Earlier 0235 task-edit labels below describe the initial isolated development
database, not the production migration identity. The release is isolated from
unrelated pending 0236/0237 and Android work.

## Delivered scope

The existing Task Control editor now loads current persisted details on open and
edits Task/Checklist type, title, description, priority, start and due dates,
upload/remark/form requirements and pinned form, verification and verifier, buddy
assignment, doers, In Loop users, branch, department, category, task group and
checklist items. Future recurring schedules remain in Recurring / To-Do.

Android changes and releases are deferred by the owner's explicit instruction.
Unrelated leave, CRM, navigation and prototype-removal work is outside this change.

## Implementation and persistence

- Web: `TaskAdminControls`, new `TaskAdminEditFields`, and the existing TaskCard,
  TasksPage and RecurringTodoPage completion entry points. New `TaskRequiredForm`
  carries task evidence and a completion remark alongside the existing form renderer.
- Shared: task edit initialization/payload validation and form-proof identity in
  `packages/core/src/taskPage.ts`; saved upload requirements are honored in task
  cards, details and recurring work. `packages/data/src/tasks/api.ts` loads real
  editor data and calls the audited contracts.
- Forward migration `0235_full_task_edit.sql` extends the existing edit RPC,
  archives removed checklist rows, deactivates removed assignments, appends new
  assignment rows and audits old/new parent and child state transactionally.
  Task identity, completion actors/timestamps, uploads and historical form
  submissions survive editing. Archived checklist items are filtered from client
  reads and definer-owned workspaces/metrics/reports.
- A protected internal upload override preserves an explicitly disabled import
  requirement without weakening direct-write proof checks. The live task view
  remains aligned with the table composite type. Both database type files include
  the new columns, view field and task-form RPC.
- Required-form submission and completion are one transaction through
  `submit_task_form_with_audit`. Normal/upload/form completion paths continue to
  enforce upload, on-behalf and explicit remark requirements. Prior form proof
  survives an audited Task/Checklist conversion without rewriting old submissions.
- Existing authorization remains database-enforced. Watchers retain read-only
  completion permissions even when they can administer task authoring. No new
  Storage bucket, public object grant or client secret is introduced.

## Local checks

- `pnpm.cmd --filter @jewelos/core test`: 71 files, 825 tests passed.
- `pnpm.cmd --filter @jewelos/data test`: latest rerun 20 files, 121 tests passed
  (includes concurrent leave tests).
- `pnpm.cmd --filter web test`: 96 files passed, one old TaskDetails expectation
  failed because evidence now follows the saved checklist upload requirement.
  The expectation was corrected; focused rerun of TaskDetails, TaskCard and
  TaskAdminControls passed all 19 tests in three files.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1`: all six web
  packages passed. Data typecheck passed again after filtering form options to
  active published forms plus the current pinned form.
- `pnpm.cmd exec turbo run build --force --concurrency=1`: all six packages
  passed. Existing chunk-size/output warnings remain.
- `git diff --check`: passed. This task made no Android edits. Concurrent native
  navigation/leave changes appeared later and have been left untouched.
- Local Playwright editor harness: actual editor component and shared payload,
  synthetic PostgreSQL records, authenticated audited edit RPC via a temporary
  adapter. Type conversion, upload/remark toggles, group and checklist changes
  saved and survived reload. Checked 17 controls at 1440x1000 and 390x844; no
  horizontal overflow or browser console errors. This is editor-level evidence,
  not a full hosted login/Supabase HTTP end-to-end test. Browser plugin startup
  failed, so standard Playwright was used.

## Database validation and release boundary

Tests use isolated synthetic databases in the existing local PostgreSQL container,
not a hosted project or the shared application's database. Current source
migrations through 0235 applied successfully to a fresh isolated database after
platform schema bootstrap. The final task-edit test includes a direct trigger
case for an unset authoring context, independent of table ACLs.
`0235_full_task_edit.test.sql` passed all 54 assertions on the fresh schema,
including privileged/ordinary/inactive/anonymous/service-role denial cases,
history preservation and upload/form/remark transaction checks.

Final result recovered on 2026-10-15: all 24 focused database suites passed,
758 assertions, zero failures. These cover task hardening/function grants/forms,
coverage, completion modes, evidence, Task Control, assignment authorization,
watcher restrictions, import/reimport and full editing. The isolated runner used
`docker exec supabase_db_assignment-release sh /tmp/task-edit-run-focused-db-tests.sh`
against `jewelos_task_edit_235_fresh2`, with pgTAP installed outside the tests'
rollback transactions. Each test runs with `psql -X -q -At -v ON_ERROR_STOP=1 -f`.
The final log audit used `/tmp/task-edit-focused-report.sh`; all 24 logs include
no pgTAP failures or SQL errors.

An exploratory 126-suite run passed 3128 assertions and failed seven suites:
0007/0103 require platform migration/cron/vault bootstrap; 0011 notification
redaction, 0162 quota privileges, 0195 staff snapshot shape and 0202 CRM roster
expectations also failed. Its 0235 failure used the earlier guard definition;
the final source fixes that nullable authorization predicate and is checked on
the fresh database. Broad suite success is not claimed.

Git commit/push, hosted migration application, web deployment and hosted
authenticated validation have not been performed. Release requires the owner
production playbook, linked migration-ledger review and dry run, scoped publish,
and hosted task-edit/completion checks. Local application is not production proof.

## Publication validation on current main

The owner explicitly authorized migration deployment and push to main on
2026-10-15. Release base: `93e4832`. Linked production project:
`yimafxhuwgfhvzczqqdd`. The release-worktree linked dry run lists only
`0238_full_task_edit.sql`; existing applied migrations remain unchanged.

The current-main migration chain plus 0238 applied cleanly to the fresh synthetic
database `jewelos_task_edit_238_release`. All 25 related pgTAP suites pass,
789 assertions, zero failures, including protected recipient rules and the
existing user-management contract. Core tests pass 949/949 and data tests pass
162/162. Full web tests pass 515/515 across 105 files. Typecheck and build pass
all 12 tasks across six packages using
`pnpm.cmd exec turbo run typecheck build --force --concurrency=1`.
The exact authenticated function allowlist includes only the new task
form entry point; both new internal helpers remain unavailable to API roles.

Task Control help in Ask Kiara and its review document now describe the expanded
editor. No new Kiara read tool is needed for this authoring guidance. No native
files, CRM changes, unrelated migrations, configuration or secrets are staged.
Prefer a forward correction for rollback. An older web build cannot supply all
newly configurable form-plus-remark combinations, so it needs a compatibility
review before rollback. Historical rows are retained and applied migration
history is never rewritten.

## Hosted migration receipt - 2026-10-15

Implementation commit: `3c7d6c622bec4b5829986ede380dd93cdfe857e9`.
Owner authorization: deploy migrations and push to main. The final linked dry
run listed only 0238; `supabase.cmd db push --linked --yes` applied exactly
`0238_full_task_edit.sql` to `jewelos-prod` (`yimafxhuwgfhvzczqqdd`). No seeds,
role files, other migrations, Edge Functions or secrets were deployed.

Read-only hosted SQL passed all 11 checks: ledger entry, archive and override
columns, live-view alignment, authenticated form RPC grant, anon/service denial,
private internal helpers, restrictive archive policy, null-safe override guard
and transactional form completion. A subsequent linked dry run reports the
remote database up to date with no pending migrations. No operational task or
customer record was used for hosted testing. Hosted authenticated user-flow
validation remains separate from this schema/grant verification.
