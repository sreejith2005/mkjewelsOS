# JewelOS technical handoff

Last source audit: 2026-08-29 (Asia/Kolkata)
Repository checkpoint: `5292f8c` (`main`, source checkpoint before this documentation update)

This is the operational handoff for the current JewelOS codebase. It describes
what the repository contains at the checkpoint above. It does **not** assert
that a migration, Edge Function, Vercel deployment, provider, or browser flow
is currently live unless a later release record says it was verified in that
environment.

## 1. Authority and truth boundaries

Work only in `C:\Users\MIS\Downloads\MKJewelOS\jewelos`. Read `AGENTS.md`,
then this document, before changing the product.

The retired prototype/Base44 projects are not part of the current development
workflow and must not be used as a source of requirements or implementation.
Current code, migrations, pgTAP tests, focused TypeScript tests, and approved
specs/plans are the source of truth. When those disagree, inspect the current
database contract and call sites, preserve deployed compatibility, and record
the decision.

Keep evidence boundaries explicit:

- source audit proves checked-in implementation only;
- local Supabase reset plus pgTAP proves the local database contract;
- local app tests/typecheck/build prove static and testable client behaviour;
- a hosted smoke test proves only the named target and release SHA;
- a Git push proves neither deployment nor hosted database state.

## 2. Current architecture

JewelOS is a strict-TypeScript pnpm monorepo:

| Area | Responsibility |
| --- | --- |
| `apps/web` | React 18/Vite application, role-aware shell and feature UI |
| `apps/mobile` | Expo/React Native starter; not a production release track yet |
| `packages/core` | Pure domain logic, RBAC/menu, generated DB types, validation and presentation helpers |
| `packages/api-client` | Typed Supabase browser client |
| `packages/ui-tokens` | Shared design tokens |
| `supabase/migrations` | Append-only schema, RLS, RPC, Storage, grants and cron contracts |
| `supabase/tests` | pgTAP contract/authorization tests |
| `supabase/functions` | Edge Functions and focused worker tests |
| `scripts` | Controlled password/authoritative-roster operational helpers |

Web is configured for a Vercel static deployment in `vercel.json`: frozen pnpm
install, `pnpm --filter web build`, `apps/web/dist`, and SPA rewrite to
`index.html`. The config is checked in; this audit did not query whether a
particular Vercel project or domain is currently deployed.

