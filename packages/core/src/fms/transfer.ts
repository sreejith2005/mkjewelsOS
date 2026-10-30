import { fmsOutgoingStageKeys } from "./engine.ts";
import { FMS_ASSIGNEE_TYPES, FMS_AUTHORING_STAGE_TYPES, FMS_TERMINAL_OUTCOMES, FMS_BRANCH_OPERATORS, type FmsAssigneeRule, type FmsBranchRule, type FmsFlowDefinition, type FmsSlaRule, type FmsStageDefinition } from "./types.ts";
import { FMS_ASSIGNMENT_MODES, type FmsAssignmentConfig, type FmsAssignmentSource, type FmsTaskDisplay } from "./workContracts.ts";

/**
 * Copy, paste, import and export of workflow definitions.
 *
 * Everything here is an authoring template: stage definitions only. Live
 * instances, visits, submissions, notifications and audit history never enter
 * a payload, because nothing in `FmsStageDefinition` refers to them. Every
 * payload carries a format name and version and is parsed field by field, so a
 * pasted or uploaded file can never smuggle an unexpected value into a draft.
 * The server still validates the saved draft and refuses to publish a Form or
 * person outside the author's tenant; this module only keeps the draft honest.
 */

export const FMS_FRAGMENT_FORMAT = "mkjewels.fms.fragment";
export const FMS_WORKFLOW_FORMAT = "mkjewels.fms.workflow";
export const FMS_TRANSFER_VERSION = 1;
export const FMS_TRANSFER_LIMITS = { maxBytes: 1_000_000, maxStages: 200, maxRules: 50, maxChecklist: 100, maxAssignees: 20, maxText: 4000 } as const;

type Point = Readonly<{ x: number; y: number }>;

/** Selected steps of a workflow, with positions relative to the selection's top-left corner. */
export type FmsFragment = Readonly<{ format: typeof FMS_FRAGMENT_FORMAT; version: typeof FMS_TRANSFER_VERSION; source?: Readonly<{ workflowName?: string | undefined }> | undefined; stages: readonly FmsStageDefinition[] }>;
/** A whole workflow definition. Tenant scope, ids and lifecycle are not exported. */
export type FmsWorkflowExport = Readonly<{
  format: typeof FMS_WORKFLOW_FORMAT; version: typeof FMS_TRANSFER_VERSION; exportedAt: string;
  workflow: Readonly<{ name: string; description?: string | undefined; assignmentVersion?: 1 | 2 | undefined; stages: readonly FmsStageDefinition[] }>;
}>;
export type FmsTransferPayload = Readonly<{ kind: "fragment" | "workflow"; name?: string | undefined; description?: string | undefined; assignmentVersion?: 1 | 2 | undefined; stages: readonly FmsStageDefinition[] }>;

export class FmsTransferError extends Error {
  constructor(message: string) { super(message); this.name = "FmsTransferError"; }
}

/** What a paste changed so the builder can tell the author, instead of silently guessing. */
export type FmsPasteReport = Readonly<{
  /** Routes kept with their condition but no destination, because it was outside the copied steps. */
  unresolvedRoutes: number;
  /** Plain next-step, parallel, join, timing and condition links to steps that were not copied. */
  droppedLinks: number;
  /** Form versions the destination cannot use; the step keeps its routes and asks for a Form. */
  removedFormIds: readonly string[];
  /** Named people or fallbacks that are not active in this workspace. */
  removedAssignees: number;
  /** Assignment and task-display sources that read a step outside the copy. */
  removedSources: number;
}>;

export type FmsPasteOptions = Readonly<{
  /** World point the copied group's top-left corner lands on. */
  anchor: Point;
  newId: () => string;
  availableFormIds?: Iterable<string> | undefined;
  availableUserIds?: Iterable<string> | undefined;
  availableFlowIds?: Iterable<string> | undefined;
}>;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Positions relative to the group's top-left corner, so a paste can place the group anywhere. */
function relativePositions(stages: readonly FmsStageDefinition[], positions: ReadonlyMap<string, Point>): Map<string, Point> {
  const points = stages.map((stage) => positions.get(stage.key) ?? stage.position ?? { x: 0, y: 0 });
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  return new Map(stages.map((stage, index) => [stage.key, { x: Math.round(points[index]!.x - left), y: Math.round(points[index]!.y - top) }]));
}

/** A draft of the next questionnaire version belongs to the workflow it was started in. */
function withoutPrivateDraft(stage: FmsStageDefinition): FmsStageDefinition {
  if (!stage.sla.questionnaire?.draftFormId) return stage;
  return { ...stage, sla: { ...stage.sla, questionnaire: { origin: stage.sla.questionnaire.origin } } };
}

