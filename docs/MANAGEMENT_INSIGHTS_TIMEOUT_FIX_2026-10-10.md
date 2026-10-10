# Main Dashboard timeout correction - 2026-10-10

The Main Dashboard failed because its default overview exceeded the authenticated
database statement budget. A production read took 27,508 ms against an unchanged
8-second limit. Earlier administrative SQL smoke checks validated the response
but did not enforce that request limit.

## Correction

Migration `0209_management_insights_request_budget.sql` permits PostgreSQL to
inline the private, parameter-only metric predicate and resolves the four stable
module-access decisions once per row-helper invocation. Predicate inlining alone
did not pass the local scale regression; both changes together did.

Actor resolution, record scopes, metric calculations, public RPC signatures and
grants are retained. Definer functions keep their fixed search paths. The private
helpers remain inaccessible to authenticated clients. No stored records, RLS
policies, Storage, audited write contracts or generated types change. There are
no client or native source changes in this correction, so no APK is required.

## Local evidence

The new pgTAP regression inserts 1,000 synthetic assigned tasks inside a rolled
back transaction. Before the correction it failed the eight-second budget and
open-task count assertions. Afterward it passes and counts all 1,000 tasks.

Each focused test was executed through:

```powershell
Get-Content -Raw <test-file> | docker exec -i supabase_db_jewelos psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

TAP output was checked for failures, in addition to the process exit status:

- `supabase/tests/0206_management_insights.test.sql`: 41 assertions passed.
- `supabase/tests/0207_dashboard_saved_views.test.sql`: 14 assertions passed.
- `supabase/tests/0209_management_insights_request_budget.test.sql`: 3 assertions passed.

No full database reset, full test suite or authenticated browser session was run
for this correction. Concurrent task-management source changes were left intact.

## Hosted evidence

The linked target was confirmed as `jewelos-prod` (`yimafxhuwgfhvzczqqdd`). An
ignored deployment overlay containing committed migrations through 0207 plus
0209 isolated this correction from the concurrent, unreviewed 0208 migration.

```powershell
supabase.cmd migration list --linked --workdir <approved-hotfix-overlay>
supabase.cmd db push --linked --dry-run --workdir <approved-hotfix-overlay>
supabase.cmd db push --linked --yes --workdir <approved-hotfix-overlay>
supabase.cmd db push --linked --dry-run --workdir <approved-hotfix-overlay>
```

The dry run proposed only 0209. Its apply succeeded, and the following dry run
reported no pending overlay migrations. The hosted ledger records 0209.

The same default overview, with an active actor and explicit 8-second statement
timeout, completed in **2,104 ms** after deployment. All seven payload structure
checks passed. The authenticated role's 8-second limit is unchanged; private
predicate and row-helper execute grants remain denied. A no-actor public RPC
call remains denied with SQLSTATE 42501. Only booleans and timings were printed;
no operational records were exported.

Migration 0208 was deliberately not applied. Its owner must inspect the linked
ledger and use the appropriate out-of-order migration procedure (including a
reviewed `--include-all` dry run) before deploying that separate change.

These checks prove the corrected server response meets the reproduced request
budget. They do not constitute a signed-in browser rendering or physical-device
test. No CRM-project migration is needed for this Main Dashboard correction.
