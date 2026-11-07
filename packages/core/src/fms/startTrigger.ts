/**
 * How an FMS workflow starts (migration 0374).
 *
 * - `form`: the existing behaviour. The first step is a linked Form; filling it starts a run.
 * - `automatic`: a saved submission (a JewelOS form, a CRM walk-in visit, a CRM queue entry, a
 *   CRM lead, or a CRM form built in the Form Builder) starts a run when the configured
 *   conditions match. No starting form is shown to anyone.
 * - `manual`: an authorized person starts a run from the FMS list without an intake form.
 *
 * The start trigger is workflow configuration, not a step: it never becomes an `fms_stages` row,
 * a task or a form. It is stored per published version (`fms_flows.start_trigger`) and is frozen
 * once that version leaves draft.
 *
 * The database is the authority: `fms_trigger_rule_matches` / `fms_trigger_group_eval` in 0374
 * evaluate every live event. `evaluateFmsTriggerConditions` below mirrors them for the builder's
 * test panel and the simulation only; both sides share the cases in startTrigger.test.ts and the
 * pgTAP file 0374_fms_start_triggers.test.sql.
 */

export const FMS_START_MODES = ["form", "automatic", "manual"] as const;
export type FmsStartMode = typeof FMS_START_MODES[number];

export const FMS_TRIGGER_SOURCE_TYPES = ["jewelos_form", "crm_walkin", "crm_queue", "crm_lead", "crm_linked_form"] as const;
export type FmsTriggerSourceType = typeof FMS_TRIGGER_SOURCE_TYPES[number];

export const FMS_TRIGGER_OPERATORS = [
  "equals", "not_equals", "contains", "not_contains", "is_empty", "not_empty",
  "greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal", "in",
] as const;
export type FmsTriggerOperator = typeof FMS_TRIGGER_OPERATORS[number];

export const FMS_TRIGGER_FIELD_TYPES = ["text", "number", "date", "boolean", "choice", "multi_choice", "branch", "user"] as const;
export type FmsTriggerFieldType = typeof FMS_TRIGGER_FIELD_TYPES[number];

/** Maximum nesting below the root group, and enabled-or-not rules in the whole tree. */
export const FMS_TRIGGER_MAX_DEPTH = 3;
export const FMS_TRIGGER_MAX_RULES = 25;
export const FMS_TRIGGER_MAX_MAPPINGS = 20;

export type FmsTriggerRule = Readonly<{
  id: string;
  kind: "rule";
  field: string;
  operator: FmsTriggerOperator;
  /** Stored option values, never display labels. A list only for `in`. "today" is allowed for dates. */
  value?: string | number | boolean | readonly string[] | undefined;
  enabled: boolean;
}>;
export type FmsTriggerGroup = Readonly<{
  id: string;
  kind: "group";
  combinator: "and" | "or";
  enabled: boolean;
  children: readonly FmsTriggerNode[];
}>;
export type FmsTriggerNode = FmsTriggerRule | FmsTriggerGroup;

export type FmsTriggerSource = Readonly<{
  type: FmsTriggerSourceType;
  /** `jewelos_form` and `crm_linked_form`: the Form family; any published version of it matches. */
  formFamilyId?: string | undefined;
  /** The published version the conditions were written against (shown in the builder). */
  formTemplateId?: string | undefined;
  /** `crm_linked_form` only: which CRM save the form is linked to. */
  purpose?: "queue" | "lead" | "walkin" | undefined;
}>;

/** One value copied from the saved submission into the run's context. */
export type FmsTriggerMapping = Readonly<{
  /** Context key, shown with `label` in the work page. */
  key: string;
  label: string;
  /** A source field key, or absent with `fixed` set. */
  field?: string | undefined;
  fixed?: string | undefined;
  /** Used when the source field is blank. */
  fallback?: string | undefined;
}>;

