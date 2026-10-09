import { IMPLEMENTED_PAGE_IDS, type PageId } from "../roleMenu.ts";
import type { SectionControls } from "../settings/sectionAvailability.ts";
import { hasPermission, resolvePageAccess, type AccessContext } from "../permissions/resolve.ts";
import type { PermissionKey } from "../permissions/catalog.ts";
import { REPORT_CATALOG } from "../reports/catalog.ts";
import { KIARA_PERIODS, isIsoDate } from "./period.ts";

/**
 * The Ask Kiara tool catalogue (spec section 8).
 *
 * Every tool is read-only and runs as the caller: the Edge Function executes it
 * with the caller's JWT, so RLS and the section RPCs decide what comes back. The
 * offering rule below only keeps the model from reaching for a tool the caller
 * could never use; the database re-checks everything.
 *
 * Order matters for prompt caching: tools render before the system prompt, so
 * the offered list must be byte-identical for every caller with the same
 * permission shape. Offering filters this fixed array and never reorders it.
 * Descriptions hold no dates or other volatile text.
 */

export type KiaraDataCategory =
  | "tasks"
  | "app_help"
  | "dashboard"
  | "reports"
  | "people"
  | "directory"
  | "availability"
  | "leave"
  | "fms"
  | "forms"
  | "notifications";

/** A JSON-Schema object the Messages API accepts with `strict: true`. */
export type KiaraInputSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  required: readonly string[];
  additionalProperties: false;
}>;

/** Structurally the Messages API custom-tool shape; the Edge Function passes it as is. */
export type KiaraToolDefinition = Readonly<{
  name: KiaraToolName;
  description: string;
  input_schema: KiaraInputSchema;
  strict: true;
}>;

/** One way to qualify for a tool: a permission and the section it opens. */
export type KiaraToolGate = Readonly<{ permission: PermissionKey; page: PageId }>;

export type KiaraToolSpec = Readonly<{
  definition: KiaraToolDefinition;
  /** Offered only when every listed permission is effective for the caller. */
  permissions: readonly PermissionKey[];
  /** Offered only when the caller may open each of these sections right now. */
  pages: readonly PageId[];
  /** When present, at least one gate must also pass (a tool shared by two sections). */
  anyOf?: readonly KiaraToolGate[];
  dataCategory: KiaraDataCategory;
  /** Shown to the user while the tool runs. A fixed string, never data. */
  statusLabel: string;
}>;

export const KIARA_TOOL_NAMES = [
  "get_my_work_summary",
  "get_app_help",
  "search_my_tasks",
  "get_fms_work",
  "get_my_notifications",
  "search_forms",
  "get_leave",
  "get_availability",
  "get_dashboard_metrics",
  "get_team_progress",
  "list_reports",
  "run_report",
  "find_people",
  "find_colleague",
] as const;
export type KiaraToolName = (typeof KIARA_TOOL_NAMES)[number];

/** Sections app help can describe: every implemented page, in catalogue order. */
export const KIARA_HELP_SECTIONS: readonly PageId[] = IMPLEMENTED_PAGE_IDS;

/**
 * Reports Kiara can run: the visible report catalogue (the retired public CRM
 * reports are already hidden there) except export history, which describes the
 * user's CSV downloads, not work.
 */
export const KIARA_REPORT_KEYS: readonly string[] = REPORT_CATALOG.map((report) => report.key).filter((key) => key !== "export_history");

/** Free-text input limits, enforced by the validator (strict schemas carry no lengths). */
export const KIARA_HELP_QUESTION_MAX = 200;
export const KIARA_TEXT_MAX = 100;
export const KIARA_NAME_MAX = 60;

// ---------------------------------------------------------------------------
// Input fields: one declaration drives both the schema and the validator
// ---------------------------------------------------------------------------

type FieldSpec =
  | Readonly<{ kind: "string"; max: number; description: string }>
  | Readonly<{ kind: "enum"; values: readonly string[]; description: string }>
  | Readonly<{ kind: "date"; description: string }>
  | Readonly<{ kind: "integer"; min: number; max: number; description: string }>
  | Readonly<{ kind: "boolean"; description: string }>;

type ToolFields = Readonly<{ fields: Readonly<Record<string, FieldSpec>>; required: readonly string[] }>;

