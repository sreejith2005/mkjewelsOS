# JewelOS Technical Handoff and Forward Roadmap

Last updated: 2026-08-08 (Asia/Kolkata)

This document is the durable handoff for continuing the production JewelOS implementation. It records what has been built, what has been deployed, what remains incomplete, and how the two older codebases must be used as behavioral references without copying their mock architecture.

## 1. Repository authority and operating rules

The parent folder is:

`C:\Users\MIS\Downloads\MKJewelOS`

It contains three related codebases:

1. `jewelos/` is the only writable production implementation.
2. `mkjewelos-base44/` is a read-only Base44 prototype and the richer behavioral reference.
3. `mkjewelsos/jewelos/jewelos/` is a read-only, simpler in-memory prototype and a secondary reference.

Always read `jewelos/AGENTS.md` completely before working. Never edit, import from, copy files from, or add dependencies on either reference application.

The reference applications are not production implementations. They contain mock clients, static data, demo-only buttons, incomplete integrations, and flows that may appear functional while performing no durable write. Their value is in:

- page and component inventory;
- business terminology;
- intended field sets;
- roles and menu visibility;
- user flows and interaction ideas;
- entity relationships;
- edge cases expressed in UI logic.

Their implementation patterns are not authoritative. In particular, do not reproduce:

- `globalThis.__B44_DB__` or other in-memory fallbacks;
- `src/lib/store.jsx` as an application database;
- hardcoded `src/data/*.js` records;
- Base44 `db.entities.*` calls;
- buttons that update local state without a real transaction;
- unverified `bulkCreate` assumptions;
- unconditional mock API clients;
- frontend-only role enforcement;
- provider integrations that are only stubs.

For each feature, the correct workflow is:

1. Search both reference codebases for the relevant page, components, engines, data files, and role/menu configuration.
2. Read each relevant file in full before designing the feature.
3. Write a behavioral comparison: useful Base44 behavior, useful older-prototype behavior, conflicts, demo-only behavior, and missing production requirements.
4. Design the real Postgres schema/RPC/RLS/audit contract in `jewelos`.
5. Put shared pure business logic in `packages/core`.
6. Put Supabase access in the API layer, not directly throughout components.
7. Build the real web/mobile UI using the shared contract.
8. Validate database authorization, transactions, tests, builds, and rendered behavior.

The implementation agent should perform this inspection directly. Do not hand the user a generic "audit prompt" asking them to inventory code that is already available locally. Ask the user only when a genuine product decision, credential interaction, unavailable visual asset, or external-system authorization is required.

The original task-list UI screenshots are not stored in this repository. `AGENTS.md` records their important layout characteristics. If pixel-level visual matching is required later, request the relevant screenshots again at original resolution; do not invent unseen details or block non-visual backend work unnecessarily.

## 2. Current Git and production baseline

Repository: `C:\Users\MIS\Downloads\MKJewelOS\jewelos`

Branch: `main`

Current published HEAD and `origin/main`:

`a3b5fe6f6633794b333c0417959ed0c8700431df`

Published commit history:

1. `d496fc9` - Initial JewelOS implementation
2. `a93f381` - Implement Phase 2 task management
3. `82b39ef` - Harden Phase 2 task runtime contracts
4. `5e4451d` - Restrict public function execution
5. `a3b5fe6` - Align recurring task scheduler authentication

Before this handoff document was created, the worktree was clean and local/remote hashes matched. This document itself is intentionally not committed or pushed unless separately authorized.

Latest confirmed Supabase state:

- migrations `0001` through `0007` are applied remotely;
- no migration was pending after `0007`;
- linked database lint was clean;
- `generate-recurring-tasks` was `ACTIVE`, version 6, `verify_jwt=false`;
- `invite-user` was `ACTIVE`, version 3, `verify_jwt=true`;
- the recurring cron job was active at `35 18 * * *` UTC, which is 00:05 IST;
- the cron job used one Vault-backed `x-cron-secret` header;
- it contained zero `Authorization` or `Bearer` occurrences after migration `0007`;
- the named Vault reference was `recurring_tasks_cron_secret`;
- the actual secret value was never committed, retrieved, or printed.

Latest privacy-safe production task baseline after migration `0007`:

- task templates: 2;
- task instances: 3;
- task assignees: 3;
- task checklist rows: 5;
- task comments: 0;
- task attachments: 0;
- task revisions: 0;
- task watchers: 0;
- task audit rows: 5;
- duplicate active assignment groups: 0.

The first naturally timed cron execution after the version-6/header alignment was intentionally not observed because the user chose to continue building instead of waiting until midnight. A safe invalid-date authentication proof passed:

- correct Vault-backed `x-cron-secret` plus invalid date: HTTP 400;
- missing secret: HTTP 401;
- incorrect synthetic secret: HTTP 401;
- no timeout or transport error;
- no valid recurrence date was manually invoked.

