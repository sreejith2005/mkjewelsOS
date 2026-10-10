# Management and CRM insights handoff

Source implementation: 2026-10-09. Owner approved the design and selected native implementation. This is local validation evidence, not production readiness or deployment evidence.

## Result and source scope

The management dashboard uses focused Overview, Tasks, Workflows & Forms, People & Availability, and permission-aware CRM views. It shows up to six primary metrics, bounded attention findings, two charts, scoped filters, definitions, paginated matching records, and private saved layouts. Web and native share the versioned analytics and saved-view contracts. The CRM dashboard contains CRM-project records only: recorded visit outcomes, purchase-positive visits, follow-up backlog/history, lead conversions, returning visit identities, staff/branch comparisons, and structured reasons for not buying.

- `packages/core/src/analytics/insights*.ts` and `crmInsights.ts`: filter codecs, validation, metric presentation and deterministic attention findings.
- `packages/data/src/analytics/insightsApi.ts`, `savedViews.ts`: validated server reads and audited saved-view writes.
- `apps/web/src/features/analytics/insights/`: responsive dashboard, filters, accessible charts, record drawer and saved views.
- `apps/mobile/src/features/analytics/`: native controls, charts, shared reads, saved views and exact record navigation.
- `packages/crm-ui/src/components/dashboard-insights/`, `src/lib/crm-insights-api.ts`, `src/analytics.ts`: CRM-only dashboard and lightweight existing-session adapter. CRM authoring occurred in `C:/crm`; reviewed dashboard source was integrated into the authoritative main repository.
- Task, Forms and Availability pages/screens and navigation carry exact selected identifiers. Historical task and form reads use existing RLS, not capped feed inference. Existing write/completion contracts remain in use.

## Contracts and authorization

JewelOS migrations `0206_management_insights.sql` and `0207_dashboard_saved_views.sql` add summary/options/detail RPCs and owner-scoped saved views. The existing reporting helper now resolves the interactive actor through `current_profile()`, preserving its explicit background actor path. Configured dashboard authority and module permissions remain separate. Saved views have owner/tenant RLS, a restrictive dashboard gate, no direct browser writes, validated configuration, optimistic versions, an owner quota, and transactional audit records. The existing retirement manifest retains saved layouts. Public generated database declarations were updated in core and API client.

CRM migration `C:/crm/supabase-crm/supabase/migrations/20261010000100_crm_insights.sql` adds CRM-project read RPCs and timeline/due-date indexes. It retains company-wide read access for active bridged CRM users. Inactive users, inactive/missing bridges and anonymous callers are denied. No CRM write, Storage, source-answer, merge, ingest, sync, or client-record migration was introduced. The JewelOS CRM schema was not extended.

Summary and detail predicates share server helpers. Detail pages are bounded to 100 records (clients request 25); null paging values and unknown metric selectors are rejected. Reads return identities and aggregate evidence, excluding original form answers, private leave reasons and free-text CRM content. Existing record screens retrieve protected content through their own RLS.

## Action-level parity

| Action | Persisted contract/identity | Desktop and mobile web evidence | Native evidence |
| --- | --- | --- | --- |
| Period and scope filters | `get_management_insights_v1`, options, shared versioned filter | Browser period change and expanded controls at 320px; scope/authority pgTAP; stale-response and history tests | Same shared filter/RPCs; model tests, typecheck and Android bundle; device pending |
| Inspect a metric or attention finding | `get_management_insight_records_v1`, same selector/context | Rendered metric drawer and matching local task rows; selector and reconciliation tests | Same paginated endpoint and modal; identity/model tests; device pending |
| Group comparison | Server department/branch/designation/employee/type/workflow groups | Direct values and top-ten expansion; grouped detail pgTAP | Native bars, direct values and expansion; compiled; device pending |
| Open a task | Exact `task_id`, existing task-detail mutation capability | Historical exact-ID API regression and destination test | Existing `TaskDetail` route with the same ID; model test |
| Open FMS assigned work | Starter assignment ID or instance plus runtime stage ID | Shared `fmsAssignedWorkPath`; assignment identity regression | Existing centralized assigned-work navigation; model and existing contract tests |
| Open a submission | Exact form submission ID | Exact RLS read and submission modal; data/destination tests | Exact same shared submission loader and existing submission screen; model test |
| Open employee availability | Exact employee ID within existing authorized rows | Authorized list narrowed by query ID | Typed Availability route narrows existing list; device pending |
| Save/apply/update/delete layout | Owner row, audited RPC, version | Real local create/update/delete at all four viewport widths; owner/quota/stale/denial pgTAP | Same RPCs and native controls; device pending |
| Refresh/errors/denied modules | Current server scope, request generation | Loading/error and stale-response tests; denied direct API pgTAP | Existing realtime coalescing, pull refresh, generation guards; offline/session/device pending |
| CRM handoff | Existing login bridge and persisted branch mapping | No CRM read for missing branch mapping; selected metric/branch tests; unsupported internal scopes explicit | Existing CRM WebView receives period/branch state; URL bridge tests; physical bridge pending |
| CRM-only analysis and drilldown | CRM-project RPCs and exact client IDs | Both dashboard layouts rendered with real local CRM RPCs; matching visit detail | Existing approved CRM WebView, not a second native CRM implementation; device pending |

