import { normalizeTaskParticipants } from "./taskParticipants";

export type ManualTaskMode = "task" | "checklist";
export type ManualTaskPriority = "low" | "medium" | "high";

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
export type ManualTaskDraftResult = ManualTaskCreateRequest | Readonly<{ error: ManualTaskDraftError }>;

/**
 * Builds the one audited RPC request shared by web and native task composers.
 * Organization identifiers always come from the eligible roster record, never
 * from editable form state.
 */
export function buildManualTaskCreateRequest(input: ManualTaskDraftInput): ManualTaskDraftResult {
  const title = input.title.trim();
  if (!title) return error("Add a task title.");

  const participants = normalizeTaskParticipants(input.selectedDoerIds, input.selectedWatcherIds);
  if (participants.doerIds.length !== 1) return error("Select at least one user.");

  const selectedId = participants.doerIds[0];
  const selectedPerson = input.eligiblePeople.find((person) => person.id === selectedId);
  if (!selectedPerson) return error("The selected user is no longer available.");
  if (!selectedPerson.eligible) return error("The selected user is outside your task authoring scope.");
  if (!selectedPerson.branchId || !selectedPerson.departmentId) {
    return error("The selected user needs an active branch and department.");
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
  return {
    payload: {
      title,
      description: input.description.trim(),
      planned_datetime: planned.toISOString(),
      priority: input.priority,
      branch_id: selectedPerson.branchId,
      department_id: selectedPerson.departmentId,
      task_type: input.mode === "task" ? "delegation" : "checklist",
      requires_upload: input.mode === "task",
      requires_remark: false,
      requires_form: Boolean(formTemplateId),
      form_template_id: formTemplateId,
    },
    doerIds: participants.doerIds,
    watcherIds: participants.watcherIds,
    checklist: input.mode === "checklist" ? checklist : [],
  };
}

function error(message: string): Readonly<{ error: ManualTaskDraftError }> {
  return { error: { message } };
}
