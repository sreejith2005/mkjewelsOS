/**
 * The versioned contract between the FMS AI assistant (Edge Function `fms-ai`)
 * and the builder. The model never writes an `FmsFlowDefinition` directly: it
 * returns typed edit operations against stable stage keys, which
 * `applyFmsAiOperations` compiles onto the current draft with the same
 * validators the manual builder uses. Everything the model returns is parsed
 * here as untrusted data; nothing is executed or rendered as markup.
 */
export const FMS_AI_SCHEMA_VERSION = 1 as const;

export const FMS_AI_LIMITS = {
  maxStages: 40,
  maxOperations: 80,
  maxQuestionChars: 2000,
  maxHistoryEntries: 12,
  maxHistoryChars: 4000,
  maxClarifyingQuestions: 5,
  maxListItems: 12,
  maxTextChars: 1500,
  maxNameChars: 150,
  maxRequestBytes: 300_000,
  maxCatalogForms: 60,
  maxFieldsPerForm: 60,
  maxOptionsPerField: 40,
  maxCatalogUsers: 300,
  maxFormsToCreate: 3,
} as const;

export const FMS_AI_MODES = ["debug", "build"] as const;
export type FmsAiMode = typeof FMS_AI_MODES[number];
export const FMS_AI_KINDS = ["clarification", "proposal", "explanation", "error"] as const;
export type FmsAiKind = typeof FMS_AI_KINDS[number];
export const FMS_AI_EVIDENCE_BASES = ["static", "simulated", "observed", "indeterminate"] as const;
export type FmsAiEvidenceBasis = typeof FMS_AI_EVIDENCE_BASES[number];

export const FMS_AI_OPERATION_KINDS = [
  "set_workflow_details", "add_stage", "update_stage", "remove_stage", "set_next", "add_route", "clear_routes",
  "set_assignment", "link_form", "set_timing", "set_decision_options", "set_checklist", "set_follow_up", "set_parallel",
] as const;
export type FmsAiOperationKind = typeof FMS_AI_OPERATION_KINDS[number];
export const FMS_AI_STAGE_TYPES = ["form", "task", "approval", "branch", "parallel_start", "parallel_join", "notification"] as const;
export const FMS_AI_ROUTE_OPERATORS = ["equals", "not_equals", "in", "contains", "not_empty", "greater_than", "less_than", "default"] as const;
export const FMS_AI_ASSIGNMENT_MODES = ["fixed_employee", "previous_form", "previous_stage_employee", "manual_handoff", "hierarchy"] as const;
export const FMS_AI_HIERARCHY = ["manager", "department_head", "role"] as const;
export const FMS_AI_FALLBACKS = ["none", "starter", "previous_step_doer", "specific_employee"] as const;
export const FMS_AI_FORM_FIELD_TYPES = ["text", "textarea", "number", "date", "select", "radio", "multiselect", "checkbox", "user_dropdown"] as const;

export type FmsAiRoute = Readonly<{ source: "form_answer" | "outcome"; questionKey: string | null; operator: typeof FMS_AI_ROUTE_OPERATORS[number]; values: readonly string[]; targetStageKey: string; label: string | null }>;
export type FmsAiAssignment = Readonly<{
  mode: typeof FMS_AI_ASSIGNMENT_MODES[number]; employeeIds: readonly string[]; hierarchy: typeof FMS_AI_HIERARCHY[number] | null; role: string | null;
  sourceStageKey: string | null; questionKey: string | null; followFormAssignee: boolean; allowHandoff: boolean;
  fallback: typeof FMS_AI_FALLBACKS[number]; fallbackEmployeeId: string | null;
}>;
export type FmsAiOperation = Readonly<{
  op: FmsAiOperationKind;
  stageKey: string | null;
  afterStageKey: string | null;
  stageType: typeof FMS_AI_STAGE_TYPES[number] | null;
  name: string | null;
  instructions: string | null;
  nextStageKey: string | null;
  route: FmsAiRoute | null;
  assignment: FmsAiAssignment | null;
  formTemplateId: string | null;
  timing: Readonly<{ method: "none" | "tat"; hours: number | null; minutes: number | null }> | null;
  decisionOptions: readonly Readonly<{ key: string; label: string }>[] | null;
  checklist: readonly Readonly<{ label: string; required: boolean }>[] | null;
  requiresUpload: boolean | null;
  requiresRemark: boolean | null;
  followUp: Readonly<{ maxVisits: number; onLimit: "hold" | "escalate" }> | null;
  parallelTargets: readonly string[] | null;
  joinRule: "all" | "any" | null;
  workflowDescription: string | null;
}>;
export type FmsAiQuestion = Readonly<{ id: string; question: string; choices: readonly string[] }>;
export type FmsAiEvidence = Readonly<{ basis: FmsAiEvidenceBasis; stageKey: string | null; findingId: string | null; text: string }>;
export type FmsAiSuggestedFix = Readonly<{ title: string; stageKey: string | null; steps: readonly string[]; operations: readonly FmsAiOperation[] }>;
export type FmsAiFormSpec = Readonly<{ ref: string; name: string; purpose: string; fields: readonly Readonly<{ key: string; label: string; type: typeof FMS_AI_FORM_FIELD_TYPES[number]; required: boolean; options: readonly Readonly<{ value: string; label: string }>[] }>[] }>;

