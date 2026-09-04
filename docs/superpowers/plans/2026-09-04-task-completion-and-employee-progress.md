# Task Completion and Employee Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task completion mode explicit, remove obsolete Start behavior, make Home task cards internally scrollable, and add server-authorized employee task progress to leader dashboards.

**Architecture:** A forward database migration validates one-time task mode combinations and extends the existing dashboard RPC with set-based, role-scoped employee/department/branch aggregates. The web app consumes this contract through typed task and analytics helpers, while task filters, composer/card behavior, Home scrolling, and dashboard presentation each remain in their existing focused feature modules.

**Tech Stack:** Supabase/Postgres SECURITY DEFINER RPCs and pgTAP, TypeScript, React 18/Vite, Vitest, Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-04-task-completion-and-employee-progress-design.md`

## Global Constraints

- Work only in `C:\Users\MIS\Downloads\MKJewelOS\jewelos`; preserve the untracked `artifacts/` directory.
- Add only forward migration `0133`; do not edit an applied migration or rewrite historic task status/data.
- RLS/RPC authorization and audit records remain the enforcement boundary; browser controls are UX only.
- Task evidence stays private and accepts only validated image input; never expose Storage paths, credentials, or private metadata in the UI/report payload.
- The employee progress payload must contain only operational identifiers/names and counts, and must be tenant/branch/department/role scoped in SQL.
- Generate matching `packages/core/src/database.types.ts` and `packages/api-client/src/database.types.ts` from the local schema after the migration.
- Use `pnpm.cmd` and `supabase.cmd` on this Windows host. Report local, browser, Git, Supabase-hosted, and Vercel-hosted evidence separately.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/0133_task_completion_modes_and_employee_progress.sql` | Authoritative task-mode validation and compatible dashboard employee-progress RPC extension. |
| `supabase/tests/0133_task_completion_modes_and_employee_progress.test.sql` | pgTAP fixtures plus mode, audit, tenant, role, and reporting-scope tests. |
| `packages/core/src/taskFeed.ts` | Completed status filter and open-work counters. |
| `packages/core/src/taskFeed.test.ts` | Pure filtering/count regression coverage. |
| `packages/core/src/database.types.ts` | Generated local-schema database contract. |
| `packages/api-client/src/database.types.ts` | Matching generated database contract used by the browser client. |
| `apps/web/src/features/tasks/TaskComposer.tsx` | Explicit mode selector and mode-derived creation payload. |
| `apps/web/src/features/tasks/TaskComposer.test.tsx` | Task versus multi-item Checklist authoring tests. |
| `apps/web/src/features/tasks/TaskCard.tsx` | Direct mode-appropriate completion UI with no Start action. |
| `apps/web/src/features/tasks/TaskCard.test.tsx` | Evidence and required-checklist completion behavior. |
| `apps/web/src/features/tasks/TaskFilterBar.tsx` | Pending/Overdue/Completed controls. |
| `apps/web/src/pages/TasksPage.tsx` | Open top-level counts and no Start fallback handler. |
| `apps/web/src/pages/TasksPage.test.tsx` | Workspace filter/count wiring regression test. |
| `apps/web/src/features/home/HomeView.tsx` | Fixed-height, internally scrolling My Tasks queue. |
| `apps/web/src/features/home/HomeView.test.ts` | Regression assertion for bounded queue rather than `slice(0, 4)`. |
| `apps/web/src/features/analytics/types.ts` | Typed employee progress response model. |
| `apps/web/src/features/analytics/DashboardView.tsx` | Role-gated employee, department, and branch progress section. |
| `apps/web/src/features/analytics/presentation.test.tsx` | Dashboard role/presentation source coverage. |

### Task 1: Database completion-mode and progress contract

**Files:**
- Create: `supabase/migrations/0133_task_completion_modes_and_employee_progress.sql`
- Create: `supabase/tests/0133_task_completion_modes_and_employee_progress.test.sql`
- Modify: `packages/core/src/database.types.ts`
- Modify: `packages/api-client/src/database.types.ts`

