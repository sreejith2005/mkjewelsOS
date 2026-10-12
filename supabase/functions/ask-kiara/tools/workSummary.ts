import { type ActorClient, type ToolOutcome, isRecord, localTime, outcomeForError, records, untrusted } from "./shared.ts";

/**
 * `get_my_work_summary`: the caller's own Home lists. `get_home_summary` and
 * `get_my_fms_starter_assignments` run as the caller and return only work
 * assigned to them. The retired public CRM follow-ups, the activity feed, and
 * every id are dropped: Kiara needs what the work is, not how to address it.
 */
export async function getMyWorkSummary(actor: ActorClient, timeZone: string): Promise<ToolOutcome> {
  const [summary, starters] = await Promise.all([
    actor.rpc("get_home_summary", { p_context: {} }),
    actor.rpc("get_my_fms_starter_assignments"),
  ]);
  if (summary.error) return outcomeForError(summary.error);
  if (starters.error) return outcomeForError(starters.error);
  if (!isRecord(summary.data)) return { result: { error: "unavailable", message: "This information could not be loaded right now." }, isError: true };
  const home = summary.data;

  const tasks = records(home.tasks).map((task) => ({
    title: untrusted(task.title),
    type: task.task_type ?? null,
    priority: task.priority ?? null,
    status: task.status ?? null,
    due: localTime(task.due_at, timeZone),
    overdue: task.overdue === true,
    checklist_done_percent: typeof task.checklist_completion === "number" ? task.checklist_completion : null,
  }));
  const stages = records(home.fms_stages).map((stage) => ({
    workflow: untrusted(stage.instance_title),
    reference: typeof stage.reference_number === "string" ? stage.reference_number : null,
    stage: untrusted(stage.stage_name),
    status: stage.status ?? null,
    planned: localTime(stage.planned_datetime, timeZone),
    sla_breached: stage.sla_breached === true,
  }));
  const forms = records(home.forms_awaiting_submission).map((form) => ({
    form: untrusted(form.form_name),
    for_task: untrusted(form.task_title),
    due: localTime(form.due_at, timeZone),
  }));
  const starterForms = records(starters.data).map((starter) => ({
    workflow: untrusted(starter.flow_name),
    stage: untrusted(starter.stage_name),
    assigned: localTime(starter.assigned_at, timeZone),
  }));

  return {
    result: {
      today: typeof home.tenant_local_date === "string" ? home.tenant_local_date : null,
      open_tasks: tasks,
      fms_stages: stages,
      forms_to_fill: forms,
      fms_starter_forms: starterForms,
      unread_notifications: typeof home.unread_notifications === "number" ? home.unread_notifications : 0,
      availability_today: typeof home.availability_status === "string" ? home.availability_status : "not recorded",
      limits: "Like Home, this shows at most the 10 most urgent open tasks, 6 FMS stages, and 6 forms. If a list is full, there may be more in the Tasks section.",
    },
    isError: false,
  };
}
