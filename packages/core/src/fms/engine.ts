import type { UserRole } from "../roleMenu";
import { FMS_ASSIGNEE_TYPES, FMS_BRANCH_OPERATORS, FMS_STAGE_TYPES, type FmsAssignmentCandidate, type FmsAssigneeRule, type FmsBranchRule, type FmsChecklistItemDefinition, type FmsDecisionOption, type FmsFlowDefinition, type FmsInstanceStatus, type FmsStageActorState, type FmsStageDefinition, type FmsStageStatus, type FmsTimingMethod, type FmsTransitionCapability, type FmsValidationContext, type FmsValidationIssue } from "./types";

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTO = new Set(["notification", "branch", "parallel_start", "parallel_join", "end"]);
const ELEVATED = new Set<UserRole>(["super_admin", "admin", "manager"]);

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const bool = (value: unknown, fallback = false) => typeof value === "boolean" ? value : fallback;
const array = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const TIMING_METHODS = new Set<FmsTimingMethod>(["completion_date", "tat_hours", "days_before_date", "specific_time"]);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const legacyDecisionOptions: readonly FmsDecisionOption[] = [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }];

export function normalizeFmsDefinition(input: FmsFlowDefinition): FmsFlowDefinition {
  const stages = [...input.stages].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map((stage, order) => ({
    ...stage,
    key: text(stage.key).toLowerCase(), name: text(stage.name), method: text(stage.method) || undefined, order,
    required: bool(stage.required, true), completionRule: stage.completionRule ?? "any_doer",
    allowMultipleDoers: bool(stage.allowMultipleDoers), requiresUpload: bool(stage.requiresUpload), requiresRemark: bool(stage.requiresRemark),
    checklist: array<FmsChecklistItemDefinition>(stage.checklist).map((item) => ({ key: text(item.key).toLowerCase(), label: text(item.label), required: bool(item.required, true) })),
    formTemplateId: text(stage.formTemplateId) || undefined,
    assigneeRules: array<FmsAssigneeRule>(stage.assigneeRules).map((rule) => ({ ...rule, userProfileId: text(rule.userProfileId) || undefined, fallbackUserProfileId: undefined, allowNextSelection: bool(rule.allowNextSelection) })),
    requiresNextDoerHandoff: bool(stage.requiresNextDoerHandoff), canMoveBackward: bool(stage.canMoveBackward), canReject: bool(stage.canReject),
    canRequestRevision: bool(stage.canRequestRevision), canEscalate: bool(stage.canEscalate), defaultNextStageKey: text(stage.defaultNextStageKey).toLowerCase() || undefined,
    branchRules: array<FmsBranchRule>(stage.branchRules).map((rule, index) => ({ ...rule, id: text(rule.id) || `rule_${index + 1}`, sourceKey: text(rule.sourceKey) || undefined, nextStageKey: text(rule.nextStageKey).toLowerCase() || undefined, nextFlowId: text(rule.nextFlowId) || undefined, order: index })),
    parallelTargetStageKeys: array<string>(stage.parallelTargetStageKeys).map((key) => text(key).toLowerCase()).filter(Boolean),
    joinRequiredStageKeys: array<string>(stage.joinRequiredStageKeys).map((key) => text(key).toLowerCase()).filter(Boolean),
    splitToFlowId: text(stage.splitToFlowId) || undefined,
    position: Number.isFinite(stage.position?.x) && Number.isFinite(stage.position?.y) ? { x: Math.max(0, Math.round(stage.position!.x)), y: Math.max(0, Math.round(stage.position!.y)) } : undefined,
    sla: {
      timingMethod: TIMING_METHODS.has(stage.sla?.timingMethod as FmsTimingMethod) ? stage.sla.timingMethod as FmsTimingMethod : "completion_date",
      dueDate: text(stage.sla?.dueDate), deadlineEnabled: stage.sla?.deadlineEnabled !== false,
      decisionMode: stage.sla?.decisionMode === "yes_no" || stage.sla?.decisionMode === "decision" ? "yes_no" as const : "normal" as const,
      ...(stage.sla?.decisionMode === "yes_no" || stage.sla?.decisionMode === "decision" ? { decisionOptions: (array<FmsDecisionOption>(stage.sla?.decisionOptions).map((option) => ({ key: text(option.key).toLowerCase(), label: text(option.label) })).filter((option) => option.key && option.label).length ? array<FmsDecisionOption>(stage.sla?.decisionOptions).map((option) => ({ key: text(option.key).toLowerCase(), label: text(option.label) })).filter((option) => option.key && option.label) : legacyDecisionOptions) } : {}),
      ...(Number.isFinite(stage.sla?.tatHours) ? { tatHours: Number(stage.sla.tatHours) } : {}),
      ...(Number.isFinite(stage.sla?.tatMinutes) ? { tatMinutes: Number(stage.sla.tatMinutes) } : Number.isFinite(stage.sla?.tatHours) ? { tatMinutes: Math.round(Number(stage.sla.tatHours) * 60) } : {}),
      ...(stage.sla?.tatUnit === "hours" || stage.sla?.tatUnit === "minutes" ? { tatUnit: stage.sla.tatUnit } : {}),
      ...(text(stage.sla?.futureDate) ? { futureDate: text(stage.sla.futureDate) } : {}),
      ...(Number.isFinite(stage.sla?.daysBefore) ? { daysBefore: Number(stage.sla.daysBefore) } : {}),
      ...(text(stage.sla?.clockTime) ? { clockTime: text(stage.sla.clockTime) } : {}),
      ...(text(stage.sla?.triggerStageKey) ? { triggerStageKey: text(stage.sla.triggerStageKey).toLowerCase() } : {}),
      ...(stage.sla?.conditional && "decisionStageKey" in stage.sla.conditional ? (() => { const decisionOptionKey = text("decisionOptionKey" in stage.sla.conditional ? stage.sla.conditional.decisionOptionKey : stage.sla.conditional.outcome).toLowerCase(); return { conditional: { decisionStageKey: text(stage.sla.conditional.decisionStageKey).toLowerCase(), decisionOptionKey, outcome: decisionOptionKey } }; })() : {}),
    },
  }));
  return { ...input, name: text(input.name), description: text(input.description) || undefined, manualTrigger: true, stages };
}

