# JewelOS Native Parity Matrix

Reference date: 2026-09-21. The web application is the behavioral reference. “Automated” means source, focused tests, strict TypeScript, and build/export gates passed; it does not substitute for an authenticated employee-device walkthrough.

| Web surface | Native surface | Shared authority | Reads, writes, filters, and nested paths | Realtime | Evidence |
| --- | --- | --- | --- | --- | --- |
| Home `/` | `HomeScreen` | core home/FMS destination contracts; data home | assigned tasks, FMS starter/stage links, alerts, exact IDs | tasks, forms, FMS, notifications | Automated; device pending |
| Dashboard `/dashboard` | `DashboardScreen` | core analytics; data analytics | ranges, metrics, comparison, authority scope | task/organization topics | Automated; device pending |
| Tasks `/tasks` | `TasksScreen`, `TaskDetailScreen` | core task feed/card/capabilities; data tasks | feed/status, checklist, completion/revision, evidence, form links | tasks/forms/organization | Automated; device pending |
| Create task | `TaskComposerScreen`, `VoiceTaskCapture` | core manual/voice drafts; data tasks/voice | task/checklist, one doer, watchers, deadline, priority, form, attachment, voice review | refresh on return | Automated; microphone/device pending |
| Bulk import `/tasks/import` | `TaskImportScreen` | core `taskImport`; data import API/chunk runner | CSV/XLSX, identity mapping, validation, correction report, chunk resume, history, Assigning Left | tasks/organization | Automated; document-picker device pending |
| Recurring `/recurring-todo` | `RecurringTodoScreen` | core recurrence; data recurring | schedules, work, verification, follow-up, coverage | tasks/organization | Automated; device pending |
| Task Control `/task-templates` | `TaskControlScreen` | core task control; data tasks | filters, four tabs, status views, evidence URLs, template actions, pagination | tasks/organization | Automated; device pending |
| FMS `/fms`, assigned work | `FmsScreen`, `FmsBuilderScreen`, `FmsInstanceScreen`, `FmsStageScreen`, `FmsStageFormScreen` | core FMS paths/decisions; data FMS | draft/publish/revise/delete, graph/stages/assignees/conditions/forms, live runs and audited progression | FMS/forms/tasks/organization | Automated; gesture/device pending |
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

- All long directories use virtualized list primitives; editors and bounded actions use scrollable screens or sheets with keyboard avoidance.
- Action rows wrap at phone width; horizontal segment controls scroll instead of shrinking touch targets.
- Fields retain visible labels, required state, error text, and native accessibility roles/states. Buttons and rows use the shared minimum touch target.
- Safe-area insets, light/dark semantic tokens, Android back handling, dirty-form guards, pull-to-refresh, and non-blank loading/error/empty states are shared app conventions.
- Remaining proof gate: portrait/landscape, compact height, keyboard, large font, light/dark, camera/microphone/files, and role-by-role authenticated walkthrough on the designated Android device.