export const FMS_TRIGGER_REENTRY = ["one_active_per_case", "one_per_event"] as const;
export type FmsTriggerReentry = typeof FMS_TRIGGER_REENTRY[number];

export type FmsStartTrigger = Readonly<{
  source: FmsTriggerSource;
  conditions: FmsTriggerGroup;
  /** Run title: a fixed prefix plus an optional source field (e.g. "Not bought follow-up · {client_name}"). */
  title?: Readonly<{ prefix?: string | undefined; field?: string | undefined }> | undefined;
  mapping: readonly FmsTriggerMapping[];
  /**
   * `stage_rules`: the first step's own assignment decides. `source_staff`: the person the source
   * names (CRM salesperson resolved through the roster link, or the form submitter) gets the first
   * step. When that person cannot be resolved, `review` keeps the event for an administrator and
   * `stage_rules` falls back to the step's own assignment.
   */
  assignment: Readonly<{ mode: "stage_rules" | "source_staff"; onUnresolved: "review" | "stage_rules" }>;
  /** A date field whose value becomes the first step's deadline (day-half rule). Blank or past dates fall back to the step's timing. */
  dueField?: string | undefined;
  reentry: FmsTriggerReentry;
  /** CRM sources only: what a closed Not Bought case does to a linked open run. */
  onCaseClosed: "record_only" | "cancel_run";
}>;

export type FmsTriggerFieldOption = Readonly<{ value: string; label: string }>;
export type FmsTriggerField = Readonly<{
  key: string;
  label: string;
  type: FmsTriggerFieldType;
  options?: readonly FmsTriggerFieldOption[] | undefined;
  /** True when the field may hold customer identity (name, code); offered for mapping, flagged in the UI. */
  personal?: boolean | undefined;
}>;
export type FmsTriggerSourceDescriptor = Readonly<{
  type: FmsTriggerSourceType;
  label: string;
  /** What happened, in plain words, for the canvas anchor ("WHEN CRM WALK-IN IS SAVED"). */
  event: string;
  /** Fields the CRM always sends. Form sources add their questions at runtime. */
  fields: readonly FmsTriggerField[];
  /** Fields the source supplies for identity and case handling. */
  supportsCase: boolean;
  staffField?: string | undefined;
}>;

const option = (value: string, label?: string): FmsTriggerFieldOption => ({ value, label: label ?? value.split("_").map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(" ") });

/** CRM `buy_status` enum values. Stored values are matched; labels are display only. */
export const CRM_VISIT_STATUS_OPTIONS: readonly FmsTriggerFieldOption[] = [
  option("NO", "No (not bought)"), option("YES", "Yes (bought)"), option("YES_AND_ORDER_PLACED", "Yes and order placed"),
  option("ORDER_PLACED"), option("ORDER_PICKUP"), option("REPAIR_PLACED"), option("REPAIR_PICKUP"),
  option("PRODUCT_RETURN"), option("PRODUCT_EXCHANGE"), option("STORE_VISIT"), option("PRICE_CALCULATION"),
  option("ORDER_PLACED_AND_BUYING_NEW_PRODUCT"), option("ORDER_PLACED_AND_MAKING_NEW_ORDER"),
  option("ORDER_PICKUP_AND_BUYING_NEW_PRODUCT"), option("ORDER_PICKUP_AND_MAKING_NEW_ORDER"),
  option("REPAIR_PLACED_AND_BUYING_NEW_PRODUCT"), option("REPAIR_PLACED_AND_MAKING_NEW_ORDER"),
  option("REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT"), option("REPAIR_PICKUP_AND_MAKING_NEW_ORDER"),
];
const YES_NO: readonly FmsTriggerFieldOption[] = [option("YES", "Yes"), option("NO", "No")];