/** What the model is constrained to return (structured output). */
export type FmsAiModelOutput = Readonly<{
  kind: FmsAiKind;
  message: string;
  questions: readonly FmsAiQuestion[];
  assumptions: readonly string[];
  unresolvedItems: readonly string[];
  confidence: "low" | "medium" | "high";
  evidence: readonly FmsAiEvidence[];
  suggestedFixes: readonly FmsAiSuggestedFix[];
  operations: readonly FmsAiOperation[];
  formsToCreate: readonly FmsAiFormSpec[];
}>;

export type FmsAiUsage = Readonly<{ model: string; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>;
export type FmsAiValidationIssue = Readonly<{ code: string; message: string; stageKey?: string | undefined }>;

/** What the Edge Function returns to the browser. */
export type FmsAiResponse = FmsAiModelOutput & Readonly<{
  schemaVersion: typeof FMS_AI_SCHEMA_VERSION;
  sessionId: string;
  requestId: string;
  mode: FmsAiMode;
  baseFingerprint: string;
  /** Fingerprint of the server-compiled proposal, so the browser can confirm it compiled the same result. */
  proposedFingerprint: string | null;
  validationIssues: readonly FmsAiValidationIssue[];
  /** Ids of the deterministic findings the server computed for this draft. */
  findingIds: readonly string[];
  runDataIncluded: boolean;
  usage: FmsAiUsage | null;
}>;

export type FmsAiErrorCode = "unauthenticated" | "forbidden" | "disabled" | "invalid_request" | "too_large" | "rate_limited" | "unavailable" | "provider_error" | "invalid_model_output" | "timeout";
export type FmsAiErrorBody = Readonly<{ error: string; code: FmsAiErrorCode; schemaVersion: typeof FMS_AI_SCHEMA_VERSION }>;

// ---------------------------------------------------------------------------
// JSON schema for structured output. Every object closes its properties and
// lists all of them as required; optional values are expressed as null.
// ---------------------------------------------------------------------------
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const enumOf = (values: readonly string[]): Schema => ({ type: "string", enum: [...values] });
const obj = (properties: Record<string, Schema>): Schema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: Schema): Schema => ({ type: "array", items });

