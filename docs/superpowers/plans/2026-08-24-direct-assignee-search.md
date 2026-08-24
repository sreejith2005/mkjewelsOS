# Direct Assignee Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow authorized staff to search the full active tenant roster and assign people directly, with organization context shown and server-derived assignment scope.

**Architecture:** A shared web picker exposes searchable, accessible single/multi-person selection. Task, FMS, and CRM adapters pass tenant-authorized roster data to it. A forward migration changes the protected assignment contracts to derive assignee-bound scope from `user_profiles`, validates independent business scope separately, keeps audit writes transactional, and grants authorized cross-branch assignment without cross-tenant access.

**Tech Stack:** React 18, TypeScript, Vitest/Testing Library, Supabase Postgres/RLS/RPC, pgTAP, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-24-direct-assignee-search-design.md`

## Global Constraints

- Work only in `jewelos`; preserve unrelated work and write no mock roster data.
- The browser uses only authenticated Supabase clients and never receives a service-role credential.
- Applied migrations remain immutable; add one next-numbered forward migration and matching pgTAP coverage.
- Sensitive writes stay in protected RPCs with active-actor, tenant, eligibility, scope, and audit checks in one transaction.
- The picker includes only active/login-enabled authorized people, searches name/code/role/department/branch, and shows `Department · Branch · Role`.
- New normal manual tasks accept exactly one original assignee; the established coverage resolver assigns an absent original to an available primary buddy, then secondary buddy, and records original/effective coverage fields.
- Branch/department remain for independent workflow/client/visit business scope; only assignment cascades are removed.
- Use named-path staging, `git diff --cached --check`, and a credential-safe staged scan before every publish.

---

### Task 1: Shared searchable assignee control

**Files:**
- Create: `apps/web/src/components/assignees/AssigneePicker.tsx`
- Create: `apps/web/src/components/assignees/assigneePicker.test.tsx`
- Modify: `apps/web/src/features/tasks/UserPicker.tsx`
- Modify: `apps/web/src/features/tasks/UserPicker.test.tsx`

**Interfaces:**
- Produces `AssigneePicker`, accepting `people`, `selectedIds`, `onChange`, `multiple`, `excludedIds`, `label`, `branchNames`, and `departmentNames`.
- Produces `assigneeSearchText(person, branchNames, departmentNames)` for direct pure search assertions.

- [ ] **Step 1: Write failing picker tests**

```tsx
it("searches across name, code, branch, department, and role", async () => {
  render(<AssigneePicker label="Assign user" multiple={false} people={[ananya]} selectedIds={[]} onChange={vi.fn()} branchNames={branches} departmentNames={departments} />);
  await userEvent.type(screen.getByRole("textbox", { name: "Search assign user" }), "bandra");
  expect(screen.getByText("Sales · Bandra · Staff")).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused test to verify red**

Run: `pnpm.cmd --filter web exec vitest run src/components/assignees/assigneePicker.test.tsx`

Expected: FAIL because `AssigneePicker` does not exist.

- [ ] **Step 3: Implement the minimal shared control**

```tsx
export function AssigneePicker({ multiple, onChange, selectedIds, ...props }: AssigneePickerProps) {
  const [search, setSearch] = useState("");
  const visiblePeople = useMemo(() => filterAssignees(props.people, search, props.branchNames, props.departmentNames), [props.people, search, props.branchNames, props.departmentNames]);
  return <fieldset>{/* labelled search and selectable results with context */}</fieldset>;
}
```

Use `useDeferredValue(search)` only if filtering the loaded roster is measurably non-trivial; do not add a network search endpoint.

- [ ] **Step 4: Convert the Task adapter without changing its public call sites**

Make `UserPicker` translate `TaskUser` rows to `AssigneePicker` input and retain multi-select/disabled-doer behavior. Remove duplicate search/result markup.

- [ ] **Step 5: Run focused picker tests to verify green**

Run: `pnpm.cmd --filter web exec vitest run src/components/assignees/assigneePicker.test.tsx src/features/tasks/UserPicker.test.tsx`

Expected: PASS; visible rows include organizational context and searches find every named field.

### Task 2: Direct Tasks and FMS assignment interactions

**Files:**
- Modify: `apps/web/src/features/tasks/TaskComposer.tsx`
- Modify: `apps/web/src/features/tasks/TaskComposer.test.tsx`
- Modify: `apps/web/src/features/tasks/DelegateTaskModal.tsx`
- Modify: `apps/web/src/features/fms/FmsFlowBuilder.tsx`
- Modify: `apps/web/src/features/fms/FmsStageRunner.tsx`
- Modify: `apps/web/src/features/fms/FmsStageEditor.test.tsx`
- Modify: `apps/web/src/features/fms/startScope.ts`
- Modify: `apps/web/src/features/fms/startScope.test.ts`

**Interfaces:**
- Task composer derives `branch_id`/`department_id` from its selected original doer for the protected task RPC.
- FMS direct-person selection derives the initial instance branch/department from the selected first assignee while leaving flow scope configuration unchanged.

- [ ] **Step 1: Write failing Task and FMS behavior tests**

```tsx
it("selects one Bandra Sales user without first selecting Bandra or Sales", async () => {
  renderComposer({ data: tenantWideData });
  await user.click(screen.getByRole("button", { name: /Users/i }));
  await user.type(screen.getByRole("textbox", { name: /Search users/i }), "Ananya");
  await user.click(screen.getByLabelText(/Ananya Shah/));
  expect(screen.getByText("Sales · Bandra · Staff")).toBeTruthy();
});
```

```ts
expect(resolveFmsStartFromAssignee(data, "right")).toEqual({ branchId: "b", departmentId: "b-sales", firstAssigneeId: "right" });
```

- [ ] **Step 2: Run focused tests to verify red**

Run: `pnpm.cmd --filter web exec vitest run src/features/tasks/TaskComposer.test.tsx src/features/fms/startScope.test.ts`

Expected: FAIL because both paths retain the cascade requirement.

- [ ] **Step 3: Implement direct task selection**

Remove task-composer branch/department inputs from the Users panel. Offer the full eligible tenant roster in single-select mode; derive payload `branch_id` and `department_id` from the selected original doer, and keep watcher selection tenant-wide with that doer excluded.

- [ ] **Step 4: Implement direct FMS person selection**

Use the shared picker for named FMS default assignees and live next-assignee choices. Remove hard-coded fallback-person logic. Add a pure helper that resolves initial branch/department from a selected eligible first owner; retain `FmsFlowBuilder` scope controls and existing coverage resolution in the database.

- [ ] **Step 5: Run focused tests to verify green**

Run: `pnpm.cmd --filter web exec vitest run src/features/tasks/TaskComposer.test.tsx src/features/tasks/UserPicker.test.tsx src/features/fms/FmsStageEditor.test.tsx src/features/fms/startScope.test.ts src/pages/FMSBuilderPage.test.tsx`

Expected: PASS; assignment selection does not require branch/department UI, organizational context is visible, and workflow scope still renders.

### Task 3: Direct CRM assignment interactions

**Files:**
- Modify: `apps/web/src/features/crm/ClientForm.tsx`
- Modify: `apps/web/src/features/crm/ClientDetail.tsx`
- Modify: `apps/web/src/features/crm/WalkinForm.tsx`
- Modify: `apps/web/src/features/crm/FollowupsPanel.tsx`
- Modify: `apps/web/src/features/crm/components.test.tsx`
- Modify: `apps/web/src/features/crm/types.ts`

**Interfaces:**
- CRM person options carry role, branch, and department context.
- Client/walk-in/follow-up assignment sends only the selected profile ID; independent home/visit branch remains explicit where required.

- [ ] **Step 1: Write failing CRM assignment tests**

```tsx
it("searches all eligible CRMs and shows the selected CRM organization", async () => {
  render(<ClientForm options={crossBranchOptions} onCancel={vi.fn()} onSaved={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /Assigned CRM/i }));
  await user.type(screen.getByRole("textbox", { name: /Search assigned CRM/i }), "Andheri");
  expect(screen.getByText("CRM · Andheri · CRM")).toBeTruthy();
});
```

- [ ] **Step 2: Run the CRM test to verify red**

Run: `pnpm.cmd --filter web exec vitest run src/features/crm/components.test.tsx`

Expected: FAIL because CRM filters assignees by the selected branch and uses native selects.

- [ ] **Step 3: Replace CRM assignment-only selects**

Use the shared control for Assigned CRM, Salesperson, follow-up assignee, and reassignment. Keep independent client home-branch and walk-in visit-branch inputs. Render selected organization context and do not reset an assignee merely because an independent branch changes.

- [ ] **Step 4: Run CRM tests to verify green**

Run: `pnpm.cmd --filter web exec vitest run src/features/crm/components.test.tsx src/features/crm/viewModel.test.ts`

Expected: PASS; cross-branch people can be searched by authorized actors and independent branch fields remain present.

### Task 4: Protected direct-assignment migration and database contracts

**Files:**
- Create: `supabase/migrations/0086_direct_assignee_search_scope.sql`
- Create: `supabase/tests/0086_direct_assignee_search_scope.test.sql`
- Modify: `packages/api-client/src/database.types.ts`
- Modify: `apps/web/src/features/tasks/api.ts`
- Modify: `apps/web/src/features/fms/api.ts`
- Modify: `apps/web/src/features/crm/api.ts`

**Interfaces:**
- Produces a security-definer helper to resolve an active eligible tenant profile and scoped RPC replacements that derive assignee-bound organizational context.
- Preserves audited RPC entry points while rejecting caller-supplied scope that conflicts with the selected profile and independent CRM branch requirements.

- [ ] **Step 1: Write failing pgTAP tests**

```sql
select lives_ok($$ select create_delegation_task_with_audit(jsonb_build_object('title','Cross branch','planned_datetime',now()+interval '1 day','priority','medium'), array[:'other_branch_user'::uuid], '{}'::uuid[], '[]'::jsonb) $$, 'authorized manager can assign one active same-tenant cross-branch doer');
select throws_ok($$ select create_delegation_task_with_audit(jsonb_build_object('title','Bad','planned_datetime',now()+interval '1 day','priority','medium'), array[:'inactive_user'::uuid], '{}'::uuid[], '[]'::jsonb) $$, '23514', '.*active.*', 'inactive doer denied');
select is((select coverage_resolution from task_instances where title='Covered task'), 'secondary_buddy', 'absent original and absent primary resolve to active secondary buddy');
```

- [ ] **Step 2: Run the pgTAP test to verify red**

Run: `supabase.cmd test db --file supabase/tests/0086_direct_assignee_search_scope.test.sql`

Expected: FAIL because current RPCs require caller scope / cross-branch restrictions.

- [ ] **Step 3: Implement the forward migration**

Create `resolve_assignable_profile(p_profile_id uuid, p_required_roles user_role[] default null)` as a non-public, security-definer helper with a fixed `search_path`. Recreate only affected RPCs, loading the actor with `current_profile()`, checking management authority, calling the helper, deriving assignee-bound task/FMS values, validating independent CRM branch values, retaining the established `resolve_task_coverage` primary-then-secondary logic for the task planned date, and writing existing audit rows transactionally. Require exactly one normal-task doer. Revoke public/anon/service-role execution, grant only required authenticated calls, and reload PostgREST schema.

- [ ] **Step 4: Regenerate types and update browser API calls**

Run: `supabase.cmd gen types typescript --local --schema public | Out-File -Encoding utf8 packages/api-client/src/database.types.ts`

Update task/FMS/CRM API adapters only after generated signatures are reviewed; never cast an unverified RPC name or payload to bypass type checking.

- [ ] **Step 5: Run focused database and API verification**

Run: `supabase.cmd test db --file supabase/tests/0086_direct_assignee_search_scope.test.sql; pnpm.cmd --filter @jewelos/api-client typecheck; pnpm.cmd --filter web typecheck`

Expected: PASS for authorized cross-branch selection and denial of ordinary/inactive/cross-tenant/mismatched-scope calls.

### Task 5: Integrated verification, publication, and requested migration deployment

**Files:**
- Modify only test or source files exposed by Tasks 1-4.

- [ ] **Step 1: Run focused regression suite and static checks**

Run: `pnpm.cmd --filter web test -- --runInBand; pnpm.cmd exec turbo run typecheck --force --concurrency=1; pnpm.cmd exec turbo run build --force --concurrency=1; git diff --check`

Expected: record exact pass/fail output; separate unrelated baseline failures from this work.

- [ ] **Step 2: Review publish scope and commit**

Run: `git status --short --branch; git add <named implementation paths>; git diff --cached --check; git diff --cached --name-only; git diff --cached | Select-String -Pattern 'service_role|SUPABASE.*KEY|password|secret|token' -CaseSensitive:$false; git commit -m "feat: search users directly for assignments"; git push origin main`

Expected: only approved source, tests, types, migration, and plan paths are committed; no credentials or unrelated files are included.

- [ ] **Step 3: Confirm linked Supabase target and run hosted preflight**

Run: `supabase.cmd migration list --linked; supabase.cmd db push --linked --dry-run`

Expected: identify the linked non-secret project reference and confirm the dry run contains exactly migration `0086_direct_assignee_search_scope.sql` plus any known pending approved migrations.

- [ ] **Step 4: Deploy the reviewed migration and verify history**

Run: `supabase.cmd db push --linked; supabase.cmd migration list --linked`

Expected: migration history records `0086` as applied. Do not deploy a web host or Edge Function without a separate explicit deployment target/approval.