**Interfaces:**
- Consumes: `create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)`, `update_task_with_audit(uuid,text,uuid,boolean,text)`, `get_dashboard_metrics(jsonb)`, `task_instances`, `task_assignees`, `task_checklists`, `user_profiles`, `branches`, `departments`, and `audit_logs`.
- Produces: a compatible creation RPC which accepts `payload.task_type` as `delegation | checklist`, and a `get_dashboard_metrics` response property `employee_progress` shaped as `{ employees: Array<{user_profile_id:string; employee_name:string; branch_id:string; branch_name:string; department_id:string; department_name:string; assigned:number; completed:number; remaining:number}>; departments: Array<{department_id:string; department_name:string; assigned:number; completed:number; remaining:number}>; branches: Array<{branch_id:string; branch_name:string; assigned:number; completed:number; remaining:number}> }` only for Super Admin, Admin, HR, and Manager.

- [ ] **Step 1: Write the failing pgTAP test**

Create the test with two same-tenant branches, an active Super Admin/Admin/Manager/HR/staff, an inactive employee, and an other-tenant employee. Call the protected creation RPC with these exact cases:

```sql
select throws_ok(
  $$select create_delegation_task_with_audit(
    '{"title":"Bad checklist","planned_datetime":"2026-09-04T10:00:00Z","priority":"medium","branch_id":"13320000-0000-4000-8000-000000000001","department_id":"13330000-0000-4000-8000-000000000001","task_type":"checklist","requires_upload":true}'::jsonb,
    array['13340000-0000-4000-8000-000000000005']::uuid[], '{}'::uuid[], '[]'::jsonb
  )$$,
  '23514', 'Checklist tasks cannot require an upload',
  'inconsistent checklist upload requirement is rejected'
);

select throws_ok(
  $$select create_delegation_task_with_audit(
    '{"title":"Bad task","planned_datetime":"2026-09-04T10:00:00Z","priority":"medium","branch_id":"13320000-0000-4000-8000-000000000001","department_id":"13330000-0000-4000-8000-000000000001","task_type":"delegation","requires_upload":false}'::jsonb,
    array['13340000-0000-4000-8000-000000000005']::uuid[], '{}'::uuid[],
    '[{"item_text":"Not allowed","is_required":true,"sort_order":0}]'::jsonb
  )$$,
  '23514', 'Task tasks cannot contain checklist items',
  'delegation mode rejects checklist items'
);
```

Add successful Task and Checklist creation cases and assert their persisted `task_type`, `requires_upload`, checklist-row count, and `task_created` audit row. Add dashboard assertions for Admin/HR/Manager visibility, staff omission, inactive-user omission, other-tenant omission, manager other-branch denial, and exact assigned/completed/remaining counts.

- [ ] **Step 2: Run the new database test to verify it fails**

Run: `supabase.cmd test db --file supabase/tests/0133_task_completion_modes_and_employee_progress.test.sql`

Expected: FAIL because the current creation contract does not validate the explicit one-time mode pairing and `employee_progress` does not exist.

- [ ] **Step 3: Implement the forward migration**

In `0133`, retain the current `create_delegation_task_with_audit` authorization, scope checks, task insertion, assignee insertion, checklist insertion, notifications, and audit write. Add the following declarations/derivation before insertion so existing callers without `task_type` remain compatible:

```sql
v_explicit_mode boolean := p_payload ? 'task_type';
v_task_type text := case
  when v_explicit_mode then nullif(p_payload->>'task_type','')
  when jsonb_array_length(coalesce(p_checklist,'[]'::jsonb)) > 0 then 'checklist'
  else 'delegation'
end;
```

Enforce explicit-mode conditions with `23514` errors:

```sql
if v_task_type not in ('delegation','checklist') then
  raise exception 'Task type is invalid' using errcode='23514';
end if;
if p_payload ? 'task_type' and v_task_type='checklist' and coalesce((p_payload->>'requires_upload')::boolean,false) then
  raise exception 'Checklist tasks cannot require an upload' using errcode='23514';
end if;
if p_payload ? 'task_type' and v_task_type='delegation' and jsonb_array_length(coalesce(p_checklist,'[]'::jsonb))>0 then
  raise exception 'Task tasks cannot contain checklist items' using errcode='23514';
end if;
```