/** True when the stage carries its own ordered routes instead of a single successor. */
export function hasFmsStageRouting(stage: FmsStageDefinition): boolean {
  return stage.type !== "branch" && stage.type !== "parallel_start" && stage.branchRules.length > 0;
}

/** The fallback route of a routed stage, or `defaultNextStageKey` when none is configured. */
export function fmsFallbackStageKey(stage: FmsStageDefinition): string | undefined {
  return stage.branchRules.find((rule) => rule.operator === "default")?.nextStageKey ?? stage.defaultNextStageKey;
}

export function fmsOutgoingStageKeys(stage: FmsStageDefinition): readonly string[] {
  if (stage.type === "branch") return stage.branchRules.flatMap((rule) => rule.nextStageKey ? [rule.nextStageKey] : []);
  if (stage.type === "parallel_start") return stage.parallelTargetStageKeys;
  const routed = stage.branchRules.flatMap((rule) => rule.nextStageKey ? [rule.nextStageKey] : []);
  return [...new Set(stage.defaultNextStageKey ? [...routed, stage.defaultNextStageKey] : routed)];
}

export function reachableFmsStageKeys(definition: FmsFlowDefinition): ReadonlySet<string> {
  const stages = [...definition.stages].sort((a, b) => a.order - b.order);
  const start = stages[0]?.key; const byKey = new Map(stages.map((stage) => [stage.key, stage])); const reached = new Set<string>();
  if (!start) return reached;
  const pending = [start];
  while (pending.length) { const key = pending.shift()!; if (reached.has(key)) continue; reached.add(key); const stage = byKey.get(key); if (stage) for (const next of fmsOutgoingStageKeys(stage)) if (!reached.has(next)) pending.push(next); }
  return reached;
}

