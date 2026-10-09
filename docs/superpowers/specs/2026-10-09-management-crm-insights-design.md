# Management and CRM insights dashboards

Date: 2026-10-09 (Asia/Kolkata)
Status: Approved by the owner in chat on 2026-10-09. Native implementation selected. Source is implemented and locally validated;
see docs/MANAGEMENT_INSIGHTS_PARITY.md. No hosted deployment or employee release yet.

## Intent and acceptance

Replace scattered analytics with readable, interactive decision support for directors,
managers, admins, Super Admins, and configurable HR access. Cover tasks, workflows,
forms, people/availability, and CRM without presenting every metric at once. Keep the
CRM dashboard exclusively about CRM. The supplied screenshots inform filtering,
comparison, and drilldown principles; they are not a layout or business-rule spec.

Success means a manager can identify a problem, understand its evidence and scope,
and open the relevant persisted records. Desktop, mobile web, and Android must answer
the same questions and use the same metric definitions. Existing task and CRM writes,
notifications, assignments, access rules, and historical records remain compatible.

## Current source findings

- Web uses `apps/web/src/features/analytics/DashboardView.tsx`; native uses
  `apps/mobile/src/screens/DashboardScreen.tsx`. Both consume `get_dashboard_metrics`.
- `packages/core/src/analytics` contains metric definitions, date and presentation
  helpers. API consumers exist in web and `packages/data/src/analytics`.
- Migration 0163 distinguishes planned-task cohort scores from completions occurring
  during a period. Those measures cannot be combined as one completion fraction.
- Existing negative pending/delayed score conventions stay compatible. Show their
  raw counts and explanations beside them; do not silently change Task Control.
- `packages/crm-ui/src/lib/dashboard.ts` includes total visits and overlapping outcomes
  in its status distribution. Its trend defines not-bought differently from its total.
  A composition chart must use disjoint categories and exclude the overall total.
- CRM currently pages through timeline records to calculate summaries in the client.
  Aggregate endpoints are needed for bounded transfer and consistent drilldown counts.
- CRM implementation belongs in `C:\crm`. That worktree is dirty, including the
  dashboard and continuity/performance work. Inspect and preserve those changes before
  implementing. The main JewelOS worktree was clean at discovery.
- Directors are not a distinct current `UserRole`. Director access must use existing
  dashboard authority and permission configuration, without inventing a client role.

## Approach and alternatives

Recommended: a concise overview plus focused analysis tabs, backed by versioned,
authorized aggregate and detail contracts. This provides depth without crowding the
landing page, supports new modules, and keeps mobile equivalent.

Alternative: a single configurable wall of widgets. It offers flexibility but makes
relationships and mobile reading harder. Alternative: separate report pages only.
That is simpler but fragments cross-module decisions. Neither is the default.

## Management reading path

1. Compact heading: selected scope, period, last refresh, and a filter button.
2. At most six headline cards: due work, remaining work, overdue work, on-time
   performance, workflow attention, and available people. Separate current-state
   cards from period measures with visible labels.
3. Needs attention: at most five ranked findings, each with the observed count/rate,
   denominator, period, owner/group when available, and an action to inspect records.
4. One trend and one comparison relevant to the selected analysis. More detail opens
   below or on another tab; it is not loaded into the overview indiscriminately.
5. Expandable module summaries link into Tasks, FMS, Forms, People, and CRM.

Analysis tabs: Overview, Tasks, Workflows & Forms, People & Availability, CRM summary.
Each tab owns relevant filters and metrics; unavailable modules are explicitly
unavailable, not represented as zero activity.

## Filters, grouping, and customization

- Period: today, week, month, last 7/30 days, quarter, year, custom bounded dates.
  Compare with the preceding equal-length period; label partial current periods.
- Shared scope: authorized branch, department, designation, and employee.
- Tasks: type, category, priority, status, recurring/manual source as supported by
  actual stored vocabulary. Workflows: flow/version and runtime stage/status.
