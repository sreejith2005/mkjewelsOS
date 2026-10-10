import { IMPLEMENTED_PAGE_IDS, type PageId } from "../roleMenu.ts";
import type { SectionControls } from "../settings/sectionAvailability.ts";
import { hasPermission, resolvePageAccess, type AccessContext } from "../permissions/resolve.ts";
import type { PermissionKey } from "../permissions/catalog.ts";
import { REPORT_CATALOG } from "../reports/catalog.ts";
import { KIARA_PERIOD_HINT } from "./period.ts";
import { KIARA_ESCALATION_REASONS, KIARA_ESCALATION_SUMMARY_MAX } from "./escalation.ts";

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
  | "notifications"
  | "knowledge"
  | "escalation";

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
  "search_knowledge_base",
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
  "offer_escalation",
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
export const KIARA_KB_QUERY_MAX = 200;

// ---------------------------------------------------------------------------
// Input fields: one declaration drives both the schema and the validator
// ---------------------------------------------------------------------------

type FieldSpec =
  | Readonly<{ kind: "string"; max: number; description: string }>
  | Readonly<{ kind: "enum"; values: readonly string[]; description: string }>
  | Readonly<{ kind: "boolean"; description: string }>;

type ToolFields = Readonly<{ fields: Readonly<Record<string, FieldSpec>>; required: readonly string[] }>;

/**
 * One optional text field for dates, not period/from/to: strict tool schemas
 * allow 24 optional parameters in total per request (see the limits test).
 */
const periodField: FieldSpec = { kind: "string", max: 30, description: `Dates, worked out from today in the turn context (kal = tomorrow or yesterday by context; is hafte = this_week; is mahine = this_month). ${KIARA_PERIOD_HINT}` };
const nameField = (description: string): FieldSpec => ({ kind: "string", max: KIARA_NAME_MAX, description: `${description} At most ${KIARA_NAME_MAX} characters.` });

function schemaFor(spec: ToolFields): KiaraInputSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, field] of Object.entries(spec.fields)) {
    if (field.kind === "string") properties[key] = { type: "string", description: field.description };
    else if (field.kind === "enum") properties[key] = { type: "string", enum: [...field.values], description: field.description };
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
  search_knowledge_base: {
    fields: {
      english_query: { kind: "string", max: KIARA_KB_QUERY_MAX, description: "Key words in English (translate Hindi, Hinglish, or Hindi in English letters first)." },
      original_terms: { kind: "string", max: KIARA_KB_QUERY_MAX, description: "The user's own key words when they did not write in English." },
    },
    required: ["english_query"],
  },
  search_my_tasks: {
    fields: {
      text: { kind: "string", max: KIARA_TEXT_MAX, description: "Words to find in the task title (English or as the user wrote them). At most 100 characters." },
      status: { kind: "enum", values: ["open", "overdue", "completed", "all"], description: "open (not done), overdue (not done and past due), completed, or all. Default open." },
      period: periodField,
    },
    required: [],
  },
  get_fms_work: {
    fields: {
      status: { kind: "enum", values: ["open", "completed", "all"], description: "open (default), completed, or all." },
    },
    required: [],
  },
  get_my_notifications: {
    fields: {
      unread_only: { kind: "boolean", description: "Only unread notifications. Default false." },
    },
    required: [],
  },
  search_forms: {
    fields: {
      text: { kind: "string", max: KIARA_TEXT_MAX, description: "Words to find in the form name. At most 100 characters." },
    },
    required: [],
  },
  get_leave: {
    fields: {
      scope: { kind: "enum", values: ["mine", "office"], description: "mine: the user's own leave requests. office: everyone's leave the user may see (managers, HR, admins)." },
      status: { kind: "enum", values: ["pending", "approved", "rejected"], description: "Only requests in this state." },
      period: periodField,
    },
    required: ["scope"],
  },
  get_availability: {
    fields: {
      period: periodField,
      department: nameField("Only this department (name)."),
    },
    required: [],
  },
  get_dashboard_metrics: {
    fields: {
      period: periodField,
      branch: nameField("Only this branch (name). Admins only."),
      department: nameField("Only this department (name)."),
    },
    required: [],
  },
  get_team_progress: {
    fields: {
      period: periodField,
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
      period: periodField,
      status: { kind: "string", max: 40, description: "Optional status filter, for example pending, completed, overdue, breached." },
    },
    required: ["report_key"],
  },
  find_people: {
    fields: {
      person_name: nameField("Part of the employee's name."),
      department: nameField("Part of the department name."),
    },
    required: [],
  },
  offer_escalation: {
    fields: {
      reason: { kind: "enum", values: KIARA_ESCALATION_REASONS, description: "no_kb_match: the knowledge base had no answer after two searches. conflicting_policy: the SOPs found disagree. needs_judgment: the SOPs leave it to a manager's decision." },
      summary_en: { kind: "string", max: KIARA_ESCALATION_SUMMARY_MAX, description: "The question in one short English sentence for the person who will answer, at most 300 characters. No personal details beyond what the user wrote." },
    },
    required: ["reason", "summary_en"],
  },
  find_colleague: {
    fields: {
      query: nameField("Key words only, for example \"HR Andheri\", \"Asha\", or \"Branch Manager Borivali\". Every word must match the colleague's name, designation, department, branch, or branch code."),
    },
    required: ["query"],
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
    "search_knowledge_base",
    "Search MK Jewels' SOPs and policies. Returns the best matching excerpts, each with its chunk_id, document title, and section.",
    { permissions: ["assistant.view"], pages: ["ask_kiara"], dataCategory: "knowledge", statusLabel: "Searching company SOPs" },
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
    "The first 25 rows of a report from Reports for a date range, within the user's report scope.",
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
  tool(
    "offer_escalation",
    "Offer to send the user's question to a person above them when you could not answer a valid MK Jewels procedure or policy question confidently after searching the knowledge base. Nothing is sent unless the user confirms. Never use it when the user lacks access to information, when they ask you to do something, or for a question you answered.",
    { permissions: ["assistant.view"], pages: ["ask_kiara"], dataCategory: "escalation", statusLabel: "Preparing to ask a person" },
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
