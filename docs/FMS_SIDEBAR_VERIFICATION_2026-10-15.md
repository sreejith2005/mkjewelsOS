# FMS entry and sidebar counts: local verification

Status: implementation and focused local validation complete; **not deployed**.
Approved scope: chat approval on 2026-10-14; continued on 2026-10-15.
Reported production path: Forms Library -> Instagram Assignee -> Instagram FMS.
The particular hosted workflow/submission was not inspected with an employee
session and has not been retested in production.

## Behavior and files

- `supabase/migrations/0236_fms_initial_form_routing.sql` repairs the confirmed
  initial-form routing bug. Previously, a first Form with conditional routes
  and no default-next column immediately completed the instance, with no next
  work item. Both standalone and exact-starter entries now use the existing
  route evaluator and activation engine. The existing 0194 submitter fallback,
  explicit assignees, and form-selected assignment precedence are preserved.
- The same migration makes retrying an already-started durable standalone
  submission return its original instance. It rejects wrong form versions or
  out-of-scope linked workflows with actionable errors. Atomic standalone
  submission rolls back when start fails. Ordinary unlinked forms still submit.
- `supabase/migrations/0237_sidebar_pending_counts.sql` adds exact personal
  pending-work counts, independent of recent-inbox/page limits. Tasks include
  own unfinished doer work, pending verification and FMS work; recurrence, FMS,
  Forms and unread notifications have section counts. Completed individual FMS
  contributions are excluded even while peers still owe work.
- That migration emits private durable leave-status notifications. Availability
  counts own unread updates and authorized pending reviews. A snapshot captured
  before loading leave data is acknowledged only for displayed own leave IDs,
  on visible History. Newer arrivals, failed loads, hidden tabs, backgrounded
  pages and blurred native screens retain unread state.
- Shared implementation: `packages/core/src/sidebarCounts.ts` and its export;
  `packages/data/src/sidebar/api.ts`; additive RPC signatures in both existing
  generated `database.types.ts` files.
- Web: `features/sidebar/useSidebarCounts.ts`, ApplicationShell, mobile drawer
  and bottom navigation, NotificationBell, and additive read-snapshot hooks in
  `features/availability/LeaveApplications.tsx`.
- Native: `lib/useSidebarCounts.ts`, `sidebarCountsSubscription.ts`, AppTabs,
  drawer/bottom navigation/header, and additive Availability read-snapshot hooks.
- Focused tests accompany these changes. Existing dirty Task, CRM, leave
  deletion, database-type and other unrelated changes were preserved; the web
  leave files and generated types contain both pre-existing work and these
  scoped additions. Do not stage those files wholesale without hunk review.

## Database, authorization and compatibility

New public authenticated-only RPCs:

```text
get_my_sidebar_counts() -> jsonb
get_my_leave_update_ids() -> uuid[]
mark_my_leave_updates_read(p_notification_ids uuid[], p_leave_ids uuid[]) -> integer
```

The initial routing helper and leave notification trigger are internal, with
client execution revoked. Actor/tenant/module/permission checks stay server-side;
the count API does not accept a caller-selected profile. Leave read updates
preserve `is_read`/`read_at` history and write audit evidence. No new tables,
columns, Storage behavior or RLS policies are introduced. No historical form
answers, workflow visits, assignments or notifications are deleted or rewritten.
Existing failed submissions/runs are not automatically backfilled.

## Local evidence

Database: isolated `jewelos_fms_sidebar_qa` database in local
`supabase_db_jewelos`, cloned from the existing local baseline through 0234.
0236 and 0237 were applied there; no hosted migration was applied. This is not a
claim that every migration was rebuilt from an empty Supabase stack.

SQL tests were fed individually using:

```powershell
Get-Content supabase/tests/<file> -Raw |
  docker exec -i supabase_db_jewelos psql -U postgres -d jewelos_fms_sidebar_qa -X -q -v ON_ERROR_STOP=1
```

The runner checked `not ok`, `ERROR`, and pgTAP completion, not just psql exit:

- 14 FMS files, 364 assertions passed: 0010, 0038, 0041, 0053, 0062,
  0063, 0112, 0142, 0149, 0150, 0160, 0193, 0212, and new 0236 (16).
- New 0237: 49 assertions passed, including exact counts beyond page/date
  limits, personal/admin scope, multi-doer completion, verification, inactive,
  cross-tenant, module/permission denials, snapshot races and read history.