/** The selected steps, in workflow order, as a clipboard fragment. Unknown keys are ignored. */
export function createFmsFragment(definition: FmsFlowDefinition, keys: Iterable<string>, positions: ReadonlyMap<string, Point>): FmsFragment {
  const wanted = new Set(keys);
  const stages = [...definition.stages].sort((a, b) => a.order - b.order).filter((stage) => wanted.has(stage.key));
  const relative = relativePositions(stages, positions);
  return {
    format: FMS_FRAGMENT_FORMAT, version: FMS_TRANSFER_VERSION,
    ...(definition.name ? { source: { workflowName: definition.name } } : {}),
    stages: stages.map((stage, order) => ({ ...withoutPrivateDraft(stage), order, position: relative.get(stage.key) })),
  };
}

/** The entire workflow as a downloadable definition, without its tenant scope, ids or lifecycle. */
export function exportFmsWorkflow(definition: FmsFlowDefinition, positions: ReadonlyMap<string, Point>, now = new Date()): FmsWorkflowExport {
  const stages = [...definition.stages].sort((a, b) => a.order - b.order);
  return {
    format: FMS_WORKFLOW_FORMAT, version: FMS_TRANSFER_VERSION, exportedAt: now.toISOString(),
    workflow: {
      name: definition.name, ...(definition.description ? { description: definition.description } : {}),
      ...(definition.assignmentVersion ? { assignmentVersion: definition.assignmentVersion } : {}),
      stages: stages.map((stage, order) => ({ ...withoutPrivateDraft(stage), order, position: positions.get(stage.key) ?? stage.position })),
    },
  };
}

// ---------------------------------------------------------------- parsing

function fail(path: string, message: string): never { throw new FmsTransferError(`${path}: ${message}`); }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) fail(path, `unexpected field ${unexpected[0]}`);
}
function textValue(value: unknown, path: string, max: number = FMS_TRANSFER_LIMITS.maxText, required = false): string | undefined {
  if (value === undefined || value === null) { if (required) fail(path, "is required"); return undefined; }
  if (typeof value !== "string") fail(path, "must be text");
  if (value.length > max) fail(path, `must be at most ${max} characters`);
  return value;
}
function boolValue(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") fail(path, "must be true or false");
  return value;
}
function numberValue(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!finite(value)) fail(path, "must be a number");
  return value;
}
function list(value: unknown, path: string, max: number): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(path, "must be a list");
  if (value.length > max) fail(path, `must contain at most ${max} items`);
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(path, `must be one of ${allowed.join(", ")}`);
  return value as T;
}

function parseSource(raw: unknown, path: string): FmsAssignmentSource {
  if (!isRecord(raw)) fail(path, "must be an object");
  onlyKeys(raw, ["sourceStageKey", "formTemplateId", "fieldKey", "routeRuleId", "priority"], path);
  return {
    sourceStageKey: textValue(raw.sourceStageKey, `${path}.sourceStageKey`, 64, true)!,
    formTemplateId: textValue(raw.formTemplateId, `${path}.formTemplateId`, 64, true)!,
    fieldKey: textValue(raw.fieldKey, `${path}.fieldKey`, 64, true)!,
    ...(raw.routeRuleId !== undefined ? { routeRuleId: textValue(raw.routeRuleId, `${path}.routeRuleId`, 64) } : {}),
    ...(raw.priority !== undefined ? { priority: boolValue(raw.priority, `${path}.priority`) } : {}),
  } as FmsAssignmentSource;
}

function parseAssigneeRule(raw: unknown, path: string): FmsAssigneeRule {
  if (!isRecord(raw)) fail(path, "must be an object");
  onlyKeys(raw, ["type", "userProfileId", "fallbackUserProfileId", "role", "allowNextSelection"], path);
  return {
    type: oneOf(raw.type, FMS_ASSIGNEE_TYPES, `${path}.type`),
    ...(raw.userProfileId !== undefined ? { userProfileId: textValue(raw.userProfileId, `${path}.userProfileId`, 64) } : {}),
    ...(raw.fallbackUserProfileId !== undefined ? { fallbackUserProfileId: textValue(raw.fallbackUserProfileId, `${path}.fallbackUserProfileId`, 64) } : {}),
    ...(raw.role !== undefined ? { role: textValue(raw.role, `${path}.role`, 40) as FmsAssigneeRule["role"] } : {}),
    ...(raw.allowNextSelection !== undefined ? { allowNextSelection: boolValue(raw.allowNextSelection, `${path}.allowNextSelection`) } : {}),
  };
}

function parseRuleValue(value: unknown, path: string): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return textValue(value, path, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return list(value, path, 100).map((item, index) => textValue(typeof item === "number" ? String(item) : item, `${path}[${index}]`, 500, true));
}

