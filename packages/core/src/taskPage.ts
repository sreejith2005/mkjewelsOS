import type { Json } from "./database.types";
import type { TaskFeedStatusFilter } from "./taskFeed";

export const TASK_PAGE_SIZE = 50;
export type TaskWorkspaceView = "mine" | "delegated" | "inLoop" | "fms" | "all";
export type TaskPageCounts = Record<TaskFeedStatusFilter | "open", number>;
export type TaskPageScope = Readonly<{ ids: string[]; total: number; counts: TaskPageCounts }>;
export type TaskAdminChecklistEdit = Readonly<{ id?: string; itemText: string; required: boolean; completed?: boolean }>;
export type TaskAdminEdit = Readonly<{
  title: string; description: string; priority: "low" | "medium" | "high"; planned: string; due: string;
  taskType?: "delegation" | "checklist"; requiresUpload?: boolean; requiresRemark?: boolean; requiresForm?: boolean;
  formTemplateId?: string; verificationRequired?: boolean; verifierId?: string; buddyAssignmentAllowed?: boolean;
  branchId?: string; departmentId?: string; categoryId?: string; coreTaskLabel?: string;
  doerIds?: readonly string[]; watcherIds?: readonly string[]; checklist?: readonly TaskAdminChecklistEdit[];
}>;

/** Ordinary tasks keep their identity when converted between Task and Checklist. */
export function taskFormSubmissionKey(taskId: string, module: string, formId: string): string {
  const scope = module === "delegation_task" || module === "checklist_task" ? "ordinary_task" : module;
  return [taskId, scope, formId].join("|");
}

export function taskNeedsCompletionRemark(task: Readonly<{ requires_remark?: boolean | null; assignees?: readonly Readonly<{ id: string }>[] }>, viewerId?: string | null): boolean {
  return Boolean(task.requires_remark) || (viewerId != null && !(task.assignees ?? []).some(person => person.id === viewerId));
}

