# Assigned Work and Task Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify each normal-task assignee and give authorized managers a safe CSV import for normal tasks.

**Architecture:** Migration `0064` extends the existing normal-task RPC and adds a transactional, idempotent import RPC. The browser parses a Google Sheets CSV locally, maps headers, previews rows, and submits normalized approved rows. The existing personal Home summary and notification subscription provide the cross-account work view.

**Tech Stack:** React 18, strict TypeScript, Vitest, Supabase Postgres/RLS/RPC, pgTAP, `crypto.subtle`.

**Spec:** `docs/superpowers/specs/2026-08-20-task-assignment-and-import-design.md`

## Global Constraints

- Work only in `jewelos`; no mocks, Google credentials, raw CSV storage, or employee-code matching.
- Accept UTF-8 CSV only, at most 1 MiB and 500 rows.
- Postgres is the permission boundary. Every write is tenant/branch/department scoped and audited.
- Never log source rows, descriptions, emails, or contact details.

---

### Task 1: Database contract for alerts and import batches

**Files:**
- Create: `supabase/migrations/0064_task_import_with_notifications.sql`
- Create: `supabase/migrations/0064_task_import_with_notifications.test.sql`
- Modify: `packages/api-client/src/database.types.ts`

**Interfaces:**
- Produces `import_delegation_tasks_with_audit(p_rows jsonb,p_import_hash text) returns jsonb`.
- Produces `task_import_batches` with tenant/hash uniqueness.

- [ ] **Step 1: Write the failing pgTAP contract**

```sql
select plan(10);
select is((select count(*) from notifications where user_profile_id=:'assignee_id'::uuid and event_type='task_assigned'),1::bigint,'one normal-task alert');
select throws_ok($$ select import_delegation_tasks_with_audit('[]'::jsonb,'a') $$,'42501','.*denied.*','ordinary user denied');
```

- [ ] **Step 2: Verify red**

Run: `supabase.cmd test db --file supabase/migrations/0064_task_import_with_notifications.test.sql`

Expected: failure because neither normal-task alert nor import RPC exists.

- [ ] **Step 3: Implement migration `0064`**

```sql
create table task_import_batches (id uuid primary key default extensions.uuid_generate_v4(),tenant_id uuid not null references tenants(id),created_by uuid not null references user_profiles(id),import_hash text not null check(import_hash ~ '^[a-f0-9]{64}$'),source_headers text[] not null,requested_count integer not null check(requested_count between 1 and 500),created_count integer not null default 0,rejected_count integer not null default 0,created_at timestamptz not null default now(),unique(tenant_id,import_hash));
```

Enable RLS; give select only to the actor or admin/super-admin; revoke all direct writes. Replace `create_delegation_task_with_audit` with its same signature and, in its existing transaction, insert one notification per doer: `event_type='task_assigned'`, title `New task assigned`, message equal to task title, link `/tasks`, channel `in_app`, delivered status `delivered`.

Implement the import RPC as `security definer set search_path=public`: authenticate from `current_profile()`, require normal task-creation authority, validate 1–500 rows, resolve active/login-enabled doers by unique normalized name and/or exact email, validate tenant/branch/department/category/priority/frequency, then atomically create batch/task/assignee/checklist/notification/audit rows. Existing tenant/hash returns `{replayed:true}` with no duplicate task or alert. Revoke public/anon/service-role execution, grant authenticated execution, and notify PostgREST schema reload.

- [ ] **Step 4: Verify green and types**

Run: `supabase.cmd test db --file supabase/migrations/0064_task_import_with_notifications.test.sql; supabase.cmd gen types typescript --local --schema public > packages/api-client/src/database.types.ts; pnpm.cmd --filter @jewelos/api-client typecheck`

Expected: manager success, ordinary/cross-tenant/ambiguous-name denial, notification counts, audit rows, and replay idempotency pass.

- [ ] **Step 5: Commit Task 1**

Run: `git add supabase/migrations/0064_task_import_with_notifications.sql supabase/migrations/0064_task_import_with_notifications.test.sql packages/api-client/src/database.types.ts; git commit -m "feat: audit task imports and assignment alerts"`

### Task 2: Pure parser, header mapping, and row normalization

**Files:**
- Create: `apps/web/src/features/tasks/import/parseCsv.ts`
- Create: `apps/web/src/features/tasks/import/parseCsv.test.ts`
- Create: `apps/web/src/features/tasks/import/normalizeRows.ts`
- Create: `apps/web/src/features/tasks/import/normalizeRows.test.ts`

**Interfaces:**
- Produces `parseTaskCsv(text)`, `validateImportMapping(mapping)`, and `normalizeImportRows(parsed,mapping)`.

- [ ] **Step 1: Write failing pure tests**