- Group comparisons by branch, department, designation, employee, task type, or
  workflow. Employee assignment totals are labelled as assignments: a multi-assignee
  task can count once per employee but only once in the distinct-task total.
- Shareable URL state includes filters, tab, grouping, and selected metric; validate
  all values and restore browser back/forward behavior. Never put private detail
  payloads in URLs. Native carries the same typed state through navigation.
- Personal saved views store filter/layout configuration only, via authorized audited
  preferences. Offer show/hide sections, ordering, and reset to sensible defaults.
  No arbitrary chart builder or drag-only interactions in this iteration.

## Metric and insight rules

- Due-period tasks form one cohort using the existing effective deadline source.
  Report assigned, completed, open, overdue-open, rejected/cancelled separately;
  preserve existing status vocabulary and explain exclusions.
- Completed-during-period throughput is a separate activity measure. It may include
  older work and must not be the numerator for a due-cohort completion rate.
- Backlog is open work as of refresh, including earlier and undated work. Label its
  scope and timestamp; the selected activity period must not silently hide old work.
- Deadline adherence uses the shared effective deadline contract. Zero denominators
  yield 'No data'; absent deadlines yield 'Not applicable', never invented timeliness.
- FMS distinguishes instances, actionable stages, and starter assignments. Show
  blocked/overdue/review queues, aging, and flow/stage bottlenecks. Retain assignment
  identifiers and the shared `fmsAssignedWorkPath` destination contract.
- Forms show recorded submissions, pending reviews, and required outstanding forms
  only where a durable assignment makes that measure provable.
- Availability uses approved records, week-off/half-day rules and existing coverage
  contracts. Show uncovered work and leave clashes without private reasons/documents.
  Availability is not attendance or measured productivity.
- Insights are deterministic evidence summaries, not generated assertions. Start with
  overdue concentrations, blocked stages, growing backlog, and uncovered work. Use
  'Review...' suggestions and never automatically reassign or penalize employees.
- Rankings show volumes and denominators, suppress unsupported comparisons, and make
  small samples visible. No composite employee performance score.

## CRM-only dashboard

Default view: visitor activity, recorded purchase/order outcomes, follow-up backlog,
and client/lead growth, with focused tabs for Visits & Outcomes, Follow-ups, Clients &
Leads, and Staff & Branches. Four to six summary cards and two explanatory charts per
view are the maximum default density.

Filters: period, branch, saved CRM staff, salesperson, lead source, visit type, and
recorded outcome where the source records support them. Missing historical attribution
appears as 'Unassigned/unknown'; never guess staff from free text or current ownership.

Use a directly labelled visit-outcome bar chart and daily/weekly trend. A mutually
exclusive breakdown groups exact saved statuses into documented categories whose
counts reconcile to the walk-in total, including unknown. Purchase/order/repair
indicators that overlap remain separate counts with an explicit overlap explanation.
Count actual walk-in events only; other timeline activity is not a visit.

Recorded purchase rate is purchase-positive visits / eligible visits, with exact
status mapping, missing-status count, and denominator visible. Lead conversion uses
recorded lead-to-client links in a defined creation cohort and is distinct from a
visit purchase rate. Do not infer revenue, profit, or lost sales from visit status.

Follow-up analysis separates overdue, due soon, completed/contacted outcomes, and
aging according to actual persisted follow-up fields. Show actionable follow-up
records and non-buying reasons when structured source data exists. No invented funnel
steps or unsupported outcomes. Returning clients count distinct client identities
with qualifying earlier visits; imports and unknown history are disclosed.

Every total/chart segment opens a paginated record list using the same server
predicate. Preserve client identifiers, client profile destinations, existing visit
forms, and branch write rules. CRM read remains company-wide for active CRM users.

## Data and authorization architecture

- Internal analytics stay in JewelOS; client/visit/lead/follow-up analytics stay in
  the separate CRM project. Never use archived JewelOS CRM metrics or copy client
  records across projects for the dashboard.
