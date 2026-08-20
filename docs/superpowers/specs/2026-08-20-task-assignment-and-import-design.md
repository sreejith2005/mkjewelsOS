# Assigned Work and Task Import Design

## Goal

Make every assigned normal task appear in its assignee's signed-in Home and Tasks views with an in-app alert, and allow authorized managers to create many normal tasks from a Google Sheets CSV export.

## Scope

This phase imports normal delegation tasks only. FMS stages and CRM follow-ups remain owned by their existing workflow and CRM mutation contracts; the Home view already presents all three work types in separate, clearly labelled sections.

The importer accepts UTF-8 CSV exported from Google Sheets. It does not connect to Google, retain Google credentials, or upload source files to permanent storage. XLSX and live Google Sheets synchronization are later enhancements, not part of this phase.

## Assignment and Home Behaviour

`create_delegation_task_with_audit` is the authoritative normal-task mutation. Its replacement import RPC will use the same server-side authorization, branch and department scope checks, availability handling, `task_instances`, `task_assignees`, `task_checklists`, and `audit_logs` conventions.

Every successful normal-task assignment inserts one `notifications` record per assigned active profile with event type `task_assigned`, a concise title, and `/tasks` as its link. This insert is in the same database transaction as the task and assignee rows. A failed notification insert fails the transaction, preventing a task from being assigned without its required in-app alert.

No duplicate Home copy is stored. `get_home_summary` remains the source for normal tasks, FMS stages, and CRM follow-ups. The existing Home subscription to the assignee's notification inbox refreshes the view when an alert is committed; the next summary read then includes the assigned normal task.

## CSV Mapping and Preview

The import page has four steps:

1. Choose a CSV file and parse it locally in the browser. Reject empty files, malformed quoted rows, a UTF-8 byte-order mark only file, more than 500 data rows, or more than 1 MiB of content.
2. Map arbitrary source headers to JewelOS fields. `Task title` and `Doer` are required. Description, due date/time, priority, category, branch, department, checklist item, and frequency are optional. A source column can be ignored.
3. Validate every row in a preview before any mutation. Display accepted, blocked, and unresolved rows separately. Unresolved rows cannot be submitted.
4. Confirm the accepted rows. The UI submits normalized row data and a file-content SHA-256 hash to one RPC, then displays created, skipped, and rejected counts returned by that RPC.

Rows create one normal task each. A checklist item on a row becomes one checklist item for that task. If a spreadsheet needs several checklist items for one task, the importer provides an explicit `Task group` mapping: rows with the same group value are combined only when their title, doer, due date, branch, department, priority, category, and frequency normalize to the same values. Any conflict leaves the group blocked in preview rather than guessing.

Frequency accepts `once`, `daily`, `weekly`, or `monthly`. `once` creates a normal task immediately. The other values create a task template through the existing audited template semantics; the preview makes that distinction explicit. Unsupported values are blocked.

## Doer Resolution

Employee codes are not used by this importer. A row may contain an exact name, exact email, or both. The server resolves against active, login-enabled profiles in the current tenant:

- If both values are mapped, they must resolve to the same profile.
- A unique exact normalized email resolves the doer.
- A unique exact normalized employee name resolves the doer.
- No match or more than one match is unresolved and cannot create a task.

The UI may show candidate profile names and email addresses for review, but it never sends a profile ID as proof of permission. The RPC performs the final resolution and authorization.

## Data and Security Contract

Add a forward-only migration containing an audited `import_delegation_tasks_with_audit(p_rows jsonb, p_import_hash text)` RPC and a `task_import_batches` table. The batch records tenant, actor, content hash, source column names, requested/created/rejected counts, and timestamps. It stores neither the raw CSV nor task descriptions. A unique tenant/hash constraint makes retrying the same confirmed file idempotent.

Only roles already authorized to create delegation tasks can invoke the RPC. The RPC reads the authenticated profile from `auth.uid()`, enforces tenant, branch, and department scope for every row, applies active/login-enabled doer checks, rejects cross-tenant references, creates audit entries for the batch and each task, and inserts assignee notifications in the same transaction. RLS is enabled with no direct client write policy for import batches; authenticated callers receive execute permission only on the RPC.

CSV cells are treated as untrusted text. The parser has a strict size/row limit, trims whitespace, rejects control characters except line breaks within quoted descriptions, and never renders cell values as HTML. The UI will not log rows or source file contents.

## Interfaces

- `apps/web/src/features/tasks/import/parseCsv.ts`: pure UTF-8 CSV parsing, header normalization, size limits, and mapping validation.
- `apps/web/src/features/tasks/import/normalizeRows.ts`: pure conversion from mapped cells into preview rows, including task-group validation and frequency normalization.
- `apps/web/src/features/tasks/import/api.ts`: loads eligible matching data for preview and calls the import RPC.
- `apps/web/src/features/tasks/import/TaskImportDialog.tsx`: upload, mapping, preview, confirmation, result display.
- `apps/web/src/pages/TasksPage.tsx`: manager-only `Import Tasks` entry point next to `Create Task`.
- `supabase/migrations/00xx_task_import_with_notifications.sql`: batch table, RLS, indexes, RPC, notification inserts, audit entries, and privileges.
- `supabase/migrations/00xx_task_import_with_notifications.test.sql`: pgTAP authorization, idempotency, matching, grouping, audit, and notification assertions.

## Acceptance Criteria

- A manager can export a Google Sheet as CSV, map changing headers, preview all rows, and import only valid rows.
- A normal imported task is visible in the assigned user's Home `My Tasks` section and `/tasks` feed after refresh or notification-driven refresh.
- The assigned user receives exactly one in-app `task_assigned` notification per newly created task.
- FMS and CRM work remain visible in their existing Home sections and are not duplicated by this importer.
- Import rows with unknown, ambiguous, inactive, login-disabled, out-of-scope, or cross-tenant doers cannot create tasks.
- Reconfirming the same source-file hash cannot create duplicate tasks.
- Every created task and each confirmed import batch has an audit record.
- No raw spreadsheet content, credentials, or sensitive contact details are written to logs or permanent import storage.

## Verification

Add pure unit tests for CSV parsing, header mapping, group validation, frequency parsing, and doer-match classification. Add component tests for mapping and blocked-preview states. Add pgTAP tests for manager success, ordinary-user denial, cross-tenant denial, ambiguous-name rejection, notification count, batch idempotency, and audit rows. Run web typecheck/build, focused web tests, database migration checks, and authenticated browser verification with two safe test accounts before any production claim.