const periodFields: Readonly<Record<string, FieldSpec>> = {
  period: { kind: "enum", values: KIARA_PERIODS, description: "A period relative to today in the turn context. Use instead of from/to when it fits (kal = yesterday or tomorrow by context; is hafte = this_week; is mahine = this_month)." },
  from: { kind: "date", description: "First day, YYYY-MM-DD. Use with to for any other range." },
  to: { kind: "date", description: "Last day, YYYY-MM-DD." },
};
const limitField = (max: number): FieldSpec => ({ kind: "integer", min: 1, max, description: `How many rows to return, 1 to ${max}.` });
const nameField = (description: string): FieldSpec => ({ kind: "string", max: KIARA_NAME_MAX, description: `${description} At most ${KIARA_NAME_MAX} characters.` });

function schemaFor(spec: ToolFields): KiaraInputSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, field] of Object.entries(spec.fields)) {
    if (field.kind === "string") properties[key] = { type: "string", description: field.description };
    else if (field.kind === "enum") properties[key] = { type: "string", enum: [...field.values], description: field.description };
    else if (field.kind === "date") properties[key] = { type: "string", format: "date", description: field.description };
    else if (field.kind === "integer") properties[key] = { type: "integer", description: field.description };
    else properties[key] = { type: "boolean", description: field.description };
  }
  return { type: "object", properties, required: [...spec.required], additionalProperties: false };
}

const FIELDS: Readonly<Record<KiaraToolName, ToolFields>> = {
  get_my_work_summary: { fields: {}, required: [] },
  get_app_help: {
    fields: {
      section: { kind: "enum", values: KIARA_HELP_SECTIONS, description: "The JewelOS section id the question is about." },
      question: { kind: "string", max: KIARA_HELP_QUESTION_MAX, description: "The user's how-to question in English, at most 200 characters." },
    },
    required: ["section", "question"],
  },
  search_my_tasks: {
    fields: {
      text: { kind: "string", max: KIARA_TEXT_MAX, description: "Words to find in the task title (English or as the user wrote them). At most 100 characters." },
      status: { kind: "enum", values: ["open", "overdue", "completed", "all"], description: "open (not done), overdue (not done and past due), completed, or all. Default open." },
      ...periodFields,
      limit: limitField(20),
    },
    required: [],
  },
  get_fms_work: {
    fields: {
      status: { kind: "enum", values: ["open", "completed", "all"], description: "open (default), completed, or all." },
      limit: limitField(20),
    },
    required: [],
  },
  get_my_notifications: {
    fields: {
      unread_only: { kind: "boolean", description: "Only unread notifications. Default false." },
      limit: limitField(20),
    },
    required: [],
  },
  search_forms: {
    fields: {
      text: { kind: "string", max: KIARA_TEXT_MAX, description: "Words to find in the form name. At most 100 characters." },
      limit: limitField(20),
    },
    required: [],
  },
  get_leave: {
    fields: {
      scope: { kind: "enum", values: ["mine", "office"], description: "mine: the user's own leave requests. office: everyone's leave the user may see (managers, HR, admins)." },
      status: { kind: "enum", values: ["pending", "approved", "rejected"], description: "Only requests in this state." },
      ...periodFields,
    },
    required: ["scope"],
  },
  get_availability: {
    fields: {
      ...periodFields,
      department: nameField("Only this department (name)."),
    },
    required: [],
  },
  get_dashboard_metrics: {
    fields: {
      ...periodFields,
      branch: nameField("Only this branch (name). Admins only."),
      department: nameField("Only this department (name)."),
    },
    required: [],
  },
  get_team_progress: {
    fields: {
      ...periodFields,
      branch: nameField("Only this branch (name). Admins only."),
      department: nameField("Only this department (name)."),
      employee_name: nameField("Only this employee (name)."),
    },
    required: [],
  },
  list_reports: { fields: {}, required: [] },
  run_report: {
    fields: {
      report_key: { kind: "enum", values: KIARA_REPORT_KEYS, description: "The report to run (see list_reports)." },
      ...periodFields,
      status: { kind: "string", max: 40, description: "Optional status filter, for example pending, completed, overdue, breached." },
      page: { kind: "integer", min: 1, max: 5, description: "Page of 25 rows, 1 to 5." },
    },
    required: ["report_key"],
  },
  find_people: {
    fields: {
      person_name: nameField("Part of the employee's name."),
      department: nameField("Part of the department name."),
      limit: limitField(20),
    },
    required: [],
  },
  find_colleague: {
    fields: {
      person_name: nameField("Part of the colleague's name."),
      department: nameField("Part of the department name, for example HR."),
      designation: nameField("Part of the designation, for example Manager."),
      branch: nameField("Part of the branch name or its code."),
    },
    required: [],
  },
};

