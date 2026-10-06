# Desktop web, phone web, and Android parity audit

Date: 2026-10-06 (Asia/Kolkata). Source baseline: `3d982d0`, branch
`feat/crm-sheet-sync`. Status: initial source audit; implementation and rendered
certification are outstanding.

## What this audit establishes

Desktop web and phone web are two viewport presentations of `apps/web`, not two
independent backends. Android has separate React Native presentation in
`apps/mobile`. The web routes are the behavioral reference, with server
authorization and existing approved designs remaining authoritative.

Screen existence, similar labels, and passing pure tests do not establish
complete workflow parity. Every inventory row below needs an action-level
comparison and authenticated desktop/phone/device evidence before certification.
The previous `MOBILE_PARITY_MATRIX.md` remains historical evidence, not a current
completion certificate. Its CRM screen inventory is superseded by the current
`CrmWebViewScreen` and the September 25 / October 1 CRM designs.

Unrelated changes present at audit start: `PROJECT_HANDOFF.md`, CRM client-list
paging migration and its test. Additional CRM UI, generated-type and paging-test
edits appeared during the audit; none were made by this audit. Preserve them.
CRM implementation work follows
the repository's `C:\crm` worktree requirement and current two-project runbook.

## Confirmed source gaps

| ID | Finding and source | Consequence | Required closure |
| --- | --- | --- | --- |
| P01 | `FmsScreen`, `FmsInstanceScreen`, `FmsStageScreen`, `FmsTasksScreen`, `RecurringTodoScreen`, `TaskControlScreen`, and `AvailabilityScreen` do not register tenant realtime subscriptions. Web FMS, recurring work, Task Control, and Availability do. FMS console additionally refreshes on navigation focus; pull-to-refresh exists in several screens. | A remote mutation can leave an already-open Android workspace stale until a manual refresh, navigation, or remount. | Subscribe each workspace to its relevant durable-change signals, refetch authorized loaders, and test changes originating on another surface. |
| P02 | `packages/data/src/realtime/api.ts` and the web realtime API subscribe without handling subscription status; the web refresh hook reacts to incoming events only. Native `NetworkBanner` reports connectivity, while `AuthProvider` foreground handling refreshes access. | There is no general operational-data catch-up contract for events missed while backgrounded/disconnected. | Refetch on successful reconnection, return to foreground, and route focus where needed; coalesce refreshes and preserve drafts. |
| P03 | Both realtime APIs define the same six tenant topics and maintain separate implementations. Reports and notifications are not topics in that union; notifications use a separate inbox mechanism. | A single topic subscription cannot be assumed to keep every module current. Duplicated transports can diverge. | Inventory actual signals, including notification inbox and export progress. Extend the existing shared transport only where necessary; preserve specialized working subscriptions. |
| P04 | `packages/core/src/fms/types.ts` and `engine.ts` support and validate `sla.assignmentFieldKey`. Neither current web nor native builder contains a control reading/writing that key. Both already recognize the corresponding validation issue. Migration/test `0193_fms_form_selected_user_assignment` exists. | The shared server capability is not authorable from either builder; this is a shared omission rather than an Android-only omission. | Expose required, always-visible Users-backed linked-form assignment selection on both builders, preserving explicit stage overrides. Verify migration state separately before any hosted claim. |
| P05 | `RootNavigator` mounts `NavigationContainer` without a linking configuration. Shared path adapters and exact FMS identities exist for internal navigation. | External Android URL entry is not established by the existing internal route adapters. | Inventory app manifest intent filters, cold/warm launch handling, and all web destinations; close and test any missing incoming-link path without inventing another FMS URL contract. |
| P06 | Current CRM uses `CrmWebViewScreen`, loading the configured web `/crm` route through an authenticated bridge. The ported `packages/crm-ui/src` contains no explicit realtime subscription/focus-refresh mechanism found by this audit. | Shared presentation avoids separate CRM field implementations, but does not itself prove live multi-device freshness or native file/download behavior. | Trace CRM query invalidation and reconnect behavior, add necessary refresh against the CRM project's authority, and verify bridge/session/files on Android. |
| P07 | `adb devices -l` returned no devices. Earlier parity tracker also marks authenticated device proof pending. | No current APK walkthrough, touch/keyboard proof, or three-surface live mutation proof is available. | Connect a designated device/emulator and run the acceptance matrix before claiming complete parity. |

P01-P06 are source findings. They do not prove a reproduced production failure.
P05/P06 require further integration tracing before selecting a code change.

## Complete section inventory

All rows include identical allowed/denied behavior, loading/empty/error states,
phone keyboard/scroll/touch behavior, and propagation of authorized mutations.
Existing source means present, not certified.