```ts
it("parses a BOM header and quoted comma",()=>expect(parseTaskCsv("\uFEFFTask,Doer\n\"Stock, count\",Asha").rows[0]).toEqual({Task:"Stock, count",Doer:"Asha"}));
it("rejects 501 rows",()=>expect(()=>parseTaskCsv(csvWithRows(501))).toThrow("500"));
it("groups matching checklist rows",()=>expect(normalizeImportRows(parsed,mapping).accepted[0]?.checklist).toEqual(["Open safe","Count rings"]));
it("blocks conflicting groups",()=>expect(normalizeImportRows(conflict,mapping).blocked[0]?.reason).toMatch(/group/i));
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd exec vitest run src/features/tasks/import/parseCsv.test.ts src/features/tasks/import/normalizeRows.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement pure import logic**

```ts
export type TaskImportMapping={title:string;doerName?:string;doerEmail?:string;description?:string;dueAt?:string;priority?:string;category?:string;branch?:string;department?:string;checklist?:string;taskGroup?:string;frequency?:string};
export const MAX_IMPORT_BYTES=1024*1024; export const MAX_IMPORT_ROWS=500;
```

Implement a dependency-free quoted CSV scanner. Reject empty/unterminated/over-limit CSV, duplicate normalized headers, invalid control characters, missing title mapping, and mappings without a doer name/email. Normalize frequency to `once | daily | weekly | monthly`. With no group, one source row is one task; with a group, merge only matching non-checklist fields and block conflicts.

- [ ] **Step 4: Verify green**

Run: `pnpm.cmd exec vitest run src/features/tasks/import/parseCsv.test.ts src/features/tasks/import/normalizeRows.test.ts; pnpm.cmd --filter web typecheck`

Expected: tests and strict TypeScript pass.

- [ ] **Step 5: Commit Task 2**

Run: `git add apps/web/src/features/tasks/import; git commit -m "feat: normalize task import CSV rows"`

### Task 3: Manager upload/mapping/preview dialog

**Files:**
- Create: `apps/web/src/features/tasks/import/api.ts`
- Create: `apps/web/src/features/tasks/import/TaskImportDialog.tsx`
- Create: `apps/web/src/features/tasks/import/TaskImportDialog.test.tsx`
- Modify: `apps/web/src/pages/TasksPage.tsx`

**Interfaces:**
- Consumes `ImportPreview` and the RPC from Task 1.
- Produces `submitTaskImport(rows,hash)` and manager-only `TaskImportDialog`.

- [ ] **Step 1: Write failing dialog test**

```tsx
it("disables confirmation for unresolved doers",async()=>{render(<TaskImportDialog onClose={vi.fn()} onImported={vi.fn()}/>);await uploadCsv("Task,Doer\nStock count,Unknown person");expect(screen.getByRole("button",{name:"Import accepted tasks"})).toBeDisabled();expect(screen.getByText(/unresolved/i)).toBeTruthy();});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd exec vitest run src/features/tasks/import/TaskImportDialog.test.tsx`

Expected: module-not-found failure.

- [ ] **Step 3: Implement API and UI**

```ts
export async function submitTaskImport(rows:readonly ImportedTaskRow[],hash:string):Promise<TaskImportResult>{const {data,error}=await supabase.rpc("import_delegation_tasks_with_audit",{p_rows:rows as Json,p_import_hash:hash});if(error)throw error;return data as TaskImportResult;}
```

Load only active/login-enabled profiles plus active branch, department, category, and priority references. Hash the source text with `crypto.subtle.digest("SHA-256",new TextEncoder().encode(sourceText))` and do not persist it. Implement Upload, Map, Review, Confirm states; each source header supports `Ignore`; title plus name/email is mandatory; blocked/unresolved rows disable confirmation. Success displays returned batch counts, closes the dialog, and refreshes Tasks. Add `Import Tasks` beside the manager-visible `Create Task` control; the RPC remains authorization.

- [ ] **Step 4: Verify green**

Run: `pnpm.cmd exec vitest run src/features/tasks/import/TaskImportDialog.test.tsx src/features/tasks/TaskComposer.test.tsx; pnpm.cmd --filter web typecheck; pnpm.cmd --filter web build`

Expected: focused tests, typecheck, and build pass.

- [ ] **Step 5: Commit Task 3**

Run: `git add apps/web/src/features/tasks/import apps/web/src/pages/TasksPage.tsx; git commit -m "feat: import assigned tasks from CSV"`

### Task 4: Verify assignee Home visibility

**Files:**
- Test/Create: `apps/web/src/features/home/HomeView.test.tsx` only if existing notification subscription lacks coverage.
- Modify: `apps/web/src/features/home/HomeView.tsx` only if that test exposes a refresh gap.

- [ ] **Step 1: Write a failing refresh test only if needed**

```tsx
it("refreshes after task_assigned",async()=>{render(<HomeView onNavigate={vi.fn()}/>);notificationListener({event_type:"task_assigned"});await waitFor(()=>expect(fetchHomeSummary).toHaveBeenCalledTimes(2));});
```

- [ ] **Step 2: Make only a test-proven Home change**

Keep `get_home_summary` as the personal normal/FMS/CRM feed. Do not create a duplicate Home table/cache.

- [ ] **Step 3: Verify with two safe signed-in accounts**

Manager imports one valid staff row. Staff Home shows it under `My Tasks`; Alerts increments; inbox has exactly one `task_assigned`; `/tasks` includes it. Reimport the same CSV and verify no second task or alert.

- [ ] **Step 4: Run final checks**

Run: `pnpm.cmd --filter web test; pnpm.cmd --filter web typecheck; pnpm.cmd --filter web build; git diff --check`

Expected: report unrelated baseline failures separately; do not claim browser/runtime verification without the two-account check.
