# JewelOS Native Parity Matrix

Reference date: 2026-09-23. The web application is the behavioral reference. “Automated” means source, focused tests, strict TypeScript, and build/export gates passed; it does not substitute for an authenticated employee-device walkthrough.

| Web surface | Native surface | Shared authority | Reads, writes, filters, and nested paths | Realtime | Evidence |
| --- | --- | --- | --- | --- | --- |
| Home `/` | `HomeScreen` | core home/FMS destination contracts; data home | assigned tasks, FMS starter/stage links, alerts, exact IDs | tasks, forms, FMS, notifications | Automated; device pending |
| Dashboard `/dashboard` | `DashboardScreen` | core analytics; data analytics | ranges, metrics, comparison, authority scope | task/organization topics | Automated; device pending |
| Tasks `/tasks` | `TasksScreen`, `TaskDetailScreen` | core task feed/card/capabilities; data tasks | feed/status, checklist, completion/revision, evidence, form links | tasks/forms/organization | Automated; device pending |
| Create task | `TaskComposerScreen`, `VoiceTaskCapture` | core manual/voice drafts and `tasks.voice_assign`; data tasks/voice | task/checklist, one doer, watchers, deadline, priority, form, attachment, voice review; native recording streams by file URI | refresh on return | Automated; manual render and microphone/device pending |
| Bulk import `/tasks/import` | `TaskImportScreen` | core `taskImport`; data import API/chunk runner | CSV/XLSX, identity mapping, validation, correction report, chunk resume, history, Assigning Left | tasks/organization | Automated; document-picker device pending |
| Recurring `/recurring-todo` | `RecurringTodoScreen` | core recurrence; data recurring | schedules, work, verification, follow-up, coverage | tasks/organization | Automated; device pending |
| Task Control `/task-templates` | `TaskControlScreen` | core task control; data tasks | filters, four tabs, status views, evidence URLs, template actions, pagination | tasks/organization | Automated; device pending |
| FMS `/fms`, assigned work | `FmsScreen`, `FmsBuilderScreen`, `FmsInstanceScreen`, `FmsStageScreen`, `FmsStageFormScreen` | core FMS paths/decisions; data FMS | draft/publish/revise/delete, graph/stages/assignees/conditions/forms, live runs and audited progression; compact canvas and scrolling configuration on phone | FMS/forms/tasks/organization | Automated; gesture/device pending |
| Forms `/forms` | `FormsLibraryScreen`, `FormBuilderScreen`, `FormFillScreen` | core forms; data forms | lifecycle filters, create/edit/publish/revise/archive/duplicate/publish-as-new/delete impact, authoring, fill | forms/tasks/FMS/organization | Automated; device pending |
| Form submissions | `FormSubmissionsScreen`, `FormSubmissionScreen` | core submission presentation; data forms | family/version grouping, immutable deleted snapshots, answer labels, signed files, audited approve/reject | forms | Automated; device pending |
| CRM `/crm` | `CrmScreen`, `ClientEditorScreen`, `ClientDetailScreen`, `CrmFollowupsScreen`, `CrmMergeScreen`, `WalkinScreen` | core CRM capabilities/workspace; data CRM | directory filters, create/edit/duplicate guard, visits, interactions, follow-ups/actions, reassign, merge, private documents, linked work | CRM/organization | Automated; camera/files/device pending |
| Notifications `/notifications` | `NotificationsScreen`, `NotificationAdmin` | core notifications; data notifications | inbox/read state, templates, rules, delivery logs, provider state, exact destinations | notifications/settings | Automated; device pending |
| Users `/users` | `UsersScreen`, `OrganizationTree` | core permissions/buddy rules; data users | search/status/branch/department, list/tree, add/edit/delete/password, reporting/buddies/week-off | organization/settings | Automated; device pending |
| Availability `/availability` | `AvailabilityScreen` | core availability; data availability | personal/authorized-other ranges, coverage chain | organization | Automated; device pending |
| Reports `/reports` | `ReportsScreen` | core reports; data reports | report definitions, filters, previews, private export requests/history/download | reports | Automated; device pending |
| Dropdown Master `/dropdown-master` | `DropdownMasterScreen` | core dropdown filters/counts; data dropdowns | category/search/status, create/edit, stable value, deactivate/reactivate | organization/settings | Automated; device pending |
| Settings `/settings` | `SettingsScreen`, `PermissionManagementScreen` | core settings/permissions; data settings | preferences, tenant/branch settings, section controls, permission layers, authority, purge | settings/organization | Automated; device pending |
| Daily checklist gate | `DailyChecklistGate`, `DailyChecklistManager` | core daily checklist; data settings/tasks | blocking completion, management, Android back held | tasks/settings | Automated; device pending |
| Assigning Left `/tasks/assigning-left` | `AssigningLeftScreen` | data import/tasks | unresolved imported assignment remediation | tasks/organization | Automated; device pending |

