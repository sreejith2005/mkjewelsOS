# Designation Daily Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require each eligible employee to acknowledge their designation’s short daily checklist once per Asia/Kolkata working day.

**Architecture:** One tenant/designation row stores ordered daily items in JSONB and increments a revision when employee-visible content changes. An acknowledgement table records the revision and immutable item snapshot. Audited Supabase RPCs are the sole mutation boundary; a Settings editor serves Super Admin/HR and a React gate blocks required employees until they affirm every item.

**Tech Stack:** Supabase Postgres/RLS/RPC, pgTAP, React 18/Vite, TypeScript, Vitest, Testing Library, `@jewelos/core`, `@jewelos/api-client`.

**Spec:** `docs/superpowers/specs/2026-08-25-designation-daily-checklist-design.md`

## Global Constraints

- Store only the daily checklist, not a full SOP document system.
- Items are 1–20 `{ id: UUID, text: string }` values; text is 1–500 characters. Title is 1–120, instruction max 500, confirmation text 1–240.
- Eligible means account is active, login enabled, `working_status = 'active'`, has a designation, is not on the configured week-off, and has an active checklist. Use the Asia/Kolkata date.
- Only `super_admin` and `hr` manage configuration. Server authorization, audited RPCs, RLS, no direct browser writes, forward-only migration, and generated types are mandatory.
- The modal has no close/backdrop/escape dismissal; the final button enables only after all visible items are checked. Network errors remain blocking and offer retry.

---

### Task 1: Add pure daily-checklist contract

**Files:**
- Create: `packages/core/src/dailyChecklist.ts`
- Create: `packages/core/src/dailyChecklist.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces `DailyChecklistItem`, `DailyChecklistDraft`, `DailyChecklistStatus`, `validateDailyChecklistDraft(input)`, and `calculateDailyChecklistProgress(items, checkedIds)`.
- `DailyChecklistStatus = { required: boolean; date: string; checklist: { id: string; designationId: string; title: string; instruction: string | null; items: readonly DailyChecklistItem[]; confirmationText: string; revision: number } | null }`.

- [ ] **Step 1: Write failing validation and progress tests.**

```ts
it("requires every visible item before acknowledgement", () => {
  expect(calculateDailyChecklistProgress(items, new Set([items[0].id]))).toEqual({
    completedItems: 1, totalItems: 2, canAcknowledge: false,
  });
});
it("rejects duplicate item UUIDs", () => {
  expect(() => validateDailyChecklistDraft({ title: "CRM", instruction: null,
    confirmationText: "I am ready for today.", isActive: true,
    items: [items[0], { ...items[0], text: "Duplicate" }],
  })).toThrow("checklist item IDs must be unique");
});
```

- [ ] **Step 2: Run the test before implementation.**

Run: `pnpm.cmd --filter @jewelos/core test -- dailyChecklist.test.ts`

Expected: FAIL because `./dailyChecklist` does not exist.

- [ ] **Step 3: Implement the pure contract.**

```ts
export type DailyChecklistItem = Readonly<{ id: string; text: string }>;
export function calculateDailyChecklistProgress(
  items: readonly DailyChecklistItem[], checkedIds: ReadonlySet<string>,
) {
  const completedItems = items.filter((item) => checkedIds.has(item.id)).length;
  return { completedItems, totalItems: items.length,
    canAcknowledge: items.length > 0 && completedItems === items.length };
}
```

Trim input; reject invalid UUIDs, duplicate IDs, 0 or more than 20 items, and every out-of-range text field. Export the module through `packages/core/src/index.ts`.

- [ ] **Step 4: Run focused tests and typecheck.**

Run: `pnpm.cmd --filter @jewelos/core test -- dailyChecklist.test.ts; pnpm.cmd --filter @jewelos/core typecheck`

Expected: PASS and exit 0.

- [ ] **Step 5: Commit.**

```powershell
git add packages/core/src/dailyChecklist.ts packages/core/src/dailyChecklist.test.ts packages/core/src/index.ts
git commit -m "feat(core): add daily checklist contract"
```

### Task 2: Add secure persistence and RPCs

**Files:**
- Create: `supabase/migrations/0096_designation_daily_checklists.sql`
- Create: `supabase/tests/0096_designation_daily_checklists.test.sql`
- Modify: `packages/api-client/src/database.types.ts` (generated)
- Modify: `packages/core/src/database.types.ts` (generated mirror)

**Interfaces:**
- Produces `designation_daily_checklists` and `daily_checklist_acknowledgements`.
- Produces `get_my_daily_checklist_status()`, `acknowledge_daily_checklist_with_audit(p_checklist_id uuid, p_revision integer, p_checked_item_ids uuid[])`, `list_designation_daily_checklists()`, and `save_designation_daily_checklist_with_audit(p_checklist_id uuid, p_designation_id uuid, p_title text, p_instruction text, p_items jsonb, p_confirmation_text text, p_is_active boolean, p_expected_revision integer)`.

- [ ] **Step 1: Write failing pgTAP assertions using Super Admin, HR, staff, week-off, and cross-tenant fixtures.**

```sql
select is((get_my_daily_checklist_status()->>'required')::boolean, true,
  'eligible staff must acknowledge');
