# JewelOS SaaS roadmap (master plan)

Status: active. Owner: Sreejith (MIS). Orchestrator: Claude.
Every agent working on SaaS or cleanup reads this file first.
Change it only on an owner decision, and record the date.

## Owner decisions (2026-10-15)

1. **One codebase.** MK Jewels is a *dedicated install* of the product: its own
   Supabase projects and Vercel deployment. It is **not** a tenant and is
   **not** visible to, or controllable by, the master admin. No fork, no copy.
2. **Tenants are future companies.** Each tenant company gets its own Supabase
   project. The master admin ("platform owner") is a separate control-plane
   project that only the owner can use.
3. **Year 1:** jewellers only, 1–5 companies.
4. **Cleanup comes before SaaS**, and is limited to what blocks SaaS or is
   risky. Code that is ugly but works is left alone.
5. **Every change leaves MK Jewels behaving identically.** MK-specific
   behaviour (branding, `MKC-`/`MKF-`/`MKREF-` IDs, Apps Script walk-in feed,
   Runo, CRM parity rules) becomes per-install configuration or an MK add-on.
   It is never deleted.

## How work runs

- **The orchestrator (Claude in this repo)** owns this plan. It writes one task
  prompt at a time, reviews every result against its acceptance criteria, and
  decides what merges.
- **Executor agents** (Codex, Claude sessions, subagents) each get exactly one
  task prompt, in their own worktree, on their own branch. A task names:
  - the files in scope;
  - the forbidden actions;
  - the acceptance checks;
  - the evidence to report.

  Executors never pick their own next task.
- **Migration numbers are assigned by the orchestrator** at merge time, never
  chosen by an executor. This rule exists because parallel branches have
  already collided: two `0221_*` files, two `0228_*` files, and one Kiara cron
  migration that appears as both `0221` and `0227`.
- **At most 2 SaaS/cleanup branches open at once.** Merge or delete a branch
  before opening another one.
- **Hosted actions** (anything `--linked`, deploys, secrets) follow
  `PRODUCTION_SWITCH_PLAYBOOK.md`, with the owner present.
- **A phase ends only when its gate passes.** The orchestrator reports the gate
  evidence and the owner approves it.

## Phases

### Phase 0: Stop the bleeding
- Inventory every open branch and worktree (22 worktrees and about 18
  `feat/*` branches on 2026-10-15). Classify each as merged, merge-now,
  park, or delete.
- Finish or freeze the in-flight work: CRM Sheets 2-way sync, Ask Kiara
  Android release, the department-section-access branch.
- Adopt the rules in "How work runs".

**Gate:** at most 3 unmerged branches remain, each with a written owner and
purpose, and `main` is green in CI.

### Phase 1: Ground truth (read-only)
- Compare the migrations production has actually applied
  (`supabase migration list --linked`, owner present) with the files on `main`,
  for both the JewelOS project and the CRM project.
- Build a fresh staging project from `main`'s migrations, then diff it against
  production. Staging later becomes the "Demo Co" tenant.

**Gate:** a written drift report, and staging rebuilds from migrations with no
manual fixes.

### Phase 2: Audit (read-only)
- One ranked findings list, at most 40 items. Each item gives a file
  reference, evidence, impact, a proposed fix, a verification method and a
  priority.
- Categories:
  - security and tenant isolation (e.g. `is_super_admin()` not scoped to a
    tenant);
  - rebuildability of the database;
  - MK-specific code;
  - duplication (e.g. `packages/data/src/tasks/api.ts` vs
    `apps/web/src/features/tasks/api.ts`);
  - dead code;
  - oversized modules.

**Gate:** the owner approves the list and which items get fixed.

### Phase 3: Cleanup
- Small PRs on `main`, one finding each. Every PR keeps MK Jewels identical,
  ships to MK production, and passes the owner's checklist.

**Gate:** all approved P0/P1 findings are closed.

### Phase 4: Schema baseline
- A single baseline schema for **new** projects, generated from the clean
  schema. MK Jewels keeps its migration history, with the baseline marked as
  already applied.

**Gate:** a new project built from the baseline matches a project built from
the full migration history.

### Phase 5: De-MK the product
- Move branding and MK-specific behaviour into per-install settings or an MK
  add-on.

**Gate:** MK Jewels looks and behaves the same, and Demo Co shows no MK
branding or MK-specific behaviour.

### Phase 6: Control plane
- A master admin project and site:
  - a company registry;
  - server-enforced suspend/resume;
  - a provisioning script (create project → baseline → seed → invite the
    company's super admin);
  - a script that applies migrations to every tenant;
  - an audit log;
  - MFA.

**Gate:** Demo Co is provisioned, suspended and resumed end to end by the
script.

### Phase 7: Tenant access and pilot
- Company code or subdomain at login, the Android company picker, an
  onboarding wizard (departments, branches, roster CSV, first super admin),
  then the first pilot jeweller.

**Gate:** the pilot company runs for 2 weeks with no cross-company issue.

## Decision log

| Date | Decision |
|---|---|
| 2026-10-15 | All items in "Owner decisions" above |
