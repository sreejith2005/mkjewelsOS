# AGENTS.md - JewelOS repository instructions

Read this file completely before inspecting, changing, testing, deploying, or
publishing anything in this repository. It is the single instruction file for
people and AI agents; `CLAUDE.md` only points here.

## Repository

The only JewelOS implementation is this repository:
`C:\Users\MIS\Downloads\MKJewelOS` (GitHub `sreejith2005/mkjewelsOS`, default
branch `main`). Confirm the Git root with `git rev-parse --show-toplevel` before
any commit or publish.

The earlier prototypes (Base44, the mock-data `mkjewelsos` app, the Apps Script
reference) and the original standalone CRM were removed from this repository
on 2026-10-31. They are not a specification, dependency, fixture, or target. Do
not restore them or base work on them.

The sources of truth are the current code, migrations, tests, and these
maintained documents:

| Document | Use it for |
|---|---|
| `PRODUCTION_SWITCH_PLAYBOOK.md` | Every hosted action: migration, function deploy, secret, web deploy |
| `docs/MOBILE_RELEASE_GUIDE.md` | Android releases (`scripts/release-mobile.ps1` only) |
| `docs/REGRESSION_CHECKLIST.md` | Manual regression pass |
| `docs/ASK_KIARA_APP_HELP_REVIEW.md`, `docs/ASK_KIARA_PRODUCTION_TESTING.md` | Kiara's app-help content and owner test guide |
| `docs/CRM_TWO_PROJECT_PRODUCTION_RUNBOOK.md`, `docs/CRM_SHEETS_INGEST_CUTOVER.md`, `docs/CRM_WALKIN_FIELD_MAP.md` | CRM project operations and walk-in data |
| `docs/architecture/` | Hosted data inventory and the Forms/FMS -> CRM customer integration design and mappings |
| `docs/FMS_AI_ASSISTANT.md`, `docs/LEAVE_APPLICATIONS.md` | Feature notes still in use |
| `docs/superpowers/specs/` | The four designs that code comments cite (CRM embed, CRM two projects, task scores, Ask Kiara) |
| `apps/mobile/README.md` | Android shell rules and toolchain |

Finished plans, release notes, and verification reports are not kept in the
tree; they remain in Git history. Do not treat a stale document, a commit
message, or a frontend control as evidence that a feature is live. Check the
current files and report the exact validation level reached.

## Architecture

JewelOS is a pnpm monorepo for MK Jewels' retail operations:

```text
apps/web              React 18 + Vite web app (deployed on Vercel, project mkjewels-os)
apps/mobile           Android shell: the deployed web app in one WebView
packages/core         Pure TypeScript business rules, types, validation, RBAC
packages/data         Shared data-access layer used by the web app
packages/api-client   Typed Supabase browser client
packages/crm-ui       CRM screens rendered by the web app at /crm
packages/ui-tokens    Shared design tokens
supabase/             JewelOS project: migrations, pgTAP tests, Edge Functions, local seed
supabase-crm/         CRM project: migrations, pgTAP tests, Edge Functions, Apps Script feed
scripts/              Controlled operational helpers (release, CRM/FMS reconcile, audits)
```

### Two Supabase projects (owner decision 2026-10-01, live since 2026-10-06)

- **JewelOS project** (production ref starts `yima`): users, roster, tasks, FMS,
  forms, leave, notifications, reports, Ask Kiara.
- **CRM project**: the client database. `/crm` reads and writes it through the
  JewelOS login bridge (`crm-session-exchange`); JewelOS login is the only login.
- The projects are never merged. Each record has one home project; the other
  project receives events only through the audited outbox/inbox sync (roster
  `crm-staff-sync`, walk-in -> task `sync-deliver`/`crm-sync-receive`, customer
  answers `crm-customer-sync`).
- The old JewelOS `crm` schema and `public` legacy CRM tables are retired: add
  no features to them. New CRM schema work goes in `supabase-crm/`.