Persist `task_type=v_task_type::task_type`. For explicit Task mode derive `requires_upload=true` and require no checklist items; for explicit Checklist mode derive `requires_upload=false` and require at least one nonblank required checklist item. For legacy callers without `task_type`, preserve the old supplied `requires_upload` and checklist behavior rather than rejecting them. Keep existing grants/revocations exact.

Replace `get_dashboard_metrics(jsonb)` through a compatible `create or replace function`. Reuse its current validated reporting context and `v_actor` scope. For the four leader roles, use one materialized visible-assignment set joined to active, login-enabled scoped employees. Aggregate assigned by planned date within the selected range, completed by actual completion date within that range, and remaining as assigned rows whose task status is not completed. Build employee, department, and branch JSON arrays from that same scoped set. For all other roles, return empty arrays or omit `employee_progress` consistently with the TypeScript model; do not expose people rows. Preserve all existing metric keys, trend, status distribution, ownership, `SECURITY DEFINER`, search path, grants, and denial behavior.

Regenerate both type files after local reset:

```powershell
supabase.cmd gen types typescript --local | Set-Content -Encoding utf8 packages/core/src/database.types.ts
Copy-Item packages/core/src/database.types.ts packages/api-client/src/database.types.ts
```

- [ ] **Step 4: Run the database test to verify it passes**

Run:

```powershell
supabase.cmd db reset
supabase.cmd test db --file supabase/tests/0133_task_completion_modes_and_employee_progress.test.sql
```

Expected: PASS with task-mode, completion/audit, tenant isolation, inactive-user, role, and branch/department-scope assertions.

- [ ] **Step 5: Commit the database contract**

```powershell
git add -- supabase/migrations/0133_task_completion_modes_and_employee_progress.sql supabase/tests/0133_task_completion_modes_and_employee_progress.test.sql packages/core/src/database.types.ts packages/api-client/src/database.types.ts
git diff --cached --check
git commit -m "feat(tasks): add completion modes and employee progress"
```

### Task 2: Task filters, authoring, and direct completion UI

**Files:**
- Modify: `packages/core/src/taskFeed.ts`
- Modify: `packages/core/src/taskFeed.test.ts`
- Modify: `apps/web/src/features/tasks/TaskComposer.tsx`
- Modify: `apps/web/src/features/tasks/TaskComposer.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskCard.tsx`
- Modify: `apps/web/src/features/tasks/TaskCard.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskFilterBar.tsx`
- Modify: `apps/web/src/pages/TasksPage.tsx`
- Create: `apps/web/src/pages/TasksPage.test.tsx`

**Interfaces:**
- Consumes: Task 1's mode-validated creation RPC through `createDelegationTask`, existing `updateTask`, `uploadTaskAttachment`, and `TaskBundle` task/checklist fields.
- Produces: `TaskFeedStatusFilter = "completed" | "overdue" | "pending"`; composer payloads with consistent `task_type`/`requires_upload`; no `start` client action; top-level open-work counts.

- [ ] **Step 1: Write failing focused tests**

In `taskFeed.test.ts`, assert exactly:

```ts
expect(taskMatchesStatus(completedTask, "completed")).toBe(true);
expect(taskMatchesStatus(completedTask, "pending")).toBe(false);
expect(taskMatchesStatus(completedTask, "overdue")).toBe(false);
expect(countTaskFeedStatuses([pendingTask, overdueTask, completedTask])).toEqual({ pending: 1, overdue: 1, completed: 1, open: 2 });
```

In `TaskComposer.test.tsx`, select Checklist, add two items, submit, and assert `onSave` receives `task_type: "checklist"`, `requires_upload: false`, and two required checklist records. Select Task, submit, and assert `task_type: "delegation"`, `requires_upload: true`, and `[]` checklist input. Assert checklist controls are absent in Task mode.

In `TaskCard.test.tsx`, verify an upload-mode card exposes only `Upload image to complete`, calls `upload_and_complete`, and has no Start action. Verify a two-item Checklist card keeps Complete disabled until both items are toggled complete. Add `TasksPage.test.tsx` source/render coverage that expects `Completed`, rejects `All`, and calculates My Tasks/Delegated labels from open counts.