function parseBranchRule(raw: unknown, path: string): FmsBranchRule {
  if (!isRecord(raw)) fail(path, "must be an object");
  onlyKeys(raw, ["id", "source", "sourceKey", "operator", "value", "nextStageKey", "nextFlowId", "order", "label"], path);
  return {
    id: textValue(raw.id, `${path}.id`, 64) ?? "",
    source: oneOf(raw.source, ["outcome", "context", "form_answer"] as const, `${path}.source`),
    ...(raw.sourceKey !== undefined ? { sourceKey: textValue(raw.sourceKey, `${path}.sourceKey`, 64) } : {}),
    operator: oneOf(raw.operator, FMS_BRANCH_OPERATORS, `${path}.operator`),
    ...(raw.value !== undefined ? { value: parseRuleValue(raw.value, `${path}.value`) } : {}),
    ...(raw.nextStageKey !== undefined ? { nextStageKey: textValue(raw.nextStageKey, `${path}.nextStageKey`, 64) } : {}),
    ...(raw.nextFlowId !== undefined ? { nextFlowId: textValue(raw.nextFlowId, `${path}.nextFlowId`, 64) } : {}),
    order: numberValue(raw.order, `${path}.order`) ?? 0,
    ...(raw.label !== undefined ? { label: textValue(raw.label, `${path}.label`, 120) } : {}),
  };
}

const SLA_KEYS = ["pipelineName", "assignment", "completionFormRequired", "taskDisplay", "followUp", "assignmentFieldKey", "formSectionKey", "questionnaire", "timingMethod", "deadlineEnabled", "dueDate", "tatHours", "tatMinutes", "tatUnit", "futureDate", "daysBefore", "clockTime", "triggerStageKey", "decisionMode", "decisionOptions", "conditional", "terminal"] as const;

