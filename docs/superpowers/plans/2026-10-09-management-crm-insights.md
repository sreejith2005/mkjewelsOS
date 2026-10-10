# Management and CRM Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the owner selects delegated execution. Steps use checkbox syntax for tracking.

**Goal:** Deliver readable, actionable, customizable management and CRM dashboards with equivalent web, mobile web, and Android behavior.

**Architecture:** Keep internal analytics in JewelOS and CRM analytics in the CRM project. Add compatible versioned aggregate/detail RPCs with shared typed filters, metric definitions and insight rules. Implement compact overview and analysis tabs, using existing permissions, session bridges, chart primitives and persisted work destinations.

**Tech Stack:** TypeScript, React/Vite, Expo/React Native, Supabase/Postgres, Vitest, pgTAP; existing SVG/DOM and react-native-svg renderers.

**Spec:** `docs/superpowers/specs/2026-10-09-management-crm-insights-design.md` (owner approved 2026-10-09).

## Global Constraints

- At most six overview headline cards, five attention findings, two overview charts.
- Four to six summary cards and two explanatory charts per CRM view.
- 44px touch controls; essential values visible without hover.
- Zero denominators yield 'No data'; absent deadlines yield 'Not applicable'.
- Existing negative pending/delayed score conventions stay compatible.
- CRM read remains company-wide for active CRM users; branch write rules remain intact.
- No composite employee performance score, generated recommendations, fake application records, revenue inferred from visits, or copied CRM customer records.
- All scope decisions are server enforced; dashboard authority and module permission remain separate.
- CRM implementation only in `C:\crm`; all other work at the authoritative JewelOS root. Preserve pre-existing dirty changes and review integration diffs.
- Forward migrations only. Names below reserve 0202/0203 because CRM work already includes 0201; recheck both worktrees before creating files and advance names if occupied.
- No new chart dependency; no Storage change or historical backfill in this plan.
- Stop publication if required database, staging, browser, or Android device gates fail.

## Review Focus

- Filters change during an in-flight request: an old response must not populate the new scope (Task 5/6 tests).
- An employee changes department or becomes inactive: historical work remains measurable, with the grouping basis disclosed (Task 2 tests).
- Two people save a view with the same name or a stale version: ownership isolates users and stale updates fail (Task 4 tests).
- A CRM session expires while internal data succeeds: CRM retries through the bridge and shows its own failure state (Task 8 tests).
- Long date ranges and multi-assignee work: counts reconcile and chart labels stay readable without summing assignments as distinct tasks (Task 1/2/7 tests).

## File responsibility map

- `packages/core/src/analytics/insightsTypes.ts`, `insightsFilters.ts`, `insights.ts`, `insightsCatalog.ts`: versioned contracts, filter codecs, deterministic findings, module descriptors.
- `packages/core/src/analytics/crmInsights.ts`: pure CRM status classification and rate definitions shared with CRM UI.
- `supabase/migrations/0206_management_insights.sql`: internal scope/filter helpers, aggregates, drilldowns.
- `supabase/migrations/0207_dashboard_saved_views.sql`: personal configuration persistence and audited writes.
- `packages/data/src/analytics/insightsApi.ts`: typed internal RPC I/O shared by web/native.
- `apps/web/src/features/analytics/insights/`: responsive views and interactions; existing DashboardView becomes the entry adapter.
- `apps/mobile/src/features/analytics/`: native views consuming the same contracts; existing DashboardScreen remains the entry.
- CRM worktree `supabase-crm/supabase/migrations/20261010000100_crm_insights.sql`: CRM-only aggregate/detail contracts.
- CRM worktree `packages/crm-ui/src/components/dashboard-insights/`: CRM-only rendered views.
- `docs/MANAGEMENT_INSIGHTS_PARITY.md`: action-level parity and verification evidence.

## Task 1: Shared filters, metric definitions, and insight contracts

**Files:** Create the five core `insights*` files and `crmInsights.ts` above; modify `packages/core/src/analytics/index.ts`; create `packages/core/src/analytics/insights.test.ts` and `crmInsights.test.ts`.