const common = {
  branch: { key: "branch_id", label: "Branch", type: "branch" },
  crm: { key: "crm_name", label: "CRM / salesperson", type: "text" },
  code: { key: "client_code", label: "Client code (MKC)", type: "text", personal: true },
  name: { key: "client_name", label: "Client name", type: "text", personal: true },
  staff: { key: "staff_profile_id", label: "Salesperson (JewelOS user)", type: "user" },
} as const satisfies Record<string, FmsTriggerField>;

/**
 * The supported sources. Field keys are the keys of the immutable event snapshot the CRM writes
 * in `crm_private.submission_event_snapshot` (CRM migration 20261103000200) and JewelOS stores
 * in `fms_trigger_events.payload`. `fms_trigger_source_catalog()` in 0374 mirrors this list;
 * startTrigger.migration.test.ts keeps them identical.
 */
export const FMS_TRIGGER_SOURCES: readonly FmsTriggerSourceDescriptor[] = [
  {
    type: "crm_walkin", label: "CRM Walk-In Visit", event: "When a CRM walk-in visit is saved", supportsCase: true, staffField: "staff_profile_id",
    fields: [
      { key: "visit_status", label: "Visit status (bought?)", type: "choice", options: CRM_VISIT_STATUS_OPTIONS },
      { key: "client_bought", label: "Client bought any product?", type: "choice", options: YES_NO },
      { key: "not_bought_reasons", label: "Not bought reasons", type: "multi_choice" },
      { key: "not_bought_other", label: "Not bought - other reason", type: "text" },
      { key: "product_requirement", label: "Product requirement", type: "text" },
      { key: "seen_categories", label: "Products seen", type: "multi_choice" },
      { key: "seen_count", label: "Products seen count", type: "number" },
      { key: "bought_categories", label: "Products bought", type: "multi_choice" },
      { key: "order_categories", label: "Order categories", type: "multi_choice" },
      { key: "visit_date", label: "Visit date", type: "date" },
      { key: "next_visit_date", label: "Next visit date", type: "date" },
      { key: "client_type", label: "Client type", type: "choice", options: [option("new", "New"), option("existing", "Existing")] },
      { key: "bridal_or_non_bridal", label: "Bridal or non-bridal", type: "text" },
      { key: "source_of_lead", label: "Source of lead", type: "text" },
      { key: "has_open_followup", label: "Has an open Not Bought follow-up", type: "boolean" },
      { key: "reference_number", label: "Visit reference", type: "text" },
      common.branch, common.crm, common.staff, common.code, common.name,
    ],
  },
  {
    type: "crm_queue", label: "CRM Client Queue Registration", event: "When a client is registered in the CRM queue", supportsCase: false, staffField: "staff_profile_id",
    fields: [
      { key: "is_new_client", label: "New client", type: "boolean" },
      { key: "token", label: "Queue token", type: "text" },
      { key: "registered_date", label: "Registered date", type: "date" },
      common.branch, common.crm, common.staff, common.code, common.name,
    ],
  },
  {
    type: "crm_lead", label: "CRM Lead Registration", event: "When a CRM lead is saved", supportsCase: false, staffField: "staff_profile_id",
    fields: [
      { key: "source_channel", label: "Lead source", type: "text" },
      { key: "created_via", label: "Created from", type: "text" },
      { key: "created_date", label: "Lead date", type: "date" },
      { key: "lead_name", label: "Lead name", type: "text", personal: true },
      common.branch, common.staff,
    ],
  },
  {
    type: "crm_linked_form", label: "CRM form (Form Builder)", event: "When a linked CRM form is saved", supportsCase: false, staffField: "staff_profile_id",
    fields: [common.branch, common.staff, common.code, common.name],
  },
  {
    type: "jewelos_form", label: "Forms Library form", event: "When the form is submitted", supportsCase: false, staffField: "submitted_by",
    fields: [
      { key: "branch_id", label: "Branch", type: "branch" },
      { key: "submitted_by", label: "Submitted by", type: "user" },
      { key: "submitted_date", label: "Submitted date", type: "date" },
    ],
  },
];