function hasUnsupportedCycle(definition: FmsFlowDefinition): boolean {
  const byKey = new Map(definition.stages.map((stage) => [stage.key, stage])); const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (key: string): boolean => { if (visiting.has(key)) return true; if (visited.has(key)) return false; visiting.add(key); for (const next of fmsOutgoingStageKeys(byKey.get(key)!)) if (byKey.has(next) && visit(next)) return true; visiting.delete(key); visited.add(key); return false; };
  return definition.stages.some((stage) => visit(stage.key));
}

const ROUTE_VALUE_FREE = new Set<string>(["default", "not_empty"]);

/**
 * Ordered routes on an ordinary step. They are additive: a step without routes
 * still moves to `defaultNextStageKey`, exactly as every published flow does.
 */
function validateStageRoutes(stage: FmsStageDefinition, byKey: ReadonlyMap<string, FmsStageDefinition>, context: FmsValidationContext, add: (code: string, message: string) => void): void {
  const fields = stage.formTemplateId ? context.formFields?.[stage.formTemplateId] : undefined;
  if (stage.branchRules.filter((rule) => rule.operator === "default").length > 1) add("conflicting_fallback_route", "A step can define only one fallback route");
  if (stage.branchRules.some((rule) => rule.nextFlowId)) add("invalid_route_target", "A conditional route must point to a step in this workflow");
  for (const rule of stage.branchRules) {
    const label = rule.label ? `"${rule.label}"` : `Route ${rule.order + 1}`;
    if (!FMS_BRANCH_OPERATORS.includes(rule.operator)) add("invalid_route_operator", `${label} uses an unsupported condition`);
    if (!rule.nextStageKey) { add("route_without_destination", `${label} has no destination step`); continue; }
    if (!byKey.has(rule.nextStageKey)) continue;
    if (rule.operator === "default") continue;
    if (rule.source === "outcome" && stage.sla.decisionMode !== "yes_no") add("route_without_decision", `${label} routes on this step's outcome, so make this step a Decision step`);
    if (rule.source === "outcome" && stage.sla.decisionMode === "yes_no" && !stage.sla.decisionOptions?.some((option) => option.key === String(rule.value ?? ""))) add("invalid_route_value", `${label} matches an outcome that this step no longer offers`);
    if (rule.source !== "outcome" && !rule.sourceKey) { add("invalid_route_source", `${label} needs the question or process field that decides it`); continue; }
    if (!ROUTE_VALUE_FREE.has(rule.operator) && (rule.value === undefined || rule.value === null || rule.value === "" || Array.isArray(rule.value) && rule.value.length === 0)) add("invalid_route_value", `${label} needs the answer it should match`);
    if (rule.source !== "form_answer") continue;
    if (!stage.formTemplateId) { add("route_without_form", `${label} routes on a form answer, so link a Form to this step`); continue; }
    if (!fields) continue;
    const field = fields.find((item) => item.key === rule.sourceKey);
    if (!field) { add("route_field_missing", `${label} uses a question that is no longer in the linked Form`); continue; }
    const expected = Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value ?? "")];
    if (field.optionValues?.length && !ROUTE_VALUE_FREE.has(rule.operator) && rule.operator !== "contains" && expected.some((value) => !field.optionValues!.includes(value))) add("route_value_missing", `${label} matches an option that "${field.label}" no longer offers`);
  }
}