The later optional idempotent full-path proof was not run because the Supabase database-query CLI lost its platform access token. The user elected to leave that optional proof and move forward. If live database queries are needed later, use interactive `supabase.cmd login`; never paste a personal access token into chat or put it in a visible command argument.

## 3. Monorepo architecture already established

### 3.1 Workspace layout

- `apps/web`: React 18 + Vite web application.
- `apps/mobile`: Expo/React Native shell.
- `packages/core`: shared pure TypeScript business logic and generated database types.
- `packages/api-client`: typed Supabase browser client.
- `packages/ui-tokens`: shared visual tokens for web and mobile.
- `supabase/migrations`: forward-only Postgres schema, RLS, RPC, privilege, and cron migrations.
- `supabase/functions`: Edge Functions.
- `supabase/tests`: pgTAP database contract suites.

### 3.2 Non-negotiable architectural rules

- Real Supabase data only; no mock runtime database.
- RLS/RPC authorization is the security boundary. Hidden buttons are UX only.
- Sensitive writes must create `audit_logs` rows transactionally.
- Tenant/branch/department scope must be enforced inside Postgres where applicable.
- Applied migrations are immutable; corrections use new forward-only migrations.
- Shared calculations and state machines belong in `packages/core`.
- TypeScript stays strict. Do not use implicit `any` or unexplained suppression.
- UI colors come from `packages/ui-tokens`; primary gold is `#D9B875`; no blue.
- Secrets stay in Supabase secrets/Vault or local ignored environment files.
- Use explicit Git staging; do not use `git add -A` for reviewed production releases.

### 3.3 Dependency/runtime details

- Package manager: pnpm 11.
- Node requirement: Node 20.19 or newer.
- Use Windows command shims such as `pnpm.cmd` and `supabase.cmd` because PowerShell execution policy can block `.ps1` shims.
- Web and mobile intentionally use different React dependency graphs; preserve workspace isolation.
- Typecheck/build may need `--concurrency=1` on this machine to avoid Node heap exhaustion in `@jewelos/api-client`.

## 4. Database foundation

The schema currently defines 39 tables.

### 4.1 Organization, people, administration, and audit

- `tenants`
- `branches`
- `departments`
- `user_profiles`
- `dropdown_masters`
- `resignations`
- `user_availability`
- `buddy_assignments`
- `audit_logs`

### 4.2 Forms foundation

- `form_templates`
- `form_fields`
- `form_links`
- `form_submissions`

### 4.3 Task foundation

- `task_templates`
- `task_instances`
- `task_assignees`
- `task_checklists`
- `task_comments`
- `task_attachments`
- `task_revisions`
- `task_watchers`

### 4.4 FMS foundation

- `fms_flows`
- `fms_stages`
- `fms_stage_assignees`
- `fms_branch_rules`
- `fms_instances`
- `fms_instance_stages`
- `fms_stage_logs`

### 4.5 CRM foundation

- `clients`
- `walkin_entries`
- `walkin_uploads`
- `client_timeline`
- `client_followups`

### 4.6 Notifications foundation

- `notification_templates`
- `notification_rules`
- `notifications`
- `notification_logs`

### 4.7 Analytics and export foundation

- `performance_snapshots`
- `export_logs`

These tables are a schema foundation, not proof that the corresponding product module is implemented. Forms, FMS, CRM, notification rules/providers, analytics, and export workflows still need production RPCs, policies, application APIs, UI, tests, and runtime validation.

## 5. Migration history and responsibility

### `supabase/migrations/0001_init_schema.sql`

Initial broad schema, enums, indexes, helper functions, initial RLS, storage foundations, and views. It established the multi-tenant organization and skeleton tables for the future modules.

### `supabase/migrations/0002_phase1_auth_users_dropdowns.sql`

Phase 1 administration contract:

- hardened current-profile/role/tenant/branch helpers;
- RLS for organization, resignation, and audit surfaces;
- audited profile updates;
- resignation submission and review;
- audited dropdown-master mutation;
- server-side profile creation used by the invitation Edge Function;
- role, branch, department, and tenant validation.

### `supabase/migrations/0003_enforce_active_session.sql`

Added `current_profile_is_active()` and tightened authenticated policies so a valid Supabase session is insufficient when the corresponding employee profile is disabled or absent.

### `supabase/migrations/0004_phase2_tasks.sql`

Introduced the first real task runtime:

- task RLS and helper functions;
- task templates;
- checklist and delegation task creation;
- task updates/completion;
- delegation and date revision;
- audited attachment registration;
- availability recording;
- recurrence instance creation;
- task attachment Storage authorization.

### `supabase/migrations/0005_phase2_task_hardening.sql`

Large Phase 2 production-hardening migration. Major behavior includes:

- tenant-safe task categories through nullable legacy-compatible `category_id` foreign keys;
- `task_watchers` with RLS, indexes, uniqueness, creator, and timestamps;
- inactive assignment history with only one active assignment per task/user;
- multiple doers and watcher/doer overlap rejection;
- full payload-key, category, branch, department, user, form, checklist, priority, date/time, and RRULE validation inside Postgres;
- manager branch scoping;
- watcher read-only visibility;
- elevated manager/admin access independent of watcher status;
- shared completion across active doers;
- required checklist/upload/form/remark completion conditions;
- exact linked-form task/module/template checks;
- audited before/after assignment state for delegation;
- attachment cleanup constrained to unrecorded objects;
- recurrence availability, week-off, absent, remote, half-day, buddy, blocked-coverage, escalation notification, and audit behavior;
- Kolkata date handling;
- idempotent recurring task creation;
- hardened `v_all_tasks` and supporting indexes;
- direct table writes withheld from authenticated clients;
- service-role direct reads limited to the three recurrence input tables;
- transactionally audited sensitive RPCs.

### `supabase/migrations/0006_restrict_function_execution.sql`

Forward-only privilege repair after the live migration-0005 postflight found Supabase role grants broader than intended.

Final confirmed public-schema function matrix:

- 31 postgres-owned public functions;
- 28 `SECURITY DEFINER` functions;
- `anon` executable: 0;
- `authenticated` executable: 25;
- `service_role` executable: 2;
- `PUBLIC` executable: 0;
- `postgres` executable: 31.

Service role retains only:

- `invite_profile_with_audit(...)`;
- `create_recurring_task_instance(...)`.

Owner-only helpers include:

- `rls_auto_enable()`;
- `normalize_task_checklist(jsonb)`;
- `is_supported_task_rrule(text)`;
- `is_user_available_for_task(uuid,date)`.

The migration also changed default privileges for future postgres-owned functions so they do not automatically grant execution to `PUBLIC`, `anon`, `authenticated`, or `service_role`.

### `supabase/migrations/0007_align_recurring_task_cron_auth.sql`

Forward-only alignment between the checked-in worker and an older deployed scheduler contract:

- targets only `generate-recurring-tasks-daily`;
- safely no-ops when pg_cron or the named job is absent;
- requires exactly one named job and one named Vault secret when conversion is needed;
- recognizes the exact legacy `Authorization: Bearer` command shape;
- replaces only that fragment with `x-cron-secret` using the same runtime Vault lookup;
- preserves URL, schedule, request body, timeout, database, username, and active state;
- rejects duplicate/mixed/unexpected command shapes;
- uses `cron.alter_job(...)` rather than directly updating `cron.job`;
- remains idempotent if already aligned;
- never decrypts or materializes the secret in source or migration output.

## 6. Database tests and validation achieved

### pgTAP suites

- `supabase/tests/0005_phase2_task_hardening.test.sql`: 122 assertions.
- `supabase/tests/0006_restrict_function_execution.test.sql`: 58 assertions.
- `supabase/tests/0007_align_recurring_task_cron_auth.test.sql`: 22 assertions.
- Total: 202 pgTAP assertions.

The tests cover tenant/branch/role boundaries, watchers, doers, checklist validation, delegation, completion requirements, Storage rules, recurrence/coverage, function privileges/default privileges, cron conversion, Vault-name preservation, idempotency, and fail-closed cases.

### Core TypeScript tests

There are 26 core tests across:

- `packages/core/src/recurrence.test.ts`;
- `packages/core/src/sla.test.ts`;
- `packages/core/src/taskCapabilities.test.ts`;
- `packages/core/src/taskChecklist.test.ts`;
- `packages/core/src/taskFeed.test.ts`;
- `packages/core/src/taskParticipants.test.ts`.

### Standard validation commands

Use:

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
supabase.cmd db lint --local --level warning
git diff --check
```

For database work, also rebuild locally and run every relevant pgTAP suite. A local `supabase db reset` has occasionally returned a nonzero wrapper exit because the local Storage container failed its readiness check even though Postgres applied all migrations and remained reachable. Treat that as non-blocking only after confirming migration history, database reachability, pgTAP, and lint independently.

## 7. Phase 1 application behavior implemented

### Authentication and session handling

Primary files:

- `apps/web/src/auth/AuthContext.tsx`
- `apps/web/src/App.tsx`
- `packages/api-client/src/supabase.ts`
- `supabase/migrations/0003_enforce_active_session.sql`

Implemented behavior:

- Supabase email/password login;
- user-profile loading after authentication;
- active-account enforcement at database and UI boundaries;
- branch/profile context;
- real Supabase error messages visible on the login form;
- logout and incomplete-account state;
- role-controlled navigation.

### User management and resignation

Primary files:

- `apps/web/src/pages/UserManagementPage.tsx`
- `supabase/functions/invite-user/index.ts`
- `supabase/migrations/0002_phase1_auth_users_dropdowns.sql`

Implemented behavior:

- list/search users;
- invite employee accounts through a server-side Edge Function;
- assign tenant/branch/department/role scope;
- update profiles through audited RPCs;
- activate/deactivate profiles;
- submit resignation details;
- approve/reject resignations;
- enforce which roles may make each change;
- create confirmed Auth users server-side without exposing service-role credentials to the browser.

### Dropdown master

Primary file:

- `apps/web/src/pages/DropdownMasterPage.tsx`

Implemented behavior:

- real reads from `dropdown_masters`;
- category grouping;
- audited add/edit/deactivate operations through `change_dropdown_with_audit`;
- super-admin access according to the current role menu.

## 8. Phase 2 task system implemented

### Web shell and responsive task navigation

Primary files:

- `apps/web/src/components/shell/ApplicationShell.tsx`
- `apps/web/src/components/shell/MobileBottomNav.tsx`
- `apps/web/src/components/shell/AppLauncher.tsx`
- `apps/web/src/components/shell/MoreSheet.tsx`
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/web/src/App.tsx`

