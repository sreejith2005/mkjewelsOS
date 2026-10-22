# Tasks and Task Control consolidation (Recurring / To-Do retired)

Branch `feat/task-consolidation-20261021`, migration `0340`. Status: implemented and
verified locally; **not deployed**. Production steps are at the end.

## What changed

- **Tasks → Create Task** has a **Schedule** choice for super admins and admins:
  **One-time** (default, unchanged), **Recurring** and **As needed**. Other roles see the
  unchanged composer. Recurring opens a builder (ready patterns plus **Custom…**: every
  N days; weeks on chosen weekdays; months on chosen dates or the last day; months on the
  1st–4th or last weekday such as the 3rd Saturday; years in chosen months), start date,
  start and due time, end (never / on a date / after N times) and a live preview of the
  next 10 dates read from the scheduler's own engine. Each selected person gets their own
  schedule (a schedule has one owner); In Loop and attachments stay one-time only and the
  form says so.
- **Task Control → Review** (super admin, admin): Verification, Rejected, Overdue,
  Coverage Required, Manager Review, Follow-ups and Performance, with tiles that open the
  matching list or the Tasks tab filtered to recurring work. Same actions and RPCs as the
  old page.
- **Task Control → Templates**: each row shows the schedule in words, its **Next** date
  (or Ended) and **Run now**. Add/Edit uses the same builder and payload as Create Task,
  and an edit now keeps priority, verification, verifier, follow-ups, remark rule,
  checklist items and a paused state (the old form reset them).
- **Bulk Import** reads new frequencies through the same builder (3rd Saturday, Last
  Friday, every N days/weeks/months/years, Fortnightly, Half Yearly, Month End, weekday
  lists and ranges, "25th Monthly", Per Order, As Needed, On Demand). Every older label
  still produces byte-identical rules and start dates (`frequency.golden.test.ts`), so a
  replayed workbook matches its earlier rows. Unknown text is still a row error.
- **Navigation**: Recurring / To-Do is gone from the menu, launcher and Developer Mode
  switches. `/recurring-todo` (old bookmarks and notifications) is replaced by Task
  Control → Review for super admin/admin, Task Control → Tasks for manager/HR, and Tasks
  for everyone else.

## Feature migration matrix

| Recurring / To-Do feature | Now |
|---|---|
| New schedule | Create Task → Recurring / As needed; Task Control → Add Task |
| Schedules list, edit, pause/activate, delete | Task Control → Templates (existing) |
| Run now | Task Control → Templates → Run now |
| Assign now (as-needed) | Task Control → Templates (existing) |
| Import schedules | Tasks → Bulk Import (existing) |
| Today, Completed buckets | Task Control → Tasks, type Recurring (existing) |
| Overdue, Rejected, Coverage Required, Manager Review, Verification, Follow-ups, Performance | Task Control → Review |
| My Work (own recurring work) | Tasks → My Tasks (existing) |
| Stat tiles | Task Control → Review tiles |
| Status/priority/frequency/branch/department/date filters | Task Control filter bar + Review priority/frequency |

## Database (migration 0340)

Function-body changes only, each a guarded replacement that fails if production's text
differs. No table, column, row, grant or RLS policy changes.

1. `verify_recurring_task_with_audit` and `send_recurring_followup_with_audit` check
   Task Control's section switch (`task_templates`) instead of `recurring_todo`. Role
   and verifier checks are unchanged. Their alerts link to `/tasks?task_id=<task>`.
2. `save_recurring_todo_template_with_audit` stores `trigger_label` for an as-needed
   duty, keeps it when an older client omits it, and clears it for calendar schedules.
3. `save_task_template_with_audit` creates no first occurrence for a new template saved
   inactive. Only an as-needed duty is created inactive; previously creating one also
   created an ordinary task that day.

No new RPCs, so generated types are unchanged. `recurring_todo` stays in the permission
catalog and section contract (old clients' delete RPC still checks it). The generators
(`generate-recurring-tasks`, `ensure-my-recurring-tasks`, `materialize-recurring-schedule`)
are unchanged and need no redeploy. They already evaluate any supported rule through
`shouldGenerateRecurringTask`, the same function the preview uses, and the unique index
on `(task_template_id, scheduled_date)` keeps concurrent runs from duplicating work.

## Evidence (local)

- Core: 1144 tests; web: 600 tests; turbo typecheck and build; Deno tests of both
  recurrence workers; `git diff --check`.
- pgTAP `0340_recurring_work_in_tasks_and_task_control` (42 assertions): builder rules
  accepted by the DB grammar, exact storage and anchored start, first occurrence on the
  3rd Saturday with times, idempotent generation, as-needed duty with no occurrence,
  edit leaves completed work byte-identical, verifier/admin/cross-tenant/inactive/doer
  allow and deny, rejection returns work with its reason and a Tasks link, follow-ups,
  and both pausing with Task Control's switch.
- Full pgTAP suite on a database-only stack. Every file that fails there fails
  identically on `main` without 0340 (FMS engine, CRM, Ask Kiara and function-inventory
  files that need the full stack); 0340 changes no other result.
- Deploy rehearsal on seeded history (40 schedules, 480 occurrences): the deploy
  transaction's before/after row digests were identical. The captured rollback restored
  byte-identical function definitions.

Not proven: hosted Postgres, rendered screens on a real phone, production data.

## Release (owner)

1. PR and CI green.
2. From the MKJewelOS checkout linked to production, run the gated script
   `deploy-0340.ps1` (with `deploy-0340.sql` built from the PR's migration). It checks the
   project ref, refuses if 0340 exists or the latest migration is outside 0300–0339, saves
   `rollback-0340.sql`, and applies in one transaction that rolls back if any task,
   schedule, assignee, checklist, comment, notification or audit row count/digest
   changes.
3. Then merge (Vercel deploys the web). No Edge Function deploy, no APK.

Recovery: run `rollback-0340.sql` (restores the four previous function definitions
and removes the migration record), then revert the web merge. No data needs repair.

## Production checks (owner)

- As an admin: Create Task → Recurring → 3rd Saturday of every month; the preview shows
  the coming 3rd Saturdays; save; Task Control → Templates shows it with its Next date.
- As an admin: Create Task → As needed → Per Customer; no task appears today; the
  employee sees it under Anytime duties.
- Task Control → Review: verify one item and reject another with a reason; the employee's
  alert opens that task.
- Open an old `/recurring-todo` link as admin, manager and staff.
- Bulk Import: replay a previously imported workbook; rows show as replayed.

## Limitations

- Several separate occurrences per day are not supported (one occurrence per template
  per date is a database rule). Use one occurrence with time-of-day checklist items;
  the builder offers "Use Morning & Evening checkpoints".
- Skipping holidays is not supported: there is no business holiday calendar. Leave and
  week-offs are handled per employee by coverage.
- A shared (one task for several people) schedule is not supported; each person gets a
  schedule.
- Scheduling from Create Task and the Review tab are for super admin and admin, the
  roles the template directory and recurring workspace RPCs admit; managers keep their
  existing Task Control views.
- A rejected occurrence from an earlier day is reached from its notification link or
  Search; the task board still shows only today's dated recurring work (existing rule).
- Older import labels keep their sheet start date even when it is not a rule date
  (unchanged, for replay safety); new labels start on their first real date.