const operationSchema = obj({
  op: enumOf(FMS_AI_OPERATION_KINDS),
  stageKey: nullable(str), afterStageKey: nullable(str), stageType: nullable(enumOf(FMS_AI_STAGE_TYPES)),
  name: nullable(str), instructions: nullable(str), nextStageKey: nullable(str),
  route: nullable(obj({ source: enumOf(["form_answer", "outcome"]), questionKey: nullable(str), operator: enumOf(FMS_AI_ROUTE_OPERATORS), values: arr(str), targetStageKey: str, label: nullable(str) })),
  assignment: nullable(obj({
    mode: enumOf(FMS_AI_ASSIGNMENT_MODES), employeeIds: arr(str), hierarchy: nullable(enumOf(FMS_AI_HIERARCHY)), role: nullable(str),
    sourceStageKey: nullable(str), questionKey: nullable(str), followFormAssignee: { type: "boolean" }, allowHandoff: { type: "boolean" },
    fallback: enumOf(FMS_AI_FALLBACKS), fallbackEmployeeId: nullable(str),
  })),
  formTemplateId: nullable(str),
  timing: nullable(obj({ method: enumOf(["none", "tat"]), hours: nullable({ type: "number" }), minutes: nullable({ type: "number" }) })),
  decisionOptions: nullable(arr(obj({ key: str, label: str }))),
  checklist: nullable(arr(obj({ label: str, required: { type: "boolean" } }))),
  requiresUpload: nullable({ type: "boolean" }), requiresRemark: nullable({ type: "boolean" }),
  followUp: nullable(obj({ maxVisits: { type: "integer" }, onLimit: enumOf(["hold", "escalate"]) })),
  parallelTargets: nullable(arr(str)), joinRule: nullable(enumOf(["all", "any"])), workflowDescription: nullable(str),
});

export const FMS_AI_OUTPUT_SCHEMA: Schema = obj({
  kind: enumOf(FMS_AI_KINDS),
  message: str,
  questions: arr(obj({ id: str, question: str, choices: arr(str) })),
  assumptions: arr(str),
  unresolvedItems: arr(str),
  confidence: enumOf(["low", "medium", "high"]),
  evidence: arr(obj({ basis: enumOf(FMS_AI_EVIDENCE_BASES), stageKey: nullable(str), findingId: nullable(str), text: str })),
  suggestedFixes: arr(obj({ title: str, stageKey: nullable(str), steps: arr(str), operations: arr(operationSchema) })),
  operations: arr(operationSchema),
  formsToCreate: arr(obj({ ref: str, name: str, purpose: str, fields: arr(obj({ key: str, label: str, type: enumOf(FMS_AI_FORM_FIELD_TYPES), required: { type: "boolean" }, options: arr(obj({ value: str, label: str })) })) })),
});

// ---------------------------------------------------------------------------
// Runtime parsing of untrusted model output.
// ---------------------------------------------------------------------------
export class FmsAiContractError extends Error {
  constructor(readonly path: string, message: string) { super(`${path}: ${message}`); }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Strips control characters (except newline/tab) and bounds the length. */
export function cleanFmsAiText(value: string, max: number = FMS_AI_LIMITS.maxTextChars): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, "").trim().slice(0, max);
}
const STAGE_KEY = /^[a-z][a-z0-9_]{0,63}$/;

function text(value: unknown, path: string, max: number = FMS_AI_LIMITS.maxTextChars): string {
  if (typeof value !== "string") throw new FmsAiContractError(path, "expected text");
  return cleanFmsAiText(value, max);
}
function optionalText(value: unknown, path: string, max?: number): string | null {
  return value === null || value === undefined ? null : text(value, path, max);
}
function key(value: unknown, path: string): string {
  const raw = text(value, path, 64).toLowerCase();
  if (!STAGE_KEY.test(raw)) throw new FmsAiContractError(path, "expected a stable key (lowercase letters, digits, underscore)");
  return raw;
}
function optionalKey(value: unknown, path: string): string | null {
  return value === null || value === undefined || value === "" ? null : key(value, path);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new FmsAiContractError(path, `expected one of ${allowed.join(", ")}`);
  return value as T;
}
function list<T>(value: unknown, path: string, max: number, item: (entry: unknown, path: string) => T): T[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new FmsAiContractError(path, "expected a list");
  if (value.length > max) throw new FmsAiContractError(path, `at most ${max} entries are allowed`);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new FmsAiContractError(path, "expected true or false");
  return value;
}
function optionalBool(value: unknown, path: string): boolean | null {
  return value === null || value === undefined ? null : bool(value, path);
}
function finite(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new FmsAiContractError(path, "expected a number");
  return value;
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new FmsAiContractError(path, "expected an object");
  return value;
}