- Existing leave regressions 0174, 0176, 0181, 0234: 119 assertions passed.
- Total focused database evidence: 19 files / 532 assertions passed.
- `0006_restrict_function_execution.test.sql`: denial checks pass, but seven
  existing function-count/identity snapshot expectations fail against this
  database's later migration set. Its three new RPC identities were added to
  the authenticated allowlist. The whole database suite is **not** green.
- `plpgsql_check` is absent from the QA database; database lint is not claimed.

Client commands and results:

```text
pnpm.cmd --filter @jewelos/core exec vitest run src/fms/fms.test.ts src/sidebarCounts.test.ts --maxWorkers=1
  72 passed
pnpm.cmd --filter web exec vitest run src/features/forms/api.test.ts src/pages/FmsAssignedWorkPage.test.tsx --maxWorkers=1
  16 passed
pnpm.cmd --filter web exec vitest run src/features/availability/LeaveApplications.test.tsx src/features/sidebar/useSidebarCounts.test.tsx src/features/notifications/NotificationBell.test.tsx src/components/shell/ApplicationShell.navigation.test.tsx src/components/shell/MobileNavigationDrawer.test.tsx --maxWorkers=1
  21 passed, then final leave suite 9 passed after visibility fix
pnpm.cmd --filter web exec vitest run src/features/availability/LeaveApplications.test.tsx --maxWorkers=1 --testTimeout=30000
  final 9 passed
pnpm.cmd --filter @jewelos/data exec vitest run src/sidebar/api.test.ts --maxWorkers=1
  4 passed
pnpm.cmd --dir apps/mobile exec vitest run src/lib/sidebarCountsSubscription.test.ts src/lib/appAvailability.test.ts src/lib/refreshLifecycle.test.ts src/navigation/shellModel.test.ts --maxWorkers=1 --testTimeout=30000
  37 passed; final availability/subscription repeat 2 passed
pnpm.cmd --dir apps/mobile exec vitest run src/lib/appAvailability.test.ts src/lib/sidebarCountsSubscription.test.ts --maxWorkers=1 --testTimeout=30000
  final 2 passed
pnpm.cmd --dir apps/mobile run typecheck
  passed after final focus/foreground guard
pnpm.cmd exec turbo run typecheck --force --concurrency=1
  6 packages passed
pnpm.cmd exec turbo run build --force --concurrency=1
  6 packages passed; existing bundle-size warnings
pnpm.cmd --filter @jewelos/data typecheck
  passed after final RPC arguments
pnpm.cmd --filter web typecheck
  passed after final visibility fix
pnpm.cmd --filter web exec vite build
  passed after final visibility fix
git -c core.safecrlf=false diff --check
  passed
```

Native tests initially encountered a 5-second import timeout under host
contention; the same focused tests passed with the 30-second timeout. Browser
inventory had no available authenticated surfaces; no rendered desktop/phone
or authenticated browser proof is claimed. `adb devices` listed no devices.

## Release gates and next work

Read-only hosted checks confirmed the linked project `jewelos-prod`
(`yimafxhuwgfhvzczqqdd`). `supabase.cmd migration list --linked` succeeded;
`supabase.cmd db push --linked --dry-run` failed with
`LegacyDbPushMissingLocalError`: hosted 0218-0230 are absent locally.

`origin/main` contains those migrations and
`0235_user_management_permission_contract.sql`; this checkout instead has
unrelated untracked `0235_full_task_edit.sql`. Do not repair the hosted ledger
or rename another task's work to force deployment. Reconcile the release onto
the current main migration history and resolve the pending migration collision.

The required release script was invoked from the confirmed root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-mobile.ps1 -Notes "FMS initial form routing and live personal work counts"
```

It stopped at preflight because the checkout is on
`feat/department-section-access`, not `main`. Unrelated shared source changes
and unavailable physical-phone validation are additional release constraints.
No task commit, push, hosted write, web deployment, APK or update manifest was
published. No production ledger repair was attempted.

After source/migration reconciliation, run the grant snapshot gate against the
complete migration set, authenticated desktop/phone-width Instagram entry and
sidebar checks, and physical Android validation. Then use the production
playbook and signed mobile release script; verify hosted migration state, web
deployment, public manifest and APK separately. Any recovery of the previously
failed Instagram submission should be targeted and audited after inspecting
its persisted state, without duplicating or deleting history.