- The CRM keeps field, label, order, vocabulary, flow, validation, and
  calculation parity with the original MK Jewels CRM, with these approved
  extensions: `MKC-`/`MKF-`/`MKREF-` identifiers and search, optional client
  phone, walk-in -> JewelOS task, and channel/FMS contributions to the client
  record. Its presentation uses the JewelOS theme through
  `packages/crm-ui/src/crm-port/jewelos-theme.css`; map colours to JewelOS
  `--color-*` variables there.

The Vite client may contain only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_CRM_SUPABASE_URL`, and `VITE_CRM_SUPABASE_ANON_KEY`. An anon key is safe
to ship only because the database enforces RLS. Service-role keys, cron
secrets, provider credentials, Auth admin credentials, production exports, and
customer data never go into client config, source, Git, terminal output, or
chat.

### Android app (owner decision 2026-10-15)

The Android app is a native shell that shows the deployed web app full screen
in one WebView (`apps/mobile/src/features/webShell/`). Product work happens only
in `apps/web` and the shared packages; web changes reach the app through the web
deploy and need no APK. Native code is limited to what a web page cannot do on a
phone: navigation allowlist, downloads, theme strips, back button, offline
screen, gallery picker, and the update prompt. The old native screens live only
under the Git tag `mobile-native-archive` and are not a reference.

## Non-negotiable implementation rules

1. **Real persistence only.** Reads and writes use `@jewelos/api-client` /
   `packages/data` and the Supabase schema. Never add in-memory stores, demo
   fallback data, hardcoded records, or a React context as a fake backend. Local
   sample data belongs only in the local seed workflow.
2. **Database authorization is the boundary.** New tenant-scoped tables need
   RLS, minimal grants, tenant/branch/department rules where applicable, and
   tested reader/writer cases. Hidden menus and client role checks are
   usability aids, never security.
3. **Protected writes use audited server-side contracts.** Prefer a narrowly
   granted, validated RPC that authorizes the actor and writes its `audit_logs`
   row in the same transaction (users, roster, availability, task/FMS/form/CRM
   mutations, dropdowns, exports, permissions, settings, operational controls).
4. **Migrations are forward-only.** Never edit, rename, delete, or reuse an
   applied migration. Add the next number, keep compatible data paths, and
   regenerate database types when the schema changes. Before numbering, read
   the production `schema_migrations` ledger and `origin/main`: parallel
   branches take numbers too.
5. **Shared business logic stays shared.** Recurrence, SLA, task, FMS, forms,
   notification, CRM, analytics, reports, settings, and role-menu rules live in
   `packages/core`; do not duplicate them across clients.
6. **Strict TypeScript.** No `.jsx`, implicit `any`, or unchecked type escape.
   A necessary cast stays narrow and says why it is safe.
7. **Use design tokens.** Consume `@jewelos/ui-tokens` and the existing semantic
   utilities/components. No arbitrary colours, blue accents, or second design
   system.
8. **Storage is private by default.** Validate MIME type, size, path scope,
   authorization, signed URL use, lifecycle/cleanup, and audit linkage.
9. **Do not weaken security to unblock UI.** Optional maintenance metadata may
   fail open for authorized users; RLS/RPC checks are never optional.

## Product surface

Authenticated, role-aware web routes: Home, Dashboard, Tasks (with Task Control
and the FMS stage board), FMS (builder, runs, End Nodes, AI assistant), Forms
Library, Notifications, CRM, Users, Availability (leave), Reports, Dropdown
Master, Settings (including Customer Integration), and Ask Kiara. Recurring /
To-Do was retired as a page in migration 0340; recurring work now lives in Tasks
and Task Control. Meeting AI is a menu identifier only.

### Keeping Ask Kiara current

Kiara (`/ask-kiara`; Edge Functions `ask-kiara`, `kiara-knowledge-ingest`,
`kiara-insights`) answers only from its tools and from
`packages/core/src/assistant/appHelp.ts`, so it goes stale silently. Any change
that adds or renames a section, route, screen, button label, or major feature
must, in the same change:

1. Update that section's entry in `appHelp.ts` (exact on-screen labels) and
   `docs/ASK_KIARA_APP_HELP_REVIEW.md`. A new page needs a new entry;
   `appHelp.test.ts` fails without one.
2. Decide whether Kiara needs a read tool for the new data and say so in the PR.
   A Kiara tool reads only through an existing section RPC or view called as the
   asker (never service role, never a wider raw table read), is offered only
   with that section's permission and switch (`packages/core/src/assistant/tools.ts`),
   and gets allowed and denied cases in `docs/superpowers/evals/ask-kiara/cases.json`.
3. Never let a Kiara tool write. Kiara only answers questions.

## Working safely

1. Inspect `git status --short --branch` first. Other sessions may be editing
   or committing in this checkout: preserve unrelated work, stage only named
   paths, and prefer a separate worktree (outside this folder) per branch.
2. For a non-trivial change, read the relevant source, migration, and pgTAP
   test, then write a short plan before implementing.
3. Search call sites before changing an interface. Do not guess a database/RPC
   contract from UI code.
4. Use `pnpm.cmd` and `supabase.cmd` on this Windows host (`.ps1` shims may be
   blocked). Run commands from the repository root.
5. Make the smallest scoped change. Do not build adjacent modules because their
   tables or menus exist.
6. For migrations and Edge Functions, test unauthenticated, inactive,
   cross-tenant, cross-branch, ordinary-user, privileged-user, and service-role
   paths where they apply.
7. `supabase.cmd db reset` and the seed scripts are local-only. Every `--linked`
   command hits a real hosted project: confirm the project ref and follow the
   production playbook. Hosted actions are run by, or in front of, the owner.
8. The owner tests on production. Finish a change with merge, production
   deploy steps, and a short owner checklist for the live site.

## Local development

Prerequisites: Node.js 20.19+, pnpm 11, Docker Desktop (Linux containers),
Supabase CLI. Keys stay in the current PowerShell session only:

```powershell
pnpm.cmd install --frozen-lockfile
supabase.cmd start
supabase.cmd db reset            # local database only; never add --linked
$s = supabase.cmd status -o json | ConvertFrom-Json
$env:SUPABASE_URL = $s.API_URL
$env:SEED_SUPABASE_SERVICE_ROLE_KEY = $s.SERVICE_ROLE_KEY
$env:VITE_SUPABASE_URL = $s.API_URL
$env:VITE_SUPABASE_ANON_KEY = $s.ANON_KEY
pnpm.cmd seed:local              # refuses non-local URLs
pnpm.cmd --filter web dev        # http://localhost:5173
```

Local-only synthetic logins: `admin@mkjewels.local` / `admin123`,
`crm@mkjewels.local` / `crm123`, `sales@mkjewels.local` / `sales123`. Seed
source data is described in `supabase/seed-notes.md`.

## Validation and reporting

Run the smallest focused checks first, then the broader gate. With Docker:

```powershell
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