export function parseFmsAiOperation(raw: unknown, path = "operation"): FmsAiOperation {
  const value = record(raw, path);
  const op = oneOf(value.op, FMS_AI_OPERATION_KINDS, `${path}.op`);
  const route = value.route === null || value.route === undefined ? null : (() => {
    const item = record(value.route, `${path}.route`);
    return {
      source: oneOf(item.source, ["form_answer", "outcome"] as const, `${path}.route.source`),
      questionKey: optionalText(item.questionKey, `${path}.route.questionKey`, 120),
      operator: oneOf(item.operator, FMS_AI_ROUTE_OPERATORS, `${path}.route.operator`),
      values: list(item.values, `${path}.route.values`, FMS_AI_LIMITS.maxOptionsPerField, (entry, at) => text(entry, at, 200)),
      targetStageKey: key(item.targetStageKey, `${path}.route.targetStageKey`),
      label: optionalText(item.label, `${path}.route.label`, 80),
    } satisfies FmsAiRoute;
  })();
  const assignment = value.assignment === null || value.assignment === undefined ? null : (() => {
    const item = record(value.assignment, `${path}.assignment`);
    return {
      mode: oneOf(item.mode, FMS_AI_ASSIGNMENT_MODES, `${path}.assignment.mode`),
      employeeIds: list(item.employeeIds, `${path}.assignment.employeeIds`, 10, (entry, at) => text(entry, at, 64)),
      hierarchy: item.hierarchy === null || item.hierarchy === undefined ? null : oneOf(item.hierarchy, FMS_AI_HIERARCHY, `${path}.assignment.hierarchy`),
      role: optionalText(item.role, `${path}.assignment.role`, 40),
      sourceStageKey: optionalKey(item.sourceStageKey, `${path}.assignment.sourceStageKey`),
      questionKey: optionalText(item.questionKey, `${path}.assignment.questionKey`, 120),
      followFormAssignee: item.followFormAssignee === undefined ? false : bool(item.followFormAssignee, `${path}.assignment.followFormAssignee`),
      allowHandoff: item.allowHandoff === undefined ? false : bool(item.allowHandoff, `${path}.assignment.allowHandoff`),
      fallback: item.fallback === undefined || item.fallback === null ? "none" : oneOf(item.fallback, FMS_AI_FALLBACKS, `${path}.assignment.fallback`),
      fallbackEmployeeId: optionalText(item.fallbackEmployeeId, `${path}.assignment.fallbackEmployeeId`, 64),
    } satisfies FmsAiAssignment;
  })();
  const timing = value.timing === null || value.timing === undefined ? null : (() => {
    const item = record(value.timing, `${path}.timing`);
    return { method: oneOf(item.method, ["none", "tat"] as const, `${path}.timing.method`), hours: finite(item.hours, `${path}.timing.hours`), minutes: finite(item.minutes, `${path}.timing.minutes`) };
  })();
  const followUp = value.followUp === null || value.followUp === undefined ? null : (() => {
    const item = record(value.followUp, `${path}.followUp`);
    const maxVisits = finite(item.maxVisits, `${path}.followUp.maxVisits`);
    if (maxVisits === null || !Number.isInteger(maxVisits)) throw new FmsAiContractError(`${path}.followUp.maxVisits`, "expected a whole number");
    return { maxVisits, onLimit: oneOf(item.onLimit, ["hold", "escalate"] as const, `${path}.followUp.onLimit`) };
  })();
  return {
    op,
    stageKey: optionalKey(value.stageKey, `${path}.stageKey`),
    afterStageKey: optionalKey(value.afterStageKey, `${path}.afterStageKey`),
    stageType: value.stageType === null || value.stageType === undefined ? null : oneOf(value.stageType, FMS_AI_STAGE_TYPES, `${path}.stageType`),
    name: optionalText(value.name, `${path}.name`, FMS_AI_LIMITS.maxNameChars),
    instructions: optionalText(value.instructions, `${path}.instructions`, 1000),
    nextStageKey: optionalKey(value.nextStageKey, `${path}.nextStageKey`),
    route, assignment,
    formTemplateId: optionalText(value.formTemplateId, `${path}.formTemplateId`, 64),
    timing,
    decisionOptions: value.decisionOptions === null || value.decisionOptions === undefined ? null : list(value.decisionOptions, `${path}.decisionOptions`, 8, (entry, at) => { const item = record(entry, at); return { key: key(item.key, `${at}.key`), label: text(item.label, `${at}.label`, 80) }; }),
    checklist: value.checklist === null || value.checklist === undefined ? null : list(value.checklist, `${path}.checklist`, 20, (entry, at) => { const item = record(entry, at); return { label: text(item.label, `${at}.label`, 200), required: bool(item.required, `${at}.required`) }; }),
    requiresUpload: optionalBool(value.requiresUpload, `${path}.requiresUpload`),
    requiresRemark: optionalBool(value.requiresRemark, `${path}.requiresRemark`),
    followUp,
    parallelTargets: value.parallelTargets === null || value.parallelTargets === undefined ? null : list(value.parallelTargets, `${path}.parallelTargets`, 10, key),
    joinRule: value.joinRule === null || value.joinRule === undefined ? null : oneOf(value.joinRule, ["all", "any"] as const, `${path}.joinRule`),
    workflowDescription: optionalText(value.workflowDescription, `${path}.workflowDescription`, 500),
  };
}