export const fmsTriggerSource = (type: FmsTriggerSourceType | undefined): FmsTriggerSourceDescriptor | undefined => FMS_TRIGGER_SOURCES.find((source) => source.type === type);

/** Form Builder question types mapped to the trigger field types they can be compared as. */
export function fmsTriggerFieldTypeForQuestion(fieldType: string | undefined, hasOptions = false): FmsTriggerFieldType | null {
  switch (fieldType) {
    case "number": case "currency": case "rating": return "number";
    case "date": case "datetime": return "date";
    case "checkbox": return hasOptions ? "multi_choice" : "boolean";
    case "select": case "radio": case "department_dropdown": return "choice";
    case "multiselect": return "multi_choice";
    case "user_dropdown": return "user";
    case "branch_dropdown": return "branch";
    // Phone numbers, files and layout items never decide or travel with a run.
    case "phone": case "file": case "section_header": case "divider": return null;
    default: return "text";
  }
}

const VALUELESS = new Set<FmsTriggerOperator>(["is_empty", "not_empty"]);
const ORDERED = new Set<FmsTriggerOperator>(["greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal"]);
/** Operators each field type may use; the database checks the same table at publish. */
export function fmsTriggerOperatorsFor(type: FmsTriggerFieldType): readonly FmsTriggerOperator[] {
  switch (type) {
    case "number": case "date": return ["equals", "not_equals", "greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal", "is_empty", "not_empty"];
    case "boolean": return ["equals", "not_equals", "is_empty", "not_empty"];
    case "choice": case "branch": case "user": return ["equals", "not_equals", "in", "is_empty", "not_empty"];
    case "multi_choice": return ["contains", "not_contains", "in", "is_empty", "not_empty"];
    case "text": return ["equals", "not_equals", "contains", "not_contains", "is_empty", "not_empty"];
  }
}
export const FMS_TRIGGER_OPERATOR_LABELS: Readonly<Record<FmsTriggerOperator, string>> = {
  equals: "Equals", not_equals: "Not equals", contains: "Contains", not_contains: "Does not contain",
  is_empty: "Is empty", not_empty: "Is not empty", greater_than: "Greater than", less_than: "Less than",
  greater_than_or_equal: "Greater than or equal", less_than_or_equal: "Less than or equal", in: "Is one of",
};

// ---------------------------------------------------------------------------------------------
// Evaluation (mirror of the database). Blank, missing and hidden answers are all "empty".
// ---------------------------------------------------------------------------------------------

const blank = (value: unknown): boolean => value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
const lower = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value)).trim().toLowerCase();
/** India date of `now`, the working day of MK Jewels. */
export function fmsTriggerToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
const asDate = (value: unknown, today: string): string | null => {
  if (value === "today") return today;
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1]! : null;
};
const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  if (Array.isArray(value)) return value.length;
  return null;
};
const asBool = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  const text = lower(value);
  if (["true", "yes", "y", "1"].includes(text)) return true;
  if (["false", "no", "n", "0"].includes(text)) return false;
  return null;
};
const list = (value: unknown): readonly string[] => Array.isArray(value) ? value.map(lower) : blank(value) ? [] : [lower(value)];

export type FmsTriggerRuleResult = Readonly<{ id: string; field: string; operator: FmsTriggerOperator; passed: boolean; skipped?: boolean | undefined }>;

