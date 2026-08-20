# AGENTS.md - JewelOS repository instructions

Read this file completely before inspecting, changing, testing, deploying, or
publishing anything in this repository.

## Repository authority

The only JewelOS implementation is this nested repository:

`C:\Users\MIS\Downloads\MKJewelOS\jewelos`

Run Git, pnpm, Supabase, and file operations from that directory. Confirm the
Git root with `git rev-parse --show-toplevel` before any commit or publish.

Earlier prototype/Base44 projects are retired. They are not a behavioural
specification, dependency source, test fixture, or deployment target. Do not
search for them, restore them, import from them, or base new work on mock-data
patterns. If an old copy happens to be present in a local checkout, leave it
alone unless the user explicitly asks to remove it; it is outside the active
application surface.

The authoritative sources are the current implementation, migrations, tests,
and maintained repository documents:

- `PROJECT_HANDOFF.md` - current product and technical state;
- `PRODUCTION_SWITCH_PLAYBOOK.md` - release gates and production operations;
- `LOCAL_DEVELOPMENT.md` - local setup and synthetic seed workflow;
- `docs/superpowers/specs/` and `docs/superpowers/plans/` - approved feature
  designs/plans when relevant;
- `supabase/migrations/` and `supabase/tests/` - database contract history and
  executable authorization tests.

Do not treat a stale document, a commit message, or a frontend control as
evidence that a feature is live. Check the current files and report the exact
validation level reached.

## Architecture

JewelOS is a pnpm monorepo for MK Jewels' multi-tenant retail operations:

```text
apps/web              React 18 + Vite web application
apps/mobile           Expo/React Native client; separate, incomplete release track
packages/core         Pure TypeScript business rules, types, validation, RBAC
packages/api-client   Typed Supabase browser client
packages/ui-tokens    Shared design tokens
supabase/migrations   Append-only Postgres schema, RLS, RPC, Storage and cron work
supabase/tests        pgTAP database-contract tests
supabase/functions    Edge Functions and their focused tests
scripts               Controlled operational helpers
```

The web app is a client of hosted/local Supabase. The Vite client may contain
only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the anon key is safe to
ship only because the database enforces RLS. Service-role keys, cron secrets,
provider credentials, Auth admin credentials, production exports, and customer
data are never client configuration, source, Git content, terminal output, or
chat content.

## Non-negotiable implementation rules

1. **Real persistence only.** Reads and writes use `@jewelos/api-client` and
   the Supabase schema. Never add in-memory stores, demo fallback data,
   `globalThis` databases, hardcoded application records, or a React context as
   a fake backend. Local sample data belongs only in the local seed workflow.
2. **Database authorization is the boundary.** New tenant-scoped tables need
   RLS, minimal grants, tenant/branch/department rules where applicable, and
   tested reader/writer cases. Hidden menus, disabled controls, and client-side
   role checks are usability aids, never security controls.
3. **Protected writes use audited server-side contracts.** Prefer a narrowly
   granted, validated RPC that authorizes the actor and writes its `audit_logs`
   record in the same transaction. This applies to user and roster changes,
   availability, task/FMS/form/CRM mutations, dropdown changes, exports,
   permissions, settings, and operational controls.
4. **Migrations are forward-only.** Never edit, rename, or reuse an applied
   migration. Add the next numbered migration, preserve compatible data paths,
   and update generated database types when the schema changes.
5. **Shared business logic stays shared.** Put pure recurrence, SLA, task,
   FMS, forms, notification, CRM, analytics, reports, settings, and role-menu
   rules in `packages/core`; do not duplicate those rules across clients.
6. **Strict TypeScript.** Do not add `.jsx`, implicit `any`, or an unchecked
   type escape. If an unavoidable cast is needed, keep it narrow and explain
   why it is safe.
7. **Use design tokens.** Consume `@jewelos/ui-tokens` and existing semantic
   CSS utilities/components. Do not introduce arbitrary colour values, blue UI
   accents, or a second design system.
