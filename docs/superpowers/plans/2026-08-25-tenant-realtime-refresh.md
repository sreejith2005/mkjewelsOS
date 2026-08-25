# Tenant Realtime Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update every active JewelOS web surface promptly when an authorized tenant-scoped operational change occurs, without a browser refresh.

**Architecture:** A new RLS-protected `tenant_realtime_events` table carries only tenant id plus a safe topic: `tasks`, `fms`, `crm`, `forms`, `organization`, or `settings`. Database triggers emit a topic signal after operational writes. A strict-mode-safe shared browser subscription debounces signals and reloads each page through its existing RLS-protected loader; event payloads are never rendered.

**Tech Stack:** Postgres/Supabase Realtime/RLS/pgTAP; React 18/Vite; TypeScript; Vitest; `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-08-25-tenant-realtime-refresh-design.md`

## Global constraints

- Work only in the nested `jewelos` repository and preserve unrelated work.
- Add forward-only `0102_tenant_realtime_refresh.sql`; never edit applied migrations.
- The event is a wake-up signal only. Rendering always reloads through existing RLS/RPC contracts.
- No customer, task, profile, form-answer, or other business payload enters the event table.
- Browser roles cannot write the event table. Realtime delivery uses a
  tenant-scoped `SELECT` policy; the application never directly queries it.
- Push Git changes only. Do not use `--linked`, deploy Vercel, or deploy Edge Functions.

### Task 1: Secure database signal contract

Files: create `supabase/migrations/0102_tenant_realtime_refresh.sql`; create `supabase/tests/0102_tenant_realtime_refresh.test.sql`.

- [ ] Write pgTAP tests that initially fail for the missing signal table/function: table and topic constraint exist; anonymous, cross-tenant, and browser inserts are denied; same-tenant active profile can receive its own signal; invalid topics are denied; no payload column exists.
- [x] Run `supabase.cmd test db --local supabase/tests/0102_tenant_realtime_refresh.test.sql` and record the expected missing-contract failure.
- [x] Create `tenant_realtime_events(id bigint identity, tenant_id uuid, topic text, occurred_at timestamptz)`, RLS, minimal grants, a fixed-search-path owner-only `emit_tenant_realtime_event(uuid,text)` helper, and publication membership. Use only the six named topics.
- [ ] Run the focused pgTAP test and confirm all contract cases pass.
- [ ] Commit the migration and pgTAP test as `feat(realtime): add tenant event signal contract`.

### Task 2: Emit safe topic signals from operational writes

Files: modify `supabase/migrations/0102_tenant_realtime_refresh.sql` and `supabase/tests/0102_tenant_realtime_refresh.test.sql`.

- [ ] Add failing representative pgTAP assertions proving mutations emit `tasks`, `fms`, `crm`, `forms`, `organization`, and `settings` respectively.
- [ ] Run the focused pgTAP test and confirm missing triggers cause the expected assertion failures.
- [ ] Add minimal trigger functions with fixed search paths. Cover rendered task records (instances, assignees, watchers, checklists, attachments and task-linked forms), FMS runtime records (instances, stages, checklists, evidence/logs and linked forms), client/timeline/follow-up/assignment records, forms, availability/profile/branch/department/dropdown reference records, and tenant/branch/preferences/section-control settings. Parent lookups provide tenant ids for child rows. Do not attach import/staging tables not rendered in the app.
- [ ] Run focused pgTAP plus `supabase.cmd db lint --local --level warning` and confirm the new contract has no failure/warning.
- [ ] Commit as `feat(realtime): signal operational data changes`.

### Task 3: Shared Strict-Mode-safe browser subscription

Files: create `apps/web/src/features/realtime/api.ts`, `apps/web/src/features/realtime/api.test.ts`, `apps/web/src/features/realtime/useTenantRealtimeRefresh.ts`, `apps/web/src/features/realtime/useTenantRealtimeRefresh.test.tsx`.

