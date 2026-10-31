# FMS due dates from form answers, and the stage-column task board (2026-10-30)

Branch `feat/fms-due-board-20261030`. Migration `0360_fms_form_due_dates_and_task_board.sql`.
Web only: no Android release (the app is the web shell).

## 1. Audit (what was already there)

| Area | State on `main` (e6339cb2) | Gap |
|---|---|---|
| Deadlines | `activate_fms_stage_v2_internal` sets `planned_datetime` from `fms_stage_deadline_for_instance(rule)`: completion date, TAT, days before a date, specific clock time. | Nothing reads a form answer. A "Next Follow-up Date" answer never became the next task's deadline. |
| Assigned To | `resolve_fms_visit_assignment` reads the causal previous visit's submitted form (0288). | Deadline did not use the same source. Leave cover used the rule date only. |
| End Nodes | 0358/0359 live: automatic closure, outcomes, journey, run reports. | none (preserved). |
| Tasks -> FMS | Workflow -> stage -> card accordion (`FmsTaskWorkspace` + `FmsTaskGroups`), `get_fms_task_*` RPCs, assignee-only scope. | Long nested lists, no overdue/today counts per workflow or stage, no priority, no team view. |
| FMS Library -> Tasks | Opened `FMSTasksPage` (runs, outcomes, journeys) in place. | A second task screen. |
| Uncommitted work in the main checkout | Another session's stale branch has an unmerged `0353_advanced_fms_scheduling_task_scope.sql` with a single-source `followUp.schedule`. | Not on `main`/production; its number collides with main's 0353. Not used. This branch is the one implementation. |

## 2. Due date from a form answer

**Configuration** lives in `fms_stages.planned_time_rule.formDue` (draft saver stores it verbatim):

```json
{ "sources": [ { "stageKey": "intro", "dateFieldKey": "next_date", "timeFieldKey": "next_time" },
               { "stageKey": "demo",  "dateFieldKey": "meet_at" } ],
  "defaultTime": "11:00",
  "onMissing": "fallback" }
```

* One source per earlier step that can lead here, so Introduction -> Follow-up 1 and Demo -> Follow-up 1 each use their own form.
* `dateFieldKey`: a `date` or `datetime` question (stable field key, never the title). `timeFieldKey`: optional text/select/radio question next to a `date` question ("3:30 PM", "15:30", "3pm").
* `defaultTime`: time for a date-only answer; empty = end of that day (23:59:59.999999) in the tenant timezone (fallback `Asia/Kolkata`).
* `onMissing`: `fallback` (use the step's normal timing rule), `none` (no due date), `require` (refuse the previous step's submission).

**Builder** (step settings -> When / Deadline): "Due date source" = From form answer / Fixed date and time / TAT / relative / No due date. Existing methods are unchanged. From form answer lists "Arriving from <step>" for each incoming form step (through automatic steps). A question is pre-selected only when that step's section has exactly one date question with a due-date name (next, follow-up, due, deadline, appointment, meeting ...); with several date questions the author must choose. Existing explicit configurations are never overwritten. The shared validator (`fmsFormDueIssues`) and the publisher (`assert_fms_form_due_publishable`) refuse: non-person steps, the first step, empty sources, duplicate sources, non-date questions, a time question next to a datetime question, unknown policies.

**Runtime** (`fms_form_due_resolution`, same transaction as the visit insert):

1. Source = the nearest earlier visit on this route (`execution_path` + previous visit) that has a form and was not condition-skipped — the same causal path Assigned To uses. A parallel branch or an older visit with a similar question is never read.
2. That visit's stage must be one of `sources`; otherwise the answer is "route not configured".
3. The answer comes only from that visit's submitted `form_submissions` row. The date question must be shown, its condition met, its section reached and, for a section-scoped step, inside that section. Hidden, skipped or unanswered questions count as missing.
4. Parsing is strict (`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM[:SS]` wall time in the tenant timezone, or with an explicit offset). Malformed values are invalid, never guessed. A time without a date is not a deadline.
5. Missing/invalid -> `require` raises `23514` ("Enter a valid "<question>" in the form for step <step> ..."), so the submission, completion and next visit roll back together; `fallback` uses `fms_stage_deadline_for_instance`; `none` stores null.
6. A valid past date is stored as is and is immediately overdue.

**Precedence**: valid form answer -> configured fallback rule -> (steps without `formDue`) existing fixed/TAT rule -> null.

**Storage**: `fms_instance_stages.planned_datetime` (timestamptz). No new column. Provenance: one `fms_stage_logs` row `due_date_resolved` per visit with source (`form_answer`/`fallback`/`none`), reason, source visit, submission, question keys and the stored value. Completed visits are never rewritten.

**Leave cover** now uses the resolved due day: `fms_assignment_coverage` gained a `p_deadline` overload and `resolve_fms_visit_assignment` passes the resolved date (also during the handoff preview, with the candidate answers).

**Not built** (no existing contract to extend): manual rescheduling of FMS deadlines. The browser has no update grant on `fms_instance_stages` (pgTAP proves it), so nobody can reschedule another employee's task. A correction to an earlier answer does not move an active deadline.

## 3. Priority and urgency

