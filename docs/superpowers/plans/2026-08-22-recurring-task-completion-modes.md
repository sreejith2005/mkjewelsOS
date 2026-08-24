# Recurring Task Completion Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring Task and Checklist modes with authoritative image-evidence or tap-to-complete behavior.

**Architecture:** A forward SQL migration persists completion mode and buddy-assignment choice on templates and generated instances. A protected RPC atomically registers validated private image evidence and completes an eligible recurring Task. The React form mirrors the supplied field order and cards render controls by stored type.

**Tech Stack:** PostgreSQL/Supabase RLS and SECURITY DEFINER RPCs, pgTAP, React 18/Vite, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-recurring-task-completion-design.md`

## Global Constraints

- Work only in the nested `jewelos` repository.
- Add forward migrations only and preserve historical records.
- Task evidence is private JPEG, PNG, or WebP with a 5 MiB maximum; database authorization and audit records are mandatory.
- Browser validation is UX only; RPC and Storage scope are authoritative.
- Stage named paths only; never credentials, `.env`, `.supabase`, `supabase/.temp`, exports, or customer data.

---

### Task 1: Database completion contract

**Files:**
- Create: `supabase/migrations/0085_recurring_task_completion_modes.sql`
- Create: `supabase/tests/0085_recurring_task_completion_modes.test.sql`
- Modify: `packages/core/src/database.types.ts`
- Modify: `packages/api-client/src/database.types.ts`

**Interfaces:**
- Consumes: `task_templates`, `task_instances`, `task_assignees`, `task_attachments`, `storage.objects`, `save_task_template_with_audit`, and `create_recurring_todo_instance`.
- Produces: `complete_recurring_task_with_image_with_audit(p_task_id uuid, p_file_url text) returns void`; persisted `task_type` and `buddy_assignment_allowed`.

- [ ] **Step 1: Write failing pgTAP coverage**

```sql
select has_function('public','complete_recurring_task_with_image_with_audit',array['uuid','text'],'image task completion uses one protected RPC');
select has_column('public','task_templates','buddy_assignment_allowed','schedules store buddy assignment choice');
select throws_ok($$select complete_recurring_task_with_image_with_audit('00000000-0000-0000-0000-000000000000','bad/path.pdf')$$,'.*','non-image evidence is rejected');
```

Add fixtures for active assigned, active unassigned, cross-branch manager, inactive profile, a delegation image Task, and a Checklist. Add one matching private JPEG storage fixture at `{tenant_id}/{task_id}/...`.

- [ ] **Step 2: Run the new test to verify it fails**

Run: `supabase.cmd test db --file supabase/tests/0085_recurring_task_completion_modes.test.sql`

Expected: FAIL because the fields and RPC do not exist.

- [ ] **Step 3: Write the minimum forward migration**

Add `buddy_assignment_allowed boolean not null default true` to templates and instances. Override the recurring save/create/workspace functions so only `checklist` and `delegation` types are accepted, instances copy the template type and buddy setting, Task forces `requires_upload=true` with no checklist items, and Checklist forces `requires_upload=false`. Include both types in recurring workspace responses.

Create the SECURITY DEFINER image-completion RPC. It must lock the instance, require an active assigned actor and delegation type, inspect the matching private `storage.objects` row for exact tenant/task path, JPEG/PNG/WebP MIME and <= 5 MiB metadata, insert `task_attachments`, set completion fields, then create one audit record in the same transaction. Reject unauthenticated, inactive, unassigned, completed, wrong-type, cross-scope, wrong-path, invalid-MIME, and oversized cases. Revoke public/anon execution and grant only authenticated callers.

For `buddy_assignment_allowed=false`, preserve the original doer as active and bypass buddy-coverage reassignment only for that recurring instance. Regenerate checked-in database type files with the repository generator if available.

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase.cmd db reset; supabase.cmd test db --file supabase/tests/0085_recurring_task_completion_modes.test.sql`

Expected: PASS for completion/audit, inheritance, and every authorization/input denial.

- [ ] **Step 5: Commit the database deliverable**

```powershell
git add -- supabase/migrations/0085_recurring_task_completion_modes.sql supabase/tests/0085_recurring_task_completion_modes.test.sql packages/core/src/database.types.ts packages/api-client/src/database.types.ts
git diff --cached --check
git commit -m "feat: secure recurring task completion modes"
```

### Task 2: Exact authoring form and typed upload API

**Files:**
- Modify: `apps/web/src/features/tasks/TaskForms.tsx`
- Modify: `apps/web/src/features/tasks/TaskForms.test.tsx`
- Modify: `apps/web/src/features/recurringTodo/api.ts`
- Modify: `apps/web/src/features/recurringTodo/model.ts`

**Interfaces:**
- Consumes: the Task 1 protected RPC and generated types.
- Produces: deterministic template payload fields `task_type`, `requires_upload`, and `buddy_assignment_allowed`, plus `completeRecurringTaskWithImage(tenantId, taskId, file)`.

- [ ] **Step 1: Write failing focused web tests**