- [ ] **Step 2: Run focused web tests to verify they fail**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- taskFeed.test.ts
pnpm.cmd --filter web test -- TaskComposer.test.tsx TaskCard.test.tsx TasksPage.test.tsx
```

Expected: FAIL because `completed`/`open` filter counts and the explicit composer mode do not yet exist.

- [ ] **Step 3: Implement the focused UI changes**

Change `TaskFeedStatusFilter` and helper logic to use `pending`, `overdue`, and `completed`. `countTaskFeedStatuses` must return a fourth `open` count, computed as every non-completed task, while statuses remain mutually exclusive. Update `TaskFilterBar` to render those three filters only.

In `TasksPage`, initialize with `pending`, derive My Tasks and Delegated heading counts from `counts.open`, and remove the fallback branch which calls `updateTask(task.id, "start")`. Every `TaskCardAction` must be explicitly handled; TypeScript exhaustiveness should make a future missing action a compile error.

In `TaskComposer`, add `taskMode: "task" | "checklist"` state defaulting to `task`. Render an accessible required Task type segmented control near the title/description with labels `Task — upload image to complete` and `Checklist — complete every item`. Show Add Checklist only in Checklist mode. On mode switch to Task, clear checklist items. Build the exact payload:

```ts
task_type: taskMode === "task" ? "delegation" : "checklist",
requires_upload: taskMode === "task",
```

and pass checklist records only in checklist mode. For Task mode, use `onUploadAttachment` only after creation to attach optional supporting evidence; task-card completion still uses the assignee's upload-and-complete control.

Keep TaskCard's current direct upload behavior, label it `Upload image to complete`, accept the existing private image allowlist, and never render a Start control. For checklists, continue to render all items, block the Complete button until `calculateTaskChecklistProgress(...).canCompleteRequiredItems`, and preserve server-side enforcement.

- [ ] **Step 4: Run focused web tests to verify they pass**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- taskFeed.test.ts
pnpm.cmd --filter web test -- TaskComposer.test.tsx TaskCard.test.tsx TasksPage.test.tsx
```

Expected: PASS with completed history isolation, falling open counts, explicit mode payloads, multi-item gating, and no Start action.

- [ ] **Step 5: Commit the task UI deliverable**

```powershell
git add -- packages/core/src/taskFeed.ts packages/core/src/taskFeed.test.ts apps/web/src/features/tasks/TaskComposer.tsx apps/web/src/features/tasks/TaskComposer.test.tsx apps/web/src/features/tasks/TaskCard.tsx apps/web/src/features/tasks/TaskCard.test.tsx apps/web/src/features/tasks/TaskFilterBar.tsx apps/web/src/pages/TasksPage.tsx apps/web/src/pages/TasksPage.test.tsx
git diff --cached --check
git commit -m "feat(tasks): clarify completion and completed history"
```

### Task 3: Home scrolling and employee-progress presentation

**Files:**
- Modify: `apps/web/src/features/home/HomeView.tsx`
- Modify: `apps/web/src/features/home/HomeView.test.ts`
- Modify: `apps/web/src/features/analytics/types.ts`
- Modify: `apps/web/src/features/analytics/DashboardView.tsx`
- Modify: `apps/web/src/features/analytics/presentation.test.tsx`

**Interfaces:**
- Consumes: `HomeSummary.tasks`, Task 1's `DashboardPayload.employee_progress`, existing dashboard filters, and the role values from `useAuth().profile.user_role`.
- Produces: an internal-scroll Home My Tasks region and a `PeopleProgress` display for `super_admin | admin | hr | manager` only.

- [ ] **Step 1: Write failing UI tests**

Add a raw-source assertion to `HomeView.test.ts` that My Tasks no longer contains `openTasks.slice(0, 4)` and contains `max-h-` plus `overflow-y-auto` on the My Tasks list wrapper. Preserve assertions that all other groups remain present.

