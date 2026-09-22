import { planTaskImportFrequency } from "./taskImport/frequency";

export const TASK_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const TASK_IMPORT_MAX_ROWS = 2_500;
export const TASK_IMPORT_CHUNK_SIZE = 100;

export type ImportScheduleKind = "one_time" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "as_required";
export type TaskImportDestination = "tasks" | "recurring_todo";
export type TaskImportCompletionMode = "delegation" | "checklist";
export type TaskImportAssignmentStatus = "assigned" | "assigning_left";

export type TaskImportChecklist = Readonly<{ item_text: string; required: boolean }>;
export type TaskImportCanonicalRow = Readonly<{
  source_row: number; task_key: string; destination: TaskImportDestination; schedule_kind: ImportScheduleKind;
  task_type: TaskImportCompletionMode; core_task_label: string; title: string; description: string; priority: string;
  branch: string; department: string; category: string; assignee_email: string; assignee_profile_id: string;
  assignee_name: string; verifier_label: string; verifier_profile_id: string; starts_on: string; start_time: string;
  due_time: string; planned_at: string; due_at: string; recurrence_rule: string; requires_upload: boolean;
  verification_required: boolean; buddy_assignment_allowed: boolean; is_active: boolean;
  assignment_status: TaskImportAssignmentStatus;
  checklist: readonly TaskImportChecklist[];
}>;
export type TaskImportDraftRow = Omit<TaskImportCanonicalRow, "assignee_profile_id" | "verifier_profile_id">;
export type TaskImportIdentityRequirement = Readonly<{ key: string; kind: "assignee" | "verifier"; label: string; source_rows: readonly number[] }>;

export function normalizeImportBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  throw new Error(normalized ? "Boolean value is unsupported" : "Boolean value is required");
}

export function normalizeLegacyFrequency(value: string): ImportScheduleKind {
  return planTaskImportFrequency(value, "2000-01-01", "Task").scheduleKind;
}

export {
  buildImportSchedule,
  normalizeTaskFrequencyLabel,
  planTaskImportFrequency,
} from "./taskImport/frequency";
export type {
  TaskImportFrequencyPlan,
  TaskImportTimingPresetKey,
  TaskImportTimingPresets,
  TaskImportTimeWindow,
} from "./taskImport/frequency";

export function identityRequirementKey(kind: "assignee" | "verifier", label: string) {
  return `${kind}:${label.trim().toLocaleLowerCase("en-IN")}`;
}

export function chunkTaskImportRows<T>(rows: readonly T[], size = TASK_IMPORT_CHUNK_SIZE): readonly (readonly T[])[] {
  if (!Number.isInteger(size) || size < 1 || size > TASK_IMPORT_CHUNK_SIZE) throw new Error("Import chunk size must be between 1 and 100");
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
