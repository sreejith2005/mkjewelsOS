export type TaskBulkImportChecklist = Readonly<{ item_text: string; required: boolean }>;
export type TaskBulkImportTask = Readonly<{
  task_key: string;
  task_mode: "one_time" | "recurring";
  title: string;
  priority: string;
  primary_doer_email?: string;
  doer_emails: readonly string[];
  watcher_emails: readonly string[];
  planned_at: string;
  recurrence_kind?: "daily" | "weekly" | "monthly_day" | "monthly_nth";
  recurrence_interval?: number;
  weekly_days?: readonly string[];
  checklist: readonly TaskBulkImportChecklist[];
}>;
export type TaskBulkImportPayload = Readonly<{ tasks: readonly TaskBulkImportTask[] }>;
export type WorkbookNormalization = Readonly<{ payload: TaskBulkImportPayload | null; errors: readonly string[] }>;

type SheetRows = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;

function text(value: unknown): string { return typeof value === "string" ? value.trim() : String(value ?? "").trim(); }
function emails(value: unknown): readonly string[] { return [...new Set(text(value).split(";").map((email) => email.trim().toLowerCase()).filter(Boolean))].sort(); }
function required(value: unknown): boolean { return !["no", "false", "0"].includes(text(value).toLowerCase()); }

export function normalizeTaskImportWorkbook(sheets: SheetRows): WorkbookNormalization {
  const taskRows = sheets.Tasks;
  if (!taskRows?.length) return { payload: null, errors: ["Tasks sheet must contain at least one row"] };
  if (taskRows.length > 500) return { payload: null, errors: ["Tasks sheet can contain at most 500 rows"] };
  const checklistByKey = new Map<string, TaskBulkImportChecklist[]>();
  for (const row of sheets["Checklist Items"] ?? []) {
    const key = text(row.task_key); const item = text(row.item_text);
    if (key && item) checklistByKey.set(key, [...(checklistByKey.get(key) ?? []), { item_text: item, required: required(row.required) }]);
  }
  const errors: string[] = [];
  const tasks = taskRows.map((row, index) => {
    const task_key = text(row.task_key); const task_mode = text(row.task_mode).toLowerCase(); const title = text(row.title);
    const oneTime = task_mode === "one_time"; const recurring = task_mode === "recurring";
    if (!task_key) errors.push(`Tasks row ${index + 2}: task_key is required`);
    if (!oneTime && !recurring) errors.push(`Tasks row ${index + 2}: task_mode must be one_time or recurring`);
    if (!title) errors.push(`Tasks row ${index + 2}: title is required`);
    const doer_emails = emails(row.doer_emails); const primary_doer_email = text(row.primary_doer_email).toLowerCase();
    if (oneTime && !doer_emails.length) errors.push(`Tasks row ${index + 2}: doer_emails is required`);
    if (recurring && !primary_doer_email) errors.push(`Tasks row ${index + 2}: primary_doer_email is required`);
    const recurrence_kind = text(row.recurrence_kind).toLowerCase();
    const weekly_days = text(row.weekly_days).split(";").map((day) => day.trim().toUpperCase()).filter(Boolean);
    if (recurring && !["daily", "weekly", "monthly_day", "monthly_nth"].includes(recurrence_kind)) errors.push(`Tasks row ${index + 2}: recurrence_kind is required`);
    if (recurring && recurrence_kind === "weekly" && !weekly_days.length) errors.push(`Tasks row ${index + 2}: weekly_days is required for weekly recurrence`);
    return { task_key, task_mode: task_mode as "one_time" | "recurring", title, priority: text(row.priority) || "medium", ...(primary_doer_email ? { primary_doer_email } : {}), doer_emails, watcher_emails: emails(row.watcher_emails), planned_at: text(row.planned_at), ...(recurring ? { recurrence_kind: recurrence_kind as "daily" | "weekly" | "monthly_day" | "monthly_nth", recurrence_interval: Number(text(row.recurrence_interval) || "1"), ...(weekly_days.length ? { weekly_days } : {}) } : {}), checklist: checklistByKey.get(task_key) ?? [] };
  });
  return errors.length ? { payload: null, errors } : { payload: { tasks }, errors: [] };
}

export async function hashTaskImportPayload(payload: TaskBulkImportPayload): Promise<string> {
  const source = JSON.stringify(payload);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

const TASK_HEADERS = ["task_key", "task_mode", "title", "description", "priority", "branch", "department", "category", "primary_doer_email", "doer_emails", "watcher_emails", "planned_at", "recurrence_kind", "recurrence_interval", "weekly_days", "monthly_day", "monthly_nth", "monthly_weekday", "ends_on", "requires_upload", "requires_remark", "published_form"];

export function createTaskImportTemplate(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["MK Jewels Task Bulk Import"], ["1. Fill Tasks and Checklist Items. 2. Upload. 3. Validate. 4. Import only when every row is valid."], ["One-time tasks use doer_emails and optional watcher_emails; recurring schedules use one primary_doer_email."]]), "Read Me");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([TASK_HEADERS, ["daily-opening", "recurring", "Open showroom", "", "medium", "", "", "", "asha@example.com", "", "", "2026-08-22 09:00", "daily", "1", "", "", "", "", "", "no", "no", ""]]), "Tasks");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["task_key", "item_text", "required"], ["daily-opening", "Open shutters", "yes"]]), "Checklist Items");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Reference data is filled after upload for your authorized scope."]]), "Reference Data");
  return workbook;
}
import * as XLSX from "xlsx";