In `presentation.test.tsx`, add a typed fixture for one employee, department, and branch rollup. Render or source-check `DashboardView` and assert it includes `Employee Task Progress`, `Assigned`, `Completed`, `Remaining`, each three rollup labels, and a leader-role guard such as `canViewEmployeeProgress`. Assert the guard is true for `super_admin`, `admin`, `hr`, and `manager`, and false for `staff`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm.cmd --filter web test -- HomeView.test.ts presentation.test.tsx`

Expected: FAIL because Home slices to four tasks and DashboardView has no employee progress section/type.

- [ ] **Step 3: Implement Home and Dashboard presentation**

In `HomeView`, keep the existing grid/card dimensions. Wrap only the My Tasks action items in a `max-h-80 overflow-y-auto overscroll-contain pr-1` region with an accessible label such as `All open tasks`; replace `openTasks.slice(0, 4)` with `openTasks.map(...)`. Do not change FMS, CRM, priority, header, or navigation behavior.

In analytics types, add named `EmployeeTaskProgress`, `DepartmentTaskProgress`, `BranchTaskProgress`, and `EmployeeProgressPayload` types, then add optional `employee_progress?: EmployeeProgressPayload` to `DashboardPayload` for compatible server responses.

In `DashboardView`, derive `canViewEmployeeProgress` from the four approved roles. When authorized and `data.employee_progress` exists, render a responsive `Panel` below the current trend/status panels. Render employee rows with name, branch, department, Assigned, Completed, Remaining. Render department and branch summaries in compact responsive blocks. Use existing task semantic colours/classes, numeric `tabular-nums`, loading/error conventions, and no new arbitrary colours. If arrays are empty, show a neutral `No employee task data in this range.` message. Do not fetch users directly from the browser; use only the RPC response.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm.cmd --filter web test -- HomeView.test.ts presentation.test.tsx`

Expected: PASS with internally scrollable Home tasks and role-gated employee/department/branch progress presentation.

- [ ] **Step 5: Commit the dashboard deliverable**

```powershell
git add -- apps/web/src/features/home/HomeView.tsx apps/web/src/features/home/HomeView.test.ts apps/web/src/features/analytics/types.ts apps/web/src/features/analytics/DashboardView.tsx apps/web/src/features/analytics/presentation.test.tsx
git diff --cached --check
git commit -m "feat(dashboard): show employee task progress"
```

### Task 4: Full local verification and release handoff

**Files:**
- Modify only the Task 1–3 files if a validation defect is discovered.

**Interfaces:**
- Consumes: the completed local migration, generated types, focused database/web tests, and existing build scripts.
- Produces: clearly bounded proof of source, local database, and rendered browser behavior without claiming hosted deployment.

- [ ] **Step 1: Run the complete targeted local checks**

Run:

```powershell
supabase.cmd db reset
supabase.cmd test db --file supabase/tests/0133_task_completion_modes_and_employee_progress.test.sql
pnpm.cmd --filter @jewelos/core test -- taskFeed.test.ts
pnpm.cmd --filter web test -- TaskComposer.test.tsx TaskCard.test.tsx TasksPage.test.tsx HomeView.test.ts presentation.test.tsx
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

Expected: every named check exits `0`. If Docker/local Supabase is unavailable, record the exact failure and do not claim pgTAP/RPC proof.

- [ ] **Step 2: Perform browser QA if a local authenticated session is available**

Verify as an authorized task creator: Task vs Checklist selection, multi-item checklist creation, and Task upload-only completion. Verify as an assignee: no Start action, upload completes Task, all required checklist items are needed before Checklist completion, and completed tasks appear only in Completed. Verify Home holds its height while My Tasks scrolls. Verify each approved leader role sees only server-authorized people rows and filters update the progress counts. Record screenshots or the browser limitation; browser proof is separate from test/build proof.

- [ ] **Step 3: Audit the staged change before publication**

Run:

```powershell
git status --short --branch
git diff --check origin/main...HEAD
git diff origin/main...HEAD | Select-String -Pattern 'service_role|SUPABASE.*KEY|password|secret|token' -CaseSensitive:$false
git status --short --branch
```

Expected: only the named migration, tests, types, task/Home/dashboard source, spec, and plan are part of the change; `artifacts/` remains untracked and unstaged. Do not push, apply hosted migrations, or deploy Vercel unless separately requested.

- [ ] **Step 4: Report the handoff**

Report changed files; deliberate behavior/data compatibility; database/RPC/RLS/Storage/audit impact; exact validation outcomes; the distinct status of Git, local database, browser QA, hosted Supabase, and Vercel; and any remaining approval gate.
