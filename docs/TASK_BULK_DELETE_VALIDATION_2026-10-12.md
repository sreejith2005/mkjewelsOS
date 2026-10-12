# Task Control bulk deletion - 12 October 2026

Owner requested multi-delete and delete-all within the existing filtered Task
Control Tasks panel. The action is available to administrators with tasks.view_all.

## Behavior and source scope

- Web TasksTab/TaskTemplatesPage and native taskControl rows/TaskControlScreen add
  individual selection, Select this page, Clear selection, Delete selected and
  Delete all matching. Selection survives pagination and clears on filter, view,
  identity or administration-permission changes.
- BulkDeleteDialog/BulkDeleteSheet prepare and freeze the target identities before
  confirmation, display the employee scope and exact task count, and offer an
  explicit entire-recurring-series option. That option warns it includes unfinished
  occurrences outside the filters and preserves completed history/evidence.
- packages/data/taskControl/bulkDelete gathers every filtered page in 100-row reads,
  rejects changed/duplicate pagination and missing identities, excludes FMS work,
  deduplicates recurring series, and limits concurrent audited writes to three.
- Each existing admin_delete_task_with_audit transaction performs authorization,
  deletion, notification closure, import retirement and audit linkage. This is not
  one atomic transaction for the entire selection. Progress and partial failures
  are explicit; failed/unattempted targets remain selected for retry. A refresh
  retains filters and returns to page one without reloading the old page.

No migration, RPC, RLS, Storage, generated-type, permission or Edge Function change.
No hosted records were deleted during implementation or verification. The unrelated
task-assignment permissions work in this shared checkout is outside the reviewed
bulk-delete paths and is not included in this change.

## Verification

- Focused web task-control/page/admin tests: 6 files, 25 passed.
- Data bulk-delete and task API tests: 2 files, 19 passed, including all-page
  collection, stale scope, missing records, series deduplication, ordinary tasks
  in series mode, bounded concurrency and stopping the queue after a failure.
- Native suite: 25 files, 127 passed with --maxWorkers=1 --testTimeout=15000.
  An initial concurrent run timed out in the unrelated appAvailability test;
  the serial run passed without changing that test or its implementation.
- Native source also typechecked against a temporary snapshot of the committed
  data API plus the new bulk module while concurrent assignment RPC types were
  being edited. The temporary snapshot/configurations were removed afterward.
- Final normal native and data typechecks passed after the concurrent type
  regeneration settled. Duplicate declarations were corrected by that concurrent
  work before the proposed patch could apply; no assignment source/type changes
  were made by this task.
- Final pnpm.cmd --filter web build passed, including web TypeScript. Existing
  large-chunk warnings remain. Checks ran in the shared checkout with concurrent
  assignment work; only the named bulk-delete paths are published by this task.
- Real authenticated browser and physical-phone QA remain unverified. Browser
  execution tools are unavailable and adb devices -l lists no connected device.
  No signed Android update was published because the required phone gate is open.
- No new database behavior, so no fresh pgTAP run or migration deployment.