```tsx
it("places Task Type before Buddy Assignment Allowed and serializes Task as image evidence", async () => {
  const source = await import("./TaskForms?raw").then((module) => module.default);
  expect(source.indexOf('label="Task Type"')).toBeLessThan(source.indexOf('label="Buddy Assignment Allowed"'));
  expect(source).toContain('task_type: taskMode === "task" ? "delegation" : "checklist"');
});
```

Add an API test that rejects a >5 MiB or non-image File before Storage upload and verifies that an accepted image calls the new completion RPC rather than `add_task_attachment_with_audit`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm.cmd --filter web test -- TaskForms.test.tsx`

Expected: FAIL because the new Task Type and API do not exist.

- [ ] **Step 3: Implement the minimal authoring/API changes**

Add `taskMode` initialized from `template.task_type`. Present the fields in this exact order: Assign To User, Department, Branch, Core Task, Description, Frequency, Task Start Date, Scheduled Start Time, Due Time, Task Type, Buddy Assignment Allowed. Keep recurrence variants and advanced existing controls after these. Derive Task to `delegation` + mandatory upload and Checklist to `checklist` + no upload/checklist-item editor.

Implement `completeRecurringTaskWithImage` beside `uploadTaskAttachment`: whitelist extension/MIME, reject >5 MiB, upload to the existing private tenant/task path, call the new completion RPC, and attempt object cleanup if the RPC rejects. The browser never claims completion from upload alone.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm.cmd --filter web test -- TaskForms.test.tsx`

Expected: PASS for field order, derived payload, and upload validation.

- [ ] **Step 5: Commit the authoring/API deliverable**

```powershell
git add -- apps/web/src/features/tasks/TaskForms.tsx apps/web/src/features/tasks/TaskForms.test.tsx apps/web/src/features/recurringTodo/api.ts apps/web/src/features/recurringTodo/model.ts
git diff --cached --check
git commit -m "feat: add recurring task type authoring"
```

### Task 3: Mode-specific recurring-work cards

**Files:**
- Modify: `apps/web/src/pages/RecurringTodoPage.tsx`
- Modify: `apps/web/src/pages/RecurringTodoPage.test.tsx`

**Interfaces:**
- Consumes: `RecurringInstance.task_type`, `completeRecurringTaskWithImage`, and the existing `updateTask`.
- Produces: image completion for Tasks and direct accessible checkbox completion for Checklists.

- [ ] **Step 1: Write failing page test**

```tsx
it("renders image completion for Task and tap-to-complete checkbox for Checklist", async () => {
  const source = await import("./RecurringTodoPage?raw").then((module) => module.default);
  expect(source).toContain("Upload image to complete");
  expect(source).toContain('aria-label="Complete checklist"');
  expect(source).toContain("completeRecurringTaskWithImage");
});
```

- [ ] **Step 2: Run the page test to verify it fails**

Run: `pnpm.cmd --filter web test -- RecurringTodoPage.test.tsx`

Expected: FAIL because cards currently have a generic upload and separate Complete button.

- [ ] **Step 3: Implement distinct completion controls**

For delegation Tasks show only a disabled-while-uploading control labelled `Upload image to complete`, accepting `.jpg,.jpeg,.png,.webp`, calling the new API, then refreshing after success. For Checklist render one keyboard-accessible `Complete checklist` checkbox/button that invokes existing audited task completion directly; it does not require Start or an image. Preserve forms, verification, follow-ups, and historic multi-item checklists.

- [ ] **Step 4: Run the page test to verify it passes**

Run: `pnpm.cmd --filter web test -- RecurringTodoPage.test.tsx`

Expected: PASS with separate Task and Checklist completion paths.

- [ ] **Step 5: Commit the card deliverable**

```powershell
git add -- apps/web/src/pages/RecurringTodoPage.tsx apps/web/src/pages/RecurringTodoPage.test.tsx
git diff --cached --check
git commit -m "feat: complete recurring tasks by mode"
```

### Task 4: Full verification and Git publication

**Files:**
- Modify only files from Tasks 1-3 if a verification defect is found.

- [ ] **Step 1: Run source and database validation**

```powershell
supabase.cmd db reset
supabase.cmd test db --file supabase/tests/0085_recurring_task_completion_modes.test.sql
pnpm.cmd --filter web test -- TaskForms.test.tsx RecurringTodoPage.test.tsx
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

- [ ] **Step 2: Inspect desktop and narrow-width behavior**

Run the local web app and inspect New schedule field order, both mode choices, browser image validation, checklist completion, and server-error rendering. Record a browser limitation separately if the environment prevents that inspection.

- [ ] **Step 3: Audit and push only the scoped change**

```powershell
git status --short --branch
git diff --name-only origin/main...HEAD
git diff --check origin/main...HEAD
git diff origin/main...HEAD | Select-String -Pattern 'service_role|SUPABASE.*KEY|password|secret|token' -CaseSensitive:$false
git push origin main
git status --short --branch
```

- [ ] **Step 4: Report evidence boundaries**

Report the remote SHA independently from local pgTAP, web tests, type/build, rendered UI, hosted Supabase, and Vercel evidence. Do not claim a hosted migration or deployment without separate verified action.

