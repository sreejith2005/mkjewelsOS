# AGENTS.md — JewelOS Build Instructions

Read this file completely before starting any task in this repo.

## What this repo is

`jewelos` is a **brand-new, from-scratch** implementation of JewelOS — a
multi-tenant jewellery-retail operations platform for MK Jewels. It is a
pnpm monorepo: `apps/web` (React+Vite), `apps/mobile` (Expo/React Native),
`packages/core` (shared business logic), `packages/api-client` (Supabase
wrapper), `packages/ui-tokens` (shared design tokens), `supabase/` (SQL
migrations + edge functions).

## Where the sibling reference codebases live

This repo sits inside a parent folder alongside two OLDER, INCOMPLETE
prototype codebases:

```
MKJewelOS/
├── jewelos/                 ← THIS repo. The only one we write code into.
├── mkjewelos-base44/        ← Reference only. Base44 no-code export.
└── mkjewelsos/jewelos/jewelos/  ← Reference only. Earlier Codex attempt.
```

**Both sibling folders are READ-ONLY REFERENCE MATERIAL. Never edit, import
from, or copy files out of them. Never add them as dependencies.**

They exist because they encode two prior attempts at the same product spec,
and both are useful for different reasons:

- `mkjewelos-base44/` — the DEEPER, more complete feature spec. Has 100+
  components covering FMS builder, forms engine, notifications engine,
  dashboards, resignation workflow, etc. Read this first when you need to
  know "what should this feature actually do" — it is the most detailed
  implementation of the business logic, even though it's built on Base44's
  mock SDK (`globalThis.__B44_DB__`) and has NO real backend. Treat its
  entity shapes, page flows, role-permission rules, and component logic as
  the source of truth for FEATURE BEHAVIOR — but never copy its code
  structure, its mock client pattern, or its Base44-specific imports.

- `mkjewelsos/jewelos/jewelos/` — a simpler, earlier Codex-built prototype.
  Same product, thinner feature set, also 100% in-memory mock data
  (`src/lib/store.jsx` + `src/data/*.js`). Useful for a second opinion on
  page/route naming and role-menu structure, and as a sanity check when the
  Base44 version seems overbuilt for a given feature.

**Before implementing any feature, search both reference folders for the
relevant page/component and read it in full.** Example: before building the
Task delegation UI, read `mkjewelos-base44/src/components/tasks/
DelegateTaskSheet.jsx` AND `mkjewelsos/.../src/components/DelegateSheet.jsx`,
compare them, then implement the real (database-backed) version in
`jewelos/apps/web` using whichever behavior is more complete/correct. If
they disagree, prefer the base44 version's business rules but flag the
disagreement in your output summary so the human can decide.

## Non-negotiable architecture rules

1. **No mock data patterns.** Every entity read/write goes through
   `packages/api-client` against the real Supabase Postgres database defined
   in `supabase/migrations/`. Never reintroduce a `globalThis.__DB__`
   fallback, a `data/*.ts` hardcoded array, or a React Context acting as a
   fake database. If you need seed/sample data, write it as a SQL seed
   script in `supabase/migrations/` or `supabase/seed.sql`, not in
   application code.
2. **RLS is the real permission boundary.** Every table with tenant_id must
   have Row Level Security enabled. Frontend role-hiding (menus, buttons) is
   UX only — it is never the only enforcement. When adding a new table,
   add matching RLS policies in the same migration, following the pattern
   in `0001_init_schema.sql`.
3. **Shared logic lives in `packages/core`, not duplicated per-app.** SLA/
   delay calculation, RRULE recurrence expansion, RBAC permission checks,
   and the FMS state machine must be written once in `packages/core` (pure
   TypeScript, no React) and imported by both `apps/web` and `apps/mobile`.
4. **Strict TypeScript everywhere.** No `.jsx`, no implicit `any`, no
   suppressing type errors with `@ts-ignore` without a comment explaining
   why.
5. **Design tokens come from `packages/ui-tokens`.** Never hardcode a hex
   color in a component. Primary gold is `#D9B875` (extracted from the
   actual MK Jewels logo at `jewelos/mkjewels-logos/`) — do not use a
   generic gold like `#D4AF37` unless explicitly told to. No blue anywhere
   in the UI.
6. **Every sensitive write creates an audit_logs row.** User edits, working
   status changes, resignation actions, task reassignment, FMS flow
   create/edit/archive, dropdown master changes, form edits, CRM edits,
   report exports, permission changes — all of these must insert into
   `audit_logs` in the same transaction/request as the change.
7. **Every business table follows the tenant/branch/department + audit
   column convention** already established in `0001_init_schema.sql`
   (tenant_id, branch_id where applicable, department_id where applicable,
   created_by, updated_by, created_at, updated_at). Match this convention
   for any new table.

## UI reference

Product screenshots showing the intended mobile task-list UX (date-range
filter, status pills, floating + button, 5-tab bottom nav: Dashboard / My
Tasks / My Apps / Delegated / More, and the "Assign New Task" bottom-sheet
flow with chip-style Users/Due Date/Priority/Category/In Loop selectors)
were provided directly to the human's AI orchestrator (not stored in this
repo). When a task description references "the reference screenshots,"
ask the human to confirm the exact layout rather than guessing.

## Workflow expectation

Tasks will be given to you one phase at a time by the human, based on
instructions from their AI orchestrator (a separate conversation you don't
have access to). Each task will be scoped narrowly. Do not attempt to build
unrelated modules ahead of schedule even if you see them referenced in the
Base44 reference folder — build only what the current prompt asks for, but
feel free to read ahead in the reference folders to understand how a
current feature is expected to eventually connect to a future one.

At the end of every task, report:
- Files created/changed
- Any deviation from the reference codebases and why
- Any TODO or stub left for a later phase
- Exact commands you ran to verify it builds/boots, and their output