select throws_ok(
  $$select acknowledge_daily_checklist_with_audit('96000000-0000-4000-8000-000000000001', 1, array['96000000-0000-4000-8000-000000000011'::uuid])$$,
  '22023', 'All displayed checklist items must be checked',
  'partial acknowledgement is rejected'
);
select throws_ok(
  $$select save_designation_daily_checklist_with_audit(null, '96000000-0000-4000-8000-000000000002', 'CRM', null, '[]', 'I confirm.', true, 0)$$,
  '42501', 'Daily checklist management denied',
  'staff cannot manage daily checklists'
);
```

Also assert HR/Super Admin saves and audit rows, week-off/no-checklist skip, cross-tenant denial, same-day idempotency, one record per employee/date, snapshot preservation after a revision edit, and no direct authenticated table mutation grant.

- [ ] **Step 2: Run only this suite before the migration exists.**

Run: `supabase.cmd test db --local --file supabase/tests/0096_designation_daily_checklists.test.sql`

Expected: FAIL because the tables and RPCs are absent.

- [ ] **Step 3: Implement migration 0096.**

Create tenant-scoped tables with audit columns, foreign keys to `dropdown_masters`, `user_profiles`, and checklist IDs, RLS enabled, and:

```sql
create unique index designation_daily_checklists_one_per_designation
  on designation_daily_checklists (tenant_id, designation_id);
create unique index daily_checklist_acknowledgements_once_per_day
  on daily_checklist_acknowledgements (tenant_id, user_profile_id, acknowledgement_date);
```

The status/acknowledgement functions derive the actor with the existing profile helper, date with `timezone('Asia/Kolkata', now())::date`, and weekday against `week_off`. Return `required: false` for every ineligible condition. Lock the current checklist in acknowledgement, verify the submitted UUID set equals the stored item UUID set, copy its ordered item JSONB into the acknowledgement snapshot, insert the acknowledgement and `audit_logs` row atomically, and return the existing record on a same-day retry.

Management functions require `a.user_role in ('super_admin', 'hr')`, validate designation tenant/type/active state and JSON bounds, enforce revision 0 for create/current revision for edit, increment only when employee-visible data changes, and audit every save. Revoke defaults, grant authenticated execute only, and finish with `notify pgrst, 'reload schema';`.

- [ ] **Step 4: Reset, test, generate types, and typecheck.**

```powershell
supabase.cmd db reset
supabase.cmd test db --local --file supabase/tests/0096_designation_daily_checklists.test.sql
supabase.cmd gen types typescript --local | Set-Content -Encoding utf8 packages/api-client/src/database.types.ts
Copy-Item packages/api-client/src/database.types.ts packages/core/src/database.types.ts
pnpm.cmd --filter @jewelos/core typecheck
```

Expected: pgTAP PASS; both generated type mirrors compile.

- [ ] **Step 5: Commit.**

```powershell
git add supabase/migrations/0096_designation_daily_checklists.sql supabase/tests/0096_designation_daily_checklists.test.sql packages/api-client/src/database.types.ts packages/core/src/database.types.ts
git commit -m "feat(db): add audited designation daily checklists"
```

### Task 3: Add HR/Super Admin Settings editor

**Files:**
- Create: `apps/web/src/features/daily-checklists/api.ts`
- Create: `apps/web/src/features/daily-checklists/DailyChecklistManager.tsx`
- Create: `apps/web/src/features/daily-checklists/DailyChecklistManager.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsView.tsx`

**Interfaces:**
- `loadDailyChecklistManagement(): Promise<DailyChecklistManagementData>` invokes the list RPC.
- `saveDailyChecklist(input: DailyChecklistSaveInput): Promise<void>` invokes the save RPC.
- `DailyChecklistManager({ role }: { role: UserRole })` renders nothing unless role is `super_admin` or `hr`.

- [ ] **Step 1: Write failing editor tests.**

```tsx
it("hides management from staff", () => {
  render(<DailyChecklistManager role="staff" />);
  expect(screen.queryByRole("heading", { name: "Daily checklists" })).not.toBeInTheDocument();
});
it("requires a designation before save", async () => {
  render(<DailyChecklistManager role="hr" />);
  await userEvent.click(screen.getByRole("button", { name: "Save checklist" }));
  expect(await screen.findByText("Select a designation.")).toBeInTheDocument();
});
```

Cover add/remove/reorder, preview, successful reload after save, and a surfaced API failure without discarded draft.

- [ ] **Step 2: Run the focused suite and observe failure.**

Run: `pnpm.cmd --filter web test -- DailyChecklistManager.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement direct-RPC API calls and the Settings panel.**