function parseSla(raw: unknown, path: string): FmsSlaRule {
  if (raw === undefined || raw === null) return { dueDate: "" };
  if (!isRecord(raw)) fail(path, "must be an object");
  onlyKeys(raw, SLA_KEYS, path);
  const sla: Record<string, unknown> = { dueDate: textValue(raw.dueDate, `${path}.dueDate`, 20) ?? "" };
  for (const key of ["pipelineName", "assignmentFieldKey", "formSectionKey", "futureDate", "clockTime", "triggerStageKey"] as const) if (raw[key] !== undefined) sla[key] = textValue(raw[key], `${path}.${key}`, 120);
  for (const key of ["completionFormRequired", "deadlineEnabled"] as const) if (raw[key] !== undefined) sla[key] = boolValue(raw[key], `${path}.${key}`);
  for (const key of ["tatHours", "tatMinutes", "daysBefore"] as const) if (raw[key] !== undefined) sla[key] = numberValue(raw[key], `${path}.${key}`);
  if (raw.timingMethod !== undefined) sla.timingMethod = oneOf(raw.timingMethod, ["completion_date", "tat_hours", "days_before_date", "specific_time"] as const, `${path}.timingMethod`);
  if (raw.tatUnit !== undefined) sla.tatUnit = oneOf(raw.tatUnit, ["hours", "minutes"] as const, `${path}.tatUnit`);
  if (raw.decisionMode !== undefined) sla.decisionMode = oneOf(raw.decisionMode, ["normal", "yes_no", "decision"] as const, `${path}.decisionMode`);
  if (raw.decisionOptions !== undefined) sla.decisionOptions = list(raw.decisionOptions, `${path}.decisionOptions`, 20).map((option, index) => {
    if (!isRecord(option)) fail(`${path}.decisionOptions[${index}]`, "must be an object");
    onlyKeys(option, ["key", "label"], `${path}.decisionOptions[${index}]`);
    return { key: textValue(option.key, `${path}.decisionOptions[${index}].key`, 64, true)!, label: textValue(option.label, `${path}.decisionOptions[${index}].label`, 120, true)! };
  });
  if (raw.conditional !== undefined && raw.conditional !== null) {
    const condition = raw.conditional;
    if (!isRecord(condition)) fail(`${path}.conditional`, "must be an object");
    onlyKeys(condition, ["decisionStageKey", "decisionOptionKey", "outcome"], `${path}.conditional`);
    const option = textValue(condition.decisionOptionKey ?? condition.outcome, `${path}.conditional.decisionOptionKey`, 64, true)!;
    sla.conditional = { decisionStageKey: textValue(condition.decisionStageKey, `${path}.conditional.decisionStageKey`, 64, true)!, decisionOptionKey: option };
  }
  if (raw.terminal !== undefined && raw.terminal !== null) {
    const terminal = raw.terminal;
    if (!isRecord(terminal)) fail(`${path}.terminal`, "must be an object");
    onlyKeys(terminal, ["outcome", "reasonCode"], `${path}.terminal`);
    const reasonCode = textValue(terminal.reasonCode, `${path}.terminal.reasonCode`, 64);
    sla.terminal = { outcome: oneOf(terminal.outcome, FMS_TERMINAL_OUTCOMES, `${path}.terminal.outcome`), ...(reasonCode ? { reasonCode } : {}) };
  }
  if (raw.followUp !== undefined && raw.followUp !== null) {
    const followUp = raw.followUp;
    if (!isRecord(followUp)) fail(`${path}.followUp`, "must be an object");
    onlyKeys(followUp, ["maxVisits", "onLimit"], `${path}.followUp`);
    sla.followUp = { maxVisits: numberValue(followUp.maxVisits, `${path}.followUp.maxVisits`) ?? 1, onLimit: oneOf(followUp.onLimit, ["hold", "escalate"] as const, `${path}.followUp.onLimit`) };
  }
  if (raw.questionnaire !== undefined && raw.questionnaire !== null) {
    const questionnaire = raw.questionnaire;
    if (!isRecord(questionnaire)) fail(`${path}.questionnaire`, "must be an object");
    onlyKeys(questionnaire, ["origin", "draftFormId"], `${path}.questionnaire`);
    // An imported draft id would point at another workflow's unpublished work.
    sla.questionnaire = { origin: oneOf(questionnaire.origin, ["stage", "copied"] as const, `${path}.questionnaire.origin`) };
  }
  if (raw.assignment !== undefined && raw.assignment !== null) {
    const assignment = raw.assignment;
    if (!isRecord(assignment)) fail(`${path}.assignment`, "must be an object");
    onlyKeys(assignment, ["mode", "sources", "allowHandoff", "fallbackRule", "followFormAssignee"], `${path}.assignment`);
    const config: FmsAssignmentConfig = {
      mode: oneOf(assignment.mode, FMS_ASSIGNMENT_MODES, `${path}.assignment.mode`),
      sources: list(assignment.sources, `${path}.assignment.sources`, 20).map((source, index) => parseSource(source, `${path}.assignment.sources[${index}]`)),
      allowHandoff: boolValue(assignment.allowHandoff, `${path}.assignment.allowHandoff`) ?? false,
      ...(assignment.fallbackRule !== undefined && assignment.fallbackRule !== null ? { fallbackRule: parseAssigneeRule(assignment.fallbackRule, `${path}.assignment.fallbackRule`) } : {}),
      ...(assignment.followFormAssignee !== undefined ? { followFormAssignee: boolValue(assignment.followFormAssignee, `${path}.assignment.followFormAssignee`) } : {}),
    };
    sla.assignment = config;
  }
  if (raw.taskDisplay !== undefined && raw.taskDisplay !== null) {
    const display = raw.taskDisplay;
    if (!isRecord(display)) fail(`${path}.taskDisplay`, "must be an object");
    onlyKeys(display, ["recordNaming", "titleTemplate", "shortDescription", "instructions", "expectedResult", "dueLabel", "referenceField", "fields"], `${path}.taskDisplay`);
    const naming = display.recordNaming;
    if (naming !== undefined && naming !== null && !isRecord(naming)) fail(`${path}.taskDisplay.recordNaming`, "must be an object");
    if (isRecord(naming)) onlyKeys(naming, ["mode", "source"], `${path}.taskDisplay.recordNaming`);
    const parsed: FmsTaskDisplay = {
      fields: list(display.fields, `${path}.taskDisplay.fields`, 12).map((source, index) => parseSource(source, `${path}.taskDisplay.fields[${index}]`)),
      ...(isRecord(naming) ? { recordNaming: { mode: oneOf(naming.mode, ["automatic", "form_default", "field"] as const, `${path}.taskDisplay.recordNaming.mode`), ...(naming.source !== undefined && naming.source !== null ? { source: parseSource(naming.source, `${path}.taskDisplay.recordNaming.source`) } : {}) } } : {}),
      ...(display.referenceField !== undefined && display.referenceField !== null ? { referenceField: parseSource(display.referenceField, `${path}.taskDisplay.referenceField`) } : {}),
      ...Object.fromEntries((["titleTemplate", "shortDescription", "instructions", "expectedResult", "dueLabel"] as const).flatMap((key) => display[key] === undefined ? [] : [[key, textValue(display[key], `${path}.taskDisplay.${key}`, 1000)]])),
    };
    sla.taskDisplay = parsed;
  }
  return sla as FmsSlaRule;
}

const STAGE_KEYS = ["key", "name", "method", "type", "order", "required", "completionRule", "allowMultipleDoers", "requiresUpload", "requiresRemark", "checklist", "formTemplateId", "assigneeRules", "requiresNextDoerHandoff", "canMoveBackward", "canReject", "canRequestRevision", "canEscalate", "defaultNextStageKey", "branchRules", "parallelTargetStageKeys", "joinRule", "joinRequiredStageKeys", "splitToFlowId", "position", "sla"] as const;

