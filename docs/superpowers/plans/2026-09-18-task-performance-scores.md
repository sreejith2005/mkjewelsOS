# Task Performance Scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace task completion-rate displays with one shared red negative pending score and delayed score across the authorized web and native experiences.

**Architecture:** Define the score calculations once in `@jewelos/core`, extend the existing protected task-progress and dashboard RPC responses with the count/score fields required by that contract, and migrate both clients to render the shared labels and values. Preserve raw task counts, existing authorization boundaries, and the legacy dashboard completion-rate response field for installed clients.

**Tech Stack:** TypeScript, Vitest, React 18/Vite, Expo/React Native, Supabase PostgreSQL/pgTAP, pnpm/npm.

**Spec:** `docs/superpowers/specs/2026-09-18-task-performance-score-design.md`

## Global Constraints

- Pending score is `(completed / assigned) * 100 - 100`, rounded to one decimal.
- Delayed score is `(onTimeCompleted / completed) * 100 - 100`, rounded to one decimal.
- Zero assigned returns `null`; assigned-but-zero-completed delayed score is `-100.0`.
- Render every non-null score with the existing semantic danger/red token.
- Keep raw counts and all task/FMS/form/checklist semantics unchanged.
- Keep database authorization server-side and add only forward migrations.
- Web ships before native; native uses the same shared contract and requires phone-width/device verification.

---

### Task 1: Add the canonical score contract

**Files:**
- Modify: `packages/core/src/taskControlView.ts`
- Modify: `packages/core/src/taskControlView.test.ts`
- Modify: `packages/core/src/recurringTodo.ts`
- Modify: `packages/core/src/recurringTodo.test.ts`
- Modify: `packages/core/src/index.ts` if score exports are not already re-exported

**Interfaces:**
- Consumes: `ProgressCounts` with `assigned`, `completed`, `remaining`, `overdue`, plus an added `onTimeCompleted` count.
- Produces: `taskPendingScore(row): number | null`, `taskDelayedScore(row): number | null`, `formatTaskPerformanceScore(value): string`, and `recurringPerformanceScores(row): { pending: number | null; delayed: number | null }`.
- Used by: Task Control shared data filters, web panels, mobile panels, and recurring performance tables.

- [ ] **Step 1: Write failing shared-rule tests**

```ts
expect(taskPendingScore({ assigned: 100, completed: 75, remaining: 25, overdue: 0, onTimeCompleted: 25 })).toBe(-25);
expect(taskPendingScore({ assigned: 33, completed: 2, remaining: 31, overdue: 0, onTimeCompleted: 0 })).toBe(-93.9);
expect(taskDelayedScore({ assigned: 100, completed: 75, remaining: 25, overdue: 0, onTimeCompleted: 25 })).toBe(-66.7);
expect(taskDelayedScore({ assigned: 33, completed: 0, remaining: 33, overdue: 0, onTimeCompleted: 0 })).toBe(-100);
expect(taskPendingScore({ assigned: 0, completed: 0, remaining: 0, overdue: 0, onTimeCompleted: 0 })).toBeNull();
```

- [ ] **Step 2: Run the focused core tests and verify they fail because the score API is absent**

Run: `pnpm.cmd --dir packages\core exec vitest run src/taskControlView.test.ts src/recurringTodo.test.ts`

- [ ] **Step 3: Implement the minimal pure score helpers and migrate recurring percentages**

```ts
export function taskPendingScore({ assigned, completed }: ScoreCounts): number | null {
  return assigned > 0 ? roundOneDecimal((completed / assigned) * 100 - 100) : null;
}
export function taskDelayedScore({ assigned, completed, onTimeCompleted }: ScoreCounts): number | null {
  if (assigned === 0) return null;
  return completed === 0 ? -100 : roundOneDecimal((onTimeCompleted / completed) * 100 - 100);
}
```

- [ ] **Step 4: Run the focused core tests and verify they pass**

Run: `pnpm.cmd --dir packages\core exec vitest run src/taskControlView.test.ts src/recurringTodo.test.ts`