/** Parses and bounds a model reply. Throws `FmsAiContractError` on any shape violation. */
export function parseFmsAiModelOutput(raw: unknown): FmsAiModelOutput {
  const value = record(raw, "output");
  const kind = oneOf(value.kind, FMS_AI_KINDS, "kind");
  const operations = list(value.operations, "operations", FMS_AI_LIMITS.maxOperations, parseFmsAiOperation);
  const output: FmsAiModelOutput = {
    kind,
    message: text(value.message, "message", 4000),
    questions: list(value.questions, "questions", FMS_AI_LIMITS.maxClarifyingQuestions, (entry, at) => { const item = record(entry, at); return { id: text(item.id, `${at}.id`, 40), question: text(item.question, `${at}.question`, 400), choices: list(item.choices, `${at}.choices`, 8, (choice, path) => text(choice, path, 120)) }; }),
    assumptions: list(value.assumptions, "assumptions", FMS_AI_LIMITS.maxListItems, (entry, at) => text(entry, at, 400)),
    unresolvedItems: list(value.unresolvedItems, "unresolvedItems", FMS_AI_LIMITS.maxListItems, (entry, at) => text(entry, at, 400)),
    confidence: oneOf(value.confidence, ["low", "medium", "high"] as const, "confidence"),
    evidence: list(value.evidence, "evidence", 20, (entry, at) => { const item = record(entry, at); return { basis: oneOf(item.basis, FMS_AI_EVIDENCE_BASES, `${at}.basis`), stageKey: optionalKey(item.stageKey, `${at}.stageKey`), findingId: optionalText(item.findingId, `${at}.findingId`, 160), text: text(item.text, `${at}.text`, 600) }; }),
    suggestedFixes: list(value.suggestedFixes, "suggestedFixes", 6, (entry, at) => { const item = record(entry, at); return { title: text(item.title, `${at}.title`, 200), stageKey: optionalKey(item.stageKey, `${at}.stageKey`), steps: list(item.steps, `${at}.steps`, 8, (step, path) => text(step, path, 400)), operations: list(item.operations, `${at}.operations`, 20, parseFmsAiOperation) }; }),
    operations,
    formsToCreate: list(value.formsToCreate, "formsToCreate", FMS_AI_LIMITS.maxFormsToCreate, (entry, at) => {
      const item = record(entry, at);
      return {
        ref: key(item.ref, `${at}.ref`), name: text(item.name, `${at}.name`, FMS_AI_LIMITS.maxNameChars), purpose: text(item.purpose, `${at}.purpose`, 500),
        fields: list(item.fields, `${at}.fields`, 30, (fieldRaw, path) => { const field = record(fieldRaw, path); return { key: key(field.key, `${path}.key`), label: text(field.label, `${path}.label`, 200), type: oneOf(field.type, FMS_AI_FORM_FIELD_TYPES, `${path}.type`), required: bool(field.required, `${path}.required`), options: list(field.options, `${path}.options`, FMS_AI_LIMITS.maxOptionsPerField, (optionRaw, optionPath) => { const option = record(optionRaw, optionPath); return { value: key(option.value, `${optionPath}.value`), label: text(option.label, `${optionPath}.label`, 120) }; }) }; }),
      };
    }),
  };
  if (output.kind === "clarification" && !output.questions.length) throw new FmsAiContractError("questions", "a clarification needs at least one question");
  if (output.kind === "proposal" && !output.operations.length && !output.formsToCreate.length) throw new FmsAiContractError("operations", "a proposal needs at least one operation");
  return output;
}