/** Controls edit in the application's scheduling zone, independently of device timezone. */
export function taskAdminInitialEdit(task: Readonly<{
  title: string | null; description: string | null; priority: string | null; planned_datetime: string | null; due_datetime: string | null; revised_datetime: string | null;
  task_type?: string | null; requires_upload?: boolean | null; requires_remark?: boolean | null; requires_form?: boolean | null;
  form_template_id?: string | null; verification_status?: string | null; verifier_user_profile_id?: string | null; buddy_assignment_allowed?: boolean | null;
  branch_id?: string | null; department_id?: string | null; category_id?: string | null; core_task_label?: string | null;
  doer_ids?: readonly string[]; watcher_ids?: readonly string[];
  checklists?: readonly Readonly<{ id: string; item_text: string; is_required: boolean | null; is_completed: boolean | null }>[];
}>): TaskAdminEdit {
  const local = (value: string | null) => value ? new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 16) : "";
  return { title: task.title ?? "", description: task.description ?? "", priority: task.priority === "high" || task.priority === "low" ? task.priority : "medium",
    planned: local(task.planned_datetime), due: local(task.revised_datetime ?? task.due_datetime ?? task.planned_datetime),
    ...(task.task_type ? {
      taskType: task.task_type === "checklist" ? "checklist" as const : "delegation" as const,
      requiresUpload: task.requires_upload ?? false, requiresRemark: task.requires_remark ?? false, requiresForm: task.requires_form ?? false,
      formTemplateId: task.form_template_id ?? "", verificationRequired: task.verification_status != null && task.verification_status !== "not_required",
      verifierId: task.verifier_user_profile_id ?? "", buddyAssignmentAllowed: task.buddy_assignment_allowed ?? false,
      branchId: task.branch_id ?? "", departmentId: task.department_id ?? "", categoryId: task.category_id ?? "", coreTaskLabel: task.core_task_label ?? "",
    } : {}),
    ...(task.doer_ids ? { doerIds: [...task.doer_ids] } : {}), ...(task.watcher_ids ? { watcherIds: [...task.watcher_ids] } : {}),
    ...(task.checklists ? { checklist: task.checklists.map(item => ({ id: item.id, itemText: item.item_text, required: item.is_required ?? false, completed: item.is_completed ?? false })) } : {}),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validate server JSON at the boundary, rather than trusting a type assertion. */
export function decodeTaskPage(value: unknown): TaskPageScope {
  if (!record(value) || !Array.isArray(value.ids) || value.ids.length > TASK_PAGE_SIZE
    || !value.ids.every((id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || new Set(value.ids).size !== value.ids.length || !count(value.total) || value.ids.length > value.total
    || !record(value.counts) || !count(value.counts.pending) || !count(value.counts.overdue)
    || !count(value.counts.completed) || !count(value.counts.open)
    || value.counts.open !== value.counts.pending + value.counts.overdue) throw new Error("Invalid task page response");
  return { ids: value.ids, total: value.total, counts: {
    pending: value.counts.pending, overdue: value.counts.overdue, completed: value.counts.completed, open: value.counts.open,
  } };
}

export function taskAdminEditPayload(edit: TaskAdminEdit): Json {
  const schedulingDate = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}+05:30` : value);
  const start = schedulingDate(edit.planned);
  const end = schedulingDate(edit.due);
  if (!edit.title.trim() || edit.title.trim().length > 300 || edit.description.length > 10000
    || !["low", "medium", "high"].includes(edit.priority)) throw new Error("Enter a title, description and valid priority.");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error("Enter a due time after the start time.");
  if (edit.requiresForm && !edit.formTemplateId) throw new Error("Select the required form.");
  if (edit.verificationRequired && !edit.verifierId) throw new Error("Select a verifier.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of [edit.branchId, edit.departmentId, edit.categoryId, edit.formTemplateId, edit.verifierId, ...(edit.doerIds ?? []), ...(edit.watcherIds ?? [])]) {
    if (id && !uuid.test(id)) throw new Error("Select a valid task reference.");
  }
  if (edit.doerIds?.some(id => edit.watcherIds?.includes(id))) throw new Error("A doer cannot also be In Loop.");
  if ((edit.doerIds && new Set(edit.doerIds).size !== edit.doerIds.length) || (edit.watcherIds && new Set(edit.watcherIds).size !== edit.watcherIds.length)) throw new Error("Select each participant only once.");
  if ((edit.coreTaskLabel?.length ?? 0) > 300) throw new Error("Task group must be at most 300 characters.");
  if (edit.checklist && (edit.checklist.length > 100 || edit.checklist.some(item => !item.itemText.trim() || item.itemText.trim().length > 500 || (item.id && !uuid.test(item.id)))
    || new Set(edit.checklist.flatMap(item => item.id ? [item.id] : [])).size !== edit.checklist.filter(item => item.id).length)) throw new Error("Enter up to 100 checklist items of 1-500 characters.");
  return { title: edit.title.trim(), description: edit.description.trim(), priority: edit.priority,
    planned_datetime: start.toISOString(), due_datetime: end.toISOString(),
    ...(edit.taskType !== undefined ? { task_type: edit.taskType } : {}),
    ...(edit.requiresUpload !== undefined ? { requires_upload: edit.requiresUpload } : {}),
    ...(edit.requiresRemark !== undefined ? { requires_remark: edit.requiresRemark } : {}),
    ...(edit.requiresForm !== undefined ? { requires_form: edit.requiresForm } : {}),
    ...(edit.verificationRequired !== undefined ? { verification_required: edit.verificationRequired } : {}),
    ...(edit.buddyAssignmentAllowed !== undefined ? { buddy_assignment_allowed: edit.buddyAssignmentAllowed } : {}),
    ...(edit.formTemplateId !== undefined ? { form_template_id: edit.formTemplateId || null } : {}),
    ...(edit.verifierId !== undefined ? { verifier_user_profile_id: edit.verifierId || null } : {}),
    ...(edit.branchId !== undefined ? { branch_id: edit.branchId || null } : {}),
    ...(edit.departmentId !== undefined ? { department_id: edit.departmentId || null } : {}),
    ...(edit.categoryId !== undefined ? { category_id: edit.categoryId || null } : {}),
    ...(edit.coreTaskLabel !== undefined ? { core_task_label: edit.coreTaskLabel.trim() || null } : {}),
    ...(edit.doerIds !== undefined ? { doer_ids: [...edit.doerIds] } : {}),
    ...(edit.watcherIds !== undefined ? { watcher_ids: [...edit.watcherIds] } : {}),
    ...(edit.checklist !== undefined ? { checklist: edit.checklist.map(item => ({ ...(item.id ? { id: item.id } : {}), item_text: item.itemText.trim(), is_required: item.required })) } : {}),
  };
}
