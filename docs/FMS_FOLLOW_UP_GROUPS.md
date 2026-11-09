# FMS Follow-Up Groups

Builder shortcut (2026-11-09) that adds **Follow-Up 1**, **Follow-Up 2** and
**Follow-Up 3** after a main step. No migration, no new runtime stage type.

## What is created

`insertFmsFollowUpGroup` (`packages/core/src/fms/followUpGroup.ts`) adds three
ordinary `task` stages, built with the same defaults as **Add Step** (suggested
assignment, deadline opt-in, workflow-context default person). Each is a
Decision step with three stable outcome keys:

| Key | Label | Route |
|---|---|---|
| `proceed` | Interested, proceed | the main step's former next step |
| `follow_up_again` | No answer, follow up again | next follow-up; Follow-Up 3 -> Follow-Up 1 |
| `not_interested` | Not interested, close | existing Do not contact / Lost End Node, else unset |

Each stage carries `sla.followUpGroup = { groupId, number, parentStageKey? }`,
stored in `fms_stages.planned_time_rule` like the rest of `sla`. The runtime
never reads it.

Safety rules:

- Only a main step with a plain single next step is rewired (to Follow-Up 1).
  A main step with routes, a branch, a parallel split or an End Node keeps
  every connection; the group is added unconnected and validation reports it.
- An unset proceed or close destination is a `route_without_destination`
  issue, so the workflow cannot publish until the author chooses it.
- One insert is one `commit`, so one Undo removes the whole group.
- Paste/duplicate gives the copy a new `groupId`; a parent that was not copied
  is dropped. Deleting the main step clears `parentStageKey`.
- Only a tagged step is a follow-up. A step merely named "Follow-up" (for
  example in the Instagram or Not Bought workflows) is never reinterpreted.

## Loop and exits at runtime

Unchanged engine (migration 0212, `execution_version` 2 for every publish):
the employee's submitted outcome selects the route; returning to Follow-Up 1
inserts a new `fms_instance_stages` row with the next `visit_number` and audits
`fms_stage_revisited`. A next follow-up is created only when the previous visit
completes; automatic-only loops are still refused by client and server
validation. "Not interested, close" reaching an End Node closes the run and
creates no further work.

Customer-requested dates: leave a follow-up without its own deadline. If the
previous step's form has a follow-up/next/due date question, the follow-up is
due on that answer (`fmsAutoFormDueApplies`, migration 0361).

## Analytics

`fmsFollowUpAttempts(visits, stageRows)` reads `fms_instance_stages` rows and
the `fms_stages` rows of the versions used, and returns per visit: workflow
version, run (customer), group, parent step, follow-up number, `round`
(increases when the run returns to an earlier follow-up), total `attempt`,
employee (`completed_by`), assignees, activated/due/completed times, outcome,
exit (`proceed` / `follow_up` / `close` / `other`) and the next step.
`summarizeFmsFollowUps` totals per group: runs, completed/open/overdue attempts,
proceeded/closed/still following up, average attempts and rounds to proceed,
proceeded at Follow-Up 1/2/3 or a later round, and completed attempts per
employee. `groupId` is kept across revisions, so a group's history spans
versions while different groups never mix.

Read-only SQL to inspect the raw attempts (run by the owner):

```sql
select v.fms_instance_id, f.name, f.version,
  s.planned_time_rule #>> '{followUpGroup,groupId}' as group_id,
  parent.name as parent_step,
  (s.planned_time_rule #>> '{followUpGroup,number}')::int as follow_up_number,
  row_number() over (partition by v.fms_instance_id, s.planned_time_rule #>> '{followUpGroup,groupId}'
    order by coalesce(v.activated_at, v.created_at), v.visit_number, v.id) as attempt,
  v.status, v.outcome, v.completed_by, v.planned_datetime as due_at, v.actual_datetime as completed_at
from fms_instance_stages v
join fms_stages s on s.id = v.fms_stage_id
join fms_flows f on f.id = s.fms_flow_id
left join fms_stages parent on parent.fms_flow_id = s.fms_flow_id
  and parent.stage_key = s.planned_time_rule #>> '{followUpGroup,parentStageKey}'
where s.planned_time_rule ? 'followUpGroup'
order by 1, 4, 7;
```