function parseStage(raw: unknown, index: number): FmsStageDefinition {
  const path = `Step ${index + 1}`;
  if (!isRecord(raw)) fail(path, "must be an object");
  onlyKeys(raw, STAGE_KEYS, path);
  const key = textValue(raw.key, `${path}.key`, 64, true)!;
  if (!KEY.test(key)) fail(`${path}.key`, "must be a lowercase stable identifier");
  const name = textValue(raw.name, `${path}.name`, 150, true)!;
  const position = raw.position;
  if (position !== undefined && position !== null && (!isRecord(position) || !finite(position.x) || !finite(position.y))) fail(`${path}.position`, "must have numeric x and y");
  const keyList = (value: unknown, field: string) => list(value, `${path}.${field}`, FMS_TRANSFER_LIMITS.maxStages).map((item, at) => textValue(item, `${path}.${field}[${at}]`, 64, true)!);
  return {
    key, name, type: oneOf(raw.type, FMS_AUTHORING_STAGE_TYPES, `${path}.type`),
    ...(raw.method !== undefined ? { method: textValue(raw.method, `${path}.method`) } : {}),
    order: numberValue(raw.order, `${path}.order`) ?? index,
    required: boolValue(raw.required, `${path}.required`) ?? true,
    completionRule: raw.completionRule === undefined ? "any_doer" : oneOf(raw.completionRule, ["all_doers", "any_doer", "manager_approval"] as const, `${path}.completionRule`),
    allowMultipleDoers: boolValue(raw.allowMultipleDoers, `${path}.allowMultipleDoers`) ?? false,
    requiresUpload: boolValue(raw.requiresUpload, `${path}.requiresUpload`) ?? false,
    requiresRemark: boolValue(raw.requiresRemark, `${path}.requiresRemark`) ?? false,
    checklist: list(raw.checklist, `${path}.checklist`, FMS_TRANSFER_LIMITS.maxChecklist).map((item, at) => {
      if (!isRecord(item)) fail(`${path}.checklist[${at}]`, "must be an object");
      onlyKeys(item, ["key", "label", "required"], `${path}.checklist[${at}]`);
      return { key: textValue(item.key, `${path}.checklist[${at}].key`, 64, true)!, label: textValue(item.label, `${path}.checklist[${at}].label`, 300, true)!, required: boolValue(item.required, `${path}.checklist[${at}].required`) ?? true };
    }),
    ...(raw.formTemplateId !== undefined && raw.formTemplateId !== null ? { formTemplateId: textValue(raw.formTemplateId, `${path}.formTemplateId`, 64) } : {}),
    assigneeRules: list(raw.assigneeRules, `${path}.assigneeRules`, FMS_TRANSFER_LIMITS.maxAssignees).map((rule, at) => parseAssigneeRule(rule, `${path}.assigneeRules[${at}]`)),
    requiresNextDoerHandoff: boolValue(raw.requiresNextDoerHandoff, `${path}.requiresNextDoerHandoff`) ?? false,
    canMoveBackward: boolValue(raw.canMoveBackward, `${path}.canMoveBackward`) ?? false,
    canReject: boolValue(raw.canReject, `${path}.canReject`) ?? false,
    canRequestRevision: boolValue(raw.canRequestRevision, `${path}.canRequestRevision`) ?? false,
    canEscalate: boolValue(raw.canEscalate, `${path}.canEscalate`) ?? false,
    ...(raw.defaultNextStageKey !== undefined && raw.defaultNextStageKey !== null ? { defaultNextStageKey: textValue(raw.defaultNextStageKey, `${path}.defaultNextStageKey`, 64) } : {}),
    branchRules: list(raw.branchRules, `${path}.branchRules`, FMS_TRANSFER_LIMITS.maxRules).map((rule, at) => parseBranchRule(rule, `${path}.branchRules[${at}]`)),
    parallelTargetStageKeys: keyList(raw.parallelTargetStageKeys, "parallelTargetStageKeys"),
    ...(raw.joinRule !== undefined && raw.joinRule !== null ? { joinRule: oneOf(raw.joinRule, ["all", "any", "specific"] as const, `${path}.joinRule`) } : {}),
    joinRequiredStageKeys: keyList(raw.joinRequiredStageKeys, "joinRequiredStageKeys"),
    ...(raw.splitToFlowId !== undefined && raw.splitToFlowId !== null ? { splitToFlowId: textValue(raw.splitToFlowId, `${path}.splitToFlowId`, 64) } : {}),
    ...(isRecord(position) ? { position: { x: Math.max(0, position.x as number), y: Math.max(0, position.y as number) } } : {}),
    sla: parseSla(raw.sla, `${path}.sla`),
  };
}

/**
 * Parses clipboard text or an uploaded file. Accepts only MK Jewels FMS
 * fragments and workflow exports of a supported version; everything else
 * (including n8n workflow JSON) is refused with a readable reason.
 */