/** One rule against one answer. `type` comes from the source catalog or the linked question. */
export function fmsTriggerRuleMatches(rule: Pick<FmsTriggerRule, "operator" | "value">, actual: unknown, type: FmsTriggerFieldType, today: string = fmsTriggerToday()): boolean {
  const { operator, value } = rule;
  if (operator === "is_empty") return blank(actual);
  if (operator === "not_empty") return !blank(actual);
  if (blank(actual)) return operator === "not_equals" || operator === "not_contains";
  if (ORDERED.has(operator)) {
    let left: number | string | null; let right: number | string | null;
    if (type === "date") { left = asDate(actual, today); right = asDate(value, today); } else { left = asNumber(actual); right = asNumber(value); }
    if (left === null || right === null) return false;
    switch (operator) {
      case "greater_than": return left > right;
      case "less_than": return left < right;
      case "greater_than_or_equal": return left >= right;
      default: return left <= right;
    }
  }
  if (operator === "in") {
    const expected = (Array.isArray(value) ? value : [value]).map(lower);
    return list(actual).some((item) => expected.includes(item));
  }
  const equal = (): boolean => {
    if (type === "boolean") { const a = asBool(actual); const b = asBool(value); return a !== null && a === b; }
    if (type === "number") { const a = asNumber(actual); const b = asNumber(value); return a !== null && a === b; }
    if (type === "date") { const a = asDate(actual, today); const b = asDate(value, today); return a !== null && a === b; }
    if (Array.isArray(actual)) { const items = list(actual); return items.length === 1 && items[0] === lower(value); }
    return lower(actual) === lower(value);
  };
  const contains = (): boolean => Array.isArray(actual) ? list(actual).includes(lower(value)) : lower(actual).includes(lower(value));
  switch (operator) {
    case "equals": return equal();
    case "not_equals": return !equal();
    case "contains": return contains();
    default: return !contains();
  }
}

export type FmsTriggerEvaluation = Readonly<{ matched: boolean; rules: readonly FmsTriggerRuleResult[] }>;

/**
 * Evaluates the condition tree. Disabled rules and groups are skipped; a group whose enabled
 * children are all skipped is skipped too, so an empty group never decides a result. The root
 * with nothing enabled does not match (publishing refuses that case anyway).
 */
export function evaluateFmsTriggerConditions(root: FmsTriggerGroup, answers: Readonly<Record<string, unknown>>, fieldType: (key: string) => FmsTriggerFieldType, today: string = fmsTriggerToday()): FmsTriggerEvaluation {
  const results: FmsTriggerRuleResult[] = [];
  const walk = (node: FmsTriggerNode): boolean | null => {
    if (!node.enabled) {
      if (node.kind === "rule") results.push({ id: node.id, field: node.field, operator: node.operator, passed: false, skipped: true });
      return null;
    }
    if (node.kind === "rule") {
      const passed = fmsTriggerRuleMatches(node, answers[node.field], fieldType(node.field), today);
      results.push({ id: node.id, field: node.field, operator: node.operator, passed });
      return passed;
    }
    const outcomes = node.children.map(walk).filter((item): item is boolean => item !== null);
    if (!outcomes.length) return null;
    return node.combinator === "and" ? outcomes.every(Boolean) : outcomes.some(Boolean);
  };
  return { matched: walk(root) === true, rules: results };
}

// ---------------------------------------------------------------------------------------------
// Validation (mirror of assert_fms_start_trigger_publishable).
// ---------------------------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXT_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export type FmsTriggerIssue = Readonly<{ code: string; message: string; ruleId?: string | undefined }>;

export function fmsTriggerRuleCount(node: FmsTriggerNode): number {
  return node.kind === "rule" ? 1 : node.children.reduce((sum, child) => sum + fmsTriggerRuleCount(child), 0);
}
const enabledRuleCount = (node: FmsTriggerNode): number => !node.enabled ? 0 : node.kind === "rule" ? 1 : node.children.reduce((sum, child) => sum + enabledRuleCount(child), 0);

