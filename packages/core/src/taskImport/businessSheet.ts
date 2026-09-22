import {
  identityRequirementKey,
  normalizeImportBoolean,
  planTaskImportFrequency,
  TASK_IMPORT_MAX_ROWS,
  type TaskImportDraftRow,
  type TaskImportIdentityRequirement,
  type TaskImportTimingPresetKey,
  type TaskImportTimingPresets,
} from "../taskImport";
import type { TaskBulkImportIssue } from "./workbook";

export const IDEAL_TASK_IMPORT_HEADERS = [
  "EMPLOYEE NAME", "EMPLOYEE EMAIL", "MAIN TASK", "TASK DESCRIPTION",
  "TASK TYPE", "TASK FREQUENCY", "CHECKPOINTS", "KRA", "CORE TASK",
  "DEPARTMENT", "BRANCH NAME", "TASK START DATE", "START TIME", "DUE TIME",
  "PRIORITY", "EVIDENCE REQUIRED", "VERIFICATION REQUIRED", "VERIFIER",
  "BUDDY ALLOWED", "ACTIVE",
] as const;

export const COMPACT_TASK_IMPORT_HEADERS = [
  "EMPLOYEE NAME", "DESIGNATION", "MAIN TASK", "TASK TYPE", "TASK FREQUENCY", "KRA",
] as const;

export type TaskImportBusinessHeader = typeof IDEAL_TASK_IMPORT_HEADERS[number];
export type TaskImportBusinessColumn = Readonly<{
  header: TaskImportBusinessHeader;
  required: boolean;
  width: number;
  comment: string;
  example: string;
}>;

export const TASK_IMPORT_BUSINESS_COLUMNS: readonly TaskImportBusinessColumn[] = [
  { header: "EMPLOYEE NAME", required: false, width: 24, comment: "Optional assignee name. Unresolved names remain Assigning Left.", example: "Sample Employee" },
  { header: "EMPLOYEE EMAIL", required: false, width: 28, comment: "Optional active work email. Email is preferred when provided.", example: "sample.employee@example.com" },
  { header: "MAIN TASK", required: true, width: 38, comment: "Required task title, up to 200 characters.", example: "Open showroom and complete readiness check" },
  { header: "TASK DESCRIPTION", required: false, width: 44, comment: "Optional supporting instructions in plain text.", example: "Confirm the showroom is ready before opening." },
  { header: "TASK TYPE", required: false, width: 16, comment: "TASK, CHECK LIST, or CHECKLIST. Blank defaults to TASK.", example: "CHECK LIST" },
  { header: "TASK FREQUENCY", required: false, width: 24, comment: "Supported business frequency. Blank defaults to As Required.", example: "Daily - Opening" },
  { header: "CHECKPOINTS", required: false, width: 42, comment: "Optional checklist items, one per line. These override generated checkpoints.", example: "Open shutters\nSwitch on display lights" },
  { header: "KRA", required: false, width: 24, comment: "Optional task category/KRA label.", example: "Store Readiness" },
  { header: "CORE TASK", required: false, width: 24, comment: "Optional core-task grouping label.", example: "Opening" },
  { header: "DEPARTMENT", required: false, width: 20, comment: "Optional department hint; server authorization is rechecked.", example: "Retail" },
  { header: "BRANCH NAME", required: false, width: 20, comment: "Optional branch hint; server authorization is rechecked.", example: "Sample Branch" },
  { header: "TASK START DATE", required: false, width: 18, comment: "YYYY-MM-DD. Blank uses the import-level start date for scheduled work.", example: "2026-09-22" },
  { header: "START TIME", required: false, width: 14, comment: "24-hour HH:MM. Blank uses the applicable import timing preset.", example: "09:00" },
  { header: "DUE TIME", required: false, width: 14, comment: "24-hour HH:MM and later than start time. Blank uses a timing preset.", example: "11:00" },
  { header: "PRIORITY", required: false, width: 13, comment: "LOW, MEDIUM, or HIGH. Blank defaults to MEDIUM.", example: "Medium" },
  { header: "EVIDENCE REQUIRED", required: false, width: 20, comment: "YES or NO. Blank defaults to NO.", example: "No" },
  { header: "VERIFICATION REQUIRED", required: false, width: 23, comment: "YES or NO. Blank defaults to NO.", example: "No" },
  { header: "VERIFIER", required: false, width: 24, comment: "Verifier name or email when verification is required.", example: "" },
  { header: "BUDDY ALLOWED", required: false, width: 17, comment: "YES or NO. Blank defaults to YES.", example: "Yes" },
  { header: "ACTIVE", required: false, width: 13, comment: "YES or NO. Scheduled work defaults to YES; As Required stays inactive.", example: "Yes" },
];