CI (`.github/workflows/ci.yml`) runs the core and web tests, typecheck, build,
and `git diff --check`. If Docker, a browser, a device, or hosted credentials are
unavailable, say exactly what was and was not proven: static/type/build checks
do not prove Postgres, RLS, RPC, Storage, edge-runtime, or rendered behaviour.

At handoff report: files changed and why; schema/RPC/RLS/Storage/audit and
generated-type impact; deliberate behaviour changes and data concerns; exact
validation commands and results (local and hosted kept separate); TODOs,
blockers, and the next approval gate. Never claim production readiness from a
green typecheck/build alone.

## Git and release discipline

Read `PRODUCTION_SWITCH_PLAYBOOK.md` before a deploy, migration apply, secret
change, or GitHub publish. Stage only named approved paths, inspect the staged
diff, run `git diff --cached --check`, and scan for credentials. Never commit
`.env`, `.supabase`, `supabase/.temp`, secrets, exports, or customer data. A Git
push is not a Supabase migration/function deploy, a web deploy, or production
verification.

Android releases follow `docs/MOBILE_RELEASE_GUIDE.md` and are cut only with
`scripts/release-mobile.ps1`, which publishes the signed APK and the
`latest.json` manifest installed apps poll. Never hand-roll a release, reuse a
`versionCode`, or publish a non-mobile GitHub release as "latest".