**Interfaces:**
- `InsightsFilter`: version 1, tab (`overview|tasks|workflows|people|crm`), preset, inclusive local `from/to`, optional branch/department/designation/employee UUIDs, task type/category/priority/status/source, flow/version/stage; groupBy (`branch|department|designation|employee|task_type|workflow`).
- `InsightsPayload`: version, generatedAt, timezone, authorizedScope, moduleStates, metrics (value/numerator/denominator/previous/basis), trend, groups, coverage/missingness metadata.
- `InsightsDetailFilter`: base filter plus module, metricKey, optional groupId, offset (>=0), limit (1..100; default 25).
- `InsightsDetailPage`: rows, total, offset, limit; row destinations are a typed union of task, FMS starter/runtime, form review, people/coverage, or CRM record identity.
- `parseInsightsFilter(input: unknown): InsightsFilter`; `encodeInsightsSearch(filter): string`; `decodeInsightsSearch(search): InsightsFilter`.
- `buildAttentionFindings(payload: InsightsPayload): AttentionFinding[]` with stable id, severity, evidence and detail selector; maximum five.
- `classifyCrmVisitOutcome(status: string | null): CrmVisitOutcome` and `crmPurchaseRate(counts): {value:number|null; numerator:number; denominator:number; unknown:number}`.

- [ ] Write `validates_ranges_and_uuid_scope`: reversed/custom dates, unknown keys, invalid UUIDs and unsupported enums are rejected; maximum custom interval is 366 local dates.
- [ ] Write `round_trips_filters_without_private_values`: URL roundtrip and default restoration; filters do not include contact data or auth material.
- [ ] Write `keeps_cohort_and_throughput_separate`: two due tasks, one completed plus three older completions produce 50% cohort completion and four period completions.
- [ ] Write `handles_missingness_and_multi_assignees`: zero denominator is null; unknown deadline is inapplicable; one task with two doers is one distinct task and two assignments.
- [ ] Write `crm_outcomes_reconcile`: every stored status maps to exactly one primary category; unknown stays visible; overlapping service/purchase flags never become a composition denominator.
- [ ] Run `pnpm.cmd --filter @jewelos/core test -- src/analytics/insights.test.ts src/analytics/crmInsights.test.ts`; confirm failing behavior, implement the named interfaces, rerun to passing.
- [ ] Review and commit only the named core paths after whitespace/staged scans.

## Task 2: Authorized internal aggregates and matching detail predicates

**Files:** Create `supabase/migrations/0206_management_insights.sql`, `supabase/tests/0206_management_insights.test.sql`; update `packages/api-client/src/database.types.ts` using the repository generation workflow.

**Interfaces:** `get_management_insights_v1(p_context jsonb) returns jsonb`; `get_management_insight_records_v1(p_context jsonb,p_metric text,p_group_id text default null,p_offset integer default 0,p_limit integer default 25) returns jsonb`; `get_management_insights_options_v1(p_context jsonb) returns jsonb`.

- [ ] Trace latest definitions of `current_profile`, `assert_reporting_actor`, reporting context/scope helpers, effective task deadline, FMS assignment, forms review, availability and coverage. Inventory callers before reusing helpers; do not alter old reporting context to accept new filters globally.
- [ ] Write pgTAP `internal_insights_scope_denials`: anonymous/inactive/no-dashboard deny; manager foreign branch denies; other tenant never appears; HR has permitted people and personal operations; configured authority follows server resolver; disabled modules cannot leak aggregates/details.
- [ ] Write `cohort_and_backlog_reconcile`: due cohort vs completion activity, rejected tasks, undated backlog, revised deadlines, multiple assignees, departed/inactive historical employees, shared departments, previous-period boundaries.
- [ ] Write `group_and_detail_totals_match`: each metric/group count equals the matching detail total, including FMS starter vs runtime identity and form-linked work; pagination has deterministic id tie-breaks.
- [ ] Implement strict private filter normalization and per-module scoped record queries used by both aggregate/detail RPCs. Dates use tenant timezone. Preserve prior RPC signatures and response fields.
- [ ] Use recorded work department/branch for organizational work groups, current employee designation for designation groups with a visible 'current designation' label; retain inactive historical assignees. Never claim historical designation without a stored snapshot.
- [ ] Return bounded authorized filter options; employee search is paginated and displays names only. Filter options must not enumerate out-of-scope identities.
- [ ] Return module access/unavailable states and real null/missingness metadata. Add query-plan-supported indexes only; pin search_path and revoke public/anon execution.
- [ ] Run local reset, `supabase.cmd test db`, and `supabase.cmd db lint --local --level warning`; document availability of Docker. Generate types and confirm typed RPC signatures.
- [ ] Review/commit only migration, test, and generated types after staged checks.

## Task 3: Shared typed API and request lifecycle

**Files:** Create `packages/data/src/analytics/insightsApi.ts`, `insightsApi.test.ts`; update `packages/data/src/analytics/index.ts`; web `apps/web/src/features/analytics/api.ts` imports the new API for insights only.