export type TaskImportDraftSourceFormat = "ideal_business_sheet" | "compact_work_list" | "mk_daily_checklist_csv";
export function isTaskImportDraftSourceFormat(value: string): value is TaskImportDraftSourceFormat {
  return value === "ideal_business_sheet" || value === "compact_work_list" || value === "mk_daily_checklist_csv";
}

type Row = Readonly<Record<string, unknown>>;
export type BusinessTaskSheetOptions = Readonly<{
  format: "ideal_business_sheet" | "compact_work_list";
  defaultStartsOn?: string;
  timingPresets?: TaskImportTimingPresets;
}>;
export type BusinessTaskSheetNormalization = Readonly<{
  draftRows: readonly TaskImportDraftRow[];
  identityRequirements: readonly TaskImportIdentityRequirement[];
  issues: readonly TaskBulkImportIssue[];
  requiredTimingPresets: readonly TaskImportTimingPresetKey[];
}>;

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PRIORITIES = new Set(["low", "medium", "high"]);
const unsafe = (text: string) => /^[=+\-@]/.test(text.trim()) || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text);
const value = (row: Row, header: string) => String(row[header] ?? "").trim();
const issue = (row: number, field: string, reason: string, guidance: string): TaskBulkImportIssue => ({ sheet: "Tasks", row, field, reason, guidance, severity: "error" });

