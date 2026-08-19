import { fmsOutgoingStageKeys, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";

export type FmsGraphPosition = Readonly<{ x: number; y: number }>;
export type FmsGraphEdge = Readonly<{ from: string; to: string; label?: string | undefined; kind: "default" | "branch" | "parallel" }>;

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

export function fmsGraphEdges(stages: readonly FmsStageDefinition[]): readonly FmsGraphEdge[] {
  const edges: FmsGraphEdge[] = [];
  for (const stage of stages) {
    if (stage.type === "branch") {
      for (const rule of stage.branchRules) if (rule.nextStageKey) edges.push({ from: stage.key, to: rule.nextStageKey, label: rule.label ?? (rule.operator === "default" ? "Default" : `${rule.sourceKey ?? "Outcome"} ${rule.operator}`), kind: "branch" });
    } else if (stage.type === "parallel_start") {
      for (const to of stage.parallelTargetStageKeys) edges.push({ from: stage.key, to, label: "Parallel", kind: "parallel" });
    } else if (stage.defaultNextStageKey) edges.push({ from: stage.key, to: stage.defaultNextStageKey, kind: "default" });
  }
  return edges;
}

export function fmsStageSummary(stage: FmsStageDefinition): string {
  if (stage.type === "end") return "Legacy completion node";
  if (stage.type === "branch") return `${stage.branchRules.length} route${stage.branchRules.length === 1 ? "" : "s"}`;
  if (stage.type === "parallel_start") return `${stage.parallelTargetStageKeys.length} parallel path${stage.parallelTargetStageKeys.length === 1 ? "" : "s"}`;
  if (stage.sla.decisionMode === "yes_no") return "Yes / No decision";
  if (stage.formTemplateId) return "Pinned form";
  if (!fmsOutgoingStageKeys(stage).length) return "Completes workflow";
  return stage.assigneeRules.length ? stage.assigneeRules.map((rule) => rule.type.replaceAll("_", " ")).join(", ") : "Automatic";
}

export function fmsTimingSummary(stage: FmsStageDefinition): string {
  const method = stage.sla.timingMethod ?? "completion_date";
  if (method === "tat_hours") return stage.sla.tatHours ? `TAT ${stage.sla.tatHours}h` : "TAT not set";
  if (method === "days_before_date") return stage.sla.futureDate ? `${stage.sla.daysBefore ?? 0}d before ${stage.sla.futureDate}` : "future date not set";
  if (method === "specific_time") return stage.sla.dueDate && stage.sla.clockTime ? `${stage.sla.dueDate} ${stage.sla.clockTime}` : "date/time not set";
  return stage.sla.dueDate || "date not set";
}
