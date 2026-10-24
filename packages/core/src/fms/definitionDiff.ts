import { normalizeFmsDefinition } from "./engine.ts";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types.ts";

/** JSON with object keys sorted, so equal definitions always serialize identically. */
export function stableFmsJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableFmsJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableFmsJson(item)}`).join(",")}}`;
}

/**
 * A short, stable content fingerprint of a normalized definition. It detects
 * "the draft changed while the assistant was working"; it is not a security hash.
 * Builder-only questionnaire metadata is left out, so a server compiled with an
 * older normalizer that drops it still produces the same fingerprint.
 */
export function fmsDefinitionFingerprint(definition: FmsFlowDefinition): string {
  const normalized = normalizeFmsDefinition(definition);
  const text = stableFmsJson({ ...normalized, stages: normalized.stages.map(({ sla: { questionnaire: _questionnaire, ...sla }, ...stage }) => ({ ...stage, sla })) });
  // cyrb53: two 32-bit lanes, enough to make accidental collisions negligible.
  let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `fms1-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

export type FmsStageChange = Readonly<{ field: string; label: string; before: string; after: string }>;
export type FmsDefinitionDiff = Readonly<{
  workflow: readonly FmsStageChange[];
  added: readonly Readonly<{ key: string; name: string; type: FmsStageDefinition["type"] }>[];
  removed: readonly Readonly<{ key: string; name: string; type: FmsStageDefinition["type"] }>[];
  changed: readonly Readonly<{ key: string; name: string; changes: readonly FmsStageChange[] }>[];
  unchanged: number;
}>;

const show = (value: unknown): string => value === undefined || value === null || value === "" ? "—" : typeof value === "string" ? value : stableFmsJson(value);

/** The fields a reviewer reads, in a fixed order. Canvas position is reported separately. */
const STAGE_FIELDS: readonly Readonly<{ field: string; label: string; read: (stage: FmsStageDefinition) => unknown }>[] = [
  { field: "name", label: "Name", read: (stage) => stage.name },
  { field: "type", label: "Step type", read: (stage) => stage.type },
  { field: "formTemplateId", label: "Linked Form version", read: (stage) => stage.formTemplateId },
  { field: "defaultNextStageKey", label: "Continue to", read: (stage) => stage.defaultNextStageKey },
  { field: "branchRules", label: "Routes", read: (stage) => stage.branchRules.map(({ id: _id, order: _order, ...rule }) => rule) },
  { field: "parallelTargetStageKeys", label: "Parallel targets", read: (stage) => stage.parallelTargetStageKeys },
  { field: "joinRule", label: "Join rule", read: (stage) => [stage.joinRule, stage.joinRequiredStageKeys] },
  { field: "assignment", label: "Assignment", read: (stage) => [stage.sla.assignment, stage.assigneeRules] },
  { field: "timing", label: "Deadline", read: (stage) => [stage.sla.deadlineEnabled, stage.sla.timingMethod, stage.sla.tatMinutes, stage.sla.dueDate, stage.sla.futureDate, stage.sla.daysBefore, stage.sla.clockTime, stage.sla.triggerStageKey] },
  { field: "decision", label: "Decision options", read: (stage) => [stage.sla.decisionMode, stage.sla.decisionOptions] },
  { field: "conditional", label: "Runs only when", read: (stage) => stage.sla.conditional },
  { field: "evidence", label: "Required evidence", read: (stage) => [stage.requiresUpload, stage.requiresRemark, stage.checklist] },
  { field: "followUp", label: "Visit limit", read: (stage) => stage.sla.followUp },
  { field: "taskDisplay", label: "Work instructions", read: (stage) => stage.sla.taskDisplay },
  { field: "completion", label: "Completion rule", read: (stage) => [stage.completionRule, stage.allowMultipleDoers] },
  { field: "position", label: "Canvas position", read: (stage) => stage.position },
];

/** A field-level comparison of two definitions by stable stage key. */
export function diffFmsDefinitions(beforeRaw: FmsFlowDefinition, afterRaw: FmsFlowDefinition): FmsDefinitionDiff {
  const before = normalizeFmsDefinition(beforeRaw); const after = normalizeFmsDefinition(afterRaw);
  const workflow: FmsStageChange[] = [];
  if (before.name !== after.name) workflow.push({ field: "name", label: "Workflow name", before: show(before.name), after: show(after.name) });
  if ((before.description ?? "") !== (after.description ?? "")) workflow.push({ field: "description", label: "Purpose", before: show(before.description), after: show(after.description) });
  if ((before.assignmentVersion ?? 1) !== (after.assignmentVersion ?? 1)) workflow.push({ field: "assignmentVersion", label: "Assignment contract", before: `v${before.assignmentVersion ?? 1}`, after: `v${after.assignmentVersion ?? 1}` });
  const beforeByKey = new Map(before.stages.map((stage) => [stage.key, stage]));
  const afterByKey = new Map(after.stages.map((stage) => [stage.key, stage]));
  const added = after.stages.filter((stage) => !beforeByKey.has(stage.key)).map(({ key, name, type }) => ({ key, name, type }));
  const removed = before.stages.filter((stage) => !afterByKey.has(stage.key)).map(({ key, name, type }) => ({ key, name, type }));
  const changed: { key: string; name: string; changes: FmsStageChange[] }[] = [];
  let unchanged = 0;
  for (const stage of after.stages) {
    const prior = beforeByKey.get(stage.key);
    if (!prior) continue;
    const changes = STAGE_FIELDS.flatMap(({ field, label, read }) => {
      const a = stableFmsJson(read(prior)); const b = stableFmsJson(read(stage));
      return a === b ? [] : [{ field, label, before: show(read(prior)), after: show(read(stage)) }];
    });
    if (changes.length) changed.push({ key: stage.key, name: stage.name, changes }); else unchanged += 1;
  }
  return { workflow, added, removed, changed, unchanged };
}

export function fmsDiffIsEmpty(diff: FmsDefinitionDiff): boolean {
  return !diff.workflow.length && !diff.added.length && !diff.removed.length && !diff.changed.length;
}
