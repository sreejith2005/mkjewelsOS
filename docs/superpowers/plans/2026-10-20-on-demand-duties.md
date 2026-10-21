# On-demand duties: implementation plan (2026-10-20)

Design: `docs/superpowers/specs/2026-10-20-on-demand-duties-design.md`.
Branch: `feat/on-demand-duties-20261020` (worktree `C:\jdemand`, from `origin/main` b844a67).

## Steps

1. [x] Migration `0293_on_demand_duties.sql`: `trigger_label`, `on_demand`,
   per-day index excludes on-demand rows, live views refreshed, patched
   `create_recurring_todo_instance`, `emit_task_notification_event`,
   `get_task_template_directory`, `commit_task_bulk_import_chunk_v0104`; new
   `start_on_demand_task_with_audit`, `get_my_on_demand_duties`.
2. [x] pgTAP `0293_on_demand_duties.test.sql` (29 assertions: anon, peer,
   other-branch manager, denied admin, dated/unassigned/deleted templates,
   self vs assigned alerts, audit, scheduled generation beside on-demand rows,
   daily cap, import label and replay backfill).
3. [x] `generate-recurring-tasks` pages through all active templates.
4. [x] Core: `taskImportTriggerLabel`, `trigger_label` on import rows,
   `onDemandDuties.ts` (parse, labels); database types (both copies).
5. [x] Web: As needed panel in My Tasks; Assign now in Task Control and
   Recurring / To-Do; ON DEMAND status and trigger frequency label.
6. [x] Ask Kiara app help + review doc; task import handoff doc.

## Kiara tool decision

No new Kiara read tool. Started duties are ordinary tasks that Kiara's existing
task tools already read; the standing list is shown on screen and explained in
app help.

## Rollout (owner gates)

1. PR + CI.
2. Hosted: apply 0293 (single-migration deploy with in-transaction smoke), then
   deploy `generate-recurring-tasks`.
3. Merge to `main` (Vercel deploys the web). No APK.
4. Owner re-uploads the original task sheet once to fill trigger labels. The
   replay matches on the business fingerprint, which includes start/due times,
   so keep the default timing presets (manual 11:00-20:00) or rows would be
   created again instead of replayed. A read-only fingerprint dry run against
   `task_import_row_registry` can confirm the match count before uploading.
