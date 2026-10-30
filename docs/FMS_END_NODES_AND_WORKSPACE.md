# FMS End Nodes, outcomes, journey and the unified workflow workspace (2026-10-30)

Branch `feat/fms-end-nodes-20261030`. Migrations `0358`, `0359`. Web only: no Android release.

## 1. Gaps found in the audit

| Area | Before | Gap |
|---|---|---|
| Authoring | `type: "end"` existed but `FMS_AUTHORING_STAGE_TYPES` excluded it; `validateFmsDefinition` raised `legacy_end_stage`; `assert_fms_flow_publishable_before_assignment` refused any `end` stage. | No way to model a business ending. Only "Complete workflow here" (an implicit, unclassified finish). |
| Runtime | `activate_fms_stage_v2_internal` already completed the instance on an `end` stage. | No outcome recorded; resolved an assignee for the End stage; open sibling work stayed open and visible; a late token after closure raised "not activatable". |
| Preview / handoff | The route planner (`fms_transition_plan_for_context`) skips `end` targets. | The confirmation dialog still opened ("Confirm Stage Completion") even when the answer simply closes the lead. |
| History | Visits, logs and transitions are persisted per visit. | No single readable journey; no record of *why* a run ended. |
| Reporting | FMS library cards counted runs from `loadFmsRuntime()`, which pages every instance and visit into the browser. | No outcome counts, no conversion, no stage reach, browser-side counts. |
| FMS Tasks page | `FMSTasksPage` downloaded the whole runtime and split it into My Stages / Started by Me / Branch View tabs. | Confusing navigation; no per-workflow overview; did not scale. |

## 2. Data model

**End Node configuration** lives on the existing stage row: `fms_stages.step_type = 'end'` and
`planned_time_rule.terminal = { outcome, reasonCode? }`. `outcome` is a stable code:
`won`, `lost`, `do_not_contact`, `other`. `reasonCode` is optional (`^[a-z][a-z0-9_]{0,63}$`).
The node's name and description (`method`) are display text and can change freely. The
draft saver already stores `planned_time_rule` verbatim, so no draft-writer change was needed,
and published versions stay immutable.

**Terminal record** `fms_instance_outcomes` (0358), one row per instance (`unique(fms_instance_id)`):
tenant, instance, flow, flow family, flow version, End Node id/key/name, outcome, reason code,
End visit id, source visit and stage, matched route id and label, source question key and the
actual saved value, source submission id, actor (`finalized_by`, null = system), final status,
provenance, number of stopped visits, branch/department, instance start time, `closed_at`.
RLS: select only, tenant + `can_read_fms_instance`. No browser insert/update/delete grant.
An update trigger refuses any change (the record is history).

Runs that finish without an End Node have no row; reports call them **unspecified**. Cancellation
(`fms_instances.status = 'cancelled'`) never writes an outcome.

## 3. Automatic finalization (0358)

The existing engine is extended, not replaced:

1. A step is completed/submitted through the existing RPCs (`transition_fms_work_with_audit` ->
   `submit_form_with_audit` + `complete_fms_stage_with_audit`). Answers, remark, evidence and the
   matched route are saved as before (`route_taken` log, `branch_rule_id` on the source visit).
2. `activate_fms_stage_v2_internal` activates the End Node. For `end` it now skips assignee
   resolution (no assignee row, no assignment notification) and calls
   `fms_finalize_terminal_internal`, in the same transaction.
3. The finalizer locks the instance, returns if an outcome already exists (idempotent), stops every
   other open visit (status `blocked`, outcome `workflow_closed`, assignees `cancelled`/inactive,
   their assignment notifications marked read, a `stopped_by_end_node` log keeping the previous
   status), writes the outcome row and audit log `fms_instance_terminal_outcome`, and completes
   the instance. The End visit is marked completed with an `automatic_completed` log.
4. The End visit emits no stage-completion event; the existing instance `fms_completed` event is
   the only notification.
5. A token that arrives after a terminal outcome (for example a parallel branch) is dropped quietly.
   Duplicate or concurrent submissions serialize on the instance lock; the loser gets "Stage is not
   actionable" and no second outcome is possible (unique constraint).
6. `fms_workspace_rows` excludes `workflow_closed` visits, so stopped work never appears as open or
   waiting in Tasks -> FMS.

Legacy End stages without `terminal` settings keep their old behaviour (complete only, no outcome).

**Preview and confirmation.** `preview_fms_work_transition(jsonb)` is wrapped: it resolves the
matched route with the same `fms_route_for_candidate` and adds `terminal: { stageName, outcome }`
when the answer reaches an End Node. The client (`runFmsHandoff`) submits directly when a terminal is
reached, nobody receives work and nothing is deferred; any human destination still shows the normal
confirmation. The committed result (`transition_fms_work_with_audit`) also carries `terminal`, and
the result card says "Workflow closed automatically at Lead Closed (Lost). No further steps."

**Publishing.** `assert_fms_end_nodes_publishable` (called from the existing publisher) refuses an
End Node that is first, has any outgoing connection, has an assignee, form, evidence, remark,
checklist, decision, follow-up or assignment source, or has no valid End type / reason code. End
Nodes count as completion points. The shared TypeScript validator enforces the same rules
(`end_first_stage`, `end_has_outgoing`, `end_has_assignee`, `end_has_work`, `invalid_end_outcome`,
`invalid_end_reason`), plus the existing reachability and loop checks.

## 4. Journey and loops