Implemented behavior:

- responsive application shell;
- desktop sidebar and mobile bottom navigation;
- Dashboard, My Tasks, My Apps, Delegated, and More interaction model;
- route/role filtering through shared core configuration;
- dashboard launcher cards for available implemented workspaces.

The current dashboard is an application launcher, not a finished operational analytics dashboard.

### Task feed and task interactions

Primary files:

- `apps/web/src/pages/TasksPage.tsx`
- `apps/web/src/features/tasks/api.ts`
- `apps/web/src/features/tasks/TaskCard.tsx`
- `apps/web/src/features/tasks/TaskFilterBar.tsx`
- `apps/web/src/features/tasks/DelegateTaskModal.tsx`

Implemented behavior:

- My Tasks and Delegated views;
- current, watched, and delegated task loading from `v_all_tasks`/`task_watchers`;
- search, date, status, and feed grouping/filter logic;
- assigned/watcher/elevated-access labels;
- watcher read-only behavior;
- start task;
- update checklist items;
- complete tasks with server-side requirements;
- enter required completion remarks;
- upload task evidence to private Storage and register it transactionally;
- delegate a specific active doer while preserving other doers and history;
- revise delegation datetime with reason;
- show checklist progress using completed items divided by all items;
- retain required-only completion eligibility;
- prevent watcher status from granting mutation permission;
- support elevated manager/admin actions independently of watcher status.

### Task creation and templates

Primary files:

- `apps/web/src/features/tasks/TaskComposer.tsx`
- `apps/web/src/features/tasks/TaskForms.tsx`
- `apps/web/src/features/tasks/UserPicker.tsx`
- `apps/web/src/features/tasks/ChipSelector.tsx`
- `apps/web/src/features/tasks/api.ts`

Implemented behavior:

- screenshot-inspired bottom-sheet task composer;
- title and description;
- checklist/delegation modes;
- branch and department scope;
- manager branch restrictions;
- manager department default with valid same-branch selection;
- admin/super-admin branch and department selection;
- doers filtered by branch and department;
- watcher selection with branch/tenant rules;
- doer/watcher conflict pruning;
- priority, category, planned datetime, upload/form/remark requirements;
- checklist items with required/optional semantics;
- save task templates;
- create task instances from templates;
- empty-state messaging where selected scope has no eligible doers.

### Availability, recurrence, and coverage

Primary files:

- `apps/web/src/pages/AvailabilityPage.tsx`
- `packages/core/src/recurrence.ts`
- `supabase/functions/generate-recurring-tasks/index.ts`
- `supabase/config.toml`
- `supabase/migrations/0005_phase2_task_hardening.sql`
- `supabase/migrations/0007_align_recurring_task_cron_auth.sql`

Implemented behavior:

- present/absent/remote/half-day availability;
- self or authorized-manager availability entry;
- audited writes;
- active-profile and week-off handling;
- explicit absence handling;
- missing availability treated as unavailable by the Phase 2 recurrence hardening contract;
- remote and half-day treated as available;
- buddy coverage;
- blocked task plus escalation notifications/audits when coverage cannot be resolved;
- Asia/Kolkata target dates;
- supported RRULE evaluation;
- idempotent recurring instance creation;
- service-role-only recurrence RPC;
- custom scheduler secret checked before request body parsing or database access;
- daily Vault-backed pg_cron/pg_net invocation.

## 9. Shared core logic already implemented

Primary files:

- `packages/core/src/roleMenu.ts`
- `packages/core/src/sla.ts`
- `packages/core/src/recurrence.ts`
- `packages/core/src/taskFeed.ts`
- `packages/core/src/taskParticipants.ts`
- `packages/core/src/taskChecklist.ts`
- `packages/core/src/taskCapabilities.ts`
- `packages/core/src/database.types.ts`
- `packages/core/src/index.ts`

Capabilities include:

- role and page access mapping;
- SLA/delay calculation;
- Kolkata recurrence evaluation;
- availability and buddy-assignment resolution;
- task-feed grouping and status counts;
- participant deduplication and watcher/doer conflict removal;
- visible checklist progress calculation;
- task mutation capability derivation for doers, watchers, managers, admins, and super admins;
- generated Supabase database types.