**Interfaces:** `fetchManagementInsights(filter: InsightsFilter): Promise<InsightsPayload>`; `fetchManagementInsightRecords(filter: InsightsDetailFilter): Promise<InsightsDetailPage>`; `fetchInsightsOptions(filter): Promise<InsightsOptions>`.

- [ ] Write tests for exact serialized filter and RPC arguments, validated payloads, denied/error propagation, null metrics, deterministic pagination, and no legacy CRM metric reads.
- [ ] Run `pnpm.cmd --filter @jewelos/data test -- src/analytics/insightsApi.test.ts` to failing; implement typed calls through `@jewelos/api-client`, with runtime shape validation and no unchecked `never` casts; rerun passing.
- [ ] Preserve old Home/dashboard APIs for installed clients. Review/commit named API paths.

## Task 4: Personal saved dashboard views

**Files:** Create `supabase/migrations/0207_dashboard_saved_views.sql`, `supabase/tests/0207_dashboard_saved_views.test.sql`, `packages/data/src/analytics/savedViews.ts`, `savedViews.test.ts`; update generated types and analytics exports.

**Interfaces:** `dashboard_saved_views` stores id, tenant_id, user_profile_id, name, config jsonb, record_version and timestamps. `save_dashboard_view_with_audit(p_id uuid,p_name text,p_config jsonb,p_expected_version integer) returns jsonb`; `delete_dashboard_view_with_audit(p_id uuid,p_expected_version integer) returns void`. Config: version 1, validated filter, ordered visible section keys, no metrics/records/tokens. Name trimmed 1..80 chars, at most 20 personal views, unique per-user case-insensitive name.

- [ ] Write reader/ownership tests, unauthenticated/inactive/cross-user/cross-tenant denied writes, direct write denial, schema validation, quota and stale-version rejection, transactional audit assertions.
- [ ] Implement own-row SELECT RLS and audited RPC writes using server actor; no browser-controlled owner/tenant. Do not replace or reinterpret existing user_preferences.
- [ ] Implement typed list/save/delete helpers with explicit optimistic-concurrency errors.
- [ ] Run local database suite and `pnpm.cmd --filter @jewelos/data test -- src/analytics/savedViews.test.ts`; regenerate types; commit reviewed named paths.

## Task 5: Management web dashboard and actionable drilldowns

**Files:** Modify `apps/web/src/features/analytics/DashboardView.tsx`; create `insights/ManagementDashboard.tsx`, `InsightsFilters.tsx`, `InsightsSummary.tsx`, `InsightsCharts.tsx`, `InsightsRecords.tsx`, `SavedViews.tsx`, `useInsightsState.ts`, `ManagementDashboard.test.tsx`, `useInsightsState.test.ts` in that feature directory.

**Interfaces:** Components consume Tasks 1/3/4 contracts. Detail actions first open the matching analytics record drawer; record actions use existing task destinations and shared FMS work paths, with permission-aware navigation.

- [ ] Write tests for maximum overview density, switching focused tabs, dependent filter reset, back/forward restoration, malformed URL recovery, saved layout/reset, and definition/denominator visibility.
- [ ] Write `ignores_old_filter_response`: resolve old request after a newer filter and assert no stale-scope metrics or detail rows render. Test refresh/error with previous correctly labelled same-scope data.
- [ ] Write `opens_matching_records`: summary/chart/group/attention click sends matching server detail selector; task/FMS destinations retain exact assignment identities; denied module displays unavailable, never zero.
- [ ] Run `pnpm.cmd --filter web test -- src/features/analytics/insights/ManagementDashboard.test.tsx src/features/analytics/insights/useInsightsState.test.ts`; implement to pass.
- [ ] Build overview, Tasks, Workflows & Forms, People & Availability tabs using semantic tokens and direct chart labels. Grouped comparisons use top rows plus 'View all', sorted count/rate options and visible denominators; cap two charts.
- [ ] Implement collapsible mobile filter sheet, scoped group selection, paginated record drawer, keyboard/focus return, section ordering via buttons, save/delete/reset and copy-link.
- [ ] Browser verify 1440px, 768px, 390px, 320px; inspect no page overflow, large text, reduced motion and keyboard controls. Log exact evidence in parity document. Commit reviewed web paths.

## Task 6: Equivalent native management dashboard