**Standing release instruction (2026-09-23):** after an authorized change to
`apps/mobile/**`, run the checks, commit the reviewed paths, publish the next
signed update with `scripts/release-mobile.ps1`, push its release commit to
`origin/main`, and verify the public `latest.json` and APK asset, without asking
again for routine approval. Stop and report if a gate fails. Web, shared-package,
and documentation changes need no APK. `-Mandatory` still needs explicit owner
approval. Permanent download link:
`https://github.com/sreejith2005/mkjewelsOS/releases/latest/download/JewelOS.apk`.

## Regression-safe development

Existing production behaviour is protected.

- Understand a feature's implementation and consumers before changing it, and
  make the smallest safe change. Do not rewrite or restructure working code
  unless the request requires it.
- Preserve existing behaviour unless the owner asks for a change. Fix root
  causes, not narrow workarounds.
- Reuse the existing source of truth; never add a second implementation of an
  existing system.
- After every change, run the relevant tests and check related workflows, not
  only the new feature.

Authorization:

- Enforce it at the database/API boundary, never only by hiding routes.
- Keep permission resolution central; no scattered hard-coded role checks.
- Role permissions, user overrides, dashboard authority, and feature
  availability stay conceptually separate.
- Test every permission change for both allowed and denied access, including
  direct URL/API access. Client-supplied role values never decide access.

### Protected cross-surface workflows

Home alerts, Notifications, Tasks, a direct URL, and the web app (also inside
the Android shell) are entry points onto one persisted work item. A change to a
task, FMS, or form identifier, route, completion path, or notification state
changes all of them. Inventory consumers across `apps/web`, `packages/core`,
`packages/data`, and `supabase/migrations`, and test more than one surface.

- **Identify assigned work by its assignment.** A starter assignment is
  `fms_starter_assignment_id`; a runtime step is `fms_instance_id` +
  `fms_instance_stage_id`. One form template backs many assignments, so never
  infer work from a form id.
- **One link contract.** `fmsAssignedWorkPath` / `parseFmsAssignedWorkPath` in
  `@jewelos/core` are the only FMS work-link definition.
- **Submit and complete in one server transaction.** Submitting the required
  form and progressing its stage must not be two client calls.
- **Notification state follows durable work state.** A trigger on the
  assignment completing closes the notification. Never mark it read from the
  client as a proxy, and keep history (`is_read`, `read_at`) instead of deleting.
- **A task feed must not hide open work.** Date filters apply to dated work
  only; open FMS work stays visible even when future-dated or undated. The
  filter is `taskFeedCurrentOrOverdueFilter`; both API layers call it.
- **Builder and canvas edits need phone-width checks**, since that is what the
  Android app shows. In full-screen phone sheets, avoid nested scroll areas.

### Authorization map (migration 0156)

- The resolver is `permission_effective_for()` in the database;
  `packages/core/src/permissions` mirrors it for previews, kept in parity by
  `catalog.migration.test.ts`. Use `has_permission('<key>')` in SQL and
  `hasPermission(access, "<key>")` in clients instead of role lists.
- Dashboard authority comes from `current_profile()` / `current_role_level()`;
  resolve actors through `current_profile()`, never an inline
  `user_profiles where auth_user_id = auth.uid()` lookup.
- A new section RPC calls `assert_module_enabled('<page>')` (or
  `assert_module_access` when only that section uses it), and a new
  section-owned table needs a restrictive `module_accessible` SELECT policy.
