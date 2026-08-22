# Recurring / To-Do and Central Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Recurring / To-Do workspace and make profile-owned primary/secondary buddy coverage authoritative across Tasks, recurring work, CRM follow-ups, and FMS stages.

**Architecture:** Pure TypeScript defines the deterministic coverage decision, while append-only Postgres migration `0084` is authoritative for protected writes and cross-module reconciliation. Existing module tables remain canonical; module adapters apply the common result transactionally, audit every change, and enqueue notifications.

**Tech Stack:** React 18, Vite, strict TypeScript, Vitest, pnpm, Supabase/Postgres, PL/pgSQL, pgTAP, Supabase Edge Functions, Tailwind, Lucide.

**Spec:** `docs/superpowers/specs/2026-08-22-recurring-todo-central-coverage-design.md`

## Global Constraints

- Work only in `C:\Users\MIS\Downloads\MKJewelOS\jewelos`.
- Preserve the existing one-off Tasks workflow and all historical task, CRM, FMS, notification, and audit records.
- `user_profiles.buddy_id` remains the Primary Buddy compatibility column; add `secondary_buddy_id`.
- Coverage order is original -> primary buddy -> secondary buddy -> reporting manager -> coverage required.
- Automatic movement is limited to pending/unclaimed work due today or tomorrow in `Asia/Kolkata`.
- In-progress or longer-dated work is retained and flagged for manager review.
- Returning to Present never automatically pulls work back.
- RLS/RPC authorization and audit writes are mandatory; frontend role gates are UX only.
- Do not apply hosted migrations, deploy Edge Functions, publish Git, or deploy the web app without separate explicit production authorization.
- Use `pnpm.cmd` and `supabase.cmd` on Windows.

---

### Task 1: Shared coverage decision model

**Files:**
- Create: `packages/core/src/taskCoverage.ts`
- Create: `packages/core/src/taskCoverage.test.ts`
- Modify: `packages/core/src/recurrence.ts`
- Modify: `packages/core/src/recurrence.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `resolveTaskCoverage(input: TaskCoverageInput): TaskCoverageDecision`
- Produces: `classifyCoverageWindow(deadline: string, status: string, now?: Date): "move" | "review" | "ignore"`
- Changes: `RecurringAvailabilityProfile` includes `secondary_buddy_id` and `reports_to_user_id`.
- Changes: `RecurringAssignment.resolution` supports `primary_buddy`, `secondary_buddy`, `reporting_manager`, and `coverage_required`.

- [ ] **Step 1: Write failing coverage tests**

```ts
it("uses the profile fallback order", () => {
  expect(resolveTaskCoverage({ original, primary, secondary, manager, availabilityByUser, targetDate })).toMatchObject({ resolution: "secondary_buddy", effectiveAssigneeId: secondary.id });
});