### Task 2: Extend authorized database contracts and analytics definitions

**Files:**
- Create: `supabase/migrations/0163_task_performance_scores.sql`
- Create: `supabase/tests/0163_task_performance_scores.test.sql`
- Modify: `packages/core/src/database.types.ts`
- Modify: `packages/data/src/analytics/types.ts`
- Modify: `packages/core/src/analytics/metrics.ts`
- Modify: `packages/core/src/analytics/analytics.test.ts`

**Interfaces:**
- Consumes: `task_instances`, `current_profile()`, existing task-reporting scope helpers, and the Task 1 score semantics.
- Produces: `on_time_completed` in each `get_employee_task_progress` row, and additive dashboard metric keys `task_pending_score` and `task_delayed_score`.
- Used by: authorized Task Control and Dashboard readers in both clients.

- [ ] **Step 1: Write pgTAP and metric-catalog tests before changing SQL**

```sql
select ok(position($$'on_time_completed'$$ in pg_get_functiondef('public.get_employee_task_progress(jsonb)'::regprocedure)) > 0,
  'employee progress returns on-time completed count');
select ok(position($$'task_pending_score'$$ in pg_get_functiondef('public.get_dashboard_metrics(jsonb)'::regprocedure)) > 0,
  'dashboard exposes pending score');
select ok(position($$'task_delayed_score'$$ in pg_get_functiondef('public.get_dashboard_metrics(jsonb)'::regprocedure)) > 0,
  'dashboard exposes delayed score');
```

```ts
expect(metricFor("task_pending_score")?.displayName).toBe("Pending score");
expect(metricFor("task_delayed_score")?.format).toBe("percentage");
```

- [ ] **Step 2: Run the new focused checks and verify the missing migration/catalog causes failure**

Run: `pnpm.cmd --dir packages\core exec vitest run src/analytics/analytics.test.ts`

- [ ] **Step 3: Add the forward migration and types**

Use `create or replace function` only for the two existing RPCs; preserve their grants, `security definer` settings, `assert_module_enabled` enforcement, and role/branch/tenant filters. Build dashboard score inputs from one authorized assigned-task cohort. Retain `task_completion_rate` in its JSON response, append the new keys, and update the generated type/data interfaces with `on_time_completed`.

- [ ] **Step 4: Run local pgTAP plus metric-catalog checks**

Run: `supabase.cmd test db --local --file supabase/tests/0163_task_performance_scores.test.sql`

Run: `pnpm.cmd --dir packages\core exec vitest run src/analytics/analytics.test.ts`

### Task 3: Convert web Task Control, dashboard, and recurring performance

