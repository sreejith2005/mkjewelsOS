# FMS Assigned Work Contract Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every pending FMS starter assignment and active runtime stage appear as an identifiable FMS task, deep-link to its exact work surface, complete transactionally after the required form, and clear its assignment notification.

**Architecture:** Extend the security-invoker task feed with a stable FMS work discriminator and starter-assignment rows, while preserving the effective-deadline optimization introduced by migration 0158. Put link parsing and task-card decisions in `@jewelos/core`, keep database access in the existing web/data API layers, and route web/native clients to focused starter or runtime form screens. Use database triggers to close notifications whenever the underlying assignment completes, so completion remains correct regardless of entry surface.

**Tech Stack:** PostgreSQL/Supabase RLS and pgTAP, TypeScript, React 18/Vite, Expo/React Native, Vitest.

**Delivery boundary:** This plan is independently shippable. Complete it before the canvas and Forms Builder plans because those plans consume its canonical FMS work identity. The actual Git root in this checkout is `C:\Users\MIS\Downloads\MKJewelOS`; record the mismatch with the nested path currently stated in `AGENTS.md`, but do not move files or create another repository.

---

### Task 1: Define one cross-client FMS work identity

**Files:**
- Create: `packages/core/src/fms/assignedWork.ts`
- Create: `packages/core/src/fms/assignedWork.test.ts`
- Modify: `packages/core/src/fms/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for destination construction and parsing**

```ts
expect(fmsAssignedWorkPath({
  kind: "starter_form",
  starterAssignmentId: "starter-2",
  formTemplateId: "form-7",
})).toBe("/tasks/fms?starter=starter-2&form=form-7");

expect(parseFmsAssignedWorkPath(
  "/tasks/fms?instance=instance-5&stage=stage-3&form=form-7",
)).toEqual({
  kind: "stage_form",
  instanceId: "instance-5",
  instanceStageId: "stage-3",
  formTemplateId: "form-7",
});