| Section / web entry | Current Android entry | Required action-level comparison |
| --- | --- | --- |
| Authentication / account recovery | `LoginScreen`, `AuthProvider` | Login, logout, recovery entry, expired session, shared-device cleanup, active/inactive account and default landing behavior. |
| Shell / menu / theme | `AppTabs`, `SectionScreen`, shell model | All accessible menu destinations, section maintenance, history/back, badges, safe areas, theme and permissions changing remotely. |
| Home `/` | `HomeScreen` | Every task/FMS alert, priorities, follow-ups, activity, exact destination and completion state. |
| Dashboard `/dashboard` | `DashboardScreen` | All ranges, filters, scope/authority, metrics, comparisons, scores and refresh. |
| Tasks `/tasks` | `TasksScreen`, `TaskDetailScreen`, task cards | My/delegated/watcher views, filters/counts, comments, checklists, evidence, revision, required forms, completion, FMS rows and open undated/future work. |
| Task creation | `TaskComposerScreen`, voice capture | Every field/default, one doer, watchers, scope, attachment retry without duplicate task, voice review and conservative name matching. |
| Bulk import `/tasks/import` | `TaskImportScreen` | CSV/XLSX, validation/mapping, correction, bounded execution, stable retry, history, and privacy. |
| Assigning Left `/tasks/assigning-left` | `AssigningLeftScreen` | Filters, mapping/remediation, replay and permission restrictions. |
| Recurring `/recurring-todo` | `RecurringTodoScreen` | Schedule mutations, recurrence, work/verification, follow-up, coverage, scoring, evidence and live state. |
| Task Control `/task-templates` | `TaskControlScreen` | Every tab/filter, pagination, template mutation, evidence, performance and live state. |
| FMS `/fms` | `FmsScreen`, `FmsBuilderScreen`, graph/stage editors | Flow families/versions, draft/publish/revise/duplicate/delete, named/default/form-selected assignees, stage types, routing, SLA, check/issue navigation and touch canvas. |
| FMS assigned/runtime work | `FmsTasksScreen`, `FmsInstanceScreen`, `FmsStageScreen`, `FmsStageFormScreen`, starter `FormFillScreen` | Starter/stage identity from Home/Tasks/Notifications/URL, claim/evidence/approve/reject/reassign/revise/escalate/backward actions, hold/resume/cancel, timeline and atomic form progression. |
| Forms `/forms` | `FormsLibraryScreen`, `FormBuilderScreen`, `FormFillScreen` | Field families/options, live Users dropdowns, sections/conditions/routing, validation, preview, lifecycle/version families, publish/revise/archive/duplicate/delete impact and preserved assigned work. |
| Form submissions | `FormSubmissionsScreen`, `FormSubmissionScreen` | Grouping/filtering, immutable snapshots, removed template history, linked metadata, private files, approve/reject and notes. |
| CRM `/crm/*` | `CrmWebViewScreen` | Every current ported route, field, filter, lead/client/family/referral identity and walk-in/task link; login bridge, back navigation, documents/downloads and two-project sync. Preserve approved original CRM presentation. |
| Notifications `/notifications` | `NotificationsScreen`, notification admin | Inbox/read history, durable work closure, destinations, templates/rules/providers/delivery logs, permissions and refresh. |
| Users `/users` | `UsersScreen`, organization tree | Directory/hierarchy/filtering, invite/edit/status/password/delete, contacts/reporting/buddies/week-off and organization administration consumers. |
| Availability `/availability` | `AvailabilityScreen`, `LeaveApplications` | Board/ranges/coverage, personal leave, office summary, half-days, attachments, handover, pending-date editing, review and permission exceptions. Current native office-summary code exists. |
| Reports `/reports` | `ReportsScreen` | Definitions, filters/scopes, preview/pagination, export queue/progress/history/retry/cancel, private download and refreshed completion. |
| Dropdown Master `/dropdown-master` | `DropdownMasterScreen` | Categories/search/status/counts, create/edit, stable values, activation and dependency-safe deletion. |
| Settings `/settings` and permissions | `SettingsScreen`, `PermissionManagementScreen` | Identity/preferences, tenant/branch configuration, effective permission layers, dashboard authority, section controls, authorized purge, optimistic versions and draft protection. |
| Daily checklists | Native manager and gate | Authoring/defaults, blocking completion, Android back behavior, and cross-device closure. |
| Supporting device operations | Native file/voice/update utilities | Camera/gallery/files, MIME/size/scope/private signed access, permission denial, interrupted uploads, release update installation and signer compatibility. |

Meeting AI is excluded while no working web route exists. Menu identifiers alone
do not create parity scope. Any other discovered working web destination must
be added before completion.

## Verification recorded this turn

- `pnpm.cmd --filter @jewelos/core exec vitest run src/fms/fms.test.ts`:
  67 tests passed.
- `pnpm.cmd --filter @jewelos/data exec vitest run src/realtime/api.test.ts`:
  1 test passed. This tests topic multiplexing, not reconnect catch-up.
- `npm.cmd --prefix apps/mobile run test`: 18 files / 109 tests passed.
  These tests do not mount and certify every React Native workflow.
- `pnpm.cmd --filter web exec vitest run src/features/realtime/api.test.ts
  src/features/realtime/useTenantRealtimeRefresh.test.tsx
  src/pages/FmsAssignedWorkPage.test.tsx src/mobileDocument.test.ts`:
  4 files / 13 tests passed.
- `adb devices -l`: no connected devices.

No application code, schema, generated types, RLS, RPC, Storage policy, or audit
contract changed in this audit. No hosted mutation, deployment, Git publish, or
Android release occurred. No authenticated side-by-side browser/device pass or
Postgres test run occurred. Phone responsiveness findings remain unverified
until rendered inspection.

## Subsequent implementation evidence

Inline implementation has now changed application/shared source and added an unapplied refresh-signal migration. The initial audit statement above describes the audit phase only. See [the acceptance record](MOBILE_PARITY_ACCEPTANCE_2026-10-06.md) for implemented actions, full/focused tests, transactional database evidence, authenticated phone-width checks, live desktop/phone preference propagation and the outstanding device/CRM/hosted/release gates. Full parity remains incomplete.
