/**
 * Task Control "Reassign": which of one person's work items move to someone
 * else. The server lists the person's open work (`task_reassignment_candidates`)
 * and moves an explicit list (`reassign_task_work_with_audit`); this decides the
 * list from what the administrator ticked.
 */
export type ReassignTaskCandidate = Readonly<{ id: string; title: string; task_template_id: string | null; due_at: string | null; overdue: boolean }>;
export type ReassignWorkCandidate = Readonly<{ id: string; title: string }>;
export type ReassignCandidates = Readonly<{
  tasks: readonly ReassignTaskCandidate[];
  fms_steps: readonly ReassignWorkCandidate[];
  schedules: readonly ReassignWorkCandidate[];
}>;

/** The most items one server call accepts. */
export const REASSIGN_BATCH_SIZE = 100;

export type ReassignAllOptions = Readonly<{ upcoming: boolean; overdue: boolean; fmsSteps: boolean; schedules: boolean }>;
export type ReassignPlan = Readonly<{ taskIds: string[]; fmsStageIds: string[]; templateIds: string[] }>;

export const reassignPlanSize = (plan: ReassignPlan): number => plan.taskIds.length + plan.fmsStageIds.length + plan.templateIds.length;

/** "Reassign all open work": everything of one person, filtered by the ticked groups. */
export function planReassignAll(candidates: ReassignCandidates, options: ReassignAllOptions): ReassignPlan {
  return {
    taskIds: candidates.tasks.filter((task) => (task.overdue ? options.overdue : options.upcoming)).map((task) => task.id),
    fmsStageIds: options.fmsSteps ? candidates.fms_steps.map((step) => step.id) : [],
    templateIds: options.schedules ? candidates.schedules.map((schedule) => schedule.id) : [],
  };
}

/**
 * "Reassign selected": the ticked rows that are the person's open work. With `includeSchedules`, a selected
 * recurring task also moves its schedule (when that schedule belongs to the
 * person) and the schedule's other open tasks, so future tasks follow.
 */
export function planReassignSelected(
  candidates: ReassignCandidates,
  selectedIds: readonly string[],
  includeSchedules: boolean,
): ReassignPlan {
  const selected = new Set(selectedIds);
  const stepIds = new Set(candidates.fms_steps.map((step) => step.id));
  const ownSchedules = new Set(candidates.schedules.map((schedule) => schedule.id));
  const templateIds = includeSchedules
    ? [...new Set(candidates.tasks.flatMap((task) => selected.has(task.id) && task.task_template_id && ownSchedules.has(task.task_template_id) ? [task.task_template_id] : []))]
    : [];
  const templates = new Set(templateIds);
  const ownTasks = new Set(candidates.tasks.map((task) => task.id));
  // Rows that are not this person's open work (finished, or someone else's) are left out.
  const taskIds = new Set(selectedIds.filter((id) => ownTasks.has(id)));
  for (const task of candidates.tasks) if (task.task_template_id && templates.has(task.task_template_id)) taskIds.add(task.id);
  return { taskIds: [...taskIds], fmsStageIds: selectedIds.filter((id) => stepIds.has(id)), templateIds };
}

/** Splits a plan into server calls of at most `size` items, keeping the order tasks, steps, schedules. */
export function batchReassignPlan(plan: ReassignPlan, size: number = REASSIGN_BATCH_SIZE): ReassignPlan[] {
  const items = [
    ...plan.taskIds.map((id) => ["task", id] as const),
    ...plan.fmsStageIds.map((id) => ["step", id] as const),
    ...plan.templateIds.map((id) => ["template", id] as const),
  ];
  const batches: ReassignPlan[] = [];
  for (let start = 0; start < items.length; start += size) {
    const chunk = items.slice(start, start + size);
    batches.push({
      taskIds: chunk.flatMap(([kind, id]) => kind === "task" ? [id] : []),
      fmsStageIds: chunk.flatMap(([kind, id]) => kind === "step" ? [id] : []),
      templateIds: chunk.flatMap(([kind, id]) => kind === "template" ? [id] : []),
    });
  }
  return batches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

const text = (value: unknown, fallback: string): string => typeof value === "string" && value.trim() ? value : fallback;

/** Reads the `task_reassignment_candidates` response. */
export function parseReassignCandidates(value: unknown): ReassignCandidates {
  if (!isRecord(value)) throw new Error("The work list could not be read.");
  return {
    tasks: list(value.tasks).flatMap((row) => typeof row.id === "string" ? [{
      id: row.id, title: text(row.title, "Untitled task"),
      task_template_id: typeof row.task_template_id === "string" ? row.task_template_id : null,
      due_at: typeof row.due_at === "string" ? row.due_at : null, overdue: row.overdue === true,
    }] : []),
    fms_steps: list(value.fms_steps).flatMap((row) => typeof row.id === "string" ? [{ id: row.id, title: text(row.title, "FMS step") }] : []),
    schedules: list(value.schedules).flatMap((row) => typeof row.id === "string" ? [{ id: row.id, title: text(row.title, "Recurring schedule") }] : []),
  };
}

export type ReassignSkipped = Readonly<{ id: string; reason: string }>;
export type ReassignResult = Readonly<{ moved: string[]; skipped: ReassignSkipped[] }>;

/** Reads one `reassign_task_work_with_audit` response. */
export function parseReassignResult(value: unknown): ReassignResult {
  if (!isRecord(value)) throw new Error("The reassignment result could not be read.");
  return {
    moved: Array.isArray(value.moved) ? value.moved.filter((id): id is string => typeof id === "string") : [],
    skipped: list(value.skipped).flatMap((row) => typeof row.id === "string" ? [{ id: row.id, reason: text(row.reason, "Could not be moved") }] : []),
  };
}
