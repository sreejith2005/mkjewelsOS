# Delete-all schedule remnants

Owner reported a 31-row reimport creating 15 records and replaying 16 after full
Task Control deletion. Hosted read-only aggregates confirmed exactly that batch:
all 31 rows are recurring; the 16 replayed templates are inactive, have never
generated an instance, and belong to the same employee. Whole-series deletion
audits exist, but the bulk preview enumerated only task occurrences, so those
templates were never offered to the deletion RPC.

1. Reproduce with 15 generated schedules plus 16 inactive/unmaterialized schedules.
2. For Delete All, gather scoped schedule records through the existing authorized
   template directory, including inactive/future/undated records. Filter by employee,
   branch, department, search and checklist/upload type; do not infer a task date
   for a schedule. Make date/status independence explicit in confirmation.
3. Add schedule-only targets when the occurrence preview does not represent that
   schedule. Default full Delete All to series deletion; an explicit occurrences-only
   choice retains future schedules. Keep multi-select occurrence behavior unchanged.
4. Route schedule targets through the existing audited template-delete RPC; route
   occurrences through the existing audited task-delete RPC. Never clear an import
   fingerprint while leaving its underlying live schedule intact.
5. Show separate occurrence/schedule counts, include zero-occurrence workspaces,
   preserve completed history, and keep template failures separate from task IDs.
6. Test the complete 31-row delete/reimport using local synthetic pgTAP and shared
   orchestration tests, then web/native type/build/confirmation checks and scoped
   main publication. No new schema/RPC/type migration or hosted customer deletion.

The 15 newly imported records are legitimate existing work now. To obtain a clean
31-new-record reimport, the owner must run the corrected full Delete All before
uploading the sheet again. Merely uploading again should still deduplicate live work.