**Files:** Modify `apps/mobile/src/screens/DashboardScreen.tsx`; create `apps/mobile/src/features/analytics/InsightsDashboard.tsx`, `InsightsFilters.tsx`, `InsightsCharts.tsx`, `InsightsRecords.tsx`, `dashboardModel.ts`, `dashboardModel.test.ts`; modify navigation types only if required for carrying typed drilldown state.

**Interfaces:** Same contracts, filters, saved views and detail endpoints as web; native task/work navigation stays centralized in existing navigation helpers.

- [ ] Write model tests for card/tab availability, filter parity, saved view state, overdue/undated drilldown, exact FMS identity, and stale request suppression.
- [ ] Run `npm.cmd --prefix apps/mobile run test -- src/features/analytics/dashboardModel.test.ts` to failing; implement to passing using shared data API and react-native-svg.
- [ ] Provide touch filters, small-screen cards, expandable comparisons and paginated details; no essential hover behavior. Preserve ordinary-user personal dashboard behavior.
- [ ] Run mobile typecheck/tests. Validate on connected Android: tap charts/findings, back navigation, rotation, TalkBack, large text, offline/refresh, and expired session. Record device evidence; absent device remains a release blocker.
- [ ] Review/commit named mobile paths and any required navigation changes.

## Task 7: CRM aggregate/detail contracts and CRM-only view

**Files in `C:\crm`:** Create `supabase-crm/supabase/migrations/20261010000100_crm_insights.sql`, `supabase-crm/supabase/tests/20261010_crm_insights.test.sql`, `packages/crm-ui/src/lib/crm-insights-api.ts`, `packages/crm-ui/src/components/dashboard-insights/CrmInsightsDashboard.tsx`, `CrmInsightsFilters.tsx`, `CrmInsightsCharts.tsx`, `CrmInsightsRecords.tsx`, `packages/crm-ui/tests/crm-insights.test.tsx`; modify existing dashboard page and CRM-project generated types. Integrate the reviewed core classifier from Task 1 without replacing dirty core changes.

**Interfaces:** `get_crm_insights_v1(p_context jsonb) returns jsonb`; `get_crm_insight_records_v1(p_context jsonb,p_metric text,p_group_id text default null,p_offset integer default 0,p_limit integer default 25) returns jsonb`; `get_crm_insights_options_v1(p_context jsonb) returns jsonb`. `CrmInsightsFilter`: period plus branch, saved CRM attribution, salesperson, lead source, visit type/outcome, tab (`visits|followups|clients|staff`). `CrmInsightsPayload` follows shared metrics/trend/groups/missingness structure but contains CRM-only measures.

- [ ] Inspect current dirty dashboard diff and CRM forward migrations/tests; preserve existing read-error and refresh handling. Verify visit event vocabulary, staff ids, lead conversion links and follow-up completion predicates from current schema before writing mapping tests.
- [ ] Write pgTAP for active global readers, inactive/anonymous/no-bridge denial, aggregate/detail reconciliation, deterministic pagination, exact visit vs interaction event distinction, unknown statuses and attribution, clients vs visit counts, date boundaries and duplicate source-event idempotency.
- [ ] Write conversion tests: creation-cohort leads with explicit client links; purchase-positive eligible visits; no conversion from follow-up text. Follow-up current backlog uses `not_bought_followup_status_is_done` and persisted due dates. Undated open follow-ups are separate.
- [ ] Implement private common predicates for aggregates/details; add bounded options and indexes justified by query plans. Use exact saved CRM attribution and salesperson ids. Preserve original status vocabulary and audited write workflows.
- [ ] Return disjoint exact-status primary outcome categories, separate overlapping service flags, unknown counts, previous-period measures and deterministic detail selectors. Returning-client calculation checks earlier durable visits and exposes imported-history limitations.
- [ ] Write UI tests for Visits & Outcomes, Follow-ups, Clients & Leads, Staff & Branches; filter combinations, summary/drilldown equality, partial/error/empty behavior, and no internal JewelOS widgets.
- [ ] Replace whole-history browser loading with aggregate RPC and paginated details. Use scoped CRM palette and existing router/refresh, client identifiers and links. Add outcome bars, activity trend and actionable follow-up lists; no revenue claims.
- [ ] Run CRM project local pgTAP from its project directory; `pnpm.cmd --filter @jewelos/crm-ui test -- tests/crm-insights.test.tsx tests/dashboard.test.ts`; typecheck and regenerate/check scoped CSS through existing scripts.
- [ ] Verify desktop/mobile web and Android CRM WebView with authenticated bridge, touch filters and back navigation. Review diff relative to both HEAD and the captured pre-task dirty state before staging only this task's work.