## Responsive and accessibility contract

### 2026-09-24 full source audit

A section-by-section comparison of every web page against its native screen (visible strings, actions, gating, and data calls) found gaps the earlier matrix rows had marked complete. Closed in this pass:

- **Home** now follows `HomeView`: hero, "Action required", My Tasks / FMS Tasks / CRM Tasks groups with web labels (all open tasks, not five), Priority Tasks Today, CRM Follow-ups Due, Recent Activity, and inbox/tenant realtime refresh.
- **Tasks**: open counts on My Tasks / Delegated, web status labels, Bulk Import limited to managers (Assigning Left to admins), web empty state, the `canMutate` guard, and PDF evidence up to 10 MB (`taskEvidenceFileError`).
- **Task detail** loads both task feeds through `features/tasks/taskWorkspace.ts`, so delegated and coverage-blocked tasks open instead of reporting "Task not available". It shows the web detail grid (labels now in core `taskDetails.ts`, consumed by web), uploaded evidence, required-remark enforcement, evidence upload, FMS actions, and the delegation revise form.
- **Core fix**: `deriveTaskCardState` now applies web's rule that a checklist never owes evidence; native previously asked checklist tasks with a legacy upload flag for an upload.
- **FMS step**: Request revision, Move backward, Escalate, Reassign, reject confirmation, assignee line, and required/optional linked-form states. **FMS instance**: Hold / Resume / Cancel, lineage, immutable timeline. **FMS list**: opens on active work, with priority filter, Overdue only, and status tiles.
- **CRM** is the web three-section workspace (walk-in form, not-bought follow-up, client database). The walk-in form is a full port: phone lookup first, branch, visit time, source, client type, product bought, buy status, not-bought reason, follow-up date, potential, companions, CRM/salesperson, product categories, requirement, remark, private attachment. The previous native form sent dropdown values where the RPC casts UUIDs. Directory has server pagination and follow-up badges; client detail, follow-ups and merge use web wording, counts and warnings.
- **Availability** department overview; **header** unread badge (`unreadBadge` moved to core); **Forms** family grouping, grouped submissions, draft archive, in-place edit of published versions; **Dashboard** realtime refresh; composer voice gaps recomputed with `voiceDraftGaps`.

Evidence: turbo typecheck 5/5, mobile typecheck, core 711, data 83, web 358, mobile 94 tests passed. Device walkthrough still pending.

### 2026-09-23 focused refresh

- The recent web task changes in `cbc01cd` use shared task-feed visibility and include native task remarks in the same commit. The former-employee filter in `1be4bb7` also changed web and native together. These are source parity findings; authenticated behavior remains unverified.
- Native voice used the wrong permission key (`tasks.manage_team`) and passed a recorded `ArrayBuffer` into a Blob multipart part. The web surface and Edge Function use `tasks.voice_assign`; React Native requires a local URI multipart part. Native now follows those contracts. The exact exception behind the reported manual-screen crash was unavailable without a device log; the voice card is isolated so a recorder render failure does not blank manual assignment.
- The FMS phone builder previously reserved 360 points for the canvas and let the horizontal toolbar grow vertically. The compact layout reserves 160–240 points for the canvas, bounds the toolbar, and keeps configuration in its own scroll area. A physical narrow-screen gesture and keyboard pass is still required.
- This refresh is focused on the reported failures and current recent web commits. It does not constitute a fresh authenticated route-by-route parity certification for every role.

- All long directories use virtualized list primitives; editors and bounded actions use scrollable screens or sheets with keyboard avoidance.
- Action rows wrap at phone width; horizontal segment controls scroll instead of shrinking touch targets.
- Fields retain visible labels, required state, error text, and native accessibility roles/states. Buttons and rows use the shared minimum touch target.
- Safe-area insets, light/dark semantic tokens, Android back handling, dirty-form guards, pull-to-refresh, and non-blank loading/error/empty states are shared app conventions.
- Remaining proof gate: portrait/landscape, compact height, keyboard, large font, light/dark, camera/microphone/files, and role-by-role authenticated walkthrough on the designated Android device.
