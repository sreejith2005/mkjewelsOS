# Production Demo-Data Retirement Runbook

This is a one-time production cutover procedure. It does not authorize a database reset, raw SQL deletion, seed, import, or retry outside the guarded Settings control.

## Required approval record

Before execution, record outside source control: approved Git SHA; exact hosted project reference; operator and approver; maintenance window; provider backup reference and a completed staging restore rehearsal; worker-pause owner; preview manifest hash; removal/retention counts; and rollback owner.

## Procedure

1. Confirm the browser is connected to the intended hosted project and that the deployed web/function/migration SHA is the approved one. Run the linked migration list and `supabase.cmd db push --linked --dry-run`; do not proceed if any pending migration is unexpected.
2. Take a fresh provider-supported backup. Verify the backup can restore into staging without exposing data in source control, terminal transcripts, or chat.
3. Place the app into a short read-only maintenance window. Pause recurring-task, deadline, notification-outbox, report-export, and CRM-sync mutation workers only through their protected operational controls. Record each paused worker.
4. As an active Super Admin, open Settings and enter the non-secret backup reference. Confirm the maintenance acknowledgement and create a preview. Save the manifest hash and count report externally.
5. Stop if the preview includes a CRM, Auth/user, branch/department, Availability, configuration, audit, or unclassified table count. Resolve the classification with a new reviewed forward migration; never edit an applied migration.
6. Obtain final written approval that quotes the exact preview hash and counts. Type `RETIRE DEMO DATA` in the Settings card and execute once.
7. Compare post-run counts with the approved preview. Verify the cutover audit event, retained CRM documents/counts, staff sign-in, profiles, branch/department, Availability, and empty Tasks/FMS/Forms/Notifications/Reports pages.
8. Re-enable the paused workers, monitor the agreed window, and write a non-secret release outcome. If an invariant fails, contain workers and use the rehearsed restore or a reviewed forward corrective migration. Do not rerun the reset or use raw deletes.

## Explicit boundaries

Retained: the application and every section, Auth/users/profiles, branches/departments, Availability, buddy coverage, CRM/data/documents/sync, Dropdown Master, Settings/section controls/preferences/provider configuration, and historic audit rows.

Retired: demo task/import/template records, FMS definitions/instances, form definitions/submissions, notification templates/rules/deliveries, reports/exports/runtime events, daily-checklist demo state, and only manifest-listed non-CRM Storage objects.
