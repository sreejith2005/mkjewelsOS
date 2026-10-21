import type { Json } from "../database.types";
import type { FmsAssignedWorkTarget } from "./assignedWork";
import { fmsStagesInFlowOrder } from "./engine";
import type { FmsStageDefinition } from "./types";
export type FmsWorkspaceStatus = "active" | "pending" | "overdue" | "waiting" | "completed";
export type FmsWorkspaceFilters = Readonly<{ query: string; status: FmsWorkspaceStatus; from: string; to: string; familyId: string; stageId: string }>;
export const defaultFmsWorkspaceFilters = (): FmsWorkspaceFilters => ({ query: "", status: "active", from: "", to: "", familyId: "", stageId: "" });
export type FmsWorkspaceCounts = Record<FmsWorkspaceStatus, number>;
export type FmsFamilySummary = Readonly<{ id: string; name: string; count: number }>;
export type FmsStageSummary = Readonly<{ id: string; flowId: string; stageId: string; name: string; version: number; count: number; pipeline: string; order: number; nextStageIds: readonly string[]; starting: boolean }>;
export type FmsWorkspaceRecord = Readonly<{ id: string; name: string; reference: string; description: string; dueAt: string | null; status: string; visitNumber: number; target: FmsAssignedWorkTarget }>;
/** Adapt the summary's graph edges to the existing graph-order contract. */
export function orderFmsWorkspaceStages(stages: readonly FmsStageSummary[]): FmsStageSummary[] {
  const flows = [...new Set([...stages].sort((a, b) => b.version - a.version || a.flowId.localeCompare(b.flowId)).map(s => s.flowId))];
  return flows.flatMap(flow => {
    const rows = stages.filter(s => s.flowId === flow).sort((a, b) => a.order - b.order || a.stageId.localeCompare(b.stageId));
    const runtime = rows.filter(s => !s.starting); const byId = new Map(runtime.map(s => [s.stageId, s]));
    const graph: FmsStageDefinition[] = runtime.map(s => ({ key: s.stageId, name: s.name, type: "task", order: s.order,
      required: false, completionRule: "all_doers", allowMultipleDoers: false, requiresUpload: false, requiresRemark: false,
      checklist: [], assigneeRules: [], requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false,
      canRequestRevision: false, canEscalate: false, branchRules: s.nextStageIds.map((next, index) => ({ id: `${s.stageId}:${index}`, source: "outcome", operator: "default", nextStageKey: next, order: index })), parallelTargetStageKeys: [], joinRequiredStageKeys: [], sla: { dueDate: "" } }));
    return [...rows.filter(s => s.starting), ...fmsStagesInFlowOrder(graph).flatMap(s => { const row = byId.get(s.key); return row ? [row] : []; })];
  });
}
const invalid = () => new Error("Invalid FMS workspace response");
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function obj(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw invalid(); return value; }
function str(value: unknown): string { if (typeof value !== "string") throw invalid(); return value; }
function num(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(); return value; }
function uuid(value: unknown): string { const id = str(value); if (!uuidPattern.test(id)) throw invalid(); return id; }
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw invalid(); return value; }
function unique<T extends { id: string }>(items: T[]): T[] { if (new Set(items.map(i => i.id)).size !== items.length) throw invalid(); return items; }
export function fmsWorkspaceFilter(filter: FmsWorkspaceFilters): Json {
  const date = (s: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (filter.query.trim().length > 200 || !["active", "pending", "overdue", "waiting", "completed"].includes(filter.status)
    || !date(filter.from) || !date(filter.to) || filter.from && filter.to && filter.from > filter.to
    || filter.familyId && !uuidPattern.test(filter.familyId) || filter.stageId && !uuidPattern.test(filter.stageId)) throw new Error("Invalid FMS filters");
  return { ...filter, query: filter.query.trim() };
}
export function decodeFmsWorkspace(value: unknown) {
  const v = obj(value); const c = obj(v.counts);
  const counts: FmsWorkspaceCounts = { active: num(c.active), pending: num(c.pending), overdue: num(c.overdue), waiting: num(c.waiting), completed: num(c.completed) };
  if (counts.active !== counts.pending + counts.overdue) throw invalid();
  const families = unique(list(v.families, 50).map(raw => { const f = obj(raw); return { id: uuid(f.id), name: str(f.name), count: num(f.count) }; }));
  const familyTotal = num(v.familyTotal); if (families.length > familyTotal) throw invalid();
  return { total: num(v.total), activeTotal: num(v.activeTotal), familyTotal, counts, families };
}
export function decodeFmsStages(value: unknown): FmsStageSummary[] {
  return unique(list(value, 1000).map(raw => { const s = obj(raw);
    if (typeof s.starting !== "boolean") throw invalid();
    return { id: str(s.id), flowId: uuid(s.flowId), stageId: uuid(s.stageId), name: str(s.name), version: num(s.version), count: num(s.count),
      pipeline: str(s.pipeline), order: num(s.order), nextStageIds: list(s.nextStageIds, 1000).map(uuid), starting: s.starting };
  }));
}
export function decodeFmsRecords(value: unknown): { records: FmsWorkspaceRecord[]; total: number } {
  const v = obj(value); const total = num(v.total);
  const records = unique(list(v.records, 50).map(raw => {
    const r = obj(raw); const t = obj(r.target); let target: FmsAssignedWorkTarget;
    if (t.kind === "starter_form") target = { kind: t.kind, starterAssignmentId: uuid(t.starterAssignmentId), formTemplateId: uuid(t.formTemplateId) };
    else if (t.kind === "stage_form") target = { kind: t.kind, instanceId: uuid(t.instanceId), instanceStageId: uuid(t.instanceStageId), formTemplateId: uuid(t.formTemplateId) };
    else if (t.kind === "stage") target = { kind: t.kind, instanceId: uuid(t.instanceId), instanceStageId: uuid(t.instanceStageId) };
    else throw invalid();
    const dueAt = r.dueAt === null ? null : str(r.dueAt); if (dueAt && Number.isNaN(Date.parse(dueAt))) throw invalid();
    const id = uuid(r.id); if (id !== (target.kind === "starter_form" ? target.starterAssignmentId : target.instanceStageId)) throw invalid();
    return { id, name: str(r.name), reference: str(r.reference), description: str(r.description), dueAt, status: str(r.status), visitNumber: num(r.visitNumber), target };
  }));
  if (records.length > total) throw invalid(); return { records, total };
}