## Metric meanings and compatibility

Due work is an effective-deadline cohort; completion activity is a completion-date cohort. Current backlog includes older and undated open work. Rate cards expose eligible denominators and return no data when the denominator is zero. Existing negative task-score conventions remain red. Runtime completed stages exclude starter assignments; starter completion is a separate metric. Runtime stages retain recorded organization scope, while starters use the current assignee organization because historical starter organization was never stored. Review age runs from submission time. Availability is scheduling coverage with half-day cutoffs, not attendance or productivity.

CRM exact outcomes are disjoint; purchase/order/repair flags may overlap. Unknown outcomes stay visible and are excluded from purchase-rate eligibility. Saved follow-up updates and completion transitions are history evidence, not inferred calls. Client creation growth is explicitly unavailable because client rows have no reliable creation timestamp. Returning-client measures depend on recorded visit history, which imports may not fully cover. No revenue/profit metric or synthetic application fallback was added.

## Local evidence

- `pnpm.cmd --filter @jewelos/core test -- --maxWorkers=2`: 794 tests / 66 files passed (bounded-worker retry).
- `pnpm.cmd --filter @jewelos/data test`: 98 tests / 16 files passed.
- `pnpm.cmd --filter web exec vitest run --maxWorkers=2`: 414 tests / 88 files passed. Final encoding check also passed after text cleanup.
- `pnpm.cmd --filter @jewelos/crm-ui exec vitest run --maxWorkers=2`: 112 tests / 26 files passed; scoped generated CSS checked by the monorepo build.
- `npm.cmd --prefix apps/mobile run test -- --maxWorkers=2 --testTimeout=20000`: 124 tests / 24 files passed.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1`: six packages passed; `npm.cmd --prefix apps/mobile run typecheck` passed.
- `pnpm.cmd exec turbo run build --force --concurrency=1`: six packages passed. Existing bundle-size/output advisory warnings are not runtime proof.
- `EXPO_NO_DOTENV=1 npx.cmd expo export --platform android --output-dir <ignored-local-directory>` from `apps/mobile`: Android Hermes bundle exported (3,685 modules). This is compilation evidence, not a signed APK or device run.
- New SQL applied through `docker exec -i <local-container> psql -U postgres -d postgres -v ON_ERROR_STOP=1` only. Focused transactional pgTAP: management 41, saved views 14, CRM 18 assertions passed. Fixture namespaces were changed only in temporary runs to avoid collisions with browser synthetic seeds.
- Related local pgTAP passed: 0013 dashboard/reports/settings (84), 0088 task form completion (9), 0156 granular permissions, 0160 assigned-work identity, 0177 leave half-day coverage, 0181 office leave summary, 0193 selected-user assignment, 0197 refresh signals, 0199 department access (43), and 0200 CRM staff access.
- Targeted `plpgsql_check_function_tb` checked new PL/pgSQL functions; an unused local variable was removed. This is not a complete database lint or clean-reset proof.
- Local outer `EXPLAIN (ANALYZE, BUFFERS)` for current-year management/employee and CRM/salesperson summaries completed in roughly 1,419ms and 139ms on tiny synthetic fixtures. These cold local plans do not establish production-scale performance or expose nested plans.
- Playwright fallback was used because in-app browser tools were unavailable. Both actual dashboard components used real local Supabase RPCs and synthetic identities with a QA-only authentication adapter. 1440px, 768px, 390px and 320px passed rendering, matching drilldown, and no horizontal page overflow. Management saved-view CRUD passed at each width. Additional 320px checks passed expanded filters, period changes, 20px base text, reduced motion and Escape to close a drawer. Screenshots were visually inspected. This does not prove full login/session exchange or end-to-end task/form mutations.
- `git diff --check` passed. `adb devices -l` returned no connected device.

## Final review rulings and release gates

One fresh final reviewer found authority, half-day, starter counting/scope, linked-form filtering, paging, exact navigation, history and missing-measure issues. Corrections were made in one pass, with regression tests reproducing the significant failures before their fixes. The missing client creation timestamp was disclosed rather than inferred; historical starter organization cannot be reconstructed. Text readability and restored date drafts were treated as user-facing correctness fixes. A broader regression additionally found the retirement-manifest classification requirement, now covered by its existing and new tests.

The initial implementation checks reached the levels above without hosted deployment or Git publication. On 2026-10-10 the owner explicitly authorized migrations and publication to main. Both project contracts are now deployed; separate hosted evidence is recorded in [the release record](MANAGEMENT_INSIGHTS_RELEASE_2026-10-10.md). Remaining evidence gaps are a clean isolated rebuild/full pgTAP and lint, authenticated staging with the two existing session bridges, realistic query-volume/performance checks, and physical Android interaction/large-text/TalkBack/offline/session testing. No connected Android device is available, so employee APK publication stops at its required gate. After native gates pass, publish only through `scripts/release-mobile.ps1` without `-Mandatory`.

The CRM worktree contains unrelated preexisting changes; preserve them and stage only reviewed dashboard or backend paths. The old release remains public until validation succeeds.