**Files:**
- Modify: `packages/data/src/taskControl/filters.ts`
- Modify: `packages/data/src/taskControl/api.ts`
- Modify: `apps/web/src/features/taskControl/panels.tsx`
- Modify: `apps/web/src/features/taskControl/OverviewTab.tsx`
- Modify: `apps/web/src/pages/TaskTemplatesPage.tsx`
- Modify: `apps/web/src/features/analytics/DashboardView.tsx`
- Modify: `apps/web/src/pages/RecurringTodoPage.tsx`
- Modify: relevant existing `apps/web/src/features/taskControl/*.test.ts` and `apps/web/src/pages/RecurringTodoPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers and Task 2 additive RPC fields.
- Produces: red Pending score and Delayed score UI, preserving count columns and existing filters.
- Used by: Task Control and Dashboard users at their current authorized scope.

- [ ] **Step 1: Write failing web tests for labels, exact score values, and danger styling**

```tsx
expect(screen.getByText("Pending score")).toBeInTheDocument();
expect(screen.getByText("−93.9%")).toHaveClass("text-task-overdue");
expect(screen.getByText("Delayed score")).toBeInTheDocument();
```

- [ ] **Step 2: Run only the affected web tests and verify they fail for the missing score UI**

Run: `pnpm.cmd --dir apps\web exec vitest run src/features/taskControl src/pages/RecurringTodoPage.test.tsx`

- [ ] **Step 3: Replace completion/on-time rate displays with shared score helpers**

Keep “Completed”, “Remaining”, “Overdue”, “On time”, and “Delayed” as counts. Use `No data` for null scores, show score strings with a Unicode minus sign, and retain red semantic classes for every non-null score. Update task-control attention copy and its final sort tie-breaker to use pending score without changing the higher-priority overdue/backlog ordering.

- [ ] **Step 4: Run the focused web tests and visual build checks**

Run: `pnpm.cmd --dir apps\web exec vitest run src/features/taskControl src/pages/RecurringTodoPage.test.tsx`

Run: `pnpm.cmd --filter web typecheck`

### Task 4: Port the shared score UI to native

**Files:**
- Modify: `apps/mobile/src/features/taskControl/panels.tsx`
- Modify: `apps/mobile/src/screens/TaskControlScreen.tsx`
- Modify: `apps/mobile/src/screens/DashboardScreen.tsx`
- Modify: `apps/mobile/src/screens/RecurringTodoScreen.tsx`
- Modify: existing mobile pure-model tests, or create `apps/mobile/src/features/taskControl/performanceScores.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers and Task 2 response types from shared packages.
- Produces: phone-layout parity with web labels, red values, counts, and no-data behavior.
- Used by: all authorized native Task Control/Dashboard/Recurring users.

- [ ] **Step 1: Write failing mobile/shared-model tests for labels and canonical values**

```ts
expect(formatTaskPerformanceScore(taskPendingScore(row))).toBe("−93.9%");
expect(formatTaskPerformanceScore(taskDelayedScore({ ...row, completed: 0 }))).toBe("−100.0%");
```

- [ ] **Step 2: Run the focused mobile test and verify it fails before native UI changes**

Run: `npm --prefix apps/mobile run test -- performanceScores.test.ts`

- [ ] **Step 3: Replace native completion-rate tiles/bars and recurring percentage rows**

Import shared helpers only; do not recreate arithmetic in React Native. Render the two scores using the existing `danger` text tone, preserve the existing count layout and access control, and update the explanatory text to say “Pending score” and “Delayed score”.

- [ ] **Step 4: Run mobile tests and typecheck**

Run: `npm --prefix apps/mobile run test`

Run: `npm --prefix apps/mobile run typecheck`

### Task 5: Run cross-surface regression gates and prepare the release handoff

**Files:**
- Modify: `docs/MOBILE_PARITY_PLAYBOOK.md` only if the tested parity tracker status changes.
- Test: core, data, web, mobile, database contract, typecheck, build, and device QA.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: evidence separating local code checks, database checks, web build, native build, and authenticated/device proof.

- [ ] **Step 1: Run focused regression tests across packages**

Run: `pnpm.cmd --dir packages\core test`

Run: `pnpm.cmd --dir packages\data test`

Run: `pnpm.cmd --dir apps\web test`

- [ ] **Step 2: Run database and monorepo static gates**

Run: `supabase.cmd test db`

Run: `pnpm.cmd exec turbo run typecheck --force --concurrency=1`

Run: `pnpm.cmd exec turbo run build --force --concurrency=1`

- [ ] **Step 3: Perform native build and phone-width verification**

Run: `npm --prefix apps/mobile run typecheck`

Run: `npm --prefix apps/mobile run test`

Run: `apps\\mobile\\android\\gradlew.bat assembleRelease --no-daemon --max-workers=2`

Verify manually on the registered device: own dashboard score, super-admin filtered score, Task Control score rows, Recurring performance score rows, danger/red legibility, and no horizontal clipping.

- [ ] **Step 4: Inspect the final scoped diff and report release gates separately**

Run: `git diff --check`

Run: `git status --short --branch`

Report code/test evidence separately from any hosted migration apply, Vercel deployment, native release, and authenticated browser/device proof. Do not apply hosted migrations, publish a web deployment, or release an APK without the corresponding explicit release decision.
