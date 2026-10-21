import { normalizeTaskParticipants } from "./taskParticipants";

export type ManualTaskMode = "task" | "checklist";
/**
 * How several selected users receive one composed task: `separate` creates one
 * task per user (each completes their own), `shared` creates one task every
 * user can complete for all. One selected user always gets one task.
 */
export type ManualTaskAssignmentMode = "separate" | "shared";
export type ManualTaskPriority = "low" | "medium" | "high";

const PRIORITY_CODES: readonly ManualTaskPriority[] = ["high", "medium", "low"];
const PRIORITY_DEFAULT_LABELS: Readonly<Record<ManualTaskPriority, string>> = { high: "High", medium: "Medium", low: "Low" };

/**
 * The priority choices a task author sees. The database fixes the three codes
 * (enum `task_priority`; migration 0021 forbids changing them), so all three
 * are always offered, high first. Dropdown Master only renames them: a label
 * from an active master row wins, and a missing or switched-off row falls back
 * to the plain name instead of hiding a valid priority.
 */
export function taskPriorityChoices(
  masterRows: readonly Readonly<{ value: string; label: string }>[],
): Array<{ value: ManualTaskPriority; label: string }> {
  return PRIORITY_CODES.map((value) => ({
    value,
    label: masterRows.find((row) => row.value === value)?.label.trim() || PRIORITY_DEFAULT_LABELS[value],
  }));
}

export type ManualTaskEligiblePerson = Readonly<{
  id: string;
  branchId: string | null;
  departmentId: string | null;
  eligible: boolean;
}>;

export type ManualTaskDraftInput = Readonly<{
  title: string;
  description: string;
  plannedDatetime: string;
  priority: ManualTaskPriority;
  mode: ManualTaskMode;
  selectedDoerIds: readonly string[];
  selectedWatcherIds: readonly string[];
  /** Applies only when several users are selected; defaults to `separate`. */
  assignmentMode?: ManualTaskAssignmentMode;
  formTemplateId: string;
  checklistItems: readonly string[];
  eligiblePeople: readonly ManualTaskEligiblePerson[];
}>;

export type ManualTaskPayload = Readonly<{
  title: string;
  description: string;
  planned_datetime: string;
  priority: ManualTaskPriority;
  branch_id: string;
  department_id: string;
  task_type: "delegation" | "checklist";
  requires_upload: boolean;
  requires_remark: false;
  requires_form: boolean;
  form_template_id: string;
}>;

export type ManualTaskChecklistItem = Readonly<{
  item_text: string;
  is_required: true;
  sort_order: number;
}>;

export type ManualTaskCreateRequest = Readonly<{
  payload: ManualTaskPayload;
  doerIds: readonly string[];
  watcherIds: readonly string[];
  checklist: readonly ManualTaskChecklistItem[];
}>;

export type ManualTaskDraftError = Readonly<{ message: string }>;
export type ManualTaskDraftResult =
  | Readonly<{ requests: readonly ManualTaskCreateRequest[] }>
  | Readonly<{ error: ManualTaskDraftError }>;

/**
 * Builds the audited RPC requests for one composed task. Organization
 * identifiers always come from the eligible roster record, never from editable
 * form state. The server requires every doer of a task to share its branch and
 * department, so a shared task is offered only for such a group; separate
 * tasks each take their own doer's organization.
 */
export function buildManualTaskCreateRequests(input: ManualTaskDraftInput): ManualTaskDraftResult {
  const title = input.title.trim();
  if (!title) return error("Add a task title.");

  const participants = normalizeTaskParticipants(input.selectedDoerIds, input.selectedWatcherIds);
  if (participants.doerIds.length === 0) return error("Select at least one user.");

  const doers: ManualTaskEligiblePerson[] = [];
  for (const doerId of participants.doerIds) {
    const person = input.eligiblePeople.find((candidate) => candidate.id === doerId);
    if (!person) return error("The selected user is no longer available.");
    if (!person.eligible) return error("The selected user is outside your task authoring scope.");
    if (!person.branchId || !person.departmentId) return error("The selected user needs an active branch and department.");
    doers.push(person);
  }

  if (!input.plannedDatetime.trim()) return error("Choose a due date and time.");
  const planned = new Date(input.plannedDatetime);
  if (Number.isNaN(planned.getTime())) return error("Choose a valid due date and time.");

  const checklist = input.checklistItems
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item_text, sort_order) => ({ item_text, is_required: true as const, sort_order }));
  if (input.mode === "checklist" && checklist.length === 0) return error("Add at least one checklist item.");

  const formTemplateId = input.formTemplateId.trim();
  const request = (organization: ManualTaskEligiblePerson, doerIds: readonly string[]): ManualTaskCreateRequest => ({
    payload: {
      title,
      description: input.description.trim(),
      planned_datetime: planned.toISOString(),
      priority: input.priority,
      branch_id: organization.branchId ?? "",
      department_id: organization.departmentId ?? "",
      task_type: input.mode === "task" ? "delegation" : "checklist",
      requires_upload: input.mode === "task",
      requires_remark: false,
      requires_form: Boolean(formTemplateId),
      form_template_id: formTemplateId,
    },
    doerIds,
    watcherIds: participants.watcherIds,
    checklist: input.mode === "checklist" ? checklist : [],
  });

  const [firstDoer] = doers;
  if (firstDoer && (input.assignmentMode === "shared" || doers.length === 1)) {
    if (!canShareManualTask(doers)) {
      return error("A shared task needs every user in the same branch and department. Choose a separate task for each user instead.");
    }
    return { requests: [request(firstDoer, participants.doerIds)] };
  }
  return { requests: doers.map((doer) => request(doer, [doer.id])) };
}

/** True when the people can be doers of one task: one branch and one department. */
export function canShareManualTask(people: readonly Pick<ManualTaskEligiblePerson, "branchId" | "departmentId">[]): boolean {
  return people.every((person) => person.branchId === people[0]?.branchId && person.departmentId === people[0]?.departmentId);
}

function error(message: string): Readonly<{ error: ManualTaskDraftError }> {
  return { error: { message } };
}
