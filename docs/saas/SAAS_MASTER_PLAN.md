# JewelOS SaaS — Master Plan

> The single source of truth for the cleanup + SaaS project. The orchestrator chat reads this
> first and updates the **Status** section (via the owner) after every completed step.
> Facts marked (verify) were observed on 2026-10-15 and verified by the orchestrator the same day (corrections applied).

## 1. Vision (owner's words, summarised)
JewelOS is the operations web app (plus Android app) the owner built for MK Jewels: tasks,
FMS workflows, forms, CRM, leave/availability, notifications, reports, users, Ask Kiara AI
assistant. It was built quickly: features were added one on top of another whenever someone
asked, with many parallel branches and deploys, so the code, database and migrations are messy.

Goal: turn it into a **universal SaaS product** that the owner can sell to other companies.
- **Company registration / onboarding:** capture company details, number of employees,
  departments, branches, employee names and roster, and the first company super admin.
- **Each company gets its own database** (company 1 → DB 1, company 2 → DB 2, …) and its own
  JewelOS experience.
- Inside each company, the existing hierarchy stays: super admin > admin > manager > staff
  (plus hr etc.).
- **Above every company sits a Master Admin** (the owner). It can see and control every company:
  start/stop (suspend) a company, make changes a company super admin cannot, and access
  every tenant database. Only the owner has it.
- Free/trial accounts may exist for demos.
- First, **clean up and stabilise** the codebase without breaking the working MK Jewels app.
  Then build SaaS.

## 2. Decisions (with reasons and rejected alternatives)
| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | **One codebase.** MK Jewels is a *dedicated install* of the same product: its own Supabase projects and Vercel deployment, **not a tenant**, invisible to and uncontrollable by the Master Admin. | Forks die: every fix gets built twice and the copies drift (lesson from Odoo/ERPNext core edits). Dedicated install = GitLab Dedicated model. | Separate repo/fork; MK Jewels as tenant #1 |
| D2 | **One Supabase project per tenant company.** | 1–5 companies in year 1; hard isolation; easy suspend/export/delete; one company's bug can't leak into another. | Shared DB with `tenant_id` (revisit only if more than about 20 tenants) |
| D3 | **Jewellers only in year 1.** | The CRM is a jewellery-specific parity port; generic retail is a separate project. | "Jewellery + other retail" now |
| D4 | **Master Admin = separate control-plane Supabase project + admin site.** Tenant DBs keep `super_admin` meaning *company owner*; the master is never added to tenant role enums. | Clear separation; no cross-tenant role in tenant DBs. | Master as a user inside each tenant |
| D5 | **Suspension is enforced server-side** (a `platform_status` row checked by RLS/RPCs/Edge Functions/cron), not just in the UI. | AGENTS.md rule: a hidden UI is not security. | Frontend status check only |
| D6 | **Routine master actions go through narrow, audited RPCs.** Migration rollout uses the Supabase Management API / DB credentials held only in the control plane (never in clients). MFA on the master site. | Least privilege, plus the unavoidable need to migrate N projects. | Service-role key as a general master login |
| D7 | **Cleanup before SaaS, limited to what blocks SaaS or is risky.** Ugly-but-working code stays. No rewrite. No performance work without measured evidence. | Unbounded "modernise everything" never finishes. | 7-stage full modernisation programme |
| D8 | **Every change leaves MK Jewels behaving identically.** MK specifics become per-install config or an "MK add-on", never deleted. MK may lag SaaS releases. | MK production is live and must be protected. | — |
| D9 | **Migrations are never edited, renumbered or deleted.** Fix forward. Later, a *schema baseline* for **new** tenant projects only. MK keeps full history. | Production already ran them; rewriting causes drift. | Squashing or renumbering history |
| D10 | **Work happens in a git clone (`C:\JewelOS-SaaS`)** on `saas/*` branches, merged to `main` only in small MK-safe PRs. | `main` deploys MK Jewels; the original folder has many concurrent sessions. | Plain folder copy |

## 3. Current system (verify)
- **Monorepo:**
  - `apps/web` (React 18 + Vite; deployed on Vercel project `mkjewels-os`);
  - `apps/mobile` (Expo; Android APK shipped via GitHub Releases + in-app update prompt, only
    through `scripts\release-mobile.ps1`, see `docs/MOBILE_RELEASE_GUIDE.md`; releases are
    batched);
  - `packages/core` (pure business rules, RBAC), `packages/api-client`, `packages/data`,
    `packages/crm-ui`, `packages/ui-tokens`;
  - `supabase/` (migrations, pgTAP tests, Edge Functions);
  - `supabase-crm/supabase/` (the CRM project: 34 timestamp-named migrations, 21 pgTAP files,
    5 Edge Functions) and `supabase-crm/apps-script`.
