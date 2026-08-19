# JewelOS Local-to-Production Switch Playbook

Last reviewed: 2026-08-13 (Asia/Kolkata)

This is the operational guide for moving JewelOS from local development to a hosted release, and for safely releasing every future feature. `PROJECT_HANDOFF.md` describes product status and roadmap; this file describes environments, testing, deployment, verification, and rollback.

## 1. Scope and non-negotiable rules

Only this repository is deployable and writable:

`C:\Users\MIS\Downloads\MKJewelOS\jewelos`

`mkjewelos-base44/` and `mkjewelsos/jewelos/jewelos/` are read-only behavior references. Never edit, import, deploy, or publish either one.

Read `AGENTS.md` and `PROJECT_HANDOFF.md` before each feature/release. These rules always apply:

- RLS and RPCs are the security boundary; hidden browser controls are UX only.
- Sensitive writes must be transactional and audited.
- Applied migrations are immutable; fix them with a new forward-only migration.
- Never commit, print, or put secrets into browser/mobile configuration.
- Stage named Git paths only. Never use `git add -A` for a release.

## 2. Target architecture

```text
Developer laptop                         Hosted services
------------------                       ----------------------------------
Web dev server     ---- local only ----> local Supabase containers (Docker)

Web production app ---- HTTPS --------> hosted Supabase production project
Mobile app         ---- HTTPS --------> hosted Supabase production project
                                         Postgres, Auth, Storage, Functions,
                                         Vault/secrets and scheduled jobs
```

Docker Desktop is only for local Supabase testing. It is not part of the hosted app and is not needed by staff using the web/mobile app. Hosted Supabase is the live database, Auth, Storage, Edge Function and cron platform.

The Vite web app still needs an external static web host. This repository has no web-host configuration or CI deployment pipeline yet, so choosing and configuring the host is required before launch. The host may be Vercel, Netlify, Cloudflare Pages, or another approved static host.

| Environment | Use | Supabase target | Docker | Customer data |
|---|---|---|---|---|
| Local | Build and destructive DB tests | Local CLI stack | Required for DB work | Never |
| Staging | Hosted pre-release verification | Separate hosted project | Not required | Synthetic/masked only |
| Production | Live staff use | Hosted production project | Not required | Yes, protected |

**Before launch, create a separate hosted staging Supabase project.** Do not use production as the normal feature-test database. Local Docker catches most database failures; staging catches hosted configuration, redirect URL, deployed function, and web-host integration failures.

## 3. Current deployable structure

- `apps/web` — React/Vite static web app.
- `apps/mobile` — Expo app; it is a separate future release track.
- `packages/core` — shared pure business rules and generated DB types.
- `packages/api-client` — typed Supabase client.
- `packages/ui-tokens` — shared design tokens.
- `supabase/migrations` — schema, RLS, RPC, privilege, Storage and cron work. The current working tree contains migrations through `0028`.
- `supabase/tests` — pgTAP contracts.
- `supabase/functions` — Edge Functions.

The browser-safe build values are only:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The anon/publishable key is intended for clients and is protected by RLS. A service-role key is server-only: never put it in `apps/web`, `VITE_*`, a mobile build, Git, or a user device.

## 4. One-time environment setup

### Local

Follow `LOCAL_DEVELOPMENT.md`. It uses Docker Desktop and `supabase.cmd start` to create a disposable local stack with synthetic users/data.

```powershell
Set-Location 'C:\Users\MIS\Downloads\MKJewelOS\jewelos'
supabase.cmd start
supabase.cmd db reset
pnpm.cmd seed:local
```

Set local Vite values in the same terminal as Vite, exactly as documented in `LOCAL_DEVELOPMENT.md`. Do not use `--linked` for local work.

### Hosted staging

Provision a distinct hosted Supabase project. Configure:

- staging web URL and localhost development redirects in Supabase Auth;
- staging origins/CORS as needed by deployed functions;
- migrations, Storage, Edge Functions, jobs, Vault entries and function secrets matching the release;
- synthetic test users for every actual JewelOS role;
- staging web-host values for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

Vite variables are built into the static build, so changing them requires a new deployment.

### Hosted production

Configure after staging passes:

- production web domain in Auth redirect/allowed URL settings;
- production web origin in relevant CORS/origin configuration;
- production browser-safe `VITE_*` variables in the web-host environment;
- Edge Function secrets and Vault entries through Supabase's protected secret management, never source files;
- cron schedules and Vault-backed worker-secret references;
- Auth email/provider and invitation flow using a controlled account.

Never point local Vite at production as a shortcut. Never use production for local seeds, resets, broad test imports, or exploratory writes.

Record these decisions when made; do not put secrets here:

| Item | Choice | Owner | Verified |
|---|---|---|---|
| Web host | Pending | Pending | Pending |
| Staging Supabase project | Pending | Pending | Pending |
| Production Supabase project | Existing hosted account | Pending | Pending |
| Production domain | Pending | Pending | Pending |
| Error monitoring | Pending | Pending | Pending |
| Backup/restore owner | Pending | Pending | Pending |

## 5. Repeatable feature-to-production workflow

```text
Design -> local build -> local verification -> staging deployment
       -> staging smoke/E2E -> production release -> monitor
```

Do not advance when a prior gate lacks evidence. A Git push is not a database, function, web-host, or production verification.

### Gate A — Design

1. Read repository instructions and relevant behavior in both reference apps.
2. Record behavior comparison and product decisions.
3. Define schema/indexes, RPC inputs/outputs, RLS readers/writers, Storage rules, audit events, jobs, secrets, and rollback impact.
4. Put reusable validation/state logic in `packages/core`; put Supabase access in the API layer.
5. Identify every required migration, function, secret, host setting, mobile configuration, and data migration.

For protected workflows prove database authorization for unauthenticated, ordinary employee, manager, administrator, super admin, inactive, cross-branch, cross-tenant, and service-role cases where applicable.

### Gate B — Local build and validation

For database work, validate against a clean local rebuild:

```powershell
supabase.cmd start
supabase.cmd db reset
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

Run focused web/component tests where they exist and test the rendered flow at desktop and narrow mobile widths. Use local synthetic data only. If Docker is unavailable, report it accurately: typecheck/build/static checks do not prove Postgres, RLS, RPC, Storage or pgTAP runtime behavior.

### Gate C — Reviewable Git change

```powershell
git status --short
git diff --check
git diff --name-only
```

Review unrelated worktree changes. Stage approved files by name, inspect the staged diff, then run a credential-pattern scan. Do not stage `.env`, `.supabase`, `supabase/.temp`, local secrets, exports, customer data, or broad unreviewed changes.

Recommended model: short-lived feature branch, reviewed merge to `main`, then a deliberate release from a known commit SHA. Until CI exists, record every manual validation result. Add CI before frequent releases.

### Gate D — Staging deployment

Use an interactive authenticated Supabase CLI session linked to **staging**. Confirm the linked project before every write; never paste access tokens or database passwords into a command, source, or chat.

Read-only preflight:

```powershell
supabase.cmd migration list --linked
supabase.cmd db push --linked --dry-run
```

After review, apply the listed pending migrations:

```powershell
supabase.cmd db push --linked
```

Deploy only changed Edge Functions by name. `--use-api` can avoid local Docker for function bundling, but does not replace database testing:

```powershell
supabase.cmd functions deploy <changed-function-name> --use-api
```

Set or rotate function secrets only through Supabase's protected secret process. Deploy the web build with staging `VITE_*` values, then smoke-test:

- login/logout and deactivated-user denial;
- changed role permissions and RLS-denial paths;
- audit records and normal writes;
- private upload/download policies, where relevant;
- function authentication, validation and errors;
- jobs/queues/providers with safe fixtures;
- desktop and mobile-width layouts, console/network errors and monitoring.

If staging fails, correct source and repeat. Do not bypass it by applying the untested change to production.

### Gate E — Production release

Create a release record: commit SHA, migration names, changed functions, web-host/config changes, expected user impact, backup status, rollback plan, and approver. Use a quiet release window for schema/workflow changes.

Immediately before production writes:

```powershell
git rev-parse HEAD
git status --short
supabase.cmd migration list --linked
supabase.cmd db push --linked --dry-run
```

Confirm the link is production and the dry-run exactly matches approval. Take or verify a current backup/recovery plan. Then apply once:

```powershell
supabase.cmd db push --linked
```

Deploy only changed functions and the exact approved web commit with production `VITE_*` variables. Smoke-test with controlled staff/test accounts only; never seed or insert test customer data in production. Monitor the agreed period and record deployed SHA and outcome.

## 6. Database rules

1. `supabase/migrations` is append-only after any shared hosted application.
2. A protected workflow's migration must include its RLS, minimum grants, indexes, RPC privilege decisions, audit behavior and pgTAP coverage.
3. `supabase.cmd db push --linked --dry-run` is mandatory hosted preflight.
4. `supabase.cmd db reset`, local seeds and test imports are local-only.
5. `db push` has no automatic rollback. Prefer compatible expansion first, deploy new code, migrate data safely, and remove obsolete paths later.
6. Before destructive work, take a backup and rehearse recovery in staging. Prefer archived/soft-deleted data and delayed cleanup.

## 7. Functions, Storage and secrets

For every Edge Function:

- Keep service-role use server-only; it bypasses RLS.
- If JWT verification is intentionally disabled for a cron worker, validate a dedicated secret before reading request data or accessing the database.
- Test request auth, invalid input, retries, idempotency and failure logging.
- Deploy explicitly by function name; do not use broad `--prune` without a function inventory/deletion review.
- Prove response classes, not secret values.

For Storage, use private buckets by default. Test policy denial, path ownership, MIME/size validation, download access, cleanup lifecycle, and audit behavior.

## 8. Web host requirements

Build from the monorepo using:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd --filter web build
```

