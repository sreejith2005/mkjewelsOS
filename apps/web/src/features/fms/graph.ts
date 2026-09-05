import { fmsFieldOptions, fmsOutgoingStageKeys, hasFmsStageRouting, type FmsBranchRule, type FmsFlowDefinition, type FmsFormFieldRef, type FmsStageDefinition } from "@jewelos/core";

/** Resolves a route's question/answer identifiers to the Form's current display labels. */
export type FmsRouteNaming = Readonly<{ fields?: readonly FmsFormFieldRef[] | undefined; decisionOptions?: readonly Readonly<{ key: string; label: string }>[] | undefined }>;

export type FmsGraphPosition = Readonly<{ x: number; y: number }>;
export type FmsGraphEdge = Readonly<{ from: string; to: string; label?: string | undefined; kind: "default" | "branch" | "parallel"; ruleId?: string | undefined }>;

/** The readable name of a route, used on the canvas edge and in the routing panel. */
export function fmsRouteLabel(rule: FmsBranchRule, naming: FmsRouteNaming = {}): string {
  if (rule.label?.trim()) return rule.label.trim();
  if (rule.operator === "default") return "Otherwise";
  const field = rule.source === "form_answer" ? naming.fields?.find((item) => item.key === rule.sourceKey) : undefined;
  const answers = rule.source === "outcome" ? (naming.decisionOptions ?? []).map((option) => ({ value: option.key, label: option.label })) : fmsFieldOptions(field);
  const readable = (value: unknown) => answers.find((option) => option.value === String(value))?.label ?? String(value ?? "");
  const value = Array.isArray(rule.value) ? rule.value.map(readable).join(", ") : readable(rule.value);
  const question = field?.label ?? (rule.source === "outcome" ? "Outcome" : rule.sourceKey ?? "Outcome");
  const verb = rule.operator === "equals" ? "is" : rule.operator === "not_equals" ? "is not" : rule.operator === "in" ? "is one of" : rule.operator === "not_empty" ? "is answered" : rule.operator.replaceAll("_", " ");
  return `${question} ${verb}${rule.operator === "not_empty" ? "" : ` ${value}`}`.trim();
}

const COLUMN_WIDTH = 264;
const ROW_HEIGHT = 144;

/** A deterministic editor-only layout. Runtime routing never reads these coordinates. */
export function layoutFmsDefinition(definition: FmsFlowDefinition): ReadonlyMap<string, FmsGraphPosition> {
  const byKey = new Map(definition.stages.map((stage) => [stage.key, stage]));
  const depth = new Map<string, number>();
  const queue = definition.stages.length ? [definition.stages[0]!.key] : [];
  if (queue[0]) depth.set(queue[0], 0);
  while (queue.length) {
    const key = queue.shift()!;
    const nextDepth = (depth.get(key) ?? 0) + 1;
    for (const next of fmsOutgoingStageKeys(byKey.get(key)!)) {
      if (!byKey.has(next) || depth.has(next)) continue;
      depth.set(next, nextDepth);
      queue.push(next);
    }
  }
  let fallbackDepth = Math.max(-1, ...depth.values()) + 1;
  for (const stage of definition.stages) if (!depth.has(stage.key)) depth.set(stage.key, fallbackDepth++);
  const lanes = new Map<number, number>();
  return new Map(definition.stages.map((stage) => {
    const column = depth.get(stage.key) ?? 0;
    const lane = lanes.get(column) ?? 0;
    lanes.set(column, lane + 1);
    return [stage.key, { x: 28 + column * COLUMN_WIDTH, y: 28 + lane * ROW_HEIGHT }];
  }));
}

export function fmsGraphEdges(stages: readonly FmsStageDefinition[], formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>> = {}): readonly FmsGraphEdge[] {
  const edges: FmsGraphEdge[] = [];
  for (const stage of stages) {
    const naming: FmsRouteNaming = { fields: stage.formTemplateId ? formFields[stage.formTemplateId] : undefined, decisionOptions: stage.sla.decisionOptions };
    if (stage.type === "branch") {
      for (const rule of stage.branchRules) if (rule.nextStageKey) edges.push({ from: stage.key, to: rule.nextStageKey, label: fmsRouteLabel(rule, naming), kind: "branch", ruleId: rule.id });
      continue;
    }
    if (stage.type === "parallel_start") {
      for (const to of stage.parallelTargetStageKeys) edges.push({ from: stage.key, to, label: "Parallel", kind: "parallel" });
      continue;
    }
    if (hasFmsStageRouting(stage)) for (const rule of stage.branchRules) if (rule.nextStageKey) edges.push({ from: stage.key, to: rule.nextStageKey, label: fmsRouteLabel(rule, naming), kind: "branch", ruleId: rule.id });
    // A routed stage keeps its plain next step only when no fallback route covers it.
    if (stage.defaultNextStageKey && !stage.branchRules.some((rule) => rule.operator === "default" && rule.nextStageKey)) edges.push({ from: stage.key, to: stage.defaultNextStageKey, label: hasFmsStageRouting(stage) ? "Otherwise" : undefined, kind: "default" });
  }
  return edges;
}

export function fmsStageSummary(stage: FmsStageDefinition): string {
  if (stage.type === "end") return "Legacy completion node";
  if (stage.type === "branch") return `${stage.branchRules.length} route${stage.branchRules.length === 1 ? "" : "s"}`;
  if (hasFmsStageRouting(stage)) return `${fmsOutgoingStageKeys(stage).length} route${fmsOutgoingStageKeys(stage).length === 1 ? "" : "s"}`;
  if (stage.type === "parallel_start") return `${stage.parallelTargetStageKeys.length} parallel path${stage.parallelTargetStageKeys.length === 1 ? "" : "s"}`;
  if (stage.sla.decisionMode === "decision" || stage.sla.decisionMode === "yes_no") return `${stage.sla.decisionOptions?.map((option) => option.label).join(" / ") || "Decision"} decision`;
  if (stage.formTemplateId) return "Pinned form";
  if (!fmsOutgoingStageKeys(stage).length) return "Completes workflow";
  return stage.assigneeRules.length ? stage.assigneeRules.map((rule) => rule.type.replaceAll("_", " ")).join(", ") : "Automatic";
}

export function fmsTimingSummary(stage: FmsStageDefinition): string {
  if (stage.sla.deadlineEnabled === false) return "No deadline";
  const method = stage.sla.timingMethod ?? "completion_date";
  if (method === "tat_hours") return stage.sla.tatMinutes ? `TAT ${stage.sla.tatUnit === "hours" ? stage.sla.tatMinutes / 60 : stage.sla.tatMinutes}${stage.sla.tatUnit === "hours" ? "h" : "m"}` : "TAT not set";
  if (method === "days_before_date") return stage.sla.futureDate ? `${stage.sla.daysBefore ?? 0}d before ${stage.sla.futureDate}` : "future date not set";
  if (method === "specific_time") return stage.sla.dueDate && stage.sla.clockTime ? `${stage.sla.dueDate} ${stage.sla.clockTime}` : "date/time not set";
  return stage.sla.dueDate || "date not set";
}