- **Two live Supabase projects for MK Jewels:** JewelOS (users and internal records; ref starts
  `yima`, name `jewelos-prod`) and CRM (client database), connected by an audited two-way
  outbox/inbox sync (roster JewelOS → CRM, walk-in → JewelOS task, Apps Script walk-in feed).
  CRM live since 2026-10-06.
  - **Open question:** does a tenant get two projects, or does the CRM become an optional
    module in one project?
- **Multi-tenant groundwork:**
  - `tenants` table in `0001`; 188 migration files reference `tenant_id`; RLS uses
    `current_tenant_id()`.
  - **Security finding:** policies follow the pattern
    `tenant_id = current_tenant_id() or is_super_admin()`, and `is_super_admin()` checks role
    only, not tenant (defined in `0001_init_schema.sql` line 688, redefined in `0002`; the exact
    pattern appears 15× in 3 files and `is_super_admin()` is used in 8 files; the same role-only
    check exists in `crm.is_super_admin()` (`0185`) and the CRM project's
    `public.is_super_admin()`).
    That's harmless with one company per project, but must be fixed.
  - Groundwork is not full isolation. Also audit Storage paths, Edge Functions, cron/background
    jobs, integrations, realtime and caches.
- **Migrations:**
  - `origin/main` has 233 files up to `0238`, with no duplicate numbers. Gaps come from
    renumbering.
  - Heavy redefinition (`assert_fms_flow_publishable` 13×, `resolve_fms_stage_assignees` 11×).
    Several files are over 1,000 lines (`0005`, `0084`, `0183`, `0185`).
- **Branch hygiene in the original repo:**
  - 53 local branches (45 already merged into `origin/main`) and 22 worktrees.
  - Parallel branches picking "next number" caused collisions.
  - `feat/department-section-access` holds `0213`–`0217` copies identical to `main`'s
    `0221`–`0225`, plus `0231`–`0233` with the same names as `main`; it must not merge as-is.
    The original checkout also has 277 uncommitted changes.
- **Repo hazard:** `supabase/.temp/linked-project.json` is **tracked in git** (it is in `.gitignore`,
  which does not untrack it) and links to `jewelos-prod`. Any clone arrives pointed at production.
- **Code smells:**
  - `apps/web/src/pages/UserManagementPage.tsx` (about 1,100 lines);
  - `packages/crm-ui/src/components/walk-in-form.tsx` (about 1,100);
  - `RecurringTodoPage.tsx` (about 820);
  - task API duplicated (all 25 exports of the web file exist by name in the data package) in
    `packages/data/src/tasks/api.ts` and
    `apps/web/src/features/tasks/api.ts`.
- **Safety net:** 137 pgTAP files (+21 in the CRM project), 311 unit test files,
  `.github/workflows/ci.yml`.
- **Owner's testing habit:** the owner tests on production, not locally. For SaaS, a
  staging/Demo Co project is mandatory.
- **Privacy:** real CRM/customer data never appears in chat, Git or terminal output (counts
  only).
- **Rule-file hazard:** `AGENTS.md`, `CLAUDE.md`, `PROJECT_HANDOFF.md` and
  `PRODUCTION_SWITCH_PLAYBOOK.md` name `C:\Users\MIS\Downloads\MKJewelOS` as the only repo.
  Every executor prompt overrides this until an MK-safe PR updates them.

## 4. MK-specific inventory (start list — the audit completes it)
- The "MK Jewels" name in 21 web/mobile/package source files, 12 JewelOS migrations and 4
  CRM-project migrations.
- `scripts/release-mobile.ps1` pins the production Supabase host.
- 26 files use `MKC-` / `MKF-` / `MKREF-`.
- `mk-jewels-logos/`.
- CRM `MKC-` / `MKF-` / `MKREF-` IDs.
- Apps Script walk-in feed (`crm-walkin-ingest`) and Runo push (`crm-runo-push`).
- The CRM parity-with-original rule and its own palette.
- WhatsApp/notification templates, report headers, fixed department/designation names, roster
  import CSV headers (to be confirmed).

## 5. Operating model
- **Owner:** decides product questions, runs commands, approves gates, is present for every
  hosted action.
- **Orchestrator (one chat):** reads the code, never edits. Gives numbered steps and executor
  prompts. Reviews executor output against acceptance criteria. Keeps this file's Status
  current (the owner commits the updates). Pushes back when something is wrong.
- **Executors (new chat per task):** one task, own branch, report back in the fixed format.
  They never choose their next task.
