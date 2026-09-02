# FMS Runtime Read Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broad FMS runtime browser reads with one cursor-paginated, server-authorized read while retaining current FMS behaviour and access control.

**Architecture:** Migration `0111` adds `load_fms_runtime_page`, which derives actor scope from `current_profile()`, retrieves one permitted instance page, and aggregates only its dependent runtime records into JSON. The web API decodes it to the existing arrays; the page has an explicit, append-only Load more action.

**Tech Stack:** Supabase/Postgres, pgTAP, generated core database types, React 18, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-fms-runtime-read-performance-design.md`

## Global Constraints

- Work on `main`; preserve unrelated dirty work.
- Create forward-only `supabase/migrations/0111_fms_runtime_read_performance.sql`; do not modify historical migrations.
- Never accept tenant, branch, department, or assignee scope from the browser. Derive it from the active current profile.
- Preserve existing RLS, audited write RPCs, Storage rules, and assignment eligibility.
- First page defaults to 50, maximum is 100; order is `started_at DESC NULLS LAST, id DESC`.
- Regenerate `packages/core/src/database.types.ts`; do not recreate API-client database types.
- No hosted Supabase/Vercel/Auth/data action is in scope.

---

### Task 1: Define and prove the database contract

**Files:**
- Create: `supabase/tests/0111_fms_runtime_read_performance.test.sql`
- Create: `supabase/migrations/0111_fms_runtime_read_performance.sql`
- Modify: `packages/core/src/database.types.ts`

**Interfaces:**
- Produces: `load_fms_runtime_page(p_page_size integer default 50, p_cursor text default null) returns jsonb`.
- Returns: `{ instances, stages, definitions, flows, checklist, evidence, logs, users, next_cursor }`.

- [ ] **Step 1: Write the failing pgTAP test**

Seed two tenants, an active super-admin, a branch manager, a participant, two branches, a published flow and 52 deterministic instances. Add stage/checklist/evidence/log rows to returned and non-returned instances. Assert the missing function, then the intended observable contract:

```sql
select has_function('public', 'load_fms_runtime_page', array['integer','text'],
  'runtime page reader exists');
select throws_ok($$select load_fms_runtime_page(101, null)$$, '22023',
  'Page size must be between 1 and 100', 'oversized page is rejected');
select results_eq($$select jsonb_array_length(load_fms_runtime_page(50, null)->'instances')$$,
  array[50], 'first page contains 50 instances');
```

Add assertions for deterministic continuation/no duplicate IDs; child rows belonging only to page instances; manager branch isolation; participant-only visibility; tenant isolation; inactive profile `42501`; and no removed evidence.

- [ ] **Step 2: Run the test to verify it fails before implementation**

Run `supabase.cmd test db --file supabase/tests/0111_fms_runtime_read_performance.test.sql`.

Expected: failure because the RPC does not exist. If local Supabase cannot run, record that condition and do not claim database verification.

- [ ] **Step 3: Implement migration 0111**

Define the function as `stable security definer set search_path=public`. Reject page sizes outside 1-100 and any malformed cursor with `22023`. Obtain `v_actor` solely from `current_profile()` and reject a missing/inactive profile with `42501`. Materialize up to `p_page_size + 1` from `fms_instances` where `tenant_id=v_actor.tenant_id and can_read_fms_instance(id)`, ordered by the specified tuple. Build each child array from the materialized page IDs only; include only active login-enabled referenced users and non-removed evidence. Use deterministic `jsonb_agg` ordering and empty JSON arrays.

Create only:

```sql
create index if not exists idx_fms_instances_runtime_page
  on fms_instances (tenant_id, started_at desc nulls last, id desc);
