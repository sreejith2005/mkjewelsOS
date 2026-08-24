# All Assignment Absence Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all dated task, CRM, FMS, and recurring assignments from an absent user to their primary then secondary buddy, with explicit unresolved coverage.

**Architecture:** A forward-only database migration updates the central coverage resolver plus its reconciliation, assignment, CRM, FMS, and notification adapters. It retains the selected user as assignment history, makes the resolved buddy active, and records audited coverage metadata so every authorized task feed exposes the same effective assignee.

**Tech Stack:** PostgreSQL/Supabase RPCs, RLS, pgTAP, React/Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-24-all-assignment-absence-coverage-design.md`

## Global Constraints

- Create a forward-only `0086` migration; never modify migrations `0001` through `0085`.
- Use `is_user_available_for_task` as the availability authority and interpret dates in `Asia/Kolkata`.
- Automatic assignment order is original, primary buddy, secondary buddy; if both buddies are unavailable, use `coverage_required` and notify the manager.
- Preserve RLS, minimal grants, original-assignment history, audited writes, and cached RPC signatures.
- Do not deploy, push Git, or apply a hosted migration without separate authorization.

---

### Task 1: Database contract tests

**Files:**
- Create: `supabase/tests/0086_all_assignment_absence_coverage.test.sql`

**Interfaces:**
- Consumes: `resolve_task_coverage(uuid,date)`, `record_availability_with_audit`, and existing task, CRM, and FMS tables.
- Produces: executable authorization and behavior contract for migration `0086`.

- [ ] **Step 1: Write failing fallback assertions**

```sql
select is((select resolution from resolve_task_coverage(:absent_user, :target_date)),
  'secondary_buddy', 'unavailable primary falls through to secondary');
select is((select effective_assignee_id from resolve_task_coverage(:absent_user, :target_date)),
  null::uuid, 'no available buddy does not assign the manager');
```

- [ ] **Step 2: Run the test before the migration**

Run: `supabase.cmd test db supabase/tests/0086_all_assignment_absence_coverage.test.sql`

Expected: FAIL because the current resolver selects a reporting manager and creation hooks skip dates outside today/tomorrow.

- [ ] **Step 3: Add fixture coverage**

```sql
-- Create future-dated ordinary, CRM, and pending FMS work for an absent user.
-- Assert the effective secondary buddy receives each item, no original-assignee
-- notification is emitted, and the audit records the resolution.
-- Use authenticated fixtures for a Super Admin and for a normal user recording
-- their own absence; assert cross-tenant/other-user routing remains denied.
```

### Task 2: Authoritative SQL routing

**Files:**
- Create: `supabase/migrations/0086_all_assignment_absence_coverage.sql`
- Test: `supabase/tests/0086_all_assignment_absence_coverage.test.sql`

**Interfaces:**
- Produces: replacement `resolve_task_coverage`, reconciliation, task/CRM assignment hooks, FMS resolver, and notification functions.

- [ ] **Step 1: Replace the resolver with the approved order**

```sql
foreach v_candidate in array array[v_original.buddy_id, v_original.secondary_buddy_id] loop
  if v_candidate is not null and exists (
    select 1 from user_profiles u
    where u.id = v_candidate and u.tenant_id = v_original.tenant_id
      and u.account_status = 'active' and u.is_login_enabled
      and is_user_available_for_task(u.id, p_target_date)
  ) then
    return query select v_original.id, v_candidate,
      case when v_candidate = v_original.buddy_id then 'primary_buddy' else 'secondary_buddy' end;
    return;
  end if;
end loop;
```

- [ ] **Step 2: Remove only date-window gates**

```sql
-- Reconcile every pending work item whose due/planned date equals p_date.
-- Preserve manager_review for in-progress/in-review items.
-- Remove only the v_date/v_due_date "between today and tomorrow" branches
-- from task, CRM, FMS, and stale-original notification routing.
```

- [ ] **Step 3: Preserve atomic assignment history and manager notification**

```sql
-- Tasks deactivate the original active doer and insert an active buddy row.
-- CRM replaces assigned_to only while open. FMS replaces assigned_to and its
-- active stage-assignee row only while pending. Each write includes audit data.
-- No effective buddy sets coverage_required and alerts reports_to_user_id or the
-- department head; it never assigns that manager.
```

- [ ] **Step 4: Preserve security posture and test**

```sql
revoke all on function resolve_task_coverage(uuid,date) from public, anon, authenticated;
grant execute on function resolve_task_coverage(uuid,date) to service_role;
notify pgrst, 'reload schema';
```

Run: `supabase.cmd test db supabase/tests/0086_all_assignment_absence_coverage.test.sql`

Expected: PASS for normal-user and Super Admin fixtures.

### Task 3: Visibility and final verification

**Files:**
- Modify only a task/FMS feed test if database fixtures expose a missing active-assignee projection.

**Interfaces:**
- Consumes: persisted active assignments returned through current RLS-backed feeds.
- Produces: proof that effective buddies see their work and absent originals do not retain an active task.

- [ ] **Step 1: Add focused visibility assertion if required**

```ts
expect(taskFeedFor(secondaryBuddy.id)).toContainEqual(expect.objectContaining({ id: task.id }));
expect(taskFeedFor(absentOriginal.id)).not.toContainEqual(
  expect.objectContaining({ id: task.id, isActiveAssignee: true }),
);
```

- [ ] **Step 2: Run complete proportionate validation**

```powershell
supabase.cmd db reset
supabase.cmd test db supabase/tests/0086_all_assignment_absence_coverage.test.sql
supabase.cmd test db supabase/tests/0084_central_task_coverage_and_recurring_workspace.test.sql
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
```

- [ ] **Step 3: Review the affected migration and test diff before any separately authorized release**

Expected: no credentials, PII, whitespace error, grant, RLS, or audit regression.