function validDate(value: string) {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

function addRequirement(
  map: Map<string, { key: string; kind: "assignee" | "verifier"; label: string; source_rows: number[] }>,
  kind: "assignee" | "verifier",
  label: string,
  row: number,
) {
  const key = identityRequirementKey(kind, label); const existing = map.get(key);
  if (existing) existing.source_rows.push(row); else map.set(key, { key, kind, label, source_rows: [row] });
}

export function normalizeBusinessTaskSheet(rows: readonly Row[], options: BusinessTaskSheetOptions): BusinessTaskSheetNormalization {
  const issues: TaskBulkImportIssue[] = [];
  const drafts: TaskImportDraftRow[] = [];
  const requirements = new Map<string, { key: string; kind: "assignee" | "verifier"; label: string; source_rows: number[] }>();
  const requiredPresets = new Set<TaskImportTimingPresetKey>();
  if (rows.length > TASK_IMPORT_MAX_ROWS) issues.push(issue(1, "sheet", "Tasks sheet can contain at most 2500 rows", "Split the source before importing."));

  rows.slice(0, TASK_IMPORT_MAX_ROWS).forEach((row, index) => {
    const sourceRow = index + 2;
    const inspectedHeaders = options.format === "compact_work_list" ? COMPACT_TASK_IMPORT_HEADERS : IDEAL_TASK_IMPORT_HEADERS;
    if (inspectedHeaders.some((header) => unsafe(value(row, header)))) {
      issues.push(issue(sourceRow, "cell", "Formula or control character is not allowed", "Enter plain text only."));
    }

    const title = value(row, "MAIN TASK");
    if (!title || title.length > 200) issues.push(issue(sourceRow, "MAIN TASK", "Main task must contain 1 to 200 characters", "Enter a short task title."));
    const assigneeName = value(row, "EMPLOYEE NAME");
    const assigneeEmail = value(row, "EMPLOYEE EMAIL").toLowerCase();
    if (!assigneeEmail && assigneeName) addRequirement(requirements, "assignee", assigneeName, sourceRow);

    const rawType = value(row, "TASK TYPE").toLowerCase();
    const taskType = !rawType || rawType === "task" ? "delegation" : ["check list", "checklist"].includes(rawType) ? "checklist" : null;
    if (!taskType) issues.push(issue(sourceRow, "TASK TYPE", "Task type is unsupported", "Use TASK, CHECK LIST, CHECKLIST, or leave blank."));

    const sourceStartsOn = value(row, "TASK START DATE");
    const startsOn = sourceStartsOn || options.defaultStartsOn || "";
    const plannerStartsOn = validDate(startsOn) ? startsOn : "2000-01-01";
    let plan: ReturnType<typeof planTaskImportFrequency>;
    try {
      plan = planTaskImportFrequency(value(row, "TASK FREQUENCY"), plannerStartsOn, title || "Task");
    } catch (error) {
      issues.push(issue(sourceRow, "TASK FREQUENCY", error instanceof Error ? error.message : "Unsupported frequency", "Use a frequency listed in the downloaded format guidance."));
      plan = planTaskImportFrequency("", "", title || "Task");
    }
    if (sourceStartsOn && !validDate(sourceStartsOn)) issues.push(issue(sourceRow, "TASK START DATE", "Start date is invalid", "Use YYYY-MM-DD."));
    if (plan.scheduleKind !== "as_required" && !startsOn) issues.push(issue(sourceRow, "TASK START DATE", "A start date is required for scheduled work", "Enter YYYY-MM-DD or choose one import start date."));

    const explicitStart = value(row, "START TIME"); const explicitDue = value(row, "DUE TIME");
    if (explicitStart && !TIME.test(explicitStart)) issues.push(issue(sourceRow, "START TIME", "Start time is invalid", "Use 24-hour HH:MM."));
    if (explicitDue && !TIME.test(explicitDue)) issues.push(issue(sourceRow, "DUE TIME", "Due time is invalid", "Use 24-hour HH:MM."));
    const startPreset = options.timingPresets?.[plan.startTimingPreset];
    const duePreset = options.timingPresets?.[plan.dueTimingPreset];
    if (!explicitStart && (!startPreset || !TIME.test(startPreset.startTime))) {
      requiredPresets.add(plan.startTimingPreset);
      issues.push(issue(sourceRow, "START TIME", `${plan.startTimingPreset} timing preset is required`, "Choose the missing timing preset above the preview."));
    }
    if (!explicitDue && (!duePreset || !TIME.test(duePreset.dueTime))) {
      requiredPresets.add(plan.dueTimingPreset);
      issues.push(issue(sourceRow, "DUE TIME", `${plan.dueTimingPreset} timing preset is required`, "Choose the missing timing preset above the preview."));
    }
    const startTime = explicitStart || startPreset?.startTime || "";
    const dueTime = explicitDue || duePreset?.dueTime || "";
    if (TIME.test(startTime) && TIME.test(dueTime) && dueTime <= startTime) issues.push(issue(sourceRow, "DUE TIME", "Due time must be later than start time", "Use a same-day HH:MM deadline."));

    const optionalBoolean = (header: "EVIDENCE REQUIRED" | "VERIFICATION REQUIRED" | "BUDDY ALLOWED" | "ACTIVE", fallback: boolean) => {
      const raw = value(row, header);
      if (!raw) return fallback;
      try { return normalizeImportBoolean(raw); } catch { issues.push(issue(sourceRow, header, `${header} is invalid`, "Use Yes or No.")); return fallback; }
    };
    const evidence = optionalBoolean("EVIDENCE REQUIRED", false);
    const verification = optionalBoolean("VERIFICATION REQUIRED", false);
    const buddy = optionalBoolean("BUDDY ALLOWED", true);
    const active = optionalBoolean("ACTIVE", true);
    const verifier = value(row, "VERIFIER");
    if (verification && !verifier) issues.push(issue(sourceRow, "VERIFIER", "Verifier is required when verification is required", "Enter a verifier name or email."));
    if (verification && verifier) addRequirement(requirements, "verifier", verifier, sourceRow);

    const priority = (value(row, "PRIORITY") || "medium").toLowerCase();
    if (!PRIORITIES.has(priority)) issues.push(issue(sourceRow, "PRIORITY", "Priority is unsupported", "Use Low, Medium, or High."));
    const explicitCheckpoints = value(row, "CHECKPOINTS").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const checkpointLabels = explicitCheckpoints.length ? explicitCheckpoints : plan.generatedCheckpoints;
    const checklist = (checkpointLabels.length ? checkpointLabels : taskType === "checklist" && title ? [title] : [])
      .map((item_text) => ({ item_text, required: true }));
    const scheduledDate = startsOn && validDate(startsOn) ? startsOn : "";

    drafts.push({
      source_row: sourceRow,
      task_key: `business-${sourceRow}`,
      destination: plan.destination,
      schedule_kind: plan.scheduleKind,
      task_type: taskType ?? "delegation",
      core_task_label: value(row, "CORE TASK"),
      title,
      description: value(row, "TASK DESCRIPTION"),
      priority: PRIORITIES.has(priority) ? priority : "medium",
      branch: value(row, "BRANCH NAME"),
      department: value(row, "DEPARTMENT"),
      category: value(row, "KRA"),
      assignee_email: assigneeEmail,
      assignee_name: assigneeName,
      verifier_label: verifier,
      starts_on: plan.scheduleKind === "as_required" ? sourceStartsOn && validDate(sourceStartsOn) ? sourceStartsOn : "" : scheduledDate,
      start_time: startTime,
      due_time: dueTime,
      planned_at: plan.scheduleKind !== "as_required" && scheduledDate && TIME.test(startTime) ? `${scheduledDate} ${startTime}` : "",
      due_at: plan.scheduleKind !== "as_required" && scheduledDate && TIME.test(dueTime) ? `${scheduledDate} ${dueTime}` : "",
      recurrence_rule: plan.recurrenceRule,
      requires_upload: evidence,
      verification_required: verification,
      buddy_assignment_allowed: buddy,
      is_active: plan.scheduleKind === "as_required" ? false : active,
      assignment_status: "assigning_left",
      checklist,
    });
  });

  return {
    draftRows: drafts,
    identityRequirements: [...requirements.values()],
    issues,
    requiredTimingPresets: [...requiredPresets].sort(),
  };
}