export function validateFmsDefinition(raw: FmsFlowDefinition, context: FmsValidationContext = {}): readonly FmsValidationIssue[] {
  const definition = normalizeFmsDefinition(raw); const issues: FmsValidationIssue[] = []; const keys = new Set<string>(); const byKey = new Map(definition.stages.map((stage) => [stage.key, stage]));
  if (!definition.name || definition.name.length > 150) issues.push({ code: "invalid_name", message: "Flow name must contain 1 to 150 characters" });
  if (definition.version !== undefined && (!Number.isInteger(definition.version) || definition.version < 1)) issues.push({ code: "invalid_version", message: "Version must be a positive integer" });
  if (definition.scope === "department" && (!definition.branchId || !definition.departmentId)) issues.push({ code: "invalid_scope", message: "Department scope requires branch and department" });
  if (definition.scope === "branch" && !definition.branchId) issues.push({ code: "invalid_scope", message: "Branch scope requires a branch" });
  if (!definition.stages.length) return [...issues, { code: "empty_flow", message: "A flow must contain at least one stage" }];
  if (definition.stages[0]?.type !== "form") issues.push({ code: "first_stage_must_be_form", message: "The first stage must be a Form", stageKey: definition.stages[0]?.key });
  for (const [stageIndex, stage] of definition.stages.entries()) {
    const add = (code: string, message: string) => issues.push({ code, message, stageKey: stage.key });
    if (!KEY.test(stage.key) || keys.has(stage.key)) add("invalid_stage_key", "Stage keys must be unique stable identifiers"); keys.add(stage.key);
    if (!stage.name || stage.name.length > 150 || !FMS_STAGE_TYPES.includes(stage.type)) add("invalid_stage", "Stage name or type is invalid");
    if (stage.type === "end") add("legacy_end_stage", "End nodes are no longer used. Leave the final executable stage without a next connection instead");
    if (!AUTO.has(stage.type) && stage.sla.deadlineEnabled !== false && stage.sla.timingMethod === "completion_date" && !validDate(stage.sla.dueDate)) add("invalid_deadline", "Choose a valid completion due date");
    if (!AUTO.has(stage.type) && stage.sla.deadlineEnabled !== false && stage.sla.timingMethod === "tat_hours" && (!Number.isFinite(stage.sla.tatMinutes) || stage.sla.tatMinutes! <= 0 || stage.sla.tatMinutes! > 525600)) add("invalid_deadline", "TAT must be between 1 minute and 8,760 hours");
    if (!AUTO.has(stage.type) && stage.sla.deadlineEnabled !== false && stage.sla.timingMethod === "days_before_date" && (!validDate(stage.sla.futureDate ?? "") || !Number.isInteger(stage.sla.daysBefore) || stage.sla.daysBefore! < 0 || stage.sla.daysBefore! > 3650)) add("invalid_deadline", "Choose a future date and a valid number of days before it");
    if (!AUTO.has(stage.type) && stage.sla.deadlineEnabled !== false && stage.sla.timingMethod === "specific_time" && (!validDate(stage.sla.dueDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(stage.sla.clockTime ?? ""))) add("invalid_deadline", "Choose a valid date and clock time");
    if (stage.sla.triggerStageKey) { const trigger = byKey.get(stage.sla.triggerStageKey); if (!trigger || trigger.order >= stage.order) add("invalid_deadline_trigger", "Timing can only start from an earlier step"); }
    if (stage.sla.decisionMode === "yes_no" && (AUTO.has(stage.type) || stageIndex === 0 || !stage.sla.decisionOptions?.length || new Set(stage.sla.decisionOptions.map((option) => option.key)).size !== stage.sla.decisionOptions.length || stage.sla.decisionOptions.some((option) => !KEY.test(option.key) || !option.label))) add("invalid_decision", "Decision steps need unique options on human steps after the initial Form");
    if (stage.sla.conditional) {
      const decision = byKey.get(stage.sla.conditional.decisionStageKey);
      const optionKey = "decisionOptionKey" in stage.sla.conditional ? stage.sla.conditional.decisionOptionKey : stage.sla.conditional.outcome;
      if (!decision || decision.order >= stage.order || decision.sla.decisionMode !== "yes_no" || !decision.sla.decisionOptions?.some((option) => option.key === optionKey)) add("invalid_conditional", "A condition must reference an earlier configured decision option");
    }
    if (new Set(stage.checklist.map((item) => item.key)).size !== stage.checklist.length || stage.checklist.some((item) => !KEY.test(item.key) || !item.label)) add("invalid_checklist", "Checklist keys must be unique and labels are required");
    if (stageIndex === 0 && !stage.formTemplateId) add("missing_form", "The initial Form requires an exact published template version");
    if (stage.formTemplateId && !UUID.test(stage.formTemplateId)) add("invalid_form", "Linked form ID is invalid");
    if (stage.formTemplateId && UUID.test(stage.formTemplateId) && context.availableFormIds && !context.availableFormIds.includes(stage.formTemplateId)) add("missing_linked_form", "The linked Form is no longer an available published version");
    if (!AUTO.has(stage.type) && !stage.assigneeRules.length) add("missing_assignee", "Executable stages require an assignee rule");
    if (stage.assigneeRules.some((rule) => !FMS_ASSIGNEE_TYPES.includes(rule.type) || rule.type === "specific_user" && (!UUID.test(rule.userProfileId ?? "") || rule.fallbackUserProfileId !== undefined && !UUID.test(rule.fallbackUserProfileId)) || rule.type !== "specific_user" && rule.fallbackUserProfileId !== undefined || rule.type === "role" && !rule.role)) add("invalid_assignee", "Assignee rule is incomplete");
    if (!stage.allowMultipleDoers && stage.completionRule === "all_doers") add("incompatible_completion_rule", "all_doers requires multiple doers");
    if (stage.type === "approval" && stage.completionRule !== "manager_approval") add("incompatible_completion_rule", "Approval stages require manager_approval");
    for (const next of fmsOutgoingStageKeys(stage)) if (!byKey.has(next)) add("dangling_reference", `Stage references missing stage ${next}`);
    if (hasFmsStageRouting(stage)) validateStageRoutes(stage, byKey, context, add);
    if (stage.type === "branch") { const defaults = stage.branchRules.filter((rule) => rule.operator === "default"); if (!stage.branchRules.length || defaults.length !== 1 || stage.branchRules.at(-1)?.operator !== "default") add("invalid_branch", "Branch stages require one final default route"); if (stage.branchRules.some((rule) => !FMS_BRANCH_OPERATORS.includes(rule.operator) || rule.source !== "outcome" && !rule.sourceKey || rule.operator !== "default" && rule.value === undefined && rule.operator !== "not_empty" || (!!rule.nextStageKey === !!rule.nextFlowId))) add("invalid_branch", "Branch rules contain invalid source, operator, value, or target"); }
    if (stage.type === "parallel_start" && !stage.parallelTargetStageKeys.length) add("invalid_parallel", "Parallel start requires targets");
    if (stage.type === "parallel_join" && (!stage.joinRule || stage.joinRule === "specific" && !stage.joinRequiredStageKeys.length)) add("invalid_join", "Parallel join configuration is incomplete");
    if (stage.type === "end" && fmsOutgoingStageKeys(stage).length) add("invalid_end", "End stages cannot have outgoing paths");
  }
  const reached = reachableFmsStageKeys(definition); for (const stage of definition.stages) if (!reached.has(stage.key)) issues.push({ code: "unreachable_stage", message: `Stage ${stage.key} is unreachable`, stageKey: stage.key });
  if (![...reached].some((key) => { const stage = byKey.get(key); return stage ? fmsOutgoingStageKeys(stage).length === 0 : false; })) issues.push({ code: "missing_completion_path", message: "At least one reachable path must finish at a step with no outgoing connection" });
  if (hasUnsupportedCycle(definition)) issues.push({ code: "unsupported_cycle", message: "Flow contains an unsupported cycle" });
  return issues;
}

function comparable(value: unknown): string | number | boolean | null { return value === undefined ? null : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : JSON.stringify(value); }
export function evaluateFmsBranchRule(rule: FmsBranchRule, actual: unknown): boolean {
  if (rule.operator === "default") return true; const left = comparable(actual); const right = comparable(rule.value);
  switch (rule.operator) { case "equals": return left === right; case "not_equals": return left !== right; case "contains": return typeof left === "string" ? left.includes(String(right ?? "")) : Array.isArray(actual) && actual.includes(rule.value); case "greater_than": return Number(left) > Number(right); case "greater_than_or_equal": return Number(left) >= Number(right); case "less_than": return Number(left) < Number(right); case "less_than_or_equal": return Number(left) <= Number(right); case "in": return Array.isArray(rule.value) && rule.value.includes(actual); case "not_empty": return actual !== null && actual !== undefined && actual !== "" && (!Array.isArray(actual) || actual.length > 0); }
}

export function resolveFmsBranch(rules: readonly FmsBranchRule[], values: Readonly<{ outcome?: unknown; context?: Readonly<Record<string, unknown>>; formAnswers?: Readonly<Record<string, unknown>> }>): FmsBranchRule | null {
  for (const rule of [...rules].sort((a, b) => a.order - b.order)) { const actual = rule.source === "outcome" ? values.outcome : rule.source === "context" ? values.context?.[rule.sourceKey ?? ""] : values.formAnswers?.[rule.sourceKey ?? ""]; if (evaluateFmsBranchRule(rule, actual)) return rule; } return null;
}

export function isFmsJoinReady(rule: "all" | "any" | "specific", prerequisites: readonly Readonly<{ key: string; completed: boolean }>[], requiredKeys: readonly string[] = []): boolean { const considered = rule === "specific" ? prerequisites.filter((item) => requiredKeys.includes(item.key)) : prerequisites; return considered.length > 0 && (rule === "any" ? considered.some((item) => item.completed) : considered.every((item) => item.completed)); }
export function isFmsCompletionSatisfied(rule: "all_doers" | "any_doer" | "manager_approval", actors: readonly FmsStageActorState[], reviewerRole?: UserRole): boolean { if (!actors.length) return false; if (rule === "any_doer") return actors.some((actor) => actor.completed); if (rule === "all_doers") return actors.every((actor) => actor.completed); return !!reviewerRole && ELEVATED.has(reviewerRole) && actors.some((actor) => actor.completed); }

export function validateFmsAssignmentCandidate(candidate: FmsAssignmentCandidate, scope: Readonly<{ tenantId: string; branchId?: string | null; departmentId?: string | null; role?: UserRole }>): boolean { return candidate.active && candidate.loginEnabled && candidate.tenantId === scope.tenantId && (!scope.branchId || candidate.branchId === scope.branchId) && (!scope.departmentId || candidate.departmentId === scope.departmentId) && (!scope.role || candidate.role === scope.role); }

export function deriveFmsTransitionCapability(input: Readonly<{ viewerId: string; viewerRole: UserRole; assignedIds: readonly string[]; instanceStatus: FmsInstanceStatus; stageStatus: FmsStageStatus; stage: Pick<FmsStageDefinition, "type" | "canReject" | "canRequestRevision" | "canMoveBackward" | "canEscalate"> }>): FmsTransitionCapability {
  const elevated = ELEVATED.has(input.viewerRole); const assigned = input.assignedIds.includes(input.viewerId); const live = input.instanceStatus === "active" || input.instanceStatus === "overdue"; const actionable = live && ["pending", "in_progress", "in_review", "overdue"].includes(input.stageStatus) && (assigned || elevated);
  return { canComplete: actionable && input.stage.type !== "approval", canApprove: actionable && input.stage.type === "approval" && elevated, canReject: actionable && input.stage.canReject, canRequestRevision: actionable && input.stage.canRequestRevision, canReassign: live && elevated, canMoveBackward: live && elevated && input.stage.canMoveBackward, canEscalate: actionable && input.stage.canEscalate, reason: actionable ? undefined : "Stage is not actionable for this user" };
}

export function calculateFmsProgress(stages: readonly Readonly<{ required: boolean; status: FmsStageStatus }>[]): Readonly<{ completed: number; total: number; percent: number }> { const relevant = stages.filter((stage) => stage.required); const completed = relevant.filter((stage) => stage.status === "completed").length; return { completed, total: relevant.length, percent: relevant.length ? Math.round(completed / relevant.length * 100) : 100 }; }
export function calculateFmsDelay(planned: Date | string | null, actual: Date | string | null, now: Date | string = new Date()): Readonly<{ delayMinutes: number; overdue: boolean }> { if (!planned) return { delayMinutes: 0, overdue: false }; const due = new Date(planned); const end = new Date(actual ?? now); if (Number.isNaN(due.getTime()) || Number.isNaN(end.getTime())) throw new Error("Invalid SLA date"); const delayMinutes = Math.max(0, Math.round((end.getTime() - due.getTime()) / 60_000)); return { delayMinutes, overdue: delayMinutes > 0 }; }
export function fmsStatusLabel(status: string): string { return status.split("_").map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : "").join(" "); }