const tool = (name: KiaraToolName, description: string, rest: Omit<KiaraToolSpec, "definition">): KiaraToolSpec => ({
  definition: { name, description, input_schema: schemaFor(FIELDS[name]), strict: true },
  ...rest,
});

export const KIARA_TOOLS: readonly KiaraToolSpec[] = [
  tool(
    "get_my_work_summary",
    "The signed-in employee's own open work, the same lists their JewelOS Home screen shows: open and overdue tasks assigned to them (the 10 most urgent), FMS stages assigned to them (up to 6), forms they still have to fill for their tasks (up to 6), FMS starter forms waiting for them, their unread notification count, and their availability today. Use it for questions such as \"what is pending for me today\", \"my overdue tasks\", or \"aaj mera kya pending hai\". It covers only the asker's own work, never a team's.",
    { permissions: ["home.view"], pages: ["home"], dataCategory: "tasks", statusLabel: "Checking your work" },
  ),
  tool(
    "get_app_help",
    "How to use a JewelOS section: where things are and the steps for common jobs (for example applying for leave, filling a form, or creating a task). Pass the section the question is about and the question in English (at most 200 characters). Help is returned only for sections the user can open; otherwise the result says access is denied.",
    { permissions: ["assistant.view"], pages: ["ask_kiara"], dataCategory: "app_help", statusLabel: "Looking up app help" },
  ),
  tool(
    "search_my_tasks",
    "Search the user's own tasks (assigned to them, created by them, or watched by them) by words, status, and due date. Never other people's tasks; for a team use get_team_progress or run_report.",
    { permissions: ["tasks.view"], pages: ["checklist_tasks"], dataCategory: "tasks", statusLabel: "Searching your tasks" },
  ),
  tool(
    "get_fms_work",
    "FMS (workflow) stages and starter forms assigned to the user: workflow, stage, reference, status, planned time.",
    { permissions: [], pages: [], anyOf: [{ permission: "fms.view", page: "fms_builder" }, { permission: "tasks.view", page: "checklist_tasks" }], dataCategory: "fms", statusLabel: "Checking your FMS work" },
  ),
  tool(
    "get_my_notifications",
    "The user's recent notifications and unread count. Read-only: it never marks anything read.",
    { permissions: ["notifications.view"], pages: ["notifications"], dataCategory: "notifications", statusLabel: "Checking your notifications" },
  ),
  tool(
    "search_forms",
    "Published forms the user can fill, and the user's own recent submissions with their review status (never the answers).",
    { permissions: ["forms.view"], pages: ["forms_library"], dataCategory: "forms", statusLabel: "Looking up forms" },
  ),
  tool(
    "get_leave",
    "Leave requests: the user's own, or the office leave list for users allowed to see it. Filter by status and by dates the leave covers.",
    { permissions: ["availability.view"], pages: ["availability"], dataCategory: "leave", statusLabel: "Checking leave" },
  ),
  tool(
    "get_availability",
    "Who is present, absent, half day, or remote on given days: the user's own days, plus their team's when the People availability report is open to them.",
    { permissions: ["availability.view"], pages: ["availability"], dataCategory: "availability", statusLabel: "Checking availability" },
  ),
  tool(
    "get_dashboard_metrics",
    "The user's Dashboard numbers for a period, with the previous period of the same length for comparison: tasks assigned, completed, on time, overdue, FMS, forms, and people for managers and above. Scope is what their Dashboard shows (own work for staff, own branch for managers, company for admins).",
    { permissions: ["dashboard.view"], pages: ["dashboard"], dataCategory: "dashboard", statusLabel: "Checking the dashboard" },
  ),
  tool(
    "get_team_progress",
    "Task Control progress per employee, department, and branch (assigned, completed, on time, remaining, overdue) and the overdue tasks list. Scope as Task Control: own branch for managers, company for admins.",
    { permissions: ["task_control.view"], pages: ["task_templates"], dataCategory: "tasks", statusLabel: "Checking team progress" },
  ),
  tool(
    "list_reports",
    "The reports the user can open in Reports, with what each shows.",
    { permissions: ["reports.view"], pages: ["reports"], dataCategory: "reports", statusLabel: "Listing reports" },
  ),
  tool(
    "run_report",
    "One page (25 rows) of a report from Reports for a date range, within the user's report scope.",
    { permissions: ["reports.view"], pages: ["reports"], dataCategory: "reports", statusLabel: "Running the report" },
  ),
  tool(
    "find_people",
    "Employees the user can see in Users: name, code, designation, department, branch, working status, official email.",
    { permissions: ["users.view"], pages: ["users"], dataCategory: "people", statusLabel: "Looking up people" },
  ),
  tool(
    "find_colleague",
    "Find active colleagues by name, department, designation, or branch: returns only name, designation, department, and branch (no contact details). Use for \"who is the HR person in our branch\".",
    { permissions: ["assistant.view"], pages: ["ask_kiara"], dataCategory: "directory", statusLabel: "Looking up colleagues" },
  ),
];

