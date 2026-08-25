import * as XLSX from "xlsx";
import { TASK_IMPORT_MAX_BYTES, TASK_IMPORT_MAX_ROWS } from "@jewelos/core";
import { LEGACY_TASK_HEADERS, normalizeLegacyTaskSheet } from "./legacySheet";

export const TASK_IMPORT_HEADERS = ["task_key", "task_mode", "title", "description", "priority", "branch", "department", "category", "primary_doer_email", "doer_emails", "watcher_emails", "planned_at", "recurrence_kind", "recurrence_interval", "weekly_days", "monthly_day", "monthly_nth", "monthly_weekday", "ends_on", "requires_upload", "requires_remark", "published_form"] as const;
const CHECKLIST_HEADERS = ["task_key", "item_text", "required"] as const;
export type TaskBulkImportIssue = Readonly<{ sheet: string; row: number; field: string; reason: string; guidance: string; severity: "error" | "warning" }>;
export type TaskBulkImportChecklist = Readonly<{ item_text: string; required: boolean }>;
export type TaskBulkImportTask = Readonly<{ task_key: string; task_mode: "one_time" | "recurring"; title: string; description: string; priority: string; branch: string; department: string; category: string; primary_doer_email: string; doer_emails: readonly string[]; watcher_emails: readonly string[]; planned_at: string; recurrence_kind: string; recurrence_interval: number; weekly_days: readonly string[]; monthly_day: string; monthly_nth: string; monthly_weekday: string; ends_on: string; requires_upload: boolean; requires_remark: boolean; published_form: string; checklist: readonly TaskBulkImportChecklist[] }>;
export type TaskBulkImportPayload = Readonly<{ tasks: readonly TaskBulkImportTask[] }>;
export type WorkbookNormalization = Readonly<{ payload: TaskBulkImportPayload | null; errors: readonly string[]; issues: readonly TaskBulkImportIssue[] }>;
type SheetRows = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
const unsafe = (value: unknown) => typeof value === "string" && (/^[=+\-@]/.test(value.trim()) || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value));
const text = (value: unknown) => typeof value === "string" ? value.trim() : String(value ?? "").trim();
const yes = (value: unknown) => !["", "no", "false", "0"].includes(text(value).toLowerCase());
const emails = (value: unknown) => [...new Set(text(value).split(";").map((email) => email.trim().toLowerCase()).filter(Boolean))].sort();
const dayCodes = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const entry = (sheet: string, row: number, field: string, reason: string, guidance: string): TaskBulkImportIssue => ({ sheet, row, field, reason, guidance, severity: "error" });
const headers = (rows: readonly Readonly<Record<string, unknown>>[]) => rows.length ? Object.keys(rows[0] ?? {}).map((value) => value.trim().toLowerCase()) : [];
const exactly = (actual: readonly string[], expected: readonly string[]) => actual.length === expected.length && expected.every((header, index) => actual[index] === header);

