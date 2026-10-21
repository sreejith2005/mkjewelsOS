# Anytime duties and deadline-first task order (2026-10-21)

Follows `2026-10-20-on-demand-duties-design.md` (migration 0293).

## Problem

1. Imported duties without a fixed time (As Required, Per Customer, After Visit
   and every other `as_required` label) still depend on someone acting.
   Managers do not have time to press Assign now every day. The owner wants
   employees to see these duties every day as low-priority work they can finish
   whenever they like. A duty a manager enforces should move up as high priority.
2. Tasks lists were not deadline-first. The board (My Tasks, Delegated, In Loop,
   All Tasks) sorted by the **latest** deadline first. Search sorted by due date
   had no priority tie-break.

Production facts (read-only, 2026-10-21): 1,140 live `as_required` templates,
all assigned to a named employee (40 employees, median 15 duties, max 91);
1,134 are delegation duties that require an upload; no occurrence had been
started yet.

## Decisions

### A. Duties stay virtual until someone acts

Duties are not generated as daily task rows. 1,140 rows a day would flood
Task Control, reports, scores and Ask Kiara with work that may never happen,
and every unfinished row would turn into a missed task overnight. Instead:

- **Anytime duties** panel: at the bottom of My Tasks > Pending, on the last
  page, after every dated task (undated work sorts last). It is labelled
  "Low priority" and says there is no deadline. It is the same list every day,
  showing what was done today, so it "comes back" each day with no job.
- **Start (employee)** creates a **low**-priority occurrence due 23:59 today
  (Asia/Kolkata) and opens it straight away, because nearly every duty needs an
  upload to complete. No self-alert.
- **Continue** opens a duty occurrence that is already open instead of creating
  another. An enforced (high) occurrence is offered first.
- **Assign now (manager/admin)** creates a **high**-priority occurrence with the
  duty's due time (23:59 if that is under 30 minutes away). The employee is
  alerted, and it ranks with the dated tasks.

A self-started occurrence left open past 23:59 becomes overdue like any other
task that was started; the duty itself never does.

### B. Deadline first, then priority

| List | Order |
| --- | --- |
| Board, Pending and Overdue tabs | earliest deadline first, then high > medium > low, then id |
| Board, Completed tab | newest deadline first (history), then priority |
| Search, sort "Due date" (default) | earliest deadline first, then priority |
| Search, sort "Priority" / "Newest" | unchanged |

Undated work (for example an undated FMS step) sorts last.

## Contracts (migration 0297)

- `start_on_demand_task_with_audit(uuid)`: same signature, authorization and
  cap. Priority is `low` (self) or `high` (assigned); the audit row records it.
- `get_my_on_demand_duties()`: adds `completed_today` and `open_task_id`;
  `open_count` counts every non-completed, non-rejected occurrence.
- `task_workspace_page(jsonb,int,int)`: only its ORDER BY changes, patched by
  text with a fail-closed check. FMS migrations that patch this function's
  membership and filters by text do not touch the ordering text, so the two
  compose in either order.

No table, RLS, grant, Storage or signature change.