- **Rules:**
  - At most 2 open `saas/*` branches.
  - **The orchestrator assigns migration numbers.**
  - No hosted command (`--linked`, `db push`, deploys, secrets) without the owner's explicit
    go-ahead and `PRODUCTION_SWITCH_PLAYBOOK.md`.
  - Secrets only through hidden `Read-Host -AsSecureString`, never pasted into chat.
  - Always state the target project ref before a hosted command.
  - Windows: `pnpm.cmd`, `supabase.cmd`.
  - No `saas/*` branch is pushed until Vercel preview deployments are confirmed not to use
    production variables.

## 6. Phases
- **Phase 0 — Safe setup.**
  - Prove the clone can't reach production: no `.env`, no `supabase/.temp`, no Vercel link.
  - Decide what to do about the tracked `linked-project.json`.
  - Agree the rules.
  - Advise on stale branches and worktrees in the original repo (the owner decides).
  - **Gate:** the clone is isolated, and the rules are agreed.
- **Phase 1 — Ground truth (read-only).**
  - Production applied-migration list vs `main`, for both projects.
  - Create the staging/Demo Co project and build it from migrations.
  - Schema diff vs production.
  - **Gate:** a drift report, and staging rebuilds with no manual fixes.
- **Phase 2 — Audit (read-only executor).**
  - At most 40 ranked findings (P0–P3). Each gives a file reference, evidence, impact, fix,
    verification and regression risk.
  - Categories: security and tenant isolation, rebuildability, MK-specific code, duplication,
    dead code, oversized modules, integrations.
  - **Gate:** the owner approves the fix list.
- **Phase 3 — Cleanup.**
  - One finding per PR.
  - Characterization test, then refactor, then regression test.
  - Verified identical on MK production with an owner checklist.
  - **Gate:** approved P0/P1 findings closed.
- **Phase 4 — Schema baseline** for new projects.
  - **Gate:** a baseline-built project equals a history-built project.
- **Phase 5 — De-MK** into settings plus an MK add-on.
  - **Gate:** MK unchanged, and Demo Co shows nothing MK-specific.
- **Phase 6 — Control plane:**
  - company registry (name, employees, plan, status, project ref, URL, anon key);
  - server-enforced suspend/resume;
  - provisioning script (create project → baseline → seed tenant, branches, departments,
    dropdowns → invite the company super admin → register);
  - migrate-all-tenants script;
  - audit log;
  - MFA.
  - **Gate:** Demo Co provisioned, suspended and resumed end to end.
- **Phase 7 — Tenant access and pilot:**
  - company code or subdomain at login, which looks up that tenant's Supabase URL and anon key;
  - Android company picker;
  - onboarding wizard (details, branches, departments, roster CSV via the existing roster
    importer, first super admin);
  - first pilot jeweller.
  - **Gate:** 2 weeks with no cross-company issue.

## 7. Open questions (decide when the phase needs them)
- CRM per tenant: a second project, or one project? (Phase 1–2)
- Product name/brand for tenants and the domain (`*.jewelos.app`?) (Phase 5)
- Whose Supabase org hosts tenant projects; region/data residency (India); per-tenant cost
  (Phase 6)
- Pricing, trial/free plan, billing (Phase 7)
- Per-tenant integrations: WhatsApp/notifications provider, Ask Kiara AI keys and usage limits,
  Google Sheets (Phase 5–6)
- Backups and restore per tenant (Phase 6)
- One Android app for all tenants vs per-tenant builds (Phase 7)

## 8. Executor prompt template
Each executor prompt contains:
- Goal (1 sentence);
- Context ("read AGENTS.md and docs/saas/SAAS_MASTER_PLAN.md first" plus the needed facts);
- Branch name;
- Files in scope;
- Forbidden (hosted commands, editing applied migrations, changing MK behaviour unless that is
  the task, secrets, real customer data);
- Steps;
- Acceptance criteria;
- Verification commands;
- Report format (what changed, test output, risks, `git status`, commit hash).

Read-only tasks say "make no changes."

## 9. Status
- **Current phase:** 0 — Safe setup
- **Done:** fresh clone at `C:\JewelOS-SaaS` on `saas/setup`; no `.env` copied; `pnpm install`
  done. 2026-10-15: orchestrator verified sections 3–4 (corrections applied); read-only
  isolation checks passed (no `.env*` except examples, no `supabase/.temp` or
  `supabase-crm/supabase/.temp`, no `.vercel`, no prod URL/key in app source); tracked
  `supabase/.temp/linked-project.json` removed by commit on `saas/setup` (not pushed).
- **Next:** Phase 0 step 2 — owner reports Vercel Preview env-var scope; orchestrator sets the
  push rule and the rules for executors; then branch/worktree advice for the original repo.

## 10. Decision log
| Date | Decision |
|---|---|
| 2026-10-15 | D1–D10 agreed (owner delegated D1 and D10 to the orchestrator's recommendation) |
