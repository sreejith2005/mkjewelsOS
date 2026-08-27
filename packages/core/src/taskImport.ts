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

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FREQUENCIES: Record<string, ImportScheduleKind> = {
  once: "one_time", "one time": "one_time", daily: "daily", weekly: "weekly", monthly: "monthly",
  quarterly: "quarterly", yearly: "yearly", "as required": "as_required",
};

export function normalizeImportBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  throw new Error(normalized ? "Boolean value is unsupported" : "Boolean value is required");
}

export function normalizeLegacyFrequency(value: string): ImportScheduleKind {
  const normalized = FREQUENCIES[value.trim().toLowerCase()];
  if (!normalized) throw new Error("Frequency is unsupported");
  return normalized;
}

function dateParts(value: string) {
  const match = DATE.exec(value);
  if (!match) throw new Error("Start date must use YYYY-MM-DD");
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error("Start date is invalid");
  return { date, month, day };
}

export function buildImportSchedule(kind: ImportScheduleKind, startsOn: string) {
  if (kind === "one_time") return { destination: "tasks" as const, recurrenceRule: "" };
  if (kind === "as_required") return { destination: "recurring_todo" as const, recurrenceRule: "FREQ=DAILY" };
  const { date, month, day } = dateParts(startsOn);
  const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const recurrenceRule = kind === "daily" ? "FREQ=DAILY"
    : kind === "weekly" ? `FREQ=WEEKLY;BYDAY=${weekdays[date.getUTCDay()]}`
    : kind === "monthly" ? `FREQ=MONTHLY;BYMONTHDAY=${day}`
    : kind === "quarterly" ? `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${day}`
    : `FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${day}`;
  return { destination: "recurring_todo" as const, recurrenceRule };
}

export function identityRequirementKey(kind: "assignee" | "verifier", label: string) {
  return `${kind}:${label.trim().toLocaleLowerCase("en-IN")}`;
}

export function chunkTaskImportRows<T>(rows: readonly T[], size = TASK_IMPORT_CHUNK_SIZE): readonly (readonly T[])[] {
  if (!Number.isInteger(size) || size < 1 || size > TASK_IMPORT_CHUNK_SIZE) throw new Error("Import chunk size must be between 1 and 100");
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