- [ ] Write failing Vitest tests for `subscribeToTenantRealtime(tenantId, topics, listener)` sharing one channel, topic filtering, delayed final unsubscribe, and for `useTenantRealtimeRefresh` coalescing a burst into one reload/cancelling timers on unmount.
- [ ] Run `pnpm.cmd --filter web test -- api.test.ts useTenantRealtimeRefresh.test.tsx` and confirm imports fail because the feature is absent.
- [ ] Implement a single channel per tenant using `INSERT` changes filtered to the tenant event table, runtime topic validation, listener fan-out, and the existing Notifications delayed teardown pattern. Implement a sub-second default debounce hook that calls the supplied existing refresh function and cleans up safely.
- [ ] Run focused tests and confirm all pass.
- [ ] Commit as `feat(web): add tenant realtime refresh hook`.

### Task 4: Scope page refreshes to their data dependencies

Files: modify `apps/web/src/App.tsx`, `apps/web/src/features/home/HomeView.tsx`, `apps/web/src/features/analytics/DashboardView.tsx`, `apps/web/src/pages/TasksPage.tsx`, `apps/web/src/pages/RecurringTodoPage.tsx`, `apps/web/src/pages/FMSTasksPage.tsx`, `apps/web/src/pages/FMSBuilderPage.tsx`, `apps/web/src/pages/CRMPage.tsx`, `apps/web/src/pages/FormsPage.tsx`, `apps/web/src/pages/AvailabilityPage.tsx`, `apps/web/src/pages/UserManagementPage.tsx`, `apps/web/src/pages/TeamDirectoryPage.tsx`, `apps/web/src/pages/DropdownMasterPage.tsx`, `apps/web/src/features/settings/SettingsView.tsx`, `apps/web/src/features/reports/ReportsView.tsx`; create `apps/web/src/features/realtime/pageWiring.test.tsx`.

- [ ] Write failing page-wiring tests proving Tasks reload after `tasks`; AppShell rereads section availability after `settings`; and representative Home, FMS, CRM, and Forms views reload only on their respective topics.
- [ ] Run `pnpm.cmd --filter web test -- pageWiring.test.tsx` and confirm the second-load assertions fail before subscription wiring.
- [ ] Add hook calls with these topic sets: shell=`settings`; Home/Dashboard=`tasks,fms,crm,organization,settings`; tasks/recurring=`tasks,forms,organization`; FMS=`fms,forms,organization`; CRM=`crm,organization`; forms=`forms,tasks,fms,organization`; availability/users/dropdowns/settings=`organization,settings`; reports=`organization,settings`. Preserve existing local refreshes/error states and the Developer Mode fail-open read behavior.
- [ ] Run targeted page wiring tests, then `pnpm.cmd --filter web test`; confirm both pass.
- [ ] Commit as `feat(web): refresh live operational views`.

### Task 5: Verify, commit and push Git publication

Files: modify this plan by checking completed tasks; modify the spec only if implementation requires an approved design correction.

- [ ] Run `supabase.cmd db reset --local --no-seed`, focused `0102` pgTAP, DB lint, web tests, Turbo typecheck/build, and `git diff --check`. If Docker is unavailable, report database proof as blocked rather than implied.
- [ ] Run a local two-session authenticated browser smoke: assign/alter a task, FMS work, CRM follow-up and Developer Mode in session A; confirm relevant session-B route state changes without reload. Do not expose personal/customer data.
- [ ] Stage named reviewed paths only, inspect staged diff and credential-safe scan, then commit as `feat: refresh tenant operational views`.
- [ ] Run `git push origin main` and verify `git status --short --branch`. This proves Git publication only; hosted migration and web deployment stay unapplied.

## Plan self-review

Tasks 1–2 implement and prove a no-payload, tenant-safe signal from every rendered operational domain. Task 3 has the shared client contract; Task 4 scopes it across the current web pages; Task 5 separates local, Git, database and rendered-browser proof. Topic names and interface names are consistent throughout.