expect(parseFmsAssignedWorkPath("/tasks/fms?instance=instance-5")).toEqual({
  kind: "stage",
  instanceId: "instance-5",
  instanceStageId: null,
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module does not exist**

Run: `pnpm.cmd --filter @jewelos/core test -- src/fms/assignedWork.test.ts`

Expected: FAIL with an unresolved `./assignedWork` import.

- [ ] **Step 3: Implement the discriminated union and strict parser**

```ts
export type FmsAssignedWorkTarget =
  | { kind: "starter_form"; starterAssignmentId: string; formTemplateId: string }
  | { kind: "stage_form"; instanceId: string; instanceStageId: string; formTemplateId: string }
  | { kind: "stage"; instanceId: string; instanceStageId: string | null };

export function fmsAssignedWorkPath(target: FmsAssignedWorkTarget): string;
export function parseFmsAssignedWorkPath(path: string): FmsAssignedWorkTarget | null;
```

Reject partial starter/form combinations, preserve the legacy instance-only URL, and use `URLSearchParams` so identifiers are encoded exactly once.

- [ ] **Step 4: Export the helpers and run the focused test**

Run: `pnpm.cmd --filter @jewelos/core test -- src/fms/assignedWork.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit only the core files**

```powershell
git add packages/core/src/fms/assignedWork.ts packages/core/src/fms/assignedWork.test.ts packages/core/src/fms/index.ts packages/core/src/index.ts
git diff --cached --check
git commit -m "feat: define canonical FMS assigned work links"
```

### Task 2: Add starters to the authorized task feed and consolidate assignment notifications

**Files:**
- Create: `supabase/migrations/0160_fms_assigned_work_contract.sql`
- Create: `supabase/tests/0160_fms_assigned_work_contract.test.sql`
- Modify after generation: `packages/api-client/src/database.types.ts`
- Modify after generation: `packages/core/src/database.types.ts`

- [ ] **Step 1: Write pgTAP assertions for the new contract**

Cover these exact cases with synthetic tenants and authenticated claims:

```sql
select has_column('public', 'v_all_tasks', 'fms_work_source');
select has_column('public', 'v_all_tasks', 'fms_instance_id');

select is(
  (select count(*)::integer from public.v_all_tasks
   where id = '15951000-0000-4000-8000-000000000001'
     and fms_work_source = 'fms_starter'),
  1,
  'pending starter assignment is visible to its assignee'
);

select ok(
  not exists(select 1 from public.v_all_tasks
             where id = '15951000-0000-4000-8000-000000000002'),
  'completed starter assignment is absent'
);
```

Also assert: runtime rows use `fms_stage`; ordinary task rows use null; cross-tenant and another user's starter stay invisible; `security_invoker=true`; anon lacks SELECT; authenticated retains SELECT; the legacy `trg_notify_fms_stage_assignment` trigger is absent; completing either assignment marks only the matching recipient notification read.

- [ ] **Step 2: Run the new database test and confirm the expected schema failures**

Run: `supabase.cmd test db supabase/tests/0160_fms_assigned_work_contract.test.sql`

Expected: FAIL because the two view columns and completion triggers do not exist yet.

- [ ] **Step 3: Add migration 0160 without editing migrations 0158 or the existing untracked 0159**

Recreate `public.v_all_tasks` with the complete 0158 column order plus these trailing columns:

```sql
fms_work_source text,
fms_instance_id uuid,
fms_instance_stage_id uuid,
fms_starter_assignment_id uuid
```

The three union branches must emit:

```text
ordinary task -> null, null, null, null
runtime stage -> 'fms_stage', fi.id, fis.id, null
starter       -> 'fms_starter', null, null, starter.id
```

For the starter branch, join `fms_flows`, `fms_stages`, branches, and the pinned `form_templates` record; expose `starter.id` as the row `id`, `task_type='fms'`, `status='pending'`, `requires_form=true`, the pinned `form_template_id`, and `starter.user_profile_id` as `assignee_id`. Filter to `starter.status='pending'`. Preserve `security_invoker`, existing grants, and `effective_due_datetime`.

- [ ] **Step 4: Replace ambiguous and duplicate notification generation in the same forward migration**

Recreate `queue_fms_starter_assignments(uuid,uuid)` with the existing authorization and audit behavior, but write:

```sql
source_module = 'fms',
source_record_id = v_assignment.id,
action_url = '/tasks/fms?starter=' || v_assignment.id ||
             '&form=' || v_assignment.form_template_id
```

Recreate `emit_fms_stage_assignment_event()` so its canonical event URL includes `instance`, runtime `stage`, and the pinned form when one exists. Drop only the obsolete direct-notification trigger:

```sql
drop trigger if exists trg_notify_fms_stage_assignment
  on public.fms_instance_stage_assignees;
```

Keep the notification-event/outbox path and do not weaken its grants or tenant filters.

- [ ] **Step 5: Add server-side notification completion triggers**

Create narrow `security definer` trigger functions with fixed `search_path=public,extensions`. On a starter transition to `completed`, mark unread `fms_starter_assigned` notifications read only when tenant, `user_profile_id=completed_by`, `source_module='fms'`, and `source_record_id=new.id` all match. On a runtime stage transition to `completed`, use the FMS instance tenant and the completing actor to close only matching stage-assignment notifications. Preserve notification history by setting `is_read=true` and `read_at=coalesce(read_at,now())`; do not delete rows.

- [ ] **Step 6: Run database tests and lint**

Run:

```powershell
supabase.cmd db reset
supabase.cmd test db
supabase.cmd db lint --local --level warning
```

Expected: all migrations apply; all pgTAP tests pass; no new lint warning.

- [ ] **Step 7: Regenerate types and confirm only the expected view additions**

Run the repository's documented local Supabase type-generation command, then inspect both generated files. The diff must contain the four new nullable view fields and no unrelated schema drift.

- [ ] **Step 8: Commit only migration, pgTAP, and generated types**

```powershell
git add supabase/migrations/0160_fms_assigned_work_contract.sql supabase/tests/0160_fms_assigned_work_contract.test.sql packages/api-client/src/database.types.ts packages/core/src/database.types.ts
git diff --cached --check
git commit -m "fix: expose durable FMS assigned work"
```

### Task 3: Make task-feed date filtering preserve all open FMS work

**Files:**
- Modify: `packages/core/src/taskCardState.ts`
- Modify: `packages/core/src/taskCardState.test.ts`
- Modify: `packages/data/src/tasks/api.ts`
- Modify: `packages/data/src/tasks/api.test.ts`
- Modify: `apps/web/src/features/tasks/api.ts`
- Modify: `apps/web/src/features/tasks/api.test.ts`

- [ ] **Step 1: Add failing tests for source-aware visibility and card state**

Assert that the PostgREST OR expression contains the existing current/overdue effective-deadline branches plus `and(task_type.eq.fms,status.in.(pending,in_progress,in_review,overdue))`. Assert that `fms_starter` and `fms_stage` rows produce an `FMS` badge and a form action when `form_template_id` is present.

- [ ] **Step 2: Run focused tests and confirm future/null-date FMS rows are currently omitted**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- src/taskCardState.test.ts
pnpm.cmd --filter @jewelos/data test -- src/tasks/api.test.ts
pnpm.cmd --filter web test -- src/features/tasks/api.test.ts
```

Expected: FAIL on the new FMS-independent filter assertions.

- [ ] **Step 3: Centralize the pure filter and card decision**

Export one core helper that builds the date/FMS PostgREST expression. Both API implementations call it; neither keeps a copied string. Extend the existing task-card state, without changing ordinary/checklist/required-upload behavior, so the source fields decide the exact FMS action.

- [ ] **Step 4: Run the focused tests**

Expected: all three commands PASS.

- [ ] **Step 5: Commit the scoped feed changes**

```powershell
git add packages/core/src/taskCardState.ts packages/core/src/taskCardState.test.ts packages/data/src/tasks/api.ts packages/data/src/tasks/api.test.ts apps/web/src/features/tasks/api.ts apps/web/src/features/tasks/api.test.ts
git diff --cached --check
git commit -m "fix: retain open FMS work in task feeds"
```

### Task 4: Route web Home, Tasks, and notifications to the exact assigned form

**Files:**
- Modify: `packages/core/src/roleMenu.ts`
- Modify: `packages/core/src/roleMenu.test.ts`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/FmsAssignedWorkPage.tsx`
- Create: `apps/web/src/pages/FmsAssignedWorkPage.test.tsx`
- Modify: `apps/web/src/pages/TasksPage.tsx`
- Modify: `apps/web/src/features/tasks/TaskCard.tsx`
- Modify: `apps/web/src/features/tasks/TaskCard.test.tsx`
- Modify: `apps/web/src/features/home/HomeView.tsx`
- Modify: `apps/web/src/features/home/HomeView.test.tsx`
- Delete: `apps/web/src/features/fms/deepLink.ts`
- Delete: `apps/web/src/features/fms/deepLink.test.ts`

- [ ] **Step 1: Write failing route and interaction tests**

Assert:

```ts
expect(resolvePageId("/tasks/fms?starter=s-1&form=f-1")).toBe("checklist_tasks");
expect(resolvePageId("/tasks/fms?instance=i-1&stage=is-1&form=f-1")).toBe("checklist_tasks");
```

Render the focused page for each union member. Starter must render `FormRenderer` immediately and call `submitFmsStarterAssignment(formId, starterId, answers)`. Runtime form must render the exact instance-stage runner/form and call `submitFmsFormAndProgress` with `instanceStageId`. Instance-only legacy links must still render the FMS stage workspace. Assert no intermediate Dashboard or Forms Library heading.

- [ ] **Step 2: Run focused web/core tests and observe the current Dashboard/forms routing failures**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- src/roleMenu.test.ts
pnpm.cmd --filter web test -- src/pages/FmsAssignedWorkPage.test.tsx src/features/home/HomeView.test.tsx src/features/tasks/TaskCard.test.tsx
```

- [ ] **Step 3: Install the focused route under Tasks authorization**

Make `/tasks/fms` resolve only to `checklist_tasks`. In `App.tsx`, render `FmsAssignedWorkPage` before the ordinary Tasks page branch. The page parses the shared target, loads only the pinned template/stage required for that target, displays an explicit inaccessible/finished state on an authorized empty result, and never falls back to Dashboard.

- [ ] **Step 4: Point Home and TaskCard actions at the shared destination**

Starter cards use `starterAssignmentId`; runtime cards use the new view identity columns. Preserve the existing `FMS` tag and ordinary task actions. Remove the web-only deep-link helper after all imports use `@jewelos/core`.

- [ ] **Step 5: Run focused and full web tests**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- src/roleMenu.test.ts src/fms/assignedWork.test.ts src/taskCardState.test.ts
pnpm.cmd --filter web test -- src/pages/FmsAssignedWorkPage.test.tsx src/features/home/HomeView.test.tsx src/features/tasks/TaskCard.test.tsx
pnpm.cmd --filter web test
```

Expected: PASS; existing task, form, and route tests remain green.

- [ ] **Step 6: Commit only the web route files**

```powershell
git add packages/core/src/roleMenu.ts packages/core/src/roleMenu.test.ts apps/web/src/App.tsx apps/web/src/pages/FmsAssignedWorkPage.tsx apps/web/src/pages/FmsAssignedWorkPage.test.tsx apps/web/src/pages/TasksPage.tsx apps/web/src/features/tasks/TaskCard.tsx apps/web/src/features/tasks/TaskCard.test.tsx apps/web/src/features/home/HomeView.tsx apps/web/src/features/home/HomeView.test.tsx apps/web/src/features/fms/deepLink.ts apps/web/src/features/fms/deepLink.test.ts
git diff --cached --check
git commit -m "fix: deep link web FMS assignments to forms"
```

### Task 5: Give native Home and Tasks the same FMS behavior

**Files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/screens/TasksScreen.tsx`
- Modify: `apps/mobile/src/screens/TaskDetailScreen.tsx`
- Modify: `apps/mobile/src/features/tasks/TaskCard.tsx`
- Modify: `apps/mobile/src/features/tasks/TaskCard.test.tsx`
- Create: `apps/mobile/src/features/fms/assignedWorkNavigation.ts`
- Create: `apps/mobile/src/features/fms/assignedWorkNavigation.test.ts`

- [ ] **Step 1: Write failing native navigation tests**

Assert these mappings:

```text
starter_form -> FormFill { formTemplateId, starterAssignmentId }
stage_form   -> FmsStageForm { instanceId, instanceStageId, formTemplateId }
stage        -> FmsTasks { instanceId }
```

Also assert TaskCard exposes an `FMS` tag and dispatches an FMS-specific action instead of the ordinary `TaskForm` action.

- [ ] **Step 2: Run the focused mobile tests and confirm the absent action/mapping failures**

Run: `npm --prefix apps/mobile test -- src/features/fms/assignedWorkNavigation.test.ts src/features/tasks/TaskCard.test.tsx`

- [ ] **Step 3: Add the typed navigation helper and wire every entry surface**

Use the same core union for Home starter/stage rows and task-feed rows. `TasksScreen` and `TaskDetailScreen` must resolve `fms_work_source` before ordinary form handling. Keep ordinary required-form tasks on `TaskForm`; only FMS starter work uses `FormFill`, and only runtime FMS form work uses `FmsStageForm`.

- [ ] **Step 4: Run focused tests and mobile typecheck**

Run:

```powershell
npm --prefix apps/mobile test -- src/features/fms/assignedWorkNavigation.test.ts src/features/tasks/TaskCard.test.tsx
npm --prefix apps/mobile run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit only the native assigned-work files**

```powershell
git add apps/mobile/src/navigation/types.ts apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/screens/HomeScreen.tsx apps/mobile/src/screens/TasksScreen.tsx apps/mobile/src/screens/TaskDetailScreen.tsx apps/mobile/src/features/tasks/TaskCard.tsx apps/mobile/src/features/tasks/TaskCard.test.tsx apps/mobile/src/features/fms/assignedWorkNavigation.ts apps/mobile/src/features/fms/assignedWorkNavigation.test.ts
git diff --cached --check
git commit -m "fix: open exact FMS forms from native work lists"
```

### Task 6: Add regression doctrine to AGENTS.md

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/REGRESSION_CHECKLIST.md`

- [ ] **Step 1: Add a protected cross-surface workflow section**

State that Home alerts, Notifications, Tasks, direct URLs, web, and native are entry surfaces onto one persisted work item; changes to task/FMS/form identifiers, routes, completion, or notification state require a consumer inventory and cross-surface tests. Explicitly require starter-assignment IDs rather than form-ID inference, form submission and stage completion to remain one server-side transaction, notification completion to be derived from durable work state, and mobile parity checks for builder/canvas edits.

- [ ] **Step 2: Add manual regression rows**

Add authenticated checks for starter assignment, runtime form-only stage, runtime stage with additional evidence, unrelated user, completed notification history, direct deep links, narrow web viewport, and Android phone.

- [ ] **Step 3: Verify the documentation diff and commit**

```powershell
git diff --check -- AGENTS.md docs/REGRESSION_CHECKLIST.md
git add AGENTS.md docs/REGRESSION_CHECKLIST.md
git diff --cached --check
git commit -m "docs: protect cross-surface FMS workflow invariants"
```

### Task 7: Run end-to-end local and rendered regression gates

**Files:**
- Modify only if evidence reveals a scoped defect in files already listed above.

- [ ] **Step 1: Run full local database and TypeScript gates**

```powershell
supabase.cmd start
supabase.cmd db reset
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web test
npm --prefix apps/mobile test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

- [ ] **Step 2: Use authenticated browser QA at 390x844 and desktop width**

Verify Home starter click, Home runtime-form click, Tasks FMS tag, exact focused form, form-only auto-completion, notification disappearance from unread state, additional-requirement stage remaining open, browser back behavior, and direct-link refresh. Record screenshots and console errors separately from automated test output.

- [ ] **Step 3: Run Android proof on a device/emulator**

Build/install the app, launch without Metro for the release artifact, sign in, and repeat Home/Tasks/direct form flows. Do not claim native UX proof from typecheck alone.

- [ ] **Step 4: Inspect final history and worktree**

Run: `git status --short --branch` and `git log --oneline --max-count=8`.

Confirm each commit contains only named files and all pre-existing unrelated dirty files remain intact.