export function parseFmsTransfer(text: string): FmsTransferPayload {
  if (typeof text !== "string" || !text.trim()) throw new FmsTransferError("The clipboard or file is empty");
  if (text.length > FMS_TRANSFER_LIMITS.maxBytes) throw new FmsTransferError("The workflow file is too large (1 MB maximum)");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new FmsTransferError("This is not workflow JSON"); }
  if (!isRecord(raw)) throw new FmsTransferError("This is not workflow JSON");
  if (raw.format !== FMS_FRAGMENT_FORMAT && raw.format !== FMS_WORKFLOW_FORMAT) {
    throw new FmsTransferError(Array.isArray(raw.nodes) && isRecord(raw.connections)
      ? "n8n workflow files are not supported. Export the workflow from an MK Jewels FMS builder instead"
      : "This is not an MK Jewels FMS workflow or copied steps");
  }
  if (raw.version !== FMS_TRANSFER_VERSION) throw new FmsTransferError(`Unsupported workflow file version ${String(raw.version)}`);
  const fragment = raw.format === FMS_FRAGMENT_FORMAT;
  onlyKeys(raw, fragment ? ["format", "version", "source", "stages"] : ["format", "version", "exportedAt", "workflow"], "File");
  const container = fragment ? raw : raw.workflow;
  if (!isRecord(container)) throw new FmsTransferError("File: the workflow is missing");
  if (!fragment) onlyKeys(container, ["name", "description", "assignmentVersion", "stages"], "Workflow");
  const items = list(container.stages, "Steps", FMS_TRANSFER_LIMITS.maxStages);
  if (!items.length) throw new FmsTransferError("The file contains no steps");
  const stages = items.map((item, index) => parseStage(item, index));
  const keys = new Set<string>();
  for (const stage of stages) { if (keys.has(stage.key)) throw new FmsTransferError(`Step key ${stage.key} appears twice`); keys.add(stage.key); }
  const ruleIds = stages.flatMap((stage) => stage.branchRules.map((rule) => rule.id).filter(Boolean));
  if (new Set(ruleIds).size !== ruleIds.length) throw new FmsTransferError("Two routes share the same id");
  if (fragment) {
    const source = isRecord(raw.source) ? textValue(raw.source.workflowName, "File.source.workflowName", 150) : undefined;
    return { kind: "fragment", ...(source ? { name: source } : {}), stages };
  }
  const assignmentVersion = container.assignmentVersion === undefined ? undefined : container.assignmentVersion === 1 || container.assignmentVersion === 2 ? container.assignmentVersion : fail("Workflow.assignmentVersion", "must be 1 or 2");
  return {
    kind: "workflow", name: textValue(container.name, "Workflow.name", 150, true),
    ...(container.description !== undefined ? { description: textValue(container.description, "Workflow.description", 2000) } : {}),
    ...(assignmentVersion ? { assignmentVersion } : {}),
    stages,
  };
}

// ---------------------------------------------------------------- paste

/** The next `stage_N` key that no existing step uses, matching the builder's own naming. */
export function fmsStageKeyFactory(existing: Iterable<string>): () => string {
  const used = new Set(existing);
  let index = used.size + 1;
  return () => { while (used.has(`stage_${index}`)) index += 1; const key = `stage_${index}`; used.add(key); return key; };
}

/**
 * Adds copied steps to a workflow as new, independent steps. Every key and
 * route id is fresh; links between copied steps follow the copies; links to
 * steps that were not copied are never pointed at an unrelated step of the
 * destination — they are cut and counted in the report.
 */