Continue this pattern: Forms validation/conditions, FMS state transitions, notification-event matching, reporting calculations, and reusable mobile/web logic should be pure shared modules under `packages/core`, not duplicated inside React components.

## 10. Current web route status

`packages/core/src/roleMenu.ts` defines 15 logical page IDs:

- home
- dashboard
- crm
- checklist_tasks
- delegation_tasks
- fms_tasks
- fms_builder
- forms_library
- meeting_ai
- notifications
- users
- availability
- reports
- dropdown_master
- settings

`apps/web/src/App.tsx` currently exposes only six implemented destinations:

- dashboard;
- checklist tasks;
- delegation tasks;
- users;
- availability;
- dropdown master.

The following remain unavailable or redirect to the dashboard because no real page has been implemented:

- CRM;
- FMS tasks;
- FMS builder;
- Forms Library;
- Meeting AI;
- Notifications;
- Reports;
- Settings;
- a distinct Home experience.

## 11. Known gaps and blockers

### 11.1 Fourteen tables still lack RLS

Static migration inspection and Supabase diagnostics identified:

- `client_followups`
- `client_timeline`
- `export_logs`
- `fms_branch_rules`
- `fms_stage_assignees`
- `fms_stage_logs`
- `form_fields`
- `form_links`
- `notification_logs`
- `notification_rules`
- `notification_templates`
- `performance_snapshots`
- `walkin_entries`
- `walkin_uploads`

Do not apply blanket `ENABLE ROW LEVEL SECURITY` without policies. First determine intended readers/writers, existing grants, dependency paths, and required service access. Then create a forward-only migration (recommended next migration: `0008`) with table-specific policies, privileges, indexes, and pgTAP tests.

### 11.2 Task module completion gaps

- dedicated blocked-coverage resolution workflow;
- full activity/history timeline;
- comments UI and an audited comment mutation contract;
- attachment preview/download/removal lifecycle;
- richer watcher/history presentation;
- actual linked-form completion UI;
- friendly handling of all already-active delegation destinations;
- internal notification center;
- external notification providers;
- authenticated browser E2E across roles;
- production web deployment and smoke testing.

### 11.3 Web runtime and QA

- The source and database/Edge components are published/deployed, but the web application itself has not been deployed during this work.
- Browser-rendered QA was previously blocked by the in-app Browser error `Cannot redefine property: process` and by unavailable safe authenticated browser fixtures.
- Typecheck/build success must not be described as rendered UX validation.
- The web build has had a non-failing Vite warning for a roughly 512 kB main JavaScript chunk.
- There are no web component or end-to-end test suites yet.

### 11.4 Notifications are internal-only

Recurrence can create `notifications` rows, but no complete delivery engine exists. Email/WhatsApp/SMS/push providers, retry behavior, templates/rules UI, and delivery logs remain unimplemented.

### 11.5 Mobile is effectively unimplemented

`apps/mobile/App.tsx` renders only an empty themed `View`. It has no auth, navigation, screens, API access, offline behavior, notifications, uploads, or tests beyond TypeScript compilation.

### 11.6 Operational observability

- The installed Supabase CLI did not expose an Edge-log retrieval command.
- pg_cron and pg_net status can be inspected through Postgres when CLI authentication is available.
- There is no Sentry/error-monitoring integration, alerting, CI/CD deployment workflow, or operations dashboard yet.

### 11.7 Temporary local audit artifact

A prior deployed-function comparison created:

`C:\Users\MIS\AppData\Local\Temp\jewelos-edge-audit-dc9777c6d13f47c8ade06be2c4985aec`

It is outside the repository and contains downloaded source only, not secrets. Cleanup was blocked by the execution environment's destructive-command policy. It does not affect Git or the application.

## 12. How to use the reference applications for remaining modules

The Base44 application is the deeper behavioral source, but the older prototype should always be read as a second opinion. Neither should be copied blindly.

### 12.1 Forms

Read in Base44:

- `mkjewelos-base44/src/pages/Forms.jsx`
- `mkjewelos-base44/src/components/forms/FieldEditor.jsx`
- `mkjewelos-base44/src/components/forms/FormBuilder.jsx`
- `mkjewelos-base44/src/components/forms/FormBuilderCanvas.jsx`
- `mkjewelos-base44/src/components/forms/formEngine.jsx`
- `mkjewelos-base44/src/components/forms/FormFieldRenderer.jsx`
- `mkjewelos-base44/src/components/forms/FormRenderer.jsx`
- `mkjewelos-base44/src/components/forms/SubmissionViewer.jsx`

Read in the older prototype:

- `mkjewelsos/jewelos/jewelos/src/pages/Forms.jsx`
- `mkjewelsos/jewelos/jewelos/src/components/FormRenderer.jsx`
- `mkjewelsos/jewelos/jewelos/src/data/forms.js`
- `mkjewelsos/jewelos/jewelos/src/lib/store.jsx`

