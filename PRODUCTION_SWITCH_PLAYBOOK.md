# JewelOS production switch playbook

Last source review: 2026-08-20 (Asia/Kolkata)

This is the release procedure for the active JewelOS repository. It separates
what source code is configured to do from what has actually been verified in a
hosted environment. Read `AGENTS.md` and `PROJECT_HANDOFF.md` first.

## 1. Scope and safety rules

The only deployable repository is:

`C:\Users\MIS\Downloads\MKJewelOS\jewelos`

Retired prototype/Base44 projects are not release inputs or targets. Do not
build, publish, deploy, or import from them.

These rules apply to every feature release:

- RLS, minimum grants, and protected RPC/Edge Function checks are the real
  permission boundary; browser role hiding is UX only.
- Sensitive writes must authorize and create `audit_logs` in the same database
  transaction/request.
- Applied migrations are immutable. Correct them with a new forward-only
  migration; do not rewrite migration history.
- Never put service-role, cron, provider, Auth admin, database-password, or
  customer-data material in a client build, Git, terminal transcript, or chat.
- Stage approved named paths only. Do not use `git add -A` for a release.
- A Git push is not a web-host, database, Edge Function, secret, or cron
  deployment.

## 2. Release architecture and current checked-in configuration

```text
Developer laptop                         Hosted services
------------------                       -----------------------------------
Web dev server     ---- local only ----> local Supabase containers (Docker)

Vite web build     ---- HTTPS ---------> Vercel static deployment
Web/mobile client  ---- HTTPS ---------> hosted Supabase project
                                         Postgres, Auth, Storage, Functions,
                                         secrets/Vault and scheduled jobs
```

`vercel.json` is checked in with Vite settings: frozen pnpm install,
`pnpm --filter web build`, output `apps/web/dist`, and an SPA rewrite to
`index.html`. It does not prove that a Vercel project, domain, environment
variables, or deployment is currently connected.

Migrations `0001` through `0070` are in source. The database contains task,
forms, FMS, CRM, notification, report/export, roster, and operational-control
contracts. Confirm the real linked project and migration history before every
hosted write; do not infer it from this file or Git.

The browser-safe build variables are exactly:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The anon/publishable key belongs in a client only because RLS protects data.
Service-role credentials are server-only and must never be `VITE_*`, mobile
build configuration, source, Git, or a user device.

| Environment | Purpose | Supabase target | Data |
| --- | --- | --- | --- |
| Local | Build, destructive DB tests, synthetic development | Local CLI/Docker stack | Synthetic only |
| Staging | Hosted release verification | Separate hosted project | Synthetic/masked only |
| Production | Staff use | Hosted production project | Protected operational data |

Do not use production as a feature-test database. A separate hosted staging
project is a launch requirement, not a convenience.

## 3. Local setup and verification

Follow `LOCAL_DEVELOPMENT.md` for local variables and synthetic users. Typical
local database startup is:

```powershell
Set-Location 'C:\Users\MIS\Downloads\MKJewelOS\jewelos'
supabase.cmd start
supabase.cmd db reset
pnpm.cmd seed:local
```

For a database-affecting release, validate a clean local rebuild when Docker is
available:

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

Run focused test files first and add rendered desktop/narrow-width QA for every
changed user flow. If Docker or browser automation is unavailable, report that
limit accurately. Typecheck/build/static review does not prove Postgres, RLS,
RPC, Storage, Edge Functions, cron, provider delivery, or hosted rendering.

## 4. Release gates

### Gate A - Design and compatibility

1. Read the three repository documents and the relevant current source,
   migration, tests, and approved spec/plan.
2. Define tables/indexes, RLS readers/writers, grants, RPC/function inputs and
   outputs, audit event, Storage path/policy, jobs, secrets, user impact, and
   rollback/compatibility path.
3. Put reusable state/validation in `packages/core`; keep Supabase I/O in the
   API/database layers.
4. For protected flows, prove denial as well as success: unauthenticated,
   inactive, ordinary, privileged, cross-tenant, cross-branch, and service-role
   cases as applicable.
5. For destructive or identity/roster work, get explicit approval, back up or
   rehearse recovery, and preserve historical records.

### Gate B - Local evidence

Complete the appropriate checks from section 3. For every schema change,
regenerate/check the DB types and run the relevant pgTAP suite. For web work,
run focused Vitest tests and inspect the real rendered route. For Edge Functions,
test authentication, bad input, idempotency/retry, and secret-free failures.

Do not carry a local seed/reset, test import, or development Vite variable into
a hosted target.

### Gate C - Reviewable Git change

```powershell
git status --short --branch
git diff --check
git diff --name-only
```

Review unrelated work before staging. Stage named approved paths, inspect the
staged diff and whitespace, then do a credential-safe scan:

```powershell
git diff --cached --check
git diff --cached --name-only
git diff --cached | Select-String -Pattern 'service_role|SUPABASE.*KEY|password|secret|token' -CaseSensitive:$false
```

Treat matches as review prompts, not permission to print credentials. Never
stage `.env`, `.supabase`, `supabase/.temp`, production exports, customer data,
or key material. Record the release commit SHA after review.

### Gate D - Staging deployment

Use an authenticated Supabase CLI session linked to **staging**. Before any
hosted command, establish the exact project in the interactive CLI/UI and
record its non-secret name/reference. Do not paste access tokens or passwords
into command lines.

Preflight is read-only:

```powershell
supabase.cmd migration list --linked
supabase.cmd db push --linked --dry-run
```

Review every pending migration and ensure it matches the approved SHA. Then,
and only then, apply it:

```powershell
supabase.cmd db push --linked
```

Deploy only changed Edge Functions by explicit name:

```powershell
supabase.cmd functions deploy <changed-function-name> --use-api
```

The current function configuration disables platform JWT verification for
three cron-only workers - `generate-recurring-tasks`,
`process-notification-outbox`, and `process-report-exports` - because they
must validate a dedicated server-side `x-cron-secret` before parsing a request
or accessing data. Configure/rotate those secrets only through protected
Supabase secret management; never call them from a browser.

Build/deploy the web app with staging-only browser-safe Vite variables. Then
smoke-test with controlled synthetic users:

- sign-in, password recovery, logout, inactive-account denial, and redirects;
- role/RLS success and denial paths; audit records for changed workflows;
- private upload/download or signed-URL rules when Storage changed;
- task assignment/in-app alerts, Forms/FMS stage contracts, CSV import
  idempotency, recurrence, and any affected workflow;
- Edge Function authentication/validation/errors and safe jobs/providers;
- desktop and mobile-width route rendering, console/network errors, and
  monitoring signals.

If staging fails, fix source and repeat from the applicable local gate. Do not
use production as a shortcut around a failed/unverified staging gate.

### Gate E - Production release

Create a release record containing: approved SHA, target, approver, migration
names, changed functions, host/config changes, expected impact, backup/recovery
status, smoke-test owner, monitoring window, and rollback path.

Immediately before a production write:

```powershell
git rev-parse HEAD
git status --short
supabase.cmd migration list --linked
supabase.cmd db push --linked --dry-run
```

Confirm the link is production, the dry run exactly matches approval, and the
backup/recovery plan is current. Apply once with `supabase.cmd db push --linked`.
Deploy only the approved functions and exact web commit with production Vite
variables. Never seed, reset, bulk-import exploratory data, or test customer
flows in production.

Use controlled staff/test accounts for smoke tests, monitor for the agreed
window, and record the deployed SHA and result. A failed database contract is
corrected by a reviewed forward migration, not by changing history.

## 5. Database, Storage, function, and host rules

1. Database migrations are append-only; `db push` has no automatic rollback.
   Prefer compatible expansion, code deployment, controlled data migration,
   then later cleanup.
2. A protected workflow change needs RLS, minimum grants, RPC privilege
   decisions, indexes, audit behaviour, and pgTAP coverage in the same review.
3. `supabase.cmd db reset`, local seeds, and destructive test imports are
   local-only. `--linked` operates on the exact hosted project currently linked.
4. Storage buckets should be private by default. Validate path ownership,
   tenant scope, MIME/size, signed URL access, cleanup, and audit linkage.
5. Service-role use is server-only and bypasses RLS. A JWT-disabled worker must
   authenticate a dedicated secret before parsing input or touching data.
6. Vercel must retain HTTPS, separate staging/production environments, SPA
   fallback, deployment logs/commit association, browser-safe variables only,
   and rollback to a known-good deployment. Deploy `apps/web/dist`, never the
   Vite dev server.

## 6. Production readiness checklist

### Security and data

- [ ] Every exposed table has intentional RLS and minimum grants.
- [ ] Critical RPC/function denial paths cover inactive and cross-scope actors.
- [ ] Sensitive writes are transactional and audited.
- [ ] Private Storage policy and file validation are tested.
- [ ] No service-role/provider/cron secret is in clients or Git.
- [ ] Auth redirect URLs, email flow, invitations, and recovery are tested.
- [ ] Privacy, retention, export/deletion, and backup responsibilities are agreed.

### Quality

- [ ] Clean local reset, relevant pgTAP, lint, core/web tests, typecheck and build pass.
- [ ] Rendered desktop and narrow-width web QA passes.
- [ ] Authenticated role-based E2E covers critical work flows.
- [ ] Staging smoke tests pass with evidence attached to the release record.
- [ ] Loading, error/recovery, accessibility, and provider failure states are reviewed.
- [ ] Mobile is separately device-tested and signed before any mobile launch claim.

### Operations

- [ ] Separate staging and production Supabase projects are configured.
- [ ] Vercel staging/production host, HTTPS, deep links, variables and rollback are verified.
- [ ] Named functions, protected secrets, and cron schedules are deployed/verified.
- [ ] Monitoring/alerts cover web, functions, cron, queues, exports and providers.
- [ ] Backup/restore owner and a staging restore drill are documented.
- [ ] CI runs typecheck, tests, build, migration review, and secret scanning.

## 7. Rollback and incident response

A static web deployment can normally roll back to the previous known-good build
only when it remains database-compatible. Never attempt to undo a hosted
migration by editing history. Use a reviewed forward corrective migration, or
an approved, tested backup/restore procedure.

For an incident, first contain the affected feature/worker safely, preserve
non-sensitive evidence, establish the deployed SHA and target, check
authorization/data integrity, and use the compatible web rollback or corrective
migration path. Confirm critical flows after recovery and add prevention tests
before the next release.

## 8. Release record template

```text
Release: <name>
Commit SHA: <sha>
Target: staging | production
Approved by: <name/role>
Hosted project confirmed: <non-secret project name/reference>

Changed: web / migrations / Edge Functions / host configuration / secrets / jobs
Local evidence: <commands and results>
Hosted preflight: <migration list and dry-run reviewed>
Hosted verification: <roles/RLS, audits, functions, Storage, jobs, responsive QA>
Rollback: <prior compatible web build and forward-correction or restore path>
Monitoring owner/window:
Outcome and follow-up:
```

Update this playbook when the actual host/domain, CI, environments, monitoring,
backup/recovery process, release commands, or security boundary changes. Keep
`PROJECT_HANDOFF.md` focused on implementation state and this document focused
on repeatable operational evidence.