Browser-safe build configuration is restricted to `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. All other credentials, especially service-role,
cron, provider, and Auth admin material, stay server-side.

## 3. Implemented web product surface

The shell authenticates through Supabase, handles reset-password recovery,
loads role-aware navigation from `packages/core/roleMenu`, and uses a lazy-page
error boundary. Maintenance controls are an optional, fail-open overlay; they
are not authorization.

Implemented route surfaces are Home, Dashboard, Tasks, FMS, Forms Library,
Notifications, CRM, Users, Availability, Reports, Dropdown Master, and
Settings. `meeting_ai` remains a role-menu identifier with no implemented page.
`fms_tasks` reuses the FMS builder/runtime page. User roles currently include
super admin, admin, manager, HR, CRM, staff, doer, and housekeeping.

### Tasks and personal work

- Personal Home separates current assigned work, FMS starter-form assignments,
  and activity; task assignment notifications are written transactionally for
  immediate in-app visibility.
- Tasks support checked/overdue/in-progress/all filtering, search/date range,
  checklist progress, comments, delegation, revision, attachments, templates,
  recurrence, availability, buddy/in-loop users, and required linked forms.
- Task categories are optional for new work; existing historical values remain.
- CSV import validates/mappings/previews client-side, calls the protected
  `import_delegation_tasks_with_audit` RPC, stores metadata only, limits a batch
  to 500 rows, and uses an import hash for idempotency.
- Saving a new recurring template creates the first task immediately. Migration
  `0070` supplies a Kolkata-time default if the browser omits the initial time;
  the existing protected recurrence worker remains responsible for future work.
- Shared (tenant-wide) departments are supported only when active employees in
  the selected branch make the assignment valid.

### Forms

The Forms Library has real database reads and RPC-backed draft/save, publish,
revision, archive, delete, duplicate, submit, and review flows. The builder and
renderer use the shared forms domain package. Published forms linked to running
FMS work are protected from destructive replacement: duplication/revision
preserves existing pinned data. Forms can be linked to tasks and FMS stages;
FMS-stage form submissions are validated server-side and recorded on the
instance stage.

### FMS

FMS includes a graph builder, draft/publish/revision/archive/delete lifecycle,
stage configuration, named primary/fallback assignees, forms, checklists,
evidence, decision/branch rules, parallel/structural stages, timing methods,
and status-condition operators. Publication checks reachability and valid human
assignments. Live instances support start, claim, completion, review,
reassignment, revision/backward movement, escalation, checklist updates, and
private FMS evidence with signed URLs.

The opening form is a durable starter assignment. Completing it starts the
instance and assigns the next work, rather than creating a background-only or
mock workflow. Automatic/structural stages correctly skip deadline validation
and timing-rule execution where a human deadline is not meaningful.

### Other modules

- CRM includes clients, walk-ins, interactions, follow-ups, client merge
  safeguards, and documents, backed by the CRM domain/API code.
- Notifications include inbox, templates, rules, logs, provider status and an
  outbox-processing worker. Provider delivery must be treated as unverified
  until configured and exercised in the target environment.
- Dashboard/analytics, reports, private CSV-export processing, user
  administration, availability, Dropdown Master, and Settings have source and
  database contracts in the repository.
- User lifecycle work includes invitation/activation, password-reset helpers,
  hierarchy, personal/official contact fields, work-email login, and controlled
  authoritative roster reconciliation. The roster script dry run must stop for
  approval when active Auth-email collisions would require account retirement.

## 4. Database and security state

Migrations `0001` through `0109` are present. They are append-only history;
never edit an applied file. The major groups are:

| Range | Contract |
| --- | --- |
| `0001-0008` | core multi-tenant schema, active-session/RLS hardening, tasks, RPC privileges and future-table RLS closure |
| `0009-0015` | forms, FMS, notifications, CRM, analytics/reports/settings and bootstrap/read fixes |
| `0016-0029` | user lifecycle, Dropdown Master safety, forms cleanup and task watcher notifications |
| `0030-0045` | FMS assignee scoping, implicit paths, calendars/timing, forms/FMS lifecycle and decision contracts |
| `0046-0056` | production identity/roster repair and controlled section maintenance |
| `0057-0063` | FMS deletion, assignment notifications, week-off authority, automatic-stage timing, FMS forms and starter assignments |
| `0064-0070` | audited CSV task import, optional categories, valid shared departments, immediate task alerts, task-RPC reconciliation and immediate recurring-task delivery |
| `0071-0079` | CRM migration registry, field definitions, legacy mappings, staged import, historical timeline and visit-form preservation |
| `0080-0083` | task bulk-import workspace, CRM sync ingestion, FMS runtime repair and CRM sync checkpoint reads |
| `0084-0096` | centralized task coverage, recurring completion, direct assignee search, protected form completion, user credentials, roster and username-login controls |
| `0097-0100` | designation daily checklists, validator repair, active-doer mutation restriction, and task deadline/evidence contracts |
| `0101-0105` | resumable current-sheet task import, tenant realtime refresh, recurring catch-up, zero-touch imports, and organization fallback retries |
| `0106-0109` | guarded demo-data retirement, settings mutation-key RLS, task-template management, and recurring to-do reference parity |

RLS and minimum grants are the security boundary. Sensitive workflows use
`SECURITY DEFINER` RPCs with in-function active profile/tenant/role checks and
audit writes. Any change to a protected workflow must trace its table policies,
grants, RPC body, Storage policy, UI call site, generated types, and pgTAP
coverage together.

`supabase/config.toml` intentionally disables platform JWT verification only
for `generate-recurring-tasks`, `process-notification-outbox`, and
`process-report-exports`; each is designed to validate a dedicated server-side
`x-cron-secret` before parsing input or accessing data. Do not copy that model
to browser-callable functions. Other function directories currently include
`invite-user`, `delete-user`, and `reset-user-password`.

## 5. Current test and validation inventory

The repository contains pgTAP contracts for the principal module migrations,
plus focused later suites for FMS paths/assignees/forms/starter assignments,
task import, task RPC reconciliation, and initial recurring task creation.
`packages/core` and `apps/web` contain Vitest coverage for their domain and UI
helpers, including task import parsing/normalization and composer behaviour.
The notification and report workers include focused tests.

This documentation update did not run a local database reset, pgTAP, browser,
or hosted smoke test. Run the change-appropriate commands from `AGENTS.md` and
record exact output before making any completion/deployment claim. Docker being
unavailable does not justify calling database/RLS/RPC behaviour verified.

## 6. Known limits and approval gates

1. **Mobile:** the Expo app is still a starter and lacks the complete real
   auth/navigation/API/upload/offline/device-release proof required for launch.
2. **Meeting AI:** role/menu support exists, but there is no implemented route
   or backend contract.
3. **Hosted proof:** this source audit does not establish the currently linked
   Supabase project, applied migration history, deployed functions/secrets,
   Vercel domain, provider configuration, jobs, monitoring, backup status, or
   live staff workflow quality. Verify each in staging/production before use.
4. **External delivery:** in-app task alerts are transactional. Outbox/provider
   delivery is a separate operational dependency and must be configured,
   authenticated, monitored, and tested without exposing secrets.
5. **Quality gates:** source includes a CI workflow for frozen install, core
   and web unit tests, type checking, build, and whitespace validation. Its
   hosted execution status and authenticated browser E2E coverage remain
   unverified; add role-based browser coverage before a frequent production
   release cadence.
6. **Roster authority:** never run an authoritative roster apply that retires
   active accounts without explicit approval of the collision list.

## 7. Recommended next-agent workflow

1. Read `AGENTS.md`, this handoff, the production playbook (if release work),
   and any relevant spec/plan.
2. Check current `git status`, latest migrations, affected core/domain code,
   web call sites, Edge Functions, and corresponding pgTAP tests.
3. Make a narrow, real-database change. Add a forward migration and test when
   the database contract changes; do not simulate a backend in the client.
4. Validate proportionately, keeping local, hosted, UI, provider, and device
   evidence separate.
5. Before any production move, follow `PRODUCTION_SWITCH_PLAYBOOK.md` exactly:
   confirm linked target, review the dry run, deploy named functions only, and
   make a release record with a known commit SHA and rollback plan.