Use `supabase.rpc(...)` directly, validate item JSON through Task 1 helpers, allocate new item IDs with `crypto.randomUUID()`, and use existing `Panel`, `Button`, `Notice`, and `task-field` styles. Add `<DailyChecklistManager role={profile?.user_role ?? "staff"} />` to `SettingsView`; do not create a new route.

- [ ] **Step 4: Run focused tests and web typecheck.**

Run: `pnpm.cmd --filter web test -- DailyChecklistManager.test.tsx; pnpm.cmd --filter web typecheck`

Expected: PASS and exit 0.

- [ ] **Step 5: Commit.**

```powershell
git add apps/web/src/features/daily-checklists/api.ts apps/web/src/features/daily-checklists/DailyChecklistManager.tsx apps/web/src/features/daily-checklists/DailyChecklistManager.test.tsx apps/web/src/features/settings/SettingsView.tsx
git commit -m "feat(web): manage designation daily checklists"
```

### Task 4: Add the once-daily application-entry gate

**Files:**
- Create: `apps/web/src/features/daily-checklists/DailyChecklistGate.tsx`
- Create: `apps/web/src/features/daily-checklists/DailyChecklistGate.test.tsx`
- Modify: `apps/web/src/features/daily-checklists/api.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- `loadMyDailyChecklistStatus(): Promise<DailyChecklistStatus>` invokes the status RPC.
- `acknowledgeDailyChecklist(id, revision, checkedIds): Promise<DailyChecklistStatus>` invokes acknowledgement RPC.
- `DailyChecklistGate({ profileId }: { profileId: string })` reloads when profile changes and renders only its own blocking overlay when needed.

- [ ] **Step 1: Write failing gate tests with fake timers.**

```tsx
it("shows the required dialog after the status request and 1.5 seconds", async () => {
  render(<DailyChecklistGate profileId="profile-1" />);
  await waitFor(() => expect(loadMyDailyChecklistStatus).toHaveBeenCalledOnce());
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.getByRole("dialog", { name: "CRM daily routine" })).toBeInTheDocument();
});
it("enables affirmation only after all items are selected", async () => {
  renderRequiredGate();
  const confirm = await screen.findByRole("button", { name: "I am ready for today" });
  expect(confirm).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: "Review pending follow-ups." }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Confirm today's priorities." }));
  expect(confirm).toBeEnabled();
});
```

Cover no prompt when not required, no close affordance, escape/backdrop cannot dismiss, exact submit IDs/revision, success removal, and blocking retry states for either failed request.

- [ ] **Step 2: Run focused tests before implementation.**

Run: `pnpm.cmd --filter web test -- DailyChecklistGate.test.tsx`

Expected: FAIL because gate/API exports are absent.

- [ ] **Step 3: Implement gate and install it in AppShell.**

Render a fixed full-viewport `role="dialog"`, `aria-modal="true"` overlay with labelled native checkboxes, progress, and final Button; do not attach backdrop/escape close handlers. Delay only a required result by 1500 ms. Show retry on errors. In `AppShell`, add the gate as the next sibling immediately after the current `ApplicationShell`; do not modify its props or nested `LazyPageErrorBoundary`:

```tsx
<ApplicationShell>{pageContent}</ApplicationShell>
<DailyChecklistGate profileId={profile.id} />
```

- [ ] **Step 4: Run focused UI tests and production web build.**

```powershell
pnpm.cmd --filter web test -- DailyChecklistGate.test.tsx DailyChecklistManager.test.tsx
pnpm.cmd --filter web typecheck
pnpm.cmd --filter web build
```

Expected: PASS and successful Vite build.

- [ ] **Step 5: Commit.**

```powershell
git add apps/web/src/features/daily-checklists/DailyChecklistGate.tsx apps/web/src/features/daily-checklists/DailyChecklistGate.test.tsx apps/web/src/features/daily-checklists/api.ts apps/web/src/App.tsx
git commit -m "feat(web): require daily checklist acknowledgement"
```

### Task 5: Verify locally and obtain separate release approval

**Files:**
- Modify only if a test exposes a feature defect in Tasks 1–4.

- [ ] **Step 1: Run database, lint, core, and web regressions.**

```powershell
supabase.cmd db reset
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

Expected: the new suites pass. Record pre-existing failures verbatim; do not weaken them.

- [ ] **Step 2: Browser QA using synthetic local accounts.**

Verify an eligible employee sees the modal after about 1.5 seconds; partial checking cannot submit; success suppresses it on same-day reload; week-off/no-checklist users skip it; HR can save/edit/deactivate; ordinary staff cannot manage/mutate; a later edit changes the next-day revision while the prior acknowledgement retains its snapshot.

- [ ] **Step 3: Inspect the approved change set.**

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
git diff origin/main...HEAD --check
```

Expected: only daily-checklist commits, with no secrets, production data, `.env`, or Supabase temp files.

- [ ] **Step 4: Stop for explicit hosted-release approval.**

Do not run linked Supabase migration, Git push, or Vercel deployment until the user separately confirms the target project and authorizes those external operations.