export function normalizeTaskImportWorkbook(sheets: SheetRows): WorkbookNormalization {
  const issues: TaskBulkImportIssue[] = []; const tasksRows = sheets.Tasks ?? []; const checklistRows = sheets["Checklist Items"] ?? [];
  for (const name of Object.keys(sheets)) if (!["Tasks", "Checklist Items", "Read Me", "Reference Data"].includes(name)) issues.push(entry(name, 1, "sheet", "Unsupported worksheet", "Use only the four worksheets from Download format."));
  if (!tasksRows.length) issues.push(entry("Tasks", 1, "sheet", "Tasks sheet must contain at least one row", "Add one task or recurring schedule."));
  if (tasksRows.length > TASK_IMPORT_MAX_ROWS) issues.push(entry("Tasks", 1, "sheet", "Tasks sheet can contain at most 2500 rows", "Split the workbook into smaller batches."));
  if (tasksRows.length && !exactly(headers(tasksRows), TASK_IMPORT_HEADERS)) issues.push(entry("Tasks", 1, "headers", "Headers must exactly match the downloaded format", "Download a new format workbook and copy rows beneath its headers."));
  if (checklistRows.length && !exactly(headers(checklistRows), CHECKLIST_HEADERS)) issues.push(entry("Checklist Items", 1, "headers", "Checklist headers must exactly match the downloaded format", "Use task_key, item_text, required in that order."));
  const checklists = new Map<string, TaskBulkImportChecklist[]>();
  for (const [index, row] of checklistRows.entries()) { const key = text(row.task_key); const item = text(row.item_text); if (!key && !item) continue; if (Object.values(row).some(unsafe)) issues.push(entry("Checklist Items", index + 2, "cell", "Formula or control character is not allowed", "Enter plain text only.")); else if (!key || !item) issues.push(entry("Checklist Items", index + 2, !key ? "task_key" : "item_text", "Checklist key and text are required", "Supply both values or remove the row.")); else checklists.set(key, [...(checklists.get(key) ?? []), { item_text: item, required: yes(row.required) }]); }
  const keys = new Set<string>();
  const tasks = tasksRows.map((row, index): TaskBulkImportTask => {
    const rowNumber = index + 2; const task_key = text(row.task_key); const task_mode = text(row.task_mode).toLowerCase(); const title = text(row.title); const doer_emails = emails(row.doer_emails); const watcher_emails = emails(row.watcher_emails); const primary_doer_email = text(row.primary_doer_email).toLowerCase(); const recurrence_kind = text(row.recurrence_kind).toLowerCase(); const recurrence_interval = Number(text(row.recurrence_interval) || "1"); const weekly_days = text(row.weekly_days).split(";").map((day) => day.trim().toUpperCase()).filter(Boolean);
    if (Object.values(row).some(unsafe)) issues.push(entry("Tasks", rowNumber, "cell", "Formula or control character is not allowed", "Enter plain text only."));
    if (!task_key) issues.push(entry("Tasks", rowNumber, "task_key", "Task key is required", "Use a unique stable key for this row.")); else if (keys.has(task_key)) issues.push(entry("Tasks", rowNumber, "task_key", "Task key is duplicated", "Use each task key once.")); else keys.add(task_key);
    if (task_mode !== "one_time" && task_mode !== "recurring") issues.push(entry("Tasks", rowNumber, "task_mode", "Mode must be one_time or recurring", "Choose one supported mode."));
    if (!title || title.length > 200) issues.push(entry("Tasks", rowNumber, "title", "Title must contain 1 to 200 characters", "Enter a short task title."));
    if (!text(row.planned_at)) issues.push(entry("Tasks", rowNumber, "planned_at", "A start date and time is required", "Use YYYY-MM-DD HH:MM in India time."));
    if (task_mode === "one_time" && !doer_emails.length) issues.push(entry("Tasks", rowNumber, "doer_emails", "One-time tasks need at least one doer", "Use semicolon-separated active employee emails."));
    if (task_mode === "recurring") { if (!primary_doer_email || doer_emails.length || watcher_emails.length) issues.push(entry("Tasks", rowNumber, "primary_doer_email", "Recurring tasks need exactly one primary doer and no other participants", "Set primary_doer_email only.")); if (!["daily", "weekly", "monthly_day", "monthly_nth"].includes(recurrence_kind)) issues.push(entry("Tasks", rowNumber, "recurrence_kind", "Unsupported recurrence kind", "Choose daily, weekly, monthly_day, or monthly_nth.")); if (!Number.isInteger(recurrence_interval) || recurrence_interval < 1 || recurrence_interval > 365) issues.push(entry("Tasks", rowNumber, "recurrence_interval", "Interval must be between 1 and 365", "Enter a whole number.")); if (recurrence_kind === "weekly" && (!weekly_days.length || weekly_days.some((day) => !dayCodes.has(day)))) issues.push(entry("Tasks", rowNumber, "weekly_days", "Weekly rows need valid days", "Use MON;WED;FRI.")); if (recurrence_kind === "monthly_day" && !/^(?:[1-9]|[12][0-9]|3[01])$/.test(text(row.monthly_day))) issues.push(entry("Tasks", rowNumber, "monthly_day", "Monthly-day rows need a day from 1 to 31", "Enter the calendar day.")); if (recurrence_kind === "monthly_nth" && (!/^[1-5]$/.test(text(row.monthly_nth)) || !dayCodes.has(text(row.monthly_weekday).toUpperCase()))) issues.push(entry("Tasks", rowNumber, "monthly_nth", "Nth-weekday rows need nth (1-5) and weekday", "For example, 2 and MON.")); }
    return { task_key, task_mode: task_mode as "one_time" | "recurring", title, description: text(row.description), priority: text(row.priority) || "medium", branch: text(row.branch), department: text(row.department), category: text(row.category), primary_doer_email, doer_emails, watcher_emails, planned_at: text(row.planned_at), recurrence_kind, recurrence_interval, weekly_days, monthly_day: text(row.monthly_day), monthly_nth: text(row.monthly_nth), monthly_weekday: text(row.monthly_weekday).toUpperCase(), ends_on: text(row.ends_on), requires_upload: yes(row.requires_upload), requires_remark: yes(row.requires_remark), published_form: text(row.published_form), checklist: checklists.get(task_key) ?? [] };
  });
  for (const key of checklists.keys()) if (!keys.has(key)) issues.push(entry("Checklist Items", 2, "task_key", "Checklist key has no Tasks row", "Add the matching task_key to Tasks."));
  return { payload: issues.length ? null : { tasks }, errors: issues.map((item) => `${item.sheet} row ${item.row}: ${item.reason}`), issues };
}
export async function parseTaskImportFile(file: File) {
  if (file.size > TASK_IMPORT_MAX_BYTES) return { sourceFormat: "unknown" as const, payload: null, draftRows: [], identityRequirements: [], errors: ["File exceeds 2 MiB"], issues: [entry("Upload", 0, "file", "File exceeds 2 MiB", "Reduce the workbook size.")] };
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "xlsx" && extension !== "csv") return { sourceFormat: "unknown" as const, payload: null, draftRows: [], identityRequirements: [], errors: ["Only .xlsx or .csv files are supported"], issues: [entry("Upload", 0, "file", "Unsupported file extension", "Choose an .xlsx or .csv file.")] };
  if (file.type && !["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "application/csv"].includes(file.type)) return { sourceFormat: "unknown" as const, payload: null, draftRows: [], identityRequirements: [], errors: ["File type does not match Excel or CSV"], issues: [entry("Upload", 0, "file", "Unexpected MIME type", "Export as .xlsx or CSV.")] };
  const book = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellFormula: false });
  const first = book.Sheets[book.SheetNames[0]!]!;
  const firstRows = XLSX.utils.sheet_to_json(first, { defval: "", raw: false }) as Readonly<Record<string, unknown>>[];
  const headerRow = (XLSX.utils.sheet_to_json(first, { header: 1, defval: "", raw: false }) as unknown[][])[0]?.map((header) => String(header).trim().toUpperCase()) ?? [];
  if (extension === "csv" && headerRow.join("|") === LEGACY_TASK_HEADERS.join("|")) {
    const legacy = normalizeLegacyTaskSheet(firstRows);
    return { sourceFormat: "mk_daily_checklist_csv" as const, payload: null, ...legacy, errors: legacy.issues.map((item) => `Tasks row ${item.row}: ${item.reason}`) };
  }
  const sheets: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
  for (const name of book.SheetNames) sheets[extension === "csv" ? "Tasks" : name] = XLSX.utils.sheet_to_json(book.Sheets[name]!, { defval: "", raw: false }) as Readonly<Record<string, unknown>>[];
  return { sourceFormat: "canonical" as const, draftRows: [], identityRequirements: [], ...normalizeTaskImportWorkbook(sheets) };
}
export const parseTaskWorkbook = parseTaskImportFile;
export async function hashTaskImportPayload(payload: TaskBulkImportPayload): Promise<string> { const source = JSON.stringify({ tasks: [...payload.tasks].sort((a, b) => a.task_key.localeCompare(b.task_key)) }); const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)); return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join(""); }
export function createTaskImportTemplate(): XLSX.WorkBook { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["MK Jewels Task Bulk Import"], ["Fill Tasks and Checklist Items; validate before importing. Dates are India time (YYYY-MM-DD HH:MM)."], ["One-time rows use doer_emails (semicolon-separated); recurring rows use only primary_doer_email."], ["Reference Data is guidance only. Server authorization is always rechecked."]]), "Read Me"); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([Array.from(TASK_IMPORT_HEADERS), ["daily-opening", "recurring", "Open showroom", "", "medium", "", "", "", "asha@example.com", "", "", "2026-08-22 09:00", "daily", "1", "", "", "", "", "", "no", "no", ""]]), "Tasks"); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([Array.from(CHECKLIST_HEADERS), ["daily-opening", "Open shutters", "yes"]]), "Checklist Items"); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Reference data is guidance only; authorization is rechecked on the server."]]), "Reference Data"); return book; }