`get_fms_instance_journey(instance)` (0359) returns the persisted visits in causal order
(timestamp, then depth along `previous_instance_stage_id`), each with visit number, status,
decision, remark, completer, assignees, route label, next steps, notable log events (reassign,
approve, reject, stopped ...), and only the answers that decided a route (other answers stay
private). It also returns the outcome with its source step, question and saved value. Skipped
condition steps and stopped steps are labelled, never shown as completed. Access: the same
`can_read_fms_instance` rule as RLS. It works for completed, cancelled and older-version runs.

## 5. Builder

- **Add End** (phone, next to Add Step), the flag button on the desktop rail, and **Add End Node**
  in Workflow tools. With a step selected that has no next step, the End Node is linked to it;
  otherwise it is added unlinked and connected from a route ("Then go to", where it appears as
  **End: <name>**) or by dragging.
- End Nodes are coloured by outcome (semantic tokens: success, danger, warning, champagne), show
  "End · Won/Lost/No contact/Other" and, for published workflows, the number of finished runs.
  They have an incoming handle only: no outgoing handle and no "Add next step".
- **End Node settings** inspector: Node name, End type, Closure reason code, Description,
  "Automatic closure: always on" (read-only), Incoming connections, finished-run count, Delete.
  Assignee, deadline, questions, checklist, naming and routing are not shown.
- Simulation stops at the first End Node and states the ending; queued sibling work is reported as
  stopped, matching the server.
- Import/export carries `terminal`. The FMS AI assistant does not create End Nodes yet (its stage
  list is unchanged).

## 6. Unified workflow workspace

FMS -> **Tasks** on a workflow card opens one page (`FMSTasksPage`):

- **Reporting period**: All time, Today, This week, This month, Custom dates (India time).
- **Counts** (tap one to filter the list), **Endings and step reach** (expand).
- One filter bar: **Search customer or reference**, Status, Step, Employee, Show
  ("Everything I can see" / "Only my work"), Version (when there are several).
- One paged list (25 per page) from `get_fms_flow_records`: record name, reference, version, current
  step(s) with visit number, who has it, status/outcome, due or overdue, last update, and the next
  action (**Fill form** / **Open work** for your own step, otherwise **View details** /
  **View journey**).
- A run opens to its summary (Hold/Resume/Cancel for managers, unchanged), **Work to do** (the
  existing `FmsStageRunner`, so forms, evidence, checklist and handoffs are unchanged), **Journey**,
  and **Step details and saved answers**. Finished runs are read-only; End Nodes never show
  Mark as done.

The FMS library card now shows Running, Won, Lost and Other endings from `get_fms_library_outcomes`
and no longer downloads the runtime. Tasks -> FMS (global) is unchanged.

## 7. KPI definitions

All counts are unique workflow instances (runs) the viewer may read, for one workflow family
(all versions unless a version is chosen).

| KPI | Definition |
|---|---|
| Started | Runs whose `started_at` is in the period (the **cohort**). All time = every run. |
| Running | Cohort runs with status active or overdue. |
| Won / Lost / Do not contact / Other | Cohort runs whose outcome row has that code. |
| Other endings (card) | Other + unspecified (finished without an End Node). |
| Completed | Cohort runs with status completed (= won + lost + do not contact + other + unspecified). |
| Cancelled | Cohort runs cancelled by a manager. Not a business outcome. |
| Conversion | Won ÷ Started × 100, same cohort, one decimal. |
| End Node count | Distinct cohort runs whose outcome row names that End Node. |
| Step reach | Distinct cohort runs with a visit of that step (skipped steps excluded), plus total visits. |
| Completed in period | Separate measure: runs that finished in the period, whenever they started. |

The server checks totals add up; the decoder refuses a report where they do not.

## 8. Validation (local, isolated db-only stack built from this branch)

- `supabase db reset` from 0001 to 0359: clean.
- pgTAP `0358_fms_end_node_outcomes` 46/46, `0359_fms_outcome_reports_and_journey` 27/27
  (100 synthetic leads: 100 started, 40 running, 30 won, 20 lost, 10 do not contact, 30 %).
- Full pgTAP run: no new failures. Pre-existing failures on main are unchanged (0006, 0008, 0010,
  0031 #5/#7, 0032, 0035, 0036, 0041, 0062, 0124, 0195, 0202, and the retirement manifest's
  unclassified tables). 0031 #8 now asserts End Node validation instead of the old ban.
- Vitest: core 1341, data 198, web 756 passing. Typecheck and production build pass.
- Rendered check (temporary harness, mocked data) at 390 px and 1280 px: workspace, End Node
  inspector, canvas, journey; no horizontal overflow, no page errors.

Not proven locally: hosted Postgres/RLS behaviour, the real signed-in pages, the Android WebView.

## 9. Release steps (owner)

1. PR + CI green.
2. Confirm production is at 0357 (PR #33) or 0356; 0358/0359 must apply after it.
3. Owner applies 0358 then 0359 to production (gated script), then the session verifies.
4. Merge to `main` (Vercel deploys the web). No APK.

Owner test on production:
1. FMS -> Edit draft -> **Add End** three times: Sales Closed (Won), Lead Closed (Lost), Do Not
   Contact. Route Introduction "NOT INTERESTED ..." to **End: Lead Closed**. Publish.
2. Submit Introduction with that answer: no confirmation dialog, message "Workflow closed
   automatically at Lead Closed (Lost)", no Lead Closed task anywhere.
3. FMS -> card shows Lost 1. Tasks -> counts, then open the run -> Journey shows Introduction,
   Lead Closed and "because Client status was ...".
4. A normal handoff (Interested -> Demo) still asks who receives the next step.