export function pasteFmsFragment(target: FmsFlowDefinition, source: readonly FmsStageDefinition[], options: FmsPasteOptions): Readonly<{ definition: FmsFlowDefinition; pastedKeys: readonly string[]; report: FmsPasteReport }> {
  const forms = options.availableFormIds ? new Set(options.availableFormIds) : null;
  const users = options.availableUserIds ? new Set(options.availableUserIds) : null;
  const flows = options.availableFlowIds ? new Set(options.availableFlowIds) : null;
  const nextKey = fmsStageKeyFactory(target.stages.map((stage) => stage.key));
  const ordered = [...source].sort((a, b) => a.order - b.order);
  const keyMap = new Map(ordered.map((stage) => [stage.key, nextKey()]));
  const ruleMap = new Map(ordered.flatMap((stage) => stage.branchRules.map((rule) => [rule.id, options.newId()] as const)));
  const removedForms = new Set<string>();
  const formOk = (id: string | undefined) => !id || !forms || forms.has(id);
  const userOk = (id: string | undefined) => !id || !users || users.has(id);
  let unresolvedRoutes = 0; let droppedLinks = 0; let removedAssignees = 0; let removedSources = 0;
  const mapKey = (key: string | undefined): string | undefined => { if (!key) return undefined; const mapped = keyMap.get(key); if (!mapped) droppedLinks += 1; return mapped; };
  const mapSource = <T extends FmsAssignmentSource>(item: T | undefined): T | undefined => {
    if (!item) return undefined;
    const sourceKey = keyMap.get(item.sourceStageKey);
    const sourceStage = ordered.find((stage) => stage.key === item.sourceStageKey);
    if (!sourceKey || !formOk(item.formTemplateId) || sourceStage?.formTemplateId !== item.formTemplateId) { removedSources += 1; return undefined; }
    const routeRuleId = item.routeRuleId ? ruleMap.get(item.routeRuleId) : undefined;
    return { ...item, sourceStageKey: sourceKey, ...(item.routeRuleId ? { routeRuleId } : {}) };
  };
  const baseOrder = Math.max(-1, ...target.stages.map((stage) => stage.order)) + 1;
  // Fragments are already relative; a whole-workflow export is not. Either way the group's corner lands on the anchor.
  const placed = ordered.flatMap((stage) => stage.position ? [stage.position] : []);
  const corner = placed.length ? { x: Math.min(...placed.map((point) => point.x)), y: Math.min(...placed.map((point) => point.y)) } : { x: 0, y: 0 };
  const pasted = ordered.map((stage, index): FmsStageDefinition => {
    const keepForm = formOk(stage.formTemplateId);
    if (!keepForm && stage.formTemplateId) removedForms.add(stage.formTemplateId);
    const assigneeRules = stage.assigneeRules.flatMap((rule) => {
      if (rule.type === "specific_user" && !userOk(rule.userProfileId)) { removedAssignees += 1; return []; }
      if (rule.fallbackUserProfileId && !userOk(rule.fallbackUserProfileId)) { removedAssignees += 1; const { fallbackUserProfileId: _removed, ...kept } = rule; return [kept]; }
      return [rule];
    });
    const branchRules = stage.branchRules.map((rule) => {
      const nextStageKey = rule.nextStageKey ? keyMap.get(rule.nextStageKey) : undefined;
      if (rule.nextStageKey && !nextStageKey) unresolvedRoutes += 1;
      const nextFlowId = rule.nextFlowId && (!flows || flows.has(rule.nextFlowId)) ? rule.nextFlowId : undefined;
      return { ...rule, id: ruleMap.get(rule.id) ?? options.newId(), nextStageKey, nextFlowId };
    });
    const { sla } = stage;
    const assignment = sla.assignment ? (() => {
      const fallbackRule = sla.assignment.fallbackRule?.type === "specific_user" && !userOk(sla.assignment.fallbackRule.userProfileId) ? (removedAssignees += 1, undefined) : sla.assignment.fallbackRule;
      return { ...sla.assignment, sources: sla.assignment.sources.flatMap((item) => { const mapped = mapSource(item); return mapped ? [mapped] : []; }), fallbackRule };
    })() : undefined;
    const display = sla.taskDisplay ? {
      ...sla.taskDisplay,
      fields: sla.taskDisplay.fields.flatMap((item) => { const mapped = mapSource(item); return mapped ? [mapped] : []; }),
      referenceField: mapSource(sla.taskDisplay.referenceField),
      recordNaming: sla.taskDisplay.recordNaming?.mode === "field" ? (() => { const mapped = mapSource(sla.taskDisplay!.recordNaming!.source); return mapped ? { mode: "field" as const, source: mapped } : undefined; })() : sla.taskDisplay.recordNaming,
    } : undefined;
    const conditionKey = sla.conditional ? mapKey(sla.conditional.decisionStageKey) : undefined;
    const relative = stage.position ? { x: stage.position.x - corner.x, y: stage.position.y - corner.y } : { x: index * 300, y: 0 };
    return {
      ...stage,
      key: keyMap.get(stage.key)!,
      order: baseOrder + index,
      position: { x: Math.max(0, Math.round(options.anchor.x + relative.x)), y: Math.max(0, Math.round(options.anchor.y + relative.y)) },
      formTemplateId: keepForm ? stage.formTemplateId : undefined,
      assigneeRules,
      defaultNextStageKey: mapKey(stage.defaultNextStageKey),
      branchRules,
      parallelTargetStageKeys: stage.parallelTargetStageKeys.flatMap((key) => { const mapped = mapKey(key); return mapped ? [mapped] : []; }),
      joinRequiredStageKeys: stage.joinRequiredStageKeys.flatMap((key) => { const mapped = mapKey(key); return mapped ? [mapped] : []; }),
      splitToFlowId: stage.splitToFlowId && (!flows || flows.has(stage.splitToFlowId)) ? stage.splitToFlowId : undefined,
      sla: {
        ...sla,
        ...(keepForm ? {} : { formSectionKey: undefined, completionFormRequired: undefined, assignmentFieldKey: undefined }),
        // The pasted step runs the same published version; its first edit makes its own copy.
        questionnaire: sla.questionnaire && keepForm ? { origin: "copied" } : undefined,
        assignment, taskDisplay: display,
        triggerStageKey: mapKey(sla.triggerStageKey),
        conditional: conditionKey && sla.conditional ? { ...sla.conditional, decisionStageKey: conditionKey } : undefined,
      },
    };
  });
  return {
    definition: { ...target, stages: [...target.stages, ...pasted] },
    pastedKeys: pasted.map((stage) => stage.key),
    report: { unresolvedRoutes, droppedLinks, removedFormIds: [...removedForms], removedAssignees, removedSources },
  };
}