/** `fields` is the source's catalog plus its form questions (for form sources). */
export function validateFmsStartTrigger(trigger: FmsStartTrigger | undefined, fields: readonly FmsTriggerField[], firstStageType?: string): readonly FmsTriggerIssue[] {
  const issues: FmsTriggerIssue[] = [];
  const add = (code: string, message: string, ruleId?: string) => issues.push({ code, message, ...(ruleId ? { ruleId } : {}) });
  if (!trigger) return [{ code: "trigger_missing", message: "Choose what starts this workflow" }];
  const source = fmsTriggerSource(trigger.source.type);
  if (!source) add("trigger_source", "Choose a supported start source");
  if ((trigger.source.type === "jewelos_form" || trigger.source.type === "crm_linked_form") && !UUID.test(trigger.source.formFamilyId ?? "")) add("trigger_form", "Choose the form that starts this workflow");
  if (trigger.source.type === "crm_linked_form" && trigger.source.purpose !== "queue" && trigger.source.purpose !== "lead" && trigger.source.purpose !== "walkin") add("trigger_form", "Choose whether the CRM form is for a client queue registration, lead or walk-in visit");
  const byKey = new Map(fields.map((field) => [field.key, field]));
  if (fmsTriggerRuleCount(trigger.conditions) > FMS_TRIGGER_MAX_RULES) add("trigger_too_many_rules", `Use at most ${FMS_TRIGGER_MAX_RULES} conditions`);
  if (enabledRuleCount(trigger.conditions) === 0) add("trigger_no_rules", "Add at least one switched-on condition, so the workflow does not start for every submission");
  const ids = new Set<string>();
  const walk = (node: FmsTriggerNode, depth: number) => {
    if (!ID.test(node.id) || ids.has(node.id)) add("trigger_rule_id", "Condition ids must be unique"); ids.add(node.id);
    if (node.kind === "group") {
      if (depth > FMS_TRIGGER_MAX_DEPTH) add("trigger_too_deep", `Groups can be nested at most ${FMS_TRIGGER_MAX_DEPTH} levels`, node.id);
      if (node.combinator !== "and" && node.combinator !== "or") add("trigger_group", "A group must use AND or OR", node.id);
      node.children.forEach((child) => walk(child, depth + 1));
      return;
    }
    if (!node.enabled) return;
    const field = byKey.get(node.field);
    if (!FIELD.test(node.field) || !field) { add("trigger_field_missing", "A condition uses a field the source no longer has", node.id); return; }
    if (!FMS_TRIGGER_OPERATORS.includes(node.operator) || !fmsTriggerOperatorsFor(field.type).includes(node.operator)) { add("trigger_operator", `"${field.label}" cannot use ${FMS_TRIGGER_OPERATOR_LABELS[node.operator] ?? node.operator}`, node.id); return; }
    if (VALUELESS.has(node.operator)) return;
    const values = Array.isArray(node.value) ? node.value : [node.value];
    if (!values.length || values.some((item) => item === undefined || item === null || String(item).trim() === "")) { add("trigger_value", `Enter the value "${field.label}" should match`, node.id); return; }
    if (node.operator !== "in" && Array.isArray(node.value)) add("trigger_value", `Only "Is one of" accepts several values`, node.id);
    if (field.type === "date" && values.some((item) => item !== "today" && !/^\d{4}-\d{2}-\d{2}$/.test(String(item)))) add("trigger_value", `"${field.label}" needs a date (or today)`, node.id);
    if (field.type === "number" && values.some((item) => asNumber(item) === null)) add("trigger_value", `"${field.label}" needs a number`, node.id);
    if (field.options?.length && (field.type === "choice" || node.operator === "in") && values.some((item) => !field.options!.some((choice) => choice.value === String(item)))) add("trigger_option_missing", `"${field.label}" no longer offers one of the chosen answers`, node.id);
  };
  walk(trigger.conditions, 0);
  if (trigger.mapping.length > FMS_TRIGGER_MAX_MAPPINGS) add("trigger_mapping", `Copy at most ${FMS_TRIGGER_MAX_MAPPINGS} values into the workflow`);
  const keys = new Set<string>();
  for (const map of trigger.mapping) {
    if (!CONTEXT_KEY.test(map.key) || keys.has(map.key) || FMS_TRIGGER_RESERVED_CONTEXT_KEYS.includes(map.key)) add("trigger_mapping", "Each copied value needs a unique key (lowercase letters, numbers and _)"); keys.add(map.key);
    if (!map.label.trim() || map.label.length > 80) add("trigger_mapping", "Each copied value needs a label");
    if (map.field ? !byKey.has(map.field) : !(map.fixed ?? "").trim()) add("trigger_mapping_field", `"${map.label || map.key}" copies a field the source does not have`);
  }
  if (trigger.title?.field && !byKey.has(trigger.title.field)) add("trigger_title", "The run title uses a field the source does not have");
  if (trigger.dueField && byKey.get(trigger.dueField)?.type !== "date") add("trigger_due", "The deadline must come from a date field");
  if (!FMS_TRIGGER_REENTRY.includes(trigger.reentry)) add("trigger_reentry", "Choose how repeat submissions are handled");
  if (trigger.assignment.mode !== "stage_rules" && trigger.assignment.mode !== "source_staff") add("trigger_assignment", "Choose who gets the first step");
  if (firstStageType !== undefined && !FMS_TRIGGER_FIRST_STAGE_TYPES.includes(firstStageType as never)) add("trigger_first_stage", "An automatic workflow must begin with a Task, Form, Approval, Decision, Notification or Parallel step");
  return issues;
}