- Management CRM summaries use the existing authenticated CRM bridge and a dedicated
  read contract. Fetch the two projects independently and expose separate freshness
  and failure states. CRM failure must not blank internal analytics.
- Add compatible versioned aggregate/detail RPCs, strict input/output types, bounded
  date ranges, pagination, and indexes justified by query plans. Existing RPCs remain
  available for installed clients. Regenerate both projects' types when changed.
- Resolve actors using current server authority and central permission resolution.
  Dashboard access, module access, and record scope are independently enforced.
  Filters only narrow scope; a pasted URL or RPC call never grants broader access.
- HR defaults to permitted people/availability and personal work. Additional dashboard
  authority is configured through the existing administration mechanism. Do not
  silently grant HR all CRM or operational data.
- Saved views need tenant/user RLS, minimal grants, an audited validated write, and
  ownership checks. They store no metric snapshots or customer data.
- Future modules register metric definitions, supported dimensions, authorized data
  adapters, detail destinations, and tests. They do not appear without real contracts.
- No Storage changes or data backfill is needed by default. Historical gaps are
  visible; any repair would be separately scoped and audited.

## Mobile, charts, accessibility, and runtime cost

Use the existing chart/component stack where it supports these requirements; prefer
labelled SVG/DOM bars and trends, with accessible tables as the fallback. Native uses
its own renderer with shared data and metric definitions. No new visualization
dependency is justified solely by appearance.

At phone width, place attention items early, show two-column summary cards when they
fit, collapse secondary filters, and turn comparison rows into expandable cards.
Essential values remain visible without hover. Provide tap/keyboard drilldown,
44px touch controls, textual status cues, reduced motion, and large-text support.
Wide detailed tables may scroll within their panel; the page itself must not overflow.

Limit overview charts to two instances. Load tab aggregates on demand; paginate
details, aggregate long ranges by week/month, and debounce filter changes. Retain
previous data only for its labelled scope during refresh; never present old-scope
data as new-scope results. Show loading, empty, denied, error, partial, stale and
offline states with safe retry. Realtime refresh is coalesced and project-specific.

## Implementation sequence and validation gates

1. Audit current predicates/permissions and CRM dirty changes. Write the action-level
   web/mobile-web/native parity matrix and a concrete implementation plan.
2. Add shared metric/filter/insight contracts and synthetic edge-case fixtures.
3. Add internal aggregate/detail RPCs, forward migrations, generated types, pgTAP.
4. Implement management web/native views and persisted personal configuration.
5. Add CRM-project aggregate/detail RPCs and CRM-only dashboard in `C:\crm`, preserving
   existing work; integrate the management summary via the bridge.
6. Reconcile metric and detail counts; validate null dates, multiple assignees,
   rejected work, revisions, timezone boundaries, prior periods, unknown CRM statuses,
   overlapping outcomes, missing attribution, and large paginated datasets.
7. Test allowed/denied actors: anonymous, inactive, ordinary, manager, HR, configured
   authority, privileged, cross-branch, cross-tenant, service-role where applicable.
   Verify direct URL/API denials and saved-view ownership separately.
8. Run focused core/web/CRM/mobile tests, relevant pgTAP, typechecks, builds, whitespace
   checks, desktop and phone-width browser QA, then physical Android verification.
   Existing task/FMS/form completion, notification, CRM capture, and follow-up flows
   are regression gates, not rewritten by analytics work.
9. Follow the production playbook for staging/hosted actions. After required Android
   gates pass, use `scripts/release-mobile.ps1`, push the reviewed release commit,
   and verify the public manifest/APK under the standing release instruction.

## Review decisions

Recommended defaults: focused tabs, limited overview density, existing configurable
dashboard authority for directors, HR with its current restricted scope, personal
saved views, and evidence-based attention suggestions. Approval of this written
design was granted in chat; implementation-plan review follows before product code changes.