Extract field types, builder interactions, conditions, validation, preview, submission viewing, task links, and role behavior. Replace mock CRUD with versioned/audited RPCs and RLS.

### 12.2 FMS and workflows

Read in Base44:

- `mkjewelos-base44/src/pages/FMSBuilder.jsx`
- `mkjewelos-base44/src/pages/Workflows.jsx`
- `mkjewelos-base44/src/components/fms/FlowBuilder.jsx`
- `mkjewelos-base44/src/components/fms/FlowInstanceRunner.jsx`
- `mkjewelos-base44/src/components/fms/FMSInstanceDetail.jsx`
- `mkjewelos-base44/src/components/fms/FMSInstanceList.jsx`
- `mkjewelos-base44/src/components/fms/StepEditor.jsx`
- `mkjewelos-base44/src/components/workflow/WorkflowCard.jsx`
- `mkjewelos-base44/src/components/workflow/WorkflowInstanceCard.jsx`

Read in the older prototype:

- `mkjewelsos/jewelos/jewelos/src/pages/FMSBuilder.jsx`
- `mkjewelsos/jewelos/jewelos/src/data/fms.js`
- `mkjewelsos/jewelos/jewelos/src/lib/store.jsx`

Extract stage modeling, assignee selection, forms/evidence, branch rules, SLA, instance lists, transitions, history, and builder UX. Implement the authoritative transition state machine in `packages/core` and transactional RPCs in Postgres.

### 12.3 Notifications

Read in Base44:

- `mkjewelos-base44/src/pages/Notifications.jsx`
- `mkjewelos-base44/src/components/notifications/notificationEngine.jsx`
- `mkjewelos-base44/src/components/notifications/NotificationItem.jsx`
- `mkjewelos-base44/src/components/notifications/NotificationLogList.jsx`
- `mkjewelos-base44/src/components/notifications/RuleBuilder.jsx`
- `mkjewelos-base44/src/components/notifications/TemplateEditor.jsx`
- `mkjewelos-base44/src/components/navigation/NotificationBell.jsx`

Read in the older prototype:

- `mkjewelsos/jewelos/jewelos/src/pages/Notifications.jsx`
- any notification data/logic inside `src/lib/store.jsx` and `src/data/*`.

Extract event/rule/template behavior and notification-center UX. Do not copy `db.integrations.Core.SendEmail`; it is the only Base44 integration and does not establish a production delivery architecture. Build an outbox/retry/provider design with safe secrets and audited logs.

### 12.4 CRM

Read in Base44:

- `mkjewelos-base44/src/pages/CRM.jsx`
- `mkjewelos-base44/src/components/crm/CustomerCard.jsx`
- `mkjewelos-base44/src/components/crm/CustomerForm.jsx`
- CRM-related behavior in `src/components/dashboard/CRMDashboard.jsx`

Read in the older prototype:

- `mkjewelsos/jewelos/jewelos/src/pages/CRM.jsx`
- `mkjewelsos/jewelos/jewelos/src/data/crm.js`
- `mkjewelsos/jewelos/jewelos/src/lib/store.jsx`

Extract customer fields, walk-ins, interactions, filters, follow-ups, assignments, and card/detail UX. Design real duplicate handling, search normalization, branch visibility, audit, uploads, timelines, and conversion rules instead of storing local demo objects.

### 12.5 Dashboards and reports

Read in Base44:

- `mkjewelos-base44/src/pages/Dashboard.jsx`
- `mkjewelos-base44/src/pages/Home.jsx`
- `mkjewelos-base44/src/components/dashboard/analyticsEngine.jsx`
- `mkjewelos-base44/src/components/dashboard/CRMDashboard.jsx`
- `mkjewelos-base44/src/components/dashboard/ManagerDashboard.jsx`
- `mkjewelos-base44/src/components/dashboard/MetricCard.jsx`
- `mkjewelos-base44/src/components/dashboard/PerformanceChart.jsx`
- `mkjewelos-base44/src/components/dashboard/SalespersonDashboard.jsx`
- `mkjewelos-base44/src/components/home/QuickActions.jsx`
- `mkjewelos-base44/src/components/home/RecentActivity.jsx`
- `mkjewelos-base44/src/components/home/SwipeCard.jsx`

Read in the older prototype:

- `mkjewelsos/jewelos/jewelos/src/pages/Dashboard.jsx`
- `mkjewelsos/jewelos/jewelos/src/pages/Home.jsx`
- `mkjewelsos/jewelos/jewelos/src/data/analytics.js`

Treat Base44's `DashboardCache`/`PerformanceMetric` ideas as concepts only. Derive metrics from real indexed queries or reviewed snapshots, enforce role scope, and audit exports.

### 12.6 Settings and navigation

Read in Base44:

- `mkjewelos-base44/src/pages/Settings.jsx`
- `mkjewelos-base44/src/Layout.jsx`
- `mkjewelos-base44/src/components/navigation/roleMenuConfig.jsx`
- `mkjewelos-base44/src/components/navigation/BottomNav.jsx`
- `mkjewelos-base44/src/components/navigation/BranchSwitcher.jsx`
- `mkjewelos-base44/src/components/navigation/HamburgerMenu.jsx`
- `mkjewelos-base44/src/components/navigation/Sidebar.jsx`
- `mkjewelos-base44/src/components/navigation/TopBar.jsx`

Read in the older prototype:

- `mkjewelsos/jewelos/jewelos/src/pages/Settings.jsx`
- `mkjewelsos/jewelos/jewelos/src/components/Shell.jsx`
- `mkjewelsos/jewelos/jewelos/src/lib/roleConfig.jsx`

Reconcile settings scope with actual tenant/branch/role policy. Preserve the current production shell where it is stronger; do not regress to mock branch switching or frontend-only permissions.

### 12.7 Existing tasks when extending them

Read in Base44:

- `mkjewelos-base44/src/pages/MyTasks.jsx`
- `mkjewelos-base44/src/pages/Tasks.jsx`
- every file in `mkjewelos-base44/src/components/tasks/`

Read in the older prototype:

- `mkjewelsos/jewelos/jewelos/src/pages/MyTasks.jsx`
- `mkjewelsos/jewelos/jewelos/src/components/DelegateSheet.jsx`
- `mkjewelsos/jewelos/jewelos/src/components/TaskInstanceCard.jsx`
- `mkjewelsos/jewelos/jewelos/src/data/tasks.js`

The current `jewelos` implementation already has a stronger database/security contract than both references. Use the references only to identify missing UX and feature behavior; do not replace the audited RPC/RLS design.

## 13. Ordered forward roadmap

### Phase 3A: RLS and privilege closure

Goal: eliminate the known security-policy gap before exposing Forms, FMS, CRM, notification administration, analytics, or exports.

Deliverables:

- inspect grants, foreign keys, indexes, and expected readers/writers for all 14 tables;
- define tenant/branch/role access matrices;
- create forward-only migration `0008_*`;
- add RLS and minimum table privileges;
- add audited mutation RPCs where direct writes should be forbidden;
- add required policy indexes;
- add pgTAP tests for ordinary user, manager, admin, super-admin, service role, anon, and cross-tenant access;
- ensure existing Phase 1/2 behavior remains intact;
- publish/apply only after a separate review gate.

### Phase 3B: Existing web release and task completion

Goal: make the currently built administration/task application genuinely usable in production before expanding breadth.

Deliverables:

- deploy the web app;
- authenticate with safe test users for each role;
- browser-test desktop/mobile layouts;
- verify login, deactivation, users, resignations, dropdowns, availability, task creation, watchers, delegation, checklist, uploads, completion, revisions, and templates;
- implement blocked-coverage resolution;
- implement task comments and history timeline;
- implement attachment preview/download/removal rules;
- close remaining watched-task/history UX gaps;
- add component/integration/E2E tests;
- reduce or intentionally split the large web bundle.

### Phase 4: Forms engine

Goal: production form authoring, publishing, rendering, submission, viewing, and task/FMS linkage.

Recommended implementation areas:

- `packages/core/src/forms/*`: schemas, field types, validation, conditions, visibility, answer normalization, version rules;
- `apps/web/src/features/forms/*`: builder, canvas, field editor, preview, renderer, submissions;
- `apps/web/src/pages/FormsPage.tsx`;
- `apps/web/src/features/forms/api.ts`;
- forward migration(s) for form versioning, publishing, audited mutations, RLS, required indexes, and submission validation;
- generated `database.types.ts` refresh;
- pgTAP plus core/component tests.

Required product behavior:

- draft/published/archived templates;
- immutable or versioned published definitions;
- ordered field types and options;
- required fields and constraints;
- conditional visibility;
- branch/department/template scope;
- task/FMS links;
- audited submissions and revisions;
- read-only historical rendering using the original version;
- mobile-compatible renderer.

### Phase 5: FMS builder and runtime

Goal: real flow authoring and a transactional stage state machine.

Recommended implementation areas:

- `packages/core/src/fms/*`: flow validation, transition rules, SLA/delay, assignment resolution;
- `apps/web/src/features/fms/*`: builder, stage editor, flow list, instance list/detail, runner/history;
- `apps/web/src/pages/FMSBuilderPage.tsx` and `FMSTasksPage.tsx`;
- audited flow draft/publish/archive RPCs;
- transactional start/transition/reassign/complete RPCs;
- form/evidence/task linkage;
- branch rules and stage assignees;
- escalation/notification hooks;
- RLS and pgTAP for all roles and cross-tenant boundaries.

### Phase 6: Notifications engine

Goal: in-app notifications plus reliable provider delivery.

Recommended implementation areas:

- `packages/core/src/notifications/*`: event types, rule matching, template variables, channel selection;
- `apps/web/src/features/notifications/*`: notification center, bell, templates, rules, delivery logs;
- `apps/web/src/pages/NotificationsPage.tsx`;
- outbox/delivery schema and forward-only migration;
- audited template/rule mutation RPCs;
- Edge worker(s) for email/WhatsApp/SMS/push as approved;
- idempotency keys, retries, backoff, terminal failure, and privacy-safe logging;
- provider secrets stored only in the hosting secret manager;
- task/FMS/CRM event integration.

Do not claim WhatsApp/SMS support until a provider is selected, configured, and runtime-tested.

### Phase 7: CRM

Goal: production client, walk-in, interaction, timeline, follow-up, attachment, and assignment workflows.

Recommended implementation areas:

- `packages/core/src/crm/*`: normalization, duplicate rules, status transitions, follow-up calculations;
- `apps/web/src/features/crm/*`;
- `apps/web/src/pages/CRMPage.tsx`;
- real client/walk-in/timeline/follow-up RPCs;
- branch-aware RLS;
- private upload lifecycle;
- full audit trails;
- search indexes and normalized phone/contact strategy;
- conversion/linking rules;
- reporting hooks;
- pgTAP and authenticated browser tests.

No customer data should be printed during development diagnostics. Use counts, IDs only when necessary, and masked/local fixtures.

### Phase 8: Dashboards, reports, exports, and settings

Goal: replace the launcher-only dashboard with role-specific operational intelligence and safe administration.

Deliverables:

- role-specific dashboard query contracts;
- branch/department/date filters;
- task/FMS/CRM/people KPIs;
- performance charts with accessible summaries;
- reviewed snapshot/cache strategy only if live indexed queries are insufficient;
- reports and export definitions;
- asynchronous export generation where needed;
- export authorization and audit logging;
- settings grouped by tenant/branch/role scope;
- no frontend-only configuration writes.

### Phase 9: Meeting AI decision and implementation

`meeting_ai` exists in route configuration but has no implementation and no established production contract in this work. Before building it:

- identify the required business outcome;
- inspect both references for any adjacent behavior;
- define recording/consent/privacy/retention requirements;
- select transcription/summarization providers;
- define task/FMS/CRM action extraction rules;
- design secure storage, access, deletion, and audit.

Do not build a generic AI demo merely because the route exists.

### Phase 10: Mobile application

Goal: a real Expo client using the same database and core contracts.

Recommended sequence:

1. Supabase auth and secure session storage.
2. Role-aware navigation using `packages/core/roleMenu`.
3. My Tasks and Delegated views.
4. Task detail, checklist, completion, comments, and camera/document upload.
5. Availability.
6. Notifications.
7. Forms renderer/submission.
8. FMS task runner.
9. CRM field workflows where mobile use is justified.
10. Offline/error/retry strategy and push notifications.

Keep web/mobile-specific rendering separate while sharing business logic, types, validation, and API contracts.

### Phase 11: Production hardening and rollout

- CI for typecheck, core tests, pgTAP, builds, secret scans, and migration checks;
- controlled web/Edge/database deployment workflows;
- environment separation;
- authenticated E2E suite;
- accessibility and responsive QA;
- application and Edge error monitoring;
- cron/outbox/provider alerting;
- performance profiling and bundle splitting;
- rate limiting and abuse controls;
- backup/restore drills;
- incident and rollback runbooks;
- privacy/data-retention review;
- production readiness checklist per module.

## 14. Realistic completion estimate

At this checkpoint:

- monorepo/technical foundation: about 70%;
- Phase 1 administration: about 90%;
- Phase 2 task management: about 85%;
- web product overall: about 35-40%;
- mobile product: about 5%;
- complete production JewelOS vision: about 30-35%.

The broad schema can make the project look further along than it is. Count production workflows, policies, RPCs, tests, and working UI—not table names or demo screens—when estimating progress.

## 15. Immediate next action for a new agent

Start with Phase 3A, not Forms code immediately:

1. Read this document and `AGENTS.md`.
2. Inspect the 14 RLS-disabled tables, their grants, columns, foreign keys, indexes, and all current code paths.
3. Read the relevant Forms/FMS/Notifications/CRM/dashboard reference files listed above so policies reflect future behavior rather than blocking it.
4. Produce the proposed RLS access matrix and forward-only migration for review.
5. Do not apply or publish it until reviewed.

Once the security boundary is closed, proceed to Phase 3B and then Forms. Forms should precede FMS because tasks and FMS stages depend on reliable linked-form submission behavior.

## 16. Standard handoff/reporting requirements

Every implementation phase should report:

- reference files read in both prototypes;
- behavioral comparison and deliberate deviations;
- exact writable files changed;
- schema/RPC/RLS/audit changes;
- generated-type updates;
- tests mapped to acceptance criteria;
- local and live validation separated clearly;
- secrets/privacy scan;
- Git state and deployment state;
- remaining TODOs and the next approval gate.

Never describe a feature as production-ready solely because typecheck/build passed. Database runtime, authorization, rendered UX, external providers, and deployment must each be verified at the appropriate gate.