The static output is `apps/web/dist`. Do not deploy the Vite dev server. The chosen host must provide HTTPS, staging/production separation, SPA fallback for deep links, environment separation, build logs, commit association, and rollback to a known-good build. It may receive browser-safe Vite variables only.

## 9. Mobile release path

The Expo app is a separate later release. Do not call it production-ready until it has real auth, navigation, API access, uploads, error/offline behavior and device testing. Use the same staging/production Supabase separation, secure session storage, client-safe keys only, versioned signed builds, and staged store rollouts. A mobile client is untrusted: RLS/RPC checks still apply.

## 10. Production readiness checklist

### Security and data

- [ ] Intentional RLS/minimum privileges for every exposed table.
- [ ] RPC/function denial tests for unauthorized and inactive users.
- [ ] Transactional audit records for sensitive operations.
- [ ] Private Storage policies and file validation tested.
- [ ] No service-role/provider secret in clients or Git.
- [ ] Auth redirects, email settings and invitations tested.
- [ ] Privacy, retention, export and deletion policy agreed.

### Quality

- [ ] Clean local reset, relevant pgTAP, lint, core tests, typecheck and build.
- [ ] Rendered desktop and mobile-width web QA.
- [ ] Role-based authenticated E2E coverage for critical flows.
- [ ] Staging smoke tests pass.
- [ ] Accessibility, loading, error and recovery states reviewed.

### Operations

- [ ] Separate hosted staging and production projects.
- [ ] Web host configured for HTTPS, deep links, staging and rollback.
- [ ] Functions, Vault/secrets and cron configured without exposing values.
- [ ] Monitoring/alerts for web, functions, cron, queues and providers.
- [ ] Backup/restore ownership and a staging restore drill documented.
- [ ] Incident/release approval responsibilities assigned.
- [ ] CI runs typecheck, tests, build, migration review and secret scan.

## 11. Rollback and incidents

A static web build can normally roll back to the previous known-good deployment. Database migrations cannot be safely undone by editing history: make a reviewed forward corrective migration, or use an approved and tested backup/restore plan.

For an incident: limit the affected feature/worker safely, preserve aggregate evidence without PII/secrets, roll back web only if it remains DB-compatible, then verify authorization, data integrity and critical flows. Record prevention tests before the next release.

## 12. First production-switch sequence

1. Reconcile current branch/migrations. The worktree contains migrations past the older `PROJECT_HANDOFF.md` baseline; do not treat its old commit/count as current.
2. Finish the first-release RLS, test, UX and module readiness gaps.
3. Choose/configure web host and production domain.
4. Create/configure hosted staging Supabase.
5. Add CI and a small authenticated browser E2E suite.
6. Deploy the approved commit to staging and complete all smoke tests.
7. Verify production backup/recovery and approve the release record.
8. Deploy the exact approved commit to production using Gate E.
9. Smoke-test, monitor, and hand over with support/rollback contacts.

## 13. Release evidence template

```text
Release: <name>
Commit SHA: <sha>
Target: staging | production
Approved by: <name/role>

Changed: web / migrations / Edge Functions / host configuration
Local evidence: reset + pgTAP / tests / typecheck / build / rendered QA
Hosted preflight: linked target confirmed / dry-run reviewed
Hosted verification: roles / functions / storage / jobs / responsive QA
Rollback: prior web build / corrective migration or restore plan
Outcome and follow-up:
```

## 14. Command safety reference

| Command | Meaning | Target |
|---|---|---|
| `supabase.cmd start` | Starts local containers | Local; Docker required |
| `supabase.cmd db reset` | Deletes/rebuilds local DB | Local only |
| `supabase.cmd test db` | Runs database tests | Local; Docker required |
| `supabase.cmd db lint --local --level warning` | Lints local DB | Local only |
| `supabase.cmd migration list --linked` | Compares migration history | Hosted read-only preflight |
| `supabase.cmd db push --linked --dry-run` | Lists hosted pending migrations | Hosted read-only preflight |
| `supabase.cmd db push --linked` | Applies migrations | Approved staging/production action |
| `supabase.cmd functions deploy <name> --use-api` | Deploys one function | Approved hosted action |

Before every `--linked` command, confirm which hosted project is linked. It acts on that exact project, not a generic cloud environment.

## 15. Keep this current

Update this file whenever the host, CI, environment setup, mobile release process, monitoring, backup method, release command or security boundary changes. Keep `PROJECT_HANDOFF.md` for product implementation status and this file for the repeatable release process.