* Business priority = `fms_instances.priority` (High/Medium/Low, `task_priority`). Never changed by a deadline.
* Urgency is computed separately (`fms_due_urgency`, mirrored by `fmsDueUrgency`): `overdue` (past due, or status overdue), `today` (due later today in the tenant timezone; a date-only end-of-day deadline stays "today" all day), `upcoming`, `none`.
* Sort "Due soonest": overdue, today, upcoming, no date; then due time (oldest first); then priority; then id (stable). Sort "Highest priority": priority first, then the same.
* Finished, waiting and End-Node-closed work never counts as overdue. Reminders: no new reminder service; existing notifications are unchanged.

## 4. Tasks -> FMS board

**Who sees it (owner decision 2026-10-30, follow-up):** only users with `tasks.manage_team` or `tasks.view_all` (managers, admins, super admins). Everyone else keeps the original workflow -> stage -> record list (`FmsStaffWorkspace`, unchanged), and their FMS Library **Tasks** still opens the run workspace. The board shows only steps with tasks by default ("Show empty steps" reveals the rest) and a step bar jumps to any column in one click.

* **Level 1** `/tasks?view=fms`: workflows with exact server counts (active, overdue, due today) from `get_fms_task_workspace`; To do / Waiting / Done chips; search by workflow, customer or reference.
* **Level 2** `/tasks?view=fms&workflow=<family>` (refresh, direct link and Back work): `get_fms_task_board` returns, in one read, every stage of each version holding the caller's work (plus the latest published version), with exact count / overdue / today per column and the first 20 cards per column. `fmsBoardColumns` keeps person steps in graph order (`orderFmsWorkspaceStages`); automatic steps and End Nodes are not columns. Empty columns show "No pending work." Versions are never merged: each column is one stage id, labelled `vN` when several versions run.
* Cards: customer (authorized record name), REF, due date/time (`describeDue`, "5 Nov 2026 · 3:30 pm"), priority, Visit N, assignee in team view. Key = visit id. Opening a card runs the existing work page (`fmsAssignedWorkPath`); finishing returns to the same board (per-tab `sessionStorage`, only for the work opened from it).
* Toolbar: Search customer or reference, All / Overdue / Due today / Upcoming (with counts), Priority, Sort, Show (To do / Waiting for others / Done), Refresh; with `tasks.manage_team` or `tasks.view_all`: Whose work (My work / My team) and Employee.
* Paging: columns scroll inside a bounded area; "Show 20 more" calls `get_fms_task_stage_page` with the same filters and order. Realtime refresh (existing topics) reloads counts and first pages; cards are de-duplicated by id.
* Phone: a horizontal row of step buttons with counts and one column at a time; desktop: side-by-side columns with scroll arrows. Filters, scroll position and the phone's step are kept per tab.
* FMS Library card: **Tasks** opens the same board URL; **Runs** opens the run/outcome workspace (`FMSTasksPage`), also reachable from the board as "Runs and outcomes" (`/fms?runs=<family>`).

**Team scope** (`scope: "all"`): open, assigned visits of active instances that `can_read_fms_work_context` already allows (tasks.view_all, or tasks.manage_team in the caller's branch). Staff asking for the team get their own work only. Starting forms stay personal.

## 5. RPC / schema impact

| Object | Change |
|---|---|
| `fms_due_parse_time/date/datetime`, `fms_form_due_resolution`, `fms_stage_due_for_visit`, `fms_record_due_source`, `assert_fms_form_due_publishable`, `fms_due_urgency`, `fms_board_rows`, `fms_board_cards`, `fms_board_order_key` | New, private (no browser grant). |
| `get_fms_task_board(uuid,jsonb,integer)` | New, `authenticated`. Validated by `fms_workspace_validate` (module access, active profile). |
| `get_fms_task_workspace`, `get_fms_task_stage_page` | Replaced with compatible supersets (new fields: family active/overdue/dueToday, counts.dueToday, card priority/urgency/assignees). |
| `fms_workspace_rows`, `fms_workspace_validate`, `activate_fms_stage_v2_internal`, `fms_stage_deadline_for_instance`, `is_valid_fms_timing_rule`, `fms_assignment_coverage`, `resolve_fms_visit_assignment`, `assert_fms_flow_publishable` | Patched by marker (migration stops if a marker drifted). Default behaviour unchanged for every stage without `formDue` and every call without the new filters. |
| Index | `fms_instance_stages_open_due (planned_datetime, id)` for open visits. |
| Types | `database.types.ts`: `get_fms_task_board`. |

## 6. Validation (local, isolated db-only stack `jdue`, ports 586xx)

* `supabase db reset` 0001 -> 0360: clean.
* pgTAP `0360_fms_form_due_dates_and_task_board`: 60/60 (publication rules; Intro->F1 date+time+Assigned To; F1->F2 end of day; F2->F3 default time; Demo->F1 datetime; skipped conditional; required missing/malformed rolls back with no downstream visit; fallback TAT; loop visit 2; past date overdue; retry no duplicate; history kept; no direct reschedule; landing/board/stage-page counts exact beyond the page; overdue first; filters; priority sort; repeat visits; manager team scope and employee filter; staff team = own; other tenant sees nothing; End Node closure removes cards).
* Full pgTAP: no new failures. Pre-existing failures unchanged (0006, 0008, 0010, 0031 #5/#7, 0032, 0035, 0036, 0041, 0062, 0106/0199/0207/0213-0220 retirement manifest, 0124, 0195, 0202, 0208 plan count). 0312 passed when run alone (its budget test timed out once under the full parallel load).
* Vitest: see the PR description for the final counts.