/** Context keys the runtime already gives a meaning (starting-form identity, status conditions). */
export const FMS_TRIGGER_RESERVED_CONTEXT_KEYS: readonly string[] = ["form_submission_id", "form_template_id", "starter_assignment_id", "status", "trigger"];

/** Step types an automatic or manual workflow may begin with. */
export const FMS_TRIGGER_FIRST_STAGE_TYPES = ["task", "form", "approval", "branch", "notification", "parallel_start"] as const;

// ---------------------------------------------------------------------------------------------
// Context mapping and identity.
// ---------------------------------------------------------------------------------------------

const text = (value: unknown): string => blank(value) ? "" : Array.isArray(value) ? value.map((item) => String(item)).join(", ") : String(value);

/** The context a matched event writes into the run (mirror of `fms_trigger_context`). */
export function fmsTriggerContext(trigger: FmsStartTrigger, answers: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const map of trigger.mapping) {
    const value = map.field ? text(answers[map.field]) : (map.fixed ?? "").trim();
    const final = value || (map.fallback ?? "").trim();
    if (final) out[map.key] = final.slice(0, 500);
  }
  return out;
}

export function fmsTriggerTitle(trigger: FmsStartTrigger, answers: Readonly<Record<string, unknown>>, flowName: string): string {
  const field = trigger.title?.field ? text(answers[trigger.title.field]) : "";
  const prefix = (trigger.title?.prefix ?? "").trim() || flowName;
  return (field ? `${prefix} · ${field}` : prefix).slice(0, 200);
}

/**
 * The first step's deadline from a source date: that day's second-half deadline (21:00 India
 * time). A blank or past date returns null, and the step keeps its own timing.
 */
export function fmsTriggerDue(trigger: FmsStartTrigger, answers: Readonly<Record<string, unknown>>, now: Date = new Date()): Date | null {
  if (!trigger.dueField) return null;
  const date = asDate(answers[trigger.dueField], fmsTriggerToday(now));
  if (!date) return null;
  const due = new Date(`${date}T21:00:00+05:30`);
  return Number.isNaN(due.getTime()) || due.getTime() <= now.getTime() ? null : due;
}