it("reviews in-progress work instead of moving it", () => {
  expect(classifyCoverageWindow("2026-08-23T10:00:00+05:30", "in_progress", new Date("2026-08-22T00:00:00Z"))).toBe("review");
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing exports fail**

Run: `pnpm.cmd --filter @jewelos/core test -- taskCoverage.test.ts recurrence.test.ts`

Expected: FAIL because `taskCoverage.ts` and the expanded recurrence fields do not exist.

- [ ] **Step 3: Implement the deterministic decision table**

```ts
export type TaskCoverageResolution = "original" | "primary_buddy" | "secondary_buddy" | "reporting_manager" | "coverage_required";
export type TaskCoverageDecision = { effectiveAssigneeId: string | null; originalAssigneeId: string; resolution: TaskCoverageResolution };

export function resolveTaskCoverage(input: TaskCoverageInput): TaskCoverageDecision {
  const candidates = [
    [input.original, "original"],
    [input.primary, "primary_buddy"],
    [input.secondary, "secondary_buddy"],
    [input.manager, "reporting_manager"],
  ] as const;
  const seen = new Set<string>();
  for (const [candidate, resolution] of candidates) {
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (isCoverageCandidateAvailable(candidate, input.availabilityByUser.get(candidate.id), input.targetDate)) {
      return { originalAssigneeId: input.original.id, effectiveAssigneeId: candidate.id, resolution };
    }
  }
  return { originalAssigneeId: input.original.id, effectiveAssigneeId: null, resolution: "coverage_required" };
}
```

- [ ] **Step 4: Adapt recurrence to the shared resolver and run tests**

Run: `pnpm.cmd --filter @jewelos/core test -- taskCoverage.test.ts recurrence.test.ts`

Expected: PASS with original, primary, secondary, manager, blocked, weekly-off, and Kolkata-boundary cases.

- [ ] **Step 5: Commit the shared model**

```powershell
git add -- packages/core/src/taskCoverage.ts packages/core/src/taskCoverage.test.ts packages/core/src/recurrence.ts packages/core/src/recurrence.test.ts packages/core/src/index.ts
git commit -m "feat(core): centralize task coverage decisions"
```

### Task 2: Authoritative database coverage and reconciliation

**Files:**
- Create: `supabase/migrations/0084_central_task_coverage_and_recurring_workspace.sql`
- Create: `supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql`

**Interfaces:**
- Produces: `resolve_task_coverage(uuid,date)` returning original/effective assignee and resolution.
- Produces: `reconcile_short_deadline_coverage_with_audit(uuid,date,text)` returning aggregate JSON.
- Produces: `get_recurring_todo_workspace(jsonb)` returning authorized JSON for the new page.
- Produces: audited RPCs `set_task_template_active_with_audit`, `delete_task_template_with_audit`, `verify_recurring_task_with_audit`, and `send_task_followup_with_audit`.
- Updates: `record_availability_with_audit` calls reconciliation after approved absence writes.

- [ ] **Step 1: Write failing pgTAP contract tests**

```sql
select has_column('public','user_profiles','secondary_buddy_id');
select has_function('public','resolve_task_coverage',array['uuid','date']);
select has_function('public','reconcile_short_deadline_coverage_with_audit',array['uuid','date','text']);
select has_function('public','get_recurring_todo_workspace',array['jsonb']);
select function_privs_are('public','reconcile_short_deadline_coverage_with_audit',array['uuid','date','text'],'authenticated',array['EXECUTE']);
```

Add fixtures proving primary, secondary, manager, coverage-required, manager-review, today/tomorrow, later deadline, cross-tenant denial, inactive-session denial, audit atomicity, and idempotency for task instances, CRM follow-ups, and FMS instance stages.

- [ ] **Step 2: Run the database test and confirm it fails before migration**

Run: `supabase.cmd test db supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql`

Expected: FAIL because the column and functions do not exist.

- [ ] **Step 3: Add the user-profile schema and constraints**

```sql
alter table user_profiles add column if not exists secondary_buddy_id uuid references user_profiles(id);
create index if not exists idx_user_profiles_secondary_buddy on user_profiles(secondary_buddy_id) where secondary_buddy_id is not null;
```

Redefine the buddy-scope trigger to validate both buddy columns, reject self/duplicate/cross-tenant/ineligible values, and preserve the current department/hierarchy eligibility rules.

- [ ] **Step 4: Implement the SQL decision function**

The function must evaluate the original profile, `buddy_id`, `secondary_buddy_id`, and `reports_to_user_id` exactly once each, call `is_user_available_for_task`, skip duplicates, and return `coverage_required` with a null effective assignee when no candidate qualifies.

- [ ] **Step 5: Implement transactional module adapters**

For eligible today/tomorrow records:

```sql
-- task_instances: retain original task_instance_users row, deactivate the old effective row, and add the covering doer.
-- crm_followups: update assigned_to only when status='open' and due_date is in the window.
-- fms_instance_stages: update assigned_to only when status in ('pending','assigned','ready') and not claimed/in progress.
-- all adapters: write audit_logs and notification_outbox/notifications with one idempotency key per target and absence date.
```

In-progress equivalents remain unchanged and create a manager-review audit/notification. Coverage-required records retain their original history and receive explicit coverage metadata rather than a false assignee.

- [ ] **Step 6: Reconcile availability and task-creation RPCs**

Redefine current protected functions so approved absence writes call the reconciliation RPC and manual/recurring/CRM/FMS creation resolves short-deadline coverage before commit. Preserve existing signatures when cached clients depend on them; add overloads only when unavoidable and revoke `PUBLIC` execution.

- [ ] **Step 7: Add recurring workspace read/action RPCs**

`get_recurring_todo_workspace` returns only RLS-authorized templates, instances, verification items, follow-up events, performance aggregates, and reference options. Mutation RPCs validate role, lifecycle, status, and ownership and write audit rows in the same transaction.

- [ ] **Step 8: Reset and run focused database tests**

Run:

```powershell
supabase.cmd db reset
supabase.cmd test db supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql
supabase.cmd db lint --local --level warning
```

Expected: migration reset succeeds, pgTAP passes, and lint reports no new warnings attributable to `0084`.

- [ ] **Step 9: Commit the database contract**

```powershell
git add -- supabase/migrations/0084_central_task_coverage_and_recurring_workspace.sql supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql
git commit -m "feat(db): enforce central short-deadline coverage"
```

### Task 3: Generated types, invite-user, and recurring worker

**Files:**
- Modify: `packages/core/src/database.types.ts`
- Modify: `packages/api-client/src/database.types.ts`
- Modify: `supabase/functions/invite-user/index.ts`
- Modify: `supabase/functions/generate-recurring-tasks/index.ts`
- Test: `packages/core/src/recurrence.test.ts`

**Interfaces:**
- Consumes: `resolveTaskCoverage` and the `0084` RPC contracts.
- Produces: invite payload field `secondary_buddy_id`.
- Produces: recurring assignment JSON using expanded resolution values.

- [ ] **Step 1: Add failing recurrence worker/type assertions**

Assert the worker queries `secondary_buddy_id,reports_to_user_id`, loads all unique fallback profiles, and emits `secondary_buddy` and `reporting_manager` results.

- [ ] **Step 2: Regenerate local database types**

Run: `supabase.cmd gen types typescript --local`

Write the generated output identically to both database type files using the repository's established generation workflow.

- [ ] **Step 3: Update invite-user validation and RPC arguments**

Accept an optional UUID-like `secondary_buddy_id`, pass it to the server contract, and keep all password/contact values out of logs.

- [ ] **Step 4: Update the recurrence worker**

Query primary, secondary, and manager IDs; load related profiles and availability in bounded queries; call the shared resolver; and preserve per-template failure isolation and idempotent instance creation.

- [ ] **Step 5: Run focused checks and commit**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- recurrence.test.ts taskCoverage.test.ts
pnpm.cmd exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext supabase/functions/invite-user/index.ts
```

Commit:

```powershell
git add -- packages/core/src/database.types.ts packages/api-client/src/database.types.ts supabase/functions/invite-user/index.ts supabase/functions/generate-recurring-tasks/index.ts
git commit -m "feat: expand profile coverage through recurring generation"
```

### Task 4: Users and Availability integration

**Files:**
- Modify: `apps/web/src/pages/UserManagementPage.tsx`
- Modify: `apps/web/src/pages/TeamDirectoryPage.tsx`
- Modify: `apps/web/src/pages/AvailabilityPage.tsx`
- Modify: `apps/web/src/features/tasks/api.ts`
- Create: `apps/web/src/pages/AvailabilityPage.test.tsx`
- Modify: `apps/web/src/features/tasks/UserPicker.test.tsx`

**Interfaces:**
- Consumes: generated `secondary_buddy_id` and reconciliation summary.
- Produces: User forms with Primary Buddy and Secondary Buddy.
- Produces: Availability date/range, leave metadata, and coverage-result UI.

- [ ] **Step 1: Write failing user and availability tests**

```tsx
expect(screen.getByLabelText("Primary buddy")).toBeTruthy();
expect(screen.getByLabelText("Secondary buddy")).toBeTruthy();
expect(screen.getByLabelText("Availability date")).toBeTruthy();
expect(screen.getByText(/reassigned to primary/i)).toBeTruthy();
```

- [ ] **Step 2: Run focused web tests and confirm failure**

Run: `pnpm.cmd --filter web test -- UserPicker.test.tsx AvailabilityPage.test.tsx`

- [ ] **Step 3: Update user create/edit forms**

Rename Buddy to Primary Buddy, add Secondary Buddy, clear invalid selections when branch/department/designation changes, prevent selecting the same employee twice, and send both IDs through audited server paths.

- [ ] **Step 4: Update Availability UI and API**

Add a selected date, optional end date, leave type, reason, and approval-aware save. Show primary/secondary/manager names and explain that only pending/unclaimed today/tomorrow work moves. Render aggregate primary/secondary/manager/blocked/review counts returned by the RPC.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm.cmd --filter web test -- UserPicker.test.tsx AvailabilityPage.test.tsx`

Commit:

```powershell
git add -- apps/web/src/pages/UserManagementPage.tsx apps/web/src/pages/TeamDirectoryPage.tsx apps/web/src/pages/AvailabilityPage.tsx apps/web/src/pages/AvailabilityPage.test.tsx apps/web/src/features/tasks/api.ts apps/web/src/features/tasks/UserPicker.test.tsx
git commit -m "feat(web): connect users availability and profile coverage"
```

### Task 5: Remove module-specific buddy authoring

**Files:**
- Modify: `packages/core/src/fms/types.ts`
- Modify: `packages/core/src/fms/engine.ts`
- Modify: `packages/core/src/fms/fms.test.ts`
- Modify: `apps/web/src/features/fms/FmsStageEditor.tsx`
- Modify: `apps/web/src/features/fms/FmsStageEditor.test.tsx`
- Modify: `apps/web/src/features/fms/definition.ts`
- Modify: `apps/web/src/features/fms/api.ts`
- Modify: `apps/web/src/features/tasks/TaskComposer.tsx`
- Modify: `apps/web/src/features/tasks/TaskComposer.test.tsx`

**Interfaces:**
- FMS named rules retain only `userProfileId`; `fallbackUserProfileId` is read-compatible but never authored.
- Task composer retains doers/watchers but has no recurrence or buddy input.

- [ ] **Step 1: Write failing tests for removed controls**

```tsx
expect(screen.queryByText(/fallback person/i)).toBeNull();
expect(screen.queryByText(/repeat task/i)).toBeNull();
```

Add a core test proving normalization discards newly-authored FMS fallback values while published database rows remain readable.

- [ ] **Step 2: Run focused tests and confirm current controls fail expectations**

Run: `pnpm.cmd --filter web test -- FmsStageEditor.test.tsx TaskComposer.test.tsx`

- [ ] **Step 3: Remove recurrence from one-off Tasks**

Delete repeat state, RRULE construction, recurring save callback, and template-management entry points from `TaskComposer`. Keep one-off manual/template task creation and doer/watcher selection unchanged.

- [ ] **Step 4: Remove FMS fallback authoring**

Remove the fallback selector and copy. Serialize only the named assignee; rely on the database coverage resolver when the live stage activates. Keep manual stage reassignment, escalation, and next-doer handoff.

- [ ] **Step 5: Run core/web tests and commit**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- fms/fms.test.ts
pnpm.cmd --filter web test -- FmsStageEditor.test.tsx TaskComposer.test.tsx
```

Commit the named files with `git commit -m "refactor: remove per-work-item buddy authoring"`.

### Task 6: Recurring / To-Do data client and presentation model

**Files:**
- Create: `apps/web/src/features/recurringTodo/types.ts`
- Create: `apps/web/src/features/recurringTodo/api.ts`
- Create: `apps/web/src/features/recurringTodo/presentation.ts`
- Create: `apps/web/src/features/recurringTodo/presentation.test.ts`
- Modify: `apps/web/src/features/tasks/TaskForms.tsx`

**Interfaces:**
- Produces: `loadRecurringTodoWorkspace(filters)`.
- Produces: template/action wrappers for the `0084` RPCs.
- Produces: `bucketRecurringTodoItems(items, today)` and performance presentation helpers.

- [ ] **Step 1: Write failing presentation tests**

Cover Today, Overdue, Completed, Coverage Required, Manager Review, verification, follow-up, and Kolkata date ordering.

- [ ] **Step 2: Run the focused test and confirm missing module failure**

Run: `pnpm.cmd --filter web test -- recurringTodo/presentation.test.ts`

- [ ] **Step 3: Implement strict API types and wrappers**

Parse the JSON workspace payload defensively, expose no `any`, and surface RPC errors through user-safe messages. Reuse `TaskTemplateForm` only after removing assumptions that it is launched from the one-off Tasks page.

- [ ] **Step 4: Implement pure presentation helpers and pass tests**

Run: `pnpm.cmd --filter web test -- recurringTodo/presentation.test.ts`

- [ ] **Step 5: Commit the data/presentation layer**

Commit with `git commit -m "feat(web): add recurring todo data model"`.

### Task 7: Recurring / To-Do workspace and navigation

**Files:**
- Create: `apps/web/src/pages/RecurringTodoPage.tsx`
- Create: `apps/web/src/pages/RecurringTodoPage.test.tsx`
- Create: `apps/web/src/features/recurringTodo/RecurringTodoCard.tsx`
- Create: `apps/web/src/features/recurringTodo/RecurringTemplateImport.tsx`
- Modify: `packages/core/src/roleMenu.ts`
- Modify: `packages/core/src/roleMenu.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/shell/ApplicationShell.test.ts`
- Modify: `apps/web/src/pages/TasksPage.tsx`

**Interfaces:**
- Adds page ID `recurring_todo` and route `/recurring-todo`.
- Consumes Task 6 data/actions and existing task attachment/form primitives.

- [ ] **Step 1: Write failing route and page tests**

Assert role-aware menu visibility, the route, Today/Overdue/Completed/Coverage Required tabs, Templates/Verification/Follow-Up/Performance/Import views, and absence of recurring-template controls from `TasksPage`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm.cmd --filter web test -- RecurringTodoPage.test.tsx ApplicationShell.test.ts`

- [ ] **Step 3: Add navigation and lazy route**

Add `recurring_todo` to supported roles that currently receive Tasks, use a non-blue Lucide icon, add description/full-width metadata, and render the lazy page at `/recurring-todo`.

- [ ] **Step 4: Build the employee board**

Render responsive bucket tabs, search/date filters, coverage labels, checklist/upload/form/completion actions, visible loading/error/empty states, and manager-only Coverage Required/Manager Review data.

- [ ] **Step 5: Build manager views**

Add template CRUD/activation/deletion, verification/rejection with required reason, reminder/follow-up history, personal performance, and recurring-template import preview/commit. Reuse established Button/Modal/Notice and task form components.

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test -- roleMenu.test.ts
pnpm.cmd --filter web test -- RecurringTodoPage.test.tsx ApplicationShell.test.ts TaskComposer.test.tsx
```

Commit with `git commit -m "feat(web): add recurring todo workspace"`.

### Task 8: Full verification and handoff evidence

**Files:**
- Modify only files required to fix failures caused by Tasks 1-7.

**Interfaces:**
- Verifies all prior deliverables together without broadening scope.

- [ ] **Step 1: Run focused database and module gates**

```powershell
supabase.cmd db reset
supabase.cmd test db supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
```

- [ ] **Step 2: Run monorepo static/build gates**

```powershell
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

- [ ] **Step 3: Perform security and compatibility review**

Confirm no secrets/PII in diffs or logs, all new functions revoke `PUBLIC`, authenticated/service-role grants are minimal, RLS remains enabled, task/form/FMS history is preserved, and the old cached web contract remains accepted during rollout.

- [ ] **Step 4: Record evidence boundaries**

Report exact commands and outcomes. Explicitly distinguish source/local test proof from unapplied hosted migration, undeployed Edge Function, unpushed Git, and undeployed Vercel state.

- [ ] **Step 5: Commit verification-only corrections**

Stage only named affected paths, run `git diff --cached --check`, scan the staged diff for credentials, and commit with `git commit -m "test: verify recurring todo coverage integration"` only if verification required source corrections.