8. **Keep Storage private by default.** Validate MIME type, size, path scope,
   authorization, signed URL use, lifecycle/cleanup, and audit linkage.
9. **Do not weaken security to unblock UI.** An optional maintenance metadata
   failure must fail open for authorized users, but access control must remain
   server-side. Never make RLS/RPC checks optional for a browser flow.

## Current product surface

The current web source contains authenticated, role-aware routes for Home,
Dashboard, Tasks, FMS, Forms Library, Notifications, CRM, Users, Availability,
Reports, Dropdown Master, and Settings. Meeting AI remains a menu identifier,
not an implemented route. `apps/mobile` is not production-ready.

Important current contracts include:

- task creation, delegation, templates, recurrence, availability, checklist,
  attachments, required forms, immediate in-app assignment alerts, and audited
  CSV import;
- form drafting, publishing, revision/duplication, form submission/review, and
  task/FMS form links;
- FMS drafting/publishing/revision/deletion, graph stages, named assignees,
  timing/decision conditions, starter form assignments, live instances, and
  audited stage actions/evidence;
- CRM clients, walk-ins, interactions, follow-ups, merge safeguards, and
  documents;
- notifications/outbox contracts, reports/private export processing, role-aware
  user administration, controlled roster reconciliation, and section
  maintenance controls.

Read the relevant source, migration, and pgTAP test before changing one of
these areas. Preserve historical task/form/FMS data when evolving a contract.
For authoritative roster work, preserve personal contact information and use
approved work email for login; stop and obtain approval before retiring an
active conflicting account.

## Working safely

1. Inspect `git status --short --branch` before editing. This worktree may
   contain user changes; preserve unrelated work.
2. For a non-trivial feature or behavioural change, read the applicable design
   and write/refresh a concrete plan before implementation.
3. Search current source, migrations, tests, and call sites before changing an
   interface. Do not guess a database/RPC contract from UI code alone.
4. Use `pnpm.cmd` and `supabase.cmd` on this Windows host. PowerShell `.ps1`
   shims may be blocked. Run commands from this nested repository.
5. Make the smallest scoped change. Do not build adjacent modules merely
   because their tables or menus already exist.
6. For migrations and edge functions, test unauthenticated, inactive,
   cross-tenant, cross-branch, ordinary-user, privileged-user, and service-role
   paths where they apply.
7. Treat database and hosted actions separately. `supabase.cmd db reset` and
   local seed scripts are local-only. Every `--linked` command targets a real
   hosted project: confirm it and use the production playbook.

## Validation and reporting

Use the smallest focused checks first, then the relevant broader checks. A
typical full local gate, when Docker is available, is:

```powershell
supabase.cmd start
supabase.cmd db reset
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

Adapt the command list to the change. If Docker, browser automation, a device,
or hosted credentials are unavailable, say exactly what was and was not proven;
static/type/build checks do not prove Postgres, RLS, RPC, Storage, edge-runtime,
or rendered UX behaviour.

At handoff report:

- files changed and why;
- schema/RPC/RLS/Storage/audit impact and generated-type impact;
- behaviour deliberately changed and any compatibility/data-migration concern;
- exact validation commands and concise results, with local and hosted evidence
  kept separate;
- TODOs, blockers, and the next approval gate.

Do not claim a feature is production-ready from a green typecheck/build alone.

## Git and release discipline

Read `PRODUCTION_SWITCH_PLAYBOOK.md` before a deploy, migration apply, secret
change, or GitHub publish. Review a dirty worktree, stage only named approved
paths, inspect the staged diff, run `git diff --cached --check`, and perform a
credential-safe staged scan. Never include `.env`, `.supabase`,
`supabase/.temp`, secrets, exports, or customer data. A Git push is not a
Supabase migration/function/web-host deployment or production verification.