## Task 8: Management CRM summary and project-failure isolation

**Files:** Create `packages/crm-ui/src/analytics.ts` and public declaration/export for a lightweight CRM analytics adapter; create `apps/web/src/features/analytics/insights/CrmSummary.tsx`, `CrmSummary.test.tsx`; native create `apps/mobile/src/features/analytics/CrmSummary.tsx`, `crmSummaryModel.test.ts`; adapt existing CRM session provider only at its current call boundary, never introduce a second login.

**Interfaces:** `fetchCrmManagementSummary(filter: CrmInsightsFilter): Promise<CrmInsightsPayload>` accepts an authenticated CRM client/provider obtained from existing bridge. Expose it through a dedicated analytics package entry; do not import full CRM renderer into native. Summary opens the CRM-only dashboard with equivalent period/branch state.

- [ ] Inspect the latest two-project login bridge in the CRM worktree and its approved integration diff; preserve its owner project and token handling when bringing reviewed CRM changes into JewelOS. Never overwrite files wholesale from a dirty worktree.
- [ ] Write tests for no effective crm.view => no CRM request; expired exchange retries once through existing session mechanism; internal success plus CRM failure retains internal metrics; CRM summary/details never use old JewelOS tables.
- [ ] Map authorized branches using persisted project bridge mappings, never names; designation/employee selections that cannot map explicitly display unsupported scope rather than silently showing global CRM values.
- [ ] Fetch CRM independently and lazily, expose project-specific generated timestamps/partial state, and link filtered CRM dashboard destinations. Keep tokens and result rows out of URL/config persistence.
- [ ] Run focused web/native tests and existing embedded CRM bridge tests; verify Android summary and CRM WebView transition. Commit only reviewed adapter/integration paths.

## Task 9: Regression, parity, integration and release

**Files:** Create/update `docs/MANAGEMENT_INSIGHTS_PARITY.md`; update relevant handoff documents with actual evidence, not production-ready claims.

- [ ] Complete parity rows for filters, comparison, drilldown, record open, saved view, refresh, errors, denied scope, and CRM handoff across desktop web/mobile web/native. Each row records metric endpoint, persisted identity and observed result.
- [ ] Run core/data/web/CRM focused suites, then broader relevant suites; `pnpm.cmd exec turbo run typecheck --force --concurrency=1`, `pnpm.cmd exec turbo run build --force --concurrency=1`, `npm.cmd --prefix apps/mobile run typecheck`, `npm.cmd --prefix apps/mobile run test`, `git diff --check`.
- [ ] Run complete relevant pgTAP suites on both local projects. Recheck task/FMS/form submission and notification completion, CRM capture and follow-up writes, director authority/HR denial and ordinary user's prior behavior with controlled synthetic accounts.
- [ ] Complete authenticated browser and physical Android QA before publication; reconcile overview and record-detail counts on the same snapshot. Review query plans and bounded request volumes for year/custom ranges.
- [ ] Review branch/worktree integration and dirty changes; resolve only scoped conflicts, verify Git root, stage named paths, inspect staged diff, run staged whitespace and credential-safe scans; commit exact reviewed changes.
- [ ] Follow `PRODUCTION_SWITCH_PLAYBOOK.md` for staging and owner-visible hosted actions. Confirm each project link, migration ledger and `db push --linked --dry-run` before any apply. Deploy only reviewed web/function/schema changes and record distinct hosted verification.
- [ ] After all required native gates pass, follow the complete mobile guide, run `scripts/release-mobile.ps1` without `-Mandatory`, push release commit to `origin/main`, verify public latest.json versionCode and APK signature/download. If any gate fails, report the concrete blocker and keep the last verified release public.

## Plan self-review and handoff

All approved sections map to Tasks 1–9. Dependencies: 1 -> 2/7; 2 -> 3; 3/4 -> 5/6; 7 -> 8; all -> 9. Work is additive; no task/form/FMS completion rewrite or CRM data repair is proposed. Task 7 is independently testable in the CRM project, while Task 8 integrates its summary. Native execution is recommended to keep interfaces and dirty-worktree integration under one implementer; no subagent is launched until the owner selects that approach.

Status: Owner approved and selected native implementation. Tasks 1-8 implemented. Local validation completed as recorded in docs/MANAGEMENT_INSIGHTS_PARITY.md; Task 9 publication gates remain open for clean rebuild, authenticated staging and physical Android validation. Unchecked individual checklist items are not claims of completion.
