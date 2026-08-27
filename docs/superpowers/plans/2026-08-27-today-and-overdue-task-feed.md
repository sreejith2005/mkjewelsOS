# Today and Overdue Task Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current Kolkata-day task occurrences and independently overdue historical occurrences in the Tasks feed.

**Architecture:** Keep recurring materialization unchanged. Extend the existing RLS-backed `v_all_tasks` loader with an effective-deadline candidate scope, then use shared core classification to discard non-overdue historical rows.

**Tech Stack:** React, TypeScript, Supabase PostgREST, Vitest.

**Spec:** User-provided recurring occurrence requirements in this conversation.

## Global Constraints

- Preserve one task instance per template and scheduled date.
- Use Asia/Kolkata day bounds and the existing effective-deadline order.
- Do not alter RLS, task status semantics, or recurrence generation.
- Keep future work excluded from the strict Today board.

---

### Task 1: Shared feed inclusion contract

**Files:**
- Modify: `packages/core/src/taskFeed.ts`
- Test: `packages/core/src/taskFeed.test.ts`

**Interfaces:**
- Produces: `isTaskFeedItemInCurrentDayOrOverdue(task, start, end, now)`.

- [x] **Step 1: Write the failing test**

```ts
expect(isTaskFeedItemInCurrentDayOrOverdue(yesterdayPending, start, end, now)).toBe(true);
expect(isTaskFeedItemInCurrentDayOrOverdue(todayPending, start, end, now)).toBe(true);
expect(isTaskFeedItemInCurrentDayOrOverdue(tomorrowPending, start, end, now)).toBe(false);
```

- [x] **Step 2: Run the focused core test and confirm the new assertion fails.**

- [x] **Step 3: Implement the minimal shared inclusion helper.**

- [x] **Step 4: Run the focused core test and confirm it passes.**

### Task 2: RLS-backed task loader scope

**Files:**
- Modify: `apps/web/src/features/tasks/api.ts`
- Modify: `apps/web/src/pages/TasksPage.tsx`
- Test: `apps/web/src/features/tasks/api.test.ts`

**Interfaces:**
- Consumes: `isTaskFeedItemInCurrentDayOrOverdue`.
- Produces: `loadTaskFeed(..., { includeOverdue: true })` for the Today board.

- [x] **Step 1: Write a failing test for the effective-deadline candidate predicate.**
- [x] **Step 2: Run it and confirm it fails because overdue candidates are not requested.**
- [x] **Step 3: Add the candidate predicate and shared post-query inclusion filter.**
- [x] **Step 4: Enable the option only for the Tasks page.**
- [x] **Step 5: Run focused core/web tests and the production build.**
