import {
  buildImportSchedule,
  identityRequirementKey,
  normalizeImportBoolean,
  normalizeLegacyFrequency,
  TASK_IMPORT_MAX_ROWS,
  type TaskImportDraftRow,
  type TaskImportIdentityRequirement,
} from "@jewelos/core";
import type { TaskBulkImportIssue } from "./workbook";

export const LEGACY_TASK_HEADERS = ["EMPLOYEE EMAIL", "EMPLOYEE NAME", "DEPARTMENT", "BRANCH NAME", "TASK TYPE", "CORE TASK", "TASK", "TASK DESCRIPTION", "FREQUENCY", "TASK START DATE", "START TIME", "DUE TIME", "PRIORITY", "EVIDENCE REQUIRED", "VERIFICATION REQUIRED", "VERIFIER", "BUDDY ALLOWED", "ACTIVE"] as const;
type Row = Readonly<Record<string, unknown>>;
const value = (row: Row, header: typeof LEGACY_TASK_HEADERS[number]) => String(row[header] ?? "").trim();
const issue = (row: number, field: string, reason: string, guidance: string): TaskBulkImportIssue => ({ sheet: "Tasks", row, field, reason, guidance, severity: "error" });
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const unsafe = (text: string) => /^[=+\-@]/.test(text) || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text);

export type LegacyTaskSheetNormalization = Readonly<{ draftRows: readonly TaskImportDraftRow[]; identityRequirements: readonly TaskImportIdentityRequirement[]; issues: readonly TaskBulkImportIssue[] }>;

export function normalizeLegacyTaskSheet(rows: readonly Row[]): LegacyTaskSheetNormalization {
  const issues: TaskBulkImportIssue[] = [];
  const drafts: TaskImportDraftRow[] = [];
  const requirements = new Map<string, { key: string; kind: "assignee" | "verifier"; label: string; source_rows: number[] }>();
  if (rows.length > TASK_IMPORT_MAX_ROWS) issues.push(issue(1, "sheet", "Tasks sheet can contain at most 2500 rows", "Split the source before importing."));
  rows.slice(0, TASK_IMPORT_MAX_ROWS).forEach((row, index) => {
    const sourceRow = index + 2;
    if (LEGACY_TASK_HEADERS.some((header) => unsafe(value(row, header)))) issues.push(issue(sourceRow, "cell", "Formula or control character is not allowed", "Use plain text only."));
    const email = value(row, "EMPLOYEE EMAIL").toLowerCase(); const name = value(row, "EMPLOYEE NAME");
    if (!email && !name) issues.push(issue(sourceRow, "EMPLOYEE EMAIL", "Employee email or mapped name is required", "Add an employee email or name."));
    if (!email && name) addRequirement(requirements, "assignee", name, sourceRow);
    const branch = value(row, "BRANCH NAME"); const department = value(row, "DEPARTMENT");
    if (!branch) issues.push(issue(sourceRow, "BRANCH NAME", "Branch is required", "Enter an authorized branch."));
    if (!department) issues.push(issue(sourceRow, "DEPARTMENT", "Department is required", "Enter an authorized department."));
    const rawType = value(row, "TASK TYPE").toLowerCase();
    const taskType = rawType === "task" ? "delegation" : ["check list", "checklist"].includes(rawType) ? "checklist" : null;
    if (!taskType) issues.push(issue(sourceRow, "TASK TYPE", "Task type is unsupported", "Use TASK or CHECK LIST."));
    const core = value(row, "CORE TASK"); const task = value(row, "TASK");
    if (!task) issues.push(issue(sourceRow, "TASK", "Task is required", "Enter a task."));
    if (taskType === "checklist" && !core) issues.push(issue(sourceRow, "CORE TASK", "Core task is required for checklist rows", "Enter the checklist title."));
    let scheduleKind: ReturnType<typeof normalizeLegacyFrequency> = "daily";
    try { scheduleKind = normalizeLegacyFrequency(value(row, "FREQUENCY")); } catch { issues.push(issue(sourceRow, "FREQUENCY", "Frequency is unsupported", "Use One Time, Daily, Weekly, Monthly, Quarterly, Yearly, or As Required.")); }
    const startsOn = value(row, "TASK START DATE"); const startTime = value(row, "START TIME"); const dueTime = value(row, "DUE TIME");
    if (scheduleKind !== "as_required" && !startsOn) issues.push(issue(sourceRow, "TASK START DATE", "Start date is required", "Use YYYY-MM-DD."));
    if (!TIME.test(startTime)) issues.push(issue(sourceRow, "START TIME", "Start time is required", "Use HH:MM."));
    if (!TIME.test(dueTime) || dueTime <= startTime) issues.push(issue(sourceRow, "DUE TIME", "Due time must be later than start time", "Use a same-day HH:MM deadline."));
    let schedule: ReturnType<typeof buildImportSchedule> = { destination: "recurring_todo", recurrenceRule: "" };
    try { schedule = buildImportSchedule(scheduleKind, startsOn); } catch (error) { issues.push(issue(sourceRow, "TASK START DATE", error instanceof Error ? error.message : "Start date is invalid", "Use a valid YYYY-MM-DD date.")); }
    const boolean = (header: "EVIDENCE REQUIRED" | "VERIFICATION REQUIRED" | "BUDDY ALLOWED" | "ACTIVE") => { try { return normalizeImportBoolean(value(row, header)); } catch { issues.push(issue(sourceRow, header, `${header} is required`, "Use Yes or No.")); return false; } };
    const verification = boolean("VERIFICATION REQUIRED"); const active = boolean("ACTIVE"); const verifier = value(row, "VERIFIER");
    if (verification && !verifier) issues.push(issue(sourceRow, "VERIFIER", "Verifier is required", "Enter a verifier name for explicit mapping."));
    if (verification && verifier) addRequirement(requirements, "verifier", verifier, sourceRow);
    const plannedAt = startsOn ? `${startsOn} ${startTime}` : ""; const dueAt = startsOn ? `${startsOn} ${dueTime}` : "";
    drafts.push({ source_row: sourceRow, task_key: `legacy-${sourceRow}`, destination: schedule.destination, schedule_kind: scheduleKind,
      task_type: taskType ?? "delegation", core_task_label: core, title: taskType === "checklist" ? core || task : task,
      description: value(row, "TASK DESCRIPTION"), priority: value(row, "PRIORITY").toLowerCase(), branch, department, category: "",
      assignee_email: email, assignee_name: name, verifier_label: verifier, starts_on: startsOn, start_time: startTime, due_time: dueTime,
      planned_at: plannedAt, due_at: dueAt, recurrence_rule: schedule.recurrenceRule, requires_upload: boolean("EVIDENCE REQUIRED"),
      verification_required: verification, buddy_assignment_allowed: boolean("BUDDY ALLOWED"), is_active: scheduleKind === "as_required" ? false : active,
      checklist: taskType === "checklist" && task ? [{ item_text: task, required: true }] : [] });
  });
  return { draftRows: drafts, identityRequirements: [...requirements.values()], issues };
}

function addRequirement(map: Map<string, { key: string; kind: "assignee" | "verifier"; label: string; source_rows: number[] }>, kind: "assignee" | "verifier", label: string, row: number) {
  const key = identityRequirementKey(kind, label); const found = map.get(key);
  if (found) found.source_rows.push(row); else map.set(key, { key, kind, label, source_rows: [row] });
}