```

Set owner to `postgres`; revoke function access from `public`, `anon`, `authenticated`, and `service_role`; grant execute only to `authenticated`; then `notify pgrst, 'reload schema'`.

- [ ] **Step 4: Regenerate types and make tests pass**

Use the repository's approved type-generation process, then verify the generated signature is:

```ts
load_fms_runtime_page: {
  Args: { p_cursor?: string | null; p_page_size?: number };
  Returns: Json;
};
```

Run `pnpm.cmd --filter @jewelos/core typecheck` and the pgTAP command above. Expected: both pass.

- [ ] **Step 5: Capture local plan evidence**

After `supabase.cmd db reset`, use representative local fixtures and run:

```sql
explain (analyze, buffers)
select id from fms_instances
where tenant_id = (select id from tenants order by created_at limit 1)
order by started_at desc nulls last, id desc
limit 51;
```

Record whether the intended index is used. Do not add child-table indexes unless an exact query plan supports them.

- [ ] **Step 6: Commit the isolated database contract**

Run `git add supabase/migrations/0111_fms_runtime_read_performance.sql supabase/tests/0111_fms_runtime_read_performance.test.sql packages/core/src/database.types.ts` followed by `git commit -m "feat: page FMS runtime reads on the server"`.

### Task 2: Replace the broad web reader with typed RPC decoding

**Files:**
- Modify: `apps/web/src/features/fms/api.ts`
- Create: `apps/web/src/features/fms/api.test.ts`

**Interfaces:**
- Consumes: `load_fms_runtime_page({ p_page_size: 50, p_cursor })`.
- Produces: `loadFmsRuntime(cursor?: string | null): Promise<FmsRuntimePage>`, retaining present arrays plus `nextCursor: string | null`.

- [ ] **Step 1: Write the failing mapping tests**

Mock `supabase.rpc`. Assert the initial call is exactly `load_fms_runtime_page` with `{ p_page_size: 50, p_cursor: null }`, that no `.from()` broad table read is called, valid arrays/`next_cursor` map accurately, and malformed payloads throw the existing labelled error.

- [ ] **Step 2: Verify the test fails**

Run `pnpm.cmd --filter web exec vitest run src/features/fms/api.test.ts --reporter=verbose`.

Expected: failure because `loadFmsRuntime` performs eight table queries.

- [ ] **Step 3: Implement strict decode**

Define `FmsRuntimePage` alongside the present FMS types. Replace the `Promise.all` table queries with the RPC call. Check that the result is an object and every required collection is an array before casting to the current FMS row types; map `next_cursor` to `nextCursor`. Leave every mutation and signed-evidence function unchanged.

- [ ] **Step 4: Verify and commit**

Run the focused Vitest command and `pnpm.cmd --filter web typecheck`; both must pass. Commit only these two paths with `git commit -m "refactor: load FMS runtime through page contract"`.

### Task 3: Add explicit, safe continuation to the FMS page

**Files:**
- Modify: `apps/web/src/pages/FMSTasksPage.tsx`
- Create: `apps/web/src/pages/FMSTasksPage.test.tsx`

**Interfaces:**
- Consumes: `FmsRuntimePage.nextCursor` and `loadFmsRuntime(nextCursor)`.
- Produces: unchanged first-page UX and an accessible `Load more FMS instances` control.

- [ ] **Step 1: Write failing UI tests**

Mock auth, realtime, forms, and `loadFmsRuntime`. Assert initial render loads the first page once; a cursor shows the button; clicking calls the loader with that cursor; continuation arrays append by primary key without duplicates; a selected item remains selected; and continuation failure keeps visible rows while showing a retryable error.

- [ ] **Step 2: Verify the tests fail**

Run `pnpm.cmd --filter web exec vitest run src/pages/FMSTasksPage.test.tsx --reporter=verbose`.

Expected: failure because continuation state/action does not exist.

- [ ] **Step 3: Implement append-only pagination**

Track `nextCursor` and `loadingMore`. Keep `refresh()` as first-page replacement for realtime/mutations. Implement `loadMore()` with cursor/busy guards, typed primary-key de-duplication for every returned array, and no background prefetch. Render the disabled-while-loading button. Do not change filters, status action RPCs, signed evidence, or client-side authorization.

- [ ] **Step 4: Verify and commit**

Run focused page tests, `pnpm.cmd --filter web test`, and `pnpm.cmd --filter web typecheck`. Expected: pass. Commit only the page and test with `git commit -m "feat: paginate live FMS instances"`.

### Task 4: Verify, document, and hand off

**Files:**
- Modify: `PROJECT_HANDOFF.md` only if local validation actually passes and the source summary needs `0111`.

- [ ] **Step 1: Run final local checks**

Run:

```powershell
supabase.cmd db reset
supabase.cmd test db --file supabase/tests/0111_fms_runtime_read_performance.test.sql
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/core typecheck
pnpm.cmd --filter web test
pnpm.cmd --filter web typecheck
git diff --check
```

Expected: zero failures. Report any unrelated baseline failure separately.

- [ ] **Step 2: Verify scope and record evidence boundaries**

Run `git diff --name-status origin/main...HEAD` and `git status --short`. Confirm only named FMS paths plus pre-existing dirty Phase 1 files are present. Document only completed local proof, and explicitly state that no hosted migration push, deployment, production data action, or authenticated browser smoke test occurred.

- [ ] **Step 3: Commit the handoff only when changed**

Run `git add PROJECT_HANDOFF.md` and `git commit -m "docs: record FMS runtime page reader verification"` only if the handoff contains verified facts.