const TOOL_BY_NAME = new Map<string, KiaraToolSpec>(KIARA_TOOLS.map((spec) => [spec.definition.name, spec]));

export function getKiaraTool(name: string): KiaraToolSpec | undefined {
  return TOOL_BY_NAME.get(name);
}

/** Sections the caller may open right now: permission, then feature availability. */
export function accessibleKiaraSections(access: AccessContext, controls: SectionControls): readonly PageId[] {
  return KIARA_HELP_SECTIONS.filter((page) => resolvePageAccess(access, controls, page) === "allowed");
}

/**
 * The tools offered to this caller, in catalogue order. Nothing is offered when
 * Ask Kiara itself is unavailable to them.
 */
export function offeredKiaraTools(access: AccessContext, controls: SectionControls): readonly KiaraToolSpec[] {
  if (resolvePageAccess(access, controls, "ask_kiara") !== "allowed") return [];
  const open = (page: PageId) => resolvePageAccess(access, controls, page) === "allowed";
  return KIARA_TOOLS.filter((spec) =>
    spec.permissions.every((key) => hasPermission(access, key))
    && spec.pages.every(open)
    && (!spec.anyOf || spec.anyOf.some((gate) => hasPermission(access, gate.permission) && open(gate.page))));
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export type KiaraToolArgValue = string | number | boolean;
export type KiaraToolInput = Readonly<{ name: KiaraToolName } & Readonly<Record<string, KiaraToolArgValue>>>;

export type KiaraToolInputResult =
  | Readonly<{ ok: true; input: KiaraToolInput }>
  | Readonly<{ ok: false; error: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validateField(key: string, field: FieldSpec, value: unknown): Readonly<{ value: KiaraToolArgValue } | { error: string }> {
  if (field.kind === "string") {
    if (typeof value !== "string") return { error: `${key} must be text.` };
    // Longer text is cut, not refused: the model cannot see length limits in strict schemas.
    return { value: value.replace(/\s+/g, " ").trim().slice(0, field.max) };
  }
  if (field.kind === "enum") {
    if (typeof value !== "string" || !field.values.includes(value)) {
      return { error: key === "section" ? "section must be one of the listed JewelOS sections." : `${key} must be one of: ${field.values.join(", ")}.` };
    }
    return { value };
  }
  if (field.kind === "date") return isIsoDate(value) ? { value } : { error: `${key} must be a date (YYYY-MM-DD).` };
  if (field.kind === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return { error: `${key} must be a whole number.` };
    return { value: Math.min(field.max, Math.max(field.min, value)) };
  }
  return typeof value === "boolean" ? { value } : { error: `${key} must be true or false.` };
}

/**
 * Validates a model-supplied tool input against the same declaration the schema
 * is built from. The API's strict mode should make this a formality; it still
 * runs so a malformed input is answered with an error result, never executed.
 * Blank optional text counts as not given.
 */
export function validateKiaraToolInput(name: string, input: unknown): KiaraToolInputResult {
  const spec = (FIELDS as Readonly<Record<string, ToolFields>>)[name];
  if (!spec || !(KIARA_TOOL_NAMES as readonly string[]).includes(name)) return { ok: false, error: `Unknown tool: ${name}` };
  if (!isRecord(input)) return { ok: false, error: "Tool input must be an object." };
  const unknown = Object.keys(input).find((key) => !(key in spec.fields));
  if (unknown) return { ok: false, error: `Unknown field: ${unknown}` };
  const values: Record<string, KiaraToolArgValue> = {};
  for (const [key, field] of Object.entries(spec.fields)) {
    const raw = input[key];
    if (raw === undefined || raw === null) continue;
    const checked = validateField(key, field, raw);
    if ("error" in checked) return { ok: false, error: checked.error };
    if (checked.value === "" && field.kind === "string") continue;
    values[key] = checked.value;
  }
  const missing = spec.required.find((key) => values[key] === undefined);
  if (missing) return { ok: false, error: `${missing} is required.` };
  return { ok: true, input: { ...values, name: name as KiaraToolName } };
}
