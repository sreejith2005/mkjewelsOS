# Task Control bulk deletion

Owner requested multi-select and delete-all in the existing filtered Task Control
workspace. This extends the authorized admin deletion feature without a new
database contract or permission resolver.

1. Add controlled selection to web/native task rows, select-page/clear controls,
   Delete selected and Delete all matching. Keep selection over pagination;
   clear selection when date, employee, scope, search or task view changes.
2. Share bulk preparation/execution in packages/data: gather every filtered page
   before mutation, reject inconsistent pagination, load current task identities
   in bounded requests, and exclude FMS work. Freeze the identities for confirmation.
3. Confirm exact selection count. Optional whole-series mode deduplicates series
   before invoking the existing audited delete RPC; warn that it includes unfinished
   occurrences outside the current filters and retains completed history/evidence.
4. Limit concurrent writes to three. Report progress and partial failures; preserve
   failed/unattempted selections for retry. Refresh filtered rows/totals afterward.
5. Test all-page collection, filter preservation, stale/missing rows, deduplication,
   partial failures and selection interactions. Run relevant web/data/native tests,
   types/build, scoped publication checks, and the Android device/release gates.

No schema, RPC, RLS, Storage, audit or generated-type changes. Existing server
authorization and per-task transaction guarantees remain the write boundary.
Bulk deletion is a series of audited transactions, with explicit partial results.