/** Parses a model reply that arrived as JSON text. */
export function parseFmsAiModelText(raw: string): FmsAiModelOutput {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new FmsAiContractError("output", "the reply was not valid JSON"); }
  return parseFmsAiModelOutput(value);
}

// ---------------------------------------------------------------------------
// Browser -> Edge Function request contract.
// ---------------------------------------------------------------------------
export type FmsAiHistoryEntry = Readonly<{ role: "user" | "assistant"; text: string }>;
export type FmsAiRequest = Readonly<{
  schemaVersion: typeof FMS_AI_SCHEMA_VERSION;
  mode: FmsAiMode;
  sessionId: string;
  requestId: string;
  question: string;
  history: readonly FmsAiHistoryEntry[];
  /** The editor's current, possibly unsaved definition. Untrusted; validated server-side. */
  draft: unknown;
  baseFingerprint: string;
  selectedStageKey: string | null;
  /** The last published version of this family, for "what changed" questions. */
  publishedDraft: unknown | null;
  /** A live run to inspect. Only honoured when includeRunData is true and Run diagnosis is enabled. */
  instanceId: string | null;
  includeRunData: boolean;
  readOnly: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isFmsAiUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Validates the browser's request. Returns null for anything malformed. */
export function parseFmsAiRequest(raw: unknown): FmsAiRequest | null {
  if (!isRecord(raw)) return null;
  const allowed = ["schemaVersion", "mode", "sessionId", "requestId", "question", "history", "draft", "baseFingerprint", "selectedStageKey", "publishedDraft", "instanceId", "includeRunData", "readOnly"];
  if (Object.keys(raw).some((name) => !allowed.includes(name))) return null;
  if (raw.schemaVersion !== FMS_AI_SCHEMA_VERSION) return null;
  if (!FMS_AI_MODES.includes(raw.mode as FmsAiMode)) return null;
  if (!isFmsAiUuid(raw.sessionId) || !isFmsAiUuid(raw.requestId)) return null;
  if (typeof raw.question !== "string" || !raw.question.trim() || raw.question.length > FMS_AI_LIMITS.maxQuestionChars) return null;
  if (!Array.isArray(raw.history) || raw.history.length > FMS_AI_LIMITS.maxHistoryEntries) return null;
  const history: FmsAiHistoryEntry[] = [];
  for (const entry of raw.history) {
    if (!isRecord(entry) || (entry.role !== "user" && entry.role !== "assistant") || typeof entry.text !== "string" || entry.text.length > FMS_AI_LIMITS.maxHistoryChars) return null;
    history.push({ role: entry.role, text: cleanFmsAiText(entry.text, FMS_AI_LIMITS.maxHistoryChars) });
  }
  if (typeof raw.baseFingerprint !== "string" || !/^fms1-[0-9a-f]{16}$/.test(raw.baseFingerprint)) return null;
  if (raw.selectedStageKey !== null && (typeof raw.selectedStageKey !== "string" || !STAGE_KEY.test(raw.selectedStageKey))) return null;
  if (raw.instanceId !== null && !isFmsAiUuid(raw.instanceId)) return null;
  if (typeof raw.includeRunData !== "boolean" || typeof raw.readOnly !== "boolean") return null;
  if (!isRecord(raw.draft) || (raw.publishedDraft !== null && !isRecord(raw.publishedDraft))) return null;
  return {
    schemaVersion: FMS_AI_SCHEMA_VERSION, mode: raw.mode as FmsAiMode, sessionId: raw.sessionId, requestId: raw.requestId,
    question: cleanFmsAiText(raw.question, FMS_AI_LIMITS.maxQuestionChars), history, draft: raw.draft, baseFingerprint: raw.baseFingerprint,
    selectedStageKey: raw.selectedStageKey as string | null, publishedDraft: raw.publishedDraft ?? null, instanceId: raw.instanceId as string | null,
    includeRunData: raw.includeRunData, readOnly: raw.readOnly,
  };
}