/** A new, valid automatic trigger for a source, used by the builder's Start Trigger panel. */
export function newFmsStartTrigger(type: FmsTriggerSourceType, id: () => string): FmsStartTrigger {
  const walkin = type === "crm_walkin";
  return {
    source: { type },
    conditions: { id: id(), kind: "group", combinator: "and", enabled: true, children: walkin ? [{ id: id(), kind: "rule", field: "visit_status", operator: "equals", value: "NO", enabled: true }] : [] },
    title: walkin ? { field: "client_name" } : undefined,
    mapping: walkin ? [
      { key: "client_code", label: "Client code", field: "client_code" },
      { key: "visit_date", label: "Visit date", field: "visit_date" },
      { key: "visit_status", label: "Visit status", field: "visit_status" },
      { key: "not_bought_reason", label: "Not bought reason", field: "not_bought_reasons" },
      { key: "requirement", label: "Product requirement", field: "product_requirement" },
      { key: "next_visit_date", label: "Next visit date", field: "next_visit_date" },
    ] : [],
    assignment: { mode: walkin ? "source_staff" : "stage_rules", onUnresolved: "review" },
    dueField: walkin ? "next_visit_date" : undefined,
    reentry: walkin ? "one_active_per_case" : "one_per_event",
    onCaseClosed: "record_only",
  };
}

/** Plain-language lines for the canvas anchor: WHEN ..., IF ..., START .... */
export function describeFmsStartTrigger(trigger: FmsStartTrigger | undefined, fields: readonly FmsTriggerField[], flowName: string, formName?: string): readonly string[] {
  if (!trigger) return [];
  const source = fmsTriggerSource(trigger.source.type);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const when = trigger.source.type === "jewelos_form" || trigger.source.type === "crm_linked_form" ? `WHEN ${(formName ?? "the form").toUpperCase()} IS SUBMITTED` : `WHEN ${(source?.label ?? "the source").toUpperCase()} IS SAVED`;
  const ruleText = (node: FmsTriggerNode): string => {
    if (node.kind === "group") {
      const parts = node.children.filter((child) => child.enabled).map(ruleText).filter(Boolean);
      return parts.length > 1 ? `(${parts.join(` ${node.combinator.toUpperCase()} `)})` : parts[0] ?? "";
    }
    const field = byKey.get(node.field);
    const label = (field?.label ?? node.field).toUpperCase();
    if (VALUELESS.has(node.operator)) return `${label} ${FMS_TRIGGER_OPERATOR_LABELS[node.operator].toUpperCase()}`;
    const values = (Array.isArray(node.value) ? node.value : [node.value]).map((value) => field?.options?.find((choice) => choice.value === String(value))?.value ?? String(value));
    const symbol = node.operator === "equals" ? "=" : node.operator === "not_equals" ? "≠" : FMS_TRIGGER_OPERATOR_LABELS[node.operator].toUpperCase();
    return `${label} ${symbol} ${values.join(", ")}`;
  };
  const conditions = ruleText(trigger.conditions).replace(/^\((.*)\)$/, "$1");
  return [when, conditions ? `IF ${conditions}` : "IF (no conditions yet)", `START ${flowName.toUpperCase() || "THIS WORKFLOW"}`];
}

/** Narrow runtime check for a stored trigger (`fms_flows.start_trigger` is jsonb). */
export function parseFmsStartTrigger(raw: unknown): FmsStartTrigger | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Partial<FmsStartTrigger>;
  if (!value.source || !FMS_TRIGGER_SOURCE_TYPES.includes(value.source.type) || !value.conditions || value.conditions.kind !== "group") return undefined;
  return {
    source: value.source,
    conditions: value.conditions,
    title: value.title,
    mapping: Array.isArray(value.mapping) ? value.mapping : [],
    assignment: value.assignment ?? { mode: "stage_rules", onUnresolved: "review" },
    dueField: value.dueField,
    reentry: value.reentry === "one_per_event" ? "one_per_event" : "one_active_per_case",
    onCaseClosed: value.onCaseClosed === "cancel_run" ? "cancel_run" : "record_only",
  };
}

export const fmsStartMode = (raw: unknown): FmsStartMode => FMS_START_MODES.includes(raw as FmsStartMode) ? raw as FmsStartMode : "form";