/** Plain-language summary of a paste report, or null when everything came across intact. */
export function describeFmsPasteReport(report: FmsPasteReport): string | null {
  const parts = [
    report.unresolvedRoutes ? `${report.unresolvedRoutes} route${report.unresolvedRoutes === 1 ? "" : "s"} led to steps that were not copied and need a new destination` : "",
    report.droppedLinks ? `${report.droppedLinks} link${report.droppedLinks === 1 ? "" : "s"} to steps that were not copied ${report.droppedLinks === 1 ? "was" : "were"} removed` : "",
    report.removedFormIds.length ? `${report.removedFormIds.length} Form${report.removedFormIds.length === 1 ? " is" : "s are"} not available here; link a Form on those steps` : "",
    report.removedAssignees ? `${report.removedAssignees} named ${report.removedAssignees === 1 ? "person is" : "people are"} not active here and ${report.removedAssignees === 1 ? "was" : "were"} removed` : "",
    report.removedSources ? `${report.removedSources} assignment or task-name source${report.removedSources === 1 ? "" : "s"} read a step that was not copied and ${report.removedSources === 1 ? "was" : "were"} cleared` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(". ")}.` : null;
}

// ---------------------------------------------------------------- delete

/** Connections that touch any of the steps, counted once each. */
export function fmsConnectionsTouching(stages: readonly FmsStageDefinition[], keys: Iterable<string>): number {
  const selected = new Set(keys);
  let count = 0;
  for (const stage of stages) {
    const targets = fmsOutgoingStageKeys(stage);
    count += selected.has(stage.key) ? targets.filter((key) => stages.some((item) => item.key === key)).length : targets.filter((key) => selected.has(key)).length;
  }
  return count;
}

/**
 * Removes several steps at once. Unlike a single-step delete, nothing is
 * re-wired: a plain next step that pointed at a removed step is cleared, a
 * route to a removed step is removed (a fallback route keeps its place without
 * a destination), and every other reference to a removed step is cleared, so
 * the remaining steps never start flowing somewhere the author did not choose.
 */
export function removeFmsStages(stages: readonly FmsStageDefinition[], keys: Iterable<string>): readonly FmsStageDefinition[] {
  const removed = new Set(keys);
  const gone = (key: string | undefined) => !!key && removed.has(key);
  const keepSource = <T extends FmsAssignmentSource>(item: T | undefined) => item && !gone(item.sourceStageKey) ? item : undefined;
  return stages.filter((stage) => !removed.has(stage.key)).map((stage) => {
    const { sla } = stage;
    return {
      ...stage,
      defaultNextStageKey: gone(stage.defaultNextStageKey) ? undefined : stage.defaultNextStageKey,
      branchRules: stage.branchRules.flatMap((rule) => !gone(rule.nextStageKey) ? [rule] : rule.operator === "default" ? [{ ...rule, nextStageKey: undefined }] : []).map((rule, index) => ({ ...rule, order: index })),
      parallelTargetStageKeys: stage.parallelTargetStageKeys.filter((key) => !gone(key)),
      joinRequiredStageKeys: stage.joinRequiredStageKeys.filter((key) => !gone(key)),
      sla: {
        ...sla,
        ...(gone(sla.triggerStageKey) ? { triggerStageKey: undefined } : {}),
        ...(sla.conditional && gone(sla.conditional.decisionStageKey) ? { conditional: undefined } : {}),
        ...(sla.assignment ? { assignment: { ...sla.assignment, sources: sla.assignment.sources.filter((item) => !gone(item.sourceStageKey)) } } : {}),
        ...(sla.taskDisplay ? { taskDisplay: { ...sla.taskDisplay, fields: sla.taskDisplay.fields.filter((item) => !gone(item.sourceStageKey)), referenceField: keepSource(sla.taskDisplay.referenceField), recordNaming: sla.taskDisplay.recordNaming?.mode === "field" && gone(sla.taskDisplay.recordNaming.source?.sourceStageKey) ? undefined : sla.taskDisplay.recordNaming } } : {}),
      },
    };
  });
}
