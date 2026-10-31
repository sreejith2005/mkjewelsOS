import type { TaskDateScope } from "../taskSearch";
import type { Json } from "../database.types";
import type { FmsAssignedWorkTarget } from "./assignedWork";
import { fmsStagesInFlowOrder } from "./engine";
import { fmsDueUrgency, type FmsDueUrgency } from "./formDue";
import type { FmsStageDefinition } from "./types";
export type FmsWorkspaceStatus = "active" | "pending" | "overdue" | "waiting" | "completed";
/** `mine`: work assigned to me. `all`: also open work I may open as a manager (server rule). */
export type FmsWorkspaceScope = "mine" | "all";
export type FmsWorkspaceDue = "all" | FmsDueUrgency;
export type FmsBusinessPriority = "high" | "medium" | "low";
export type FmsWorkspacePriority = "all" | FmsBusinessPriority;
/** `due`: overdue, due today, upcoming, no date; then due time, then priority. `priority`: priority first. */
export type FmsWorkspaceSort = "due" | "priority";
export type FmsWorkspaceFilters = Readonly<{ query: string; status: FmsWorkspaceStatus; from: string; to: string; familyId: string; stageId: string;
  dateScope?: TaskDateScope | undefined; scope?: FmsWorkspaceScope | undefined; due?: FmsWorkspaceDue | undefined; priority?: FmsWorkspacePriority | undefined; sort?: FmsWorkspaceSort | undefined; assigneeId?: string | undefined }>;
export const defaultFmsWorkspaceFilters = (): FmsWorkspaceFilters => ({ query: "", status: "active", from: "", to: "", familyId: "", stageId: "" });
export type FmsWorkspaceCounts = Record<FmsWorkspaceStatus, number> & { dueToday: number };
export type FmsFamilySummary = Readonly<{ id: string; name: string; count: number; active: number; overdue: number; dueToday: number }>;
export type FmsStageSummary = Readonly<{ id: string; flowId: string; stageId: string; name: string; version: number; count: number; pipeline: string; order: number; nextStageIds: readonly string[]; starting: boolean }>;
export type FmsWorkspacePerson = Readonly<{ id: string; name: string }>;
export type FmsWorkspaceRecord = Readonly<{ id: string; name: string; reference: string; description: string; dueAt: string | null; status: string; visitNumber: number; target: FmsAssignedWorkTarget;
  priority: FmsBusinessPriority | null; urgency: FmsDueUrgency; assignees: readonly FmsWorkspacePerson[] }>;
export type FmsBoardStage = FmsStageSummary & Readonly<{ stepType: string; overdue: number; dueToday: number; records: readonly FmsWorkspaceRecord[] }>;
export type FmsBoardCounts = Readonly<{ active: number; overdue: number; dueToday: number; upcoming: number; noDue: number; waiting: number; completed: number; shown: number }>;
export type FmsBoard = Readonly<{ name: string | null; counts: FmsBoardCounts; stages: readonly FmsBoardStage[] }>;
/** Adapt the summary's graph edges to the existing graph-order contract. */
export function orderFmsWorkspaceStages<T extends FmsStageSummary>(stages: readonly T[]): T[] {
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
const ACTIONABLE_STEP_TYPES: ReadonlySet<string> = new Set(["form", "task", "approval"]);
/**
 * Board columns: every person's step of each version, in graph order (newest
 * version first). Automatic steps and End Nodes are never task columns; End
 * Node counts live in the workflow's outcome report. A starting form appears
 * only while someone still has one to fill.
 */
export function fmsBoardColumns(board: FmsBoard): FmsBoardStage[] {
  return orderFmsWorkspaceStages(board.stages).filter(stage => stage.starting ? stage.count > 0 : ACTIONABLE_STEP_TYPES.has(stage.stepType));
}
const invalid = () => new Error("Invalid FMS workspace response");
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function obj(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw invalid(); return value; }
function str(value: unknown): string { if (typeof value !== "string") throw invalid(); return value; }
function num(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(); return value; }
/** Newer fields are optional on the wire so an older server still decodes (counts default to 0). */
function optNum(value: unknown): number { return value === undefined || value === null ? 0 : num(value); }
function uuid(value: unknown): string { const id = str(value); if (!uuidPattern.test(id)) throw invalid(); return id; }
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw invalid(); return value; }
function unique<T extends { id: string }>(items: T[]): T[] { if (new Set(items.map(i => i.id)).size !== items.length) throw invalid(); return items; }
const PRIORITIES: ReadonlySet<string> = new Set(["high", "medium", "low"]);
const URGENCIES: ReadonlySet<string> = new Set(["overdue", "today", "upcoming", "none"]);
export function fmsWorkspaceFilter(filter: FmsWorkspaceFilters): Json {
  const date = (s: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (filter.dateScope !== undefined && !["today", "overall", "overdue"].includes(filter.dateScope)) throw new Error("Invalid task scope");
  if (filter.query.trim().length > 200 || !["active", "pending", "overdue", "waiting", "completed"].includes(filter.status)
    || !date(filter.from) || !date(filter.to) || filter.from && filter.to && filter.from > filter.to
    || filter.familyId && !uuidPattern.test(filter.familyId) || filter.stageId && !uuidPattern.test(filter.stageId)
    || filter.scope !== undefined && !["mine", "all"].includes(filter.scope) || filter.due !== undefined && !["all", "overdue", "today", "upcoming", "none"].includes(filter.due)
    || filter.priority !== undefined && !["all", "high", "medium", "low"].includes(filter.priority) || filter.sort !== undefined && !["due", "priority"].includes(filter.sort)
    || filter.assigneeId && !uuidPattern.test(filter.assigneeId)) throw new Error("Invalid FMS filters");
  // Board keys are sent only when they narrow or reorder, so the default payload keeps its original shape.
  const { scope, due, priority, sort, assigneeId, ...base } = filter;
  return { ...base, query: filter.query.trim(), ...(scope === "all" ? { scope } : {}), ...(due && due !== "all" ? { due } : {}),
    ...(priority && priority !== "all" ? { priority } : {}), ...(sort === "priority" ? { sort } : {}), ...(assigneeId ? { assigneeId } : {}) };
}
export function decodeFmsWorkspace(value: unknown) {
  const v = obj(value); const c = obj(v.counts);
  const counts: FmsWorkspaceCounts = { active: num(c.active), pending: num(c.pending), overdue: num(c.overdue), waiting: num(c.waiting), completed: num(c.completed), dueToday: optNum(c.dueToday) };
  if (counts.active !== counts.pending + counts.overdue) throw invalid();
  const families = unique(list(v.families, 50).map(raw => { const f = obj(raw);
    const family: FmsFamilySummary = { id: uuid(f.id), name: str(f.name), count: num(f.count), active: optNum(f.active), overdue: optNum(f.overdue), dueToday: optNum(f.dueToday) };
    if (f.active !== undefined && family.overdue + family.dueToday > family.active) throw invalid(); return family; }));
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
function decodeFmsRecordList(value: unknown): FmsWorkspaceRecord[] {
  return unique(list(value, 50).map(raw => {
    const r = obj(raw); const t = obj(r.target); let target: FmsAssignedWorkTarget;
    if (t.kind === "starter_form") target = { kind: t.kind, starterAssignmentId: uuid(t.starterAssignmentId), formTemplateId: uuid(t.formTemplateId) };
    else if (t.kind === "stage_form") target = { kind: t.kind, instanceId: uuid(t.instanceId), instanceStageId: uuid(t.instanceStageId), formTemplateId: uuid(t.formTemplateId) };
    else if (t.kind === "stage") target = { kind: t.kind, instanceId: uuid(t.instanceId), instanceStageId: uuid(t.instanceStageId) };
    else throw invalid();
    const dueAt = r.dueAt === null || r.dueAt === undefined ? null : str(r.dueAt); if (dueAt && Number.isNaN(Date.parse(dueAt))) throw invalid();
    const id = uuid(r.id); if (id !== (target.kind === "starter_form" ? target.starterAssignmentId : target.instanceStageId)) throw invalid();
    let priority: FmsBusinessPriority | null = null;
    if (r.priority !== undefined && r.priority !== null) { if (!PRIORITIES.has(str(r.priority))) throw invalid(); priority = r.priority as FmsBusinessPriority; }
    let urgency: FmsDueUrgency = fmsDueUrgency(dueAt);
    if (r.urgency !== undefined) { if (!URGENCIES.has(str(r.urgency))) throw invalid(); urgency = r.urgency as FmsDueUrgency; }
    const assignees = r.assignees === undefined ? [] : list(r.assignees, 100).map(person => { const p = obj(person); return { id: uuid(p.id), name: str(p.name) }; });
    return { id, name: str(r.name), reference: str(r.reference), description: str(r.description), dueAt, status: str(r.status), visitNumber: num(r.visitNumber), target, priority, urgency, assignees };
  }));
}
export function decodeFmsRecords(value: unknown): { records: FmsWorkspaceRecord[]; total: number } {
  const v = obj(value); const total = num(v.total);
  const records = decodeFmsRecordList(v.records);
  if (records.length > total) throw invalid(); return { records, total };
}
/** One workflow's board (get_fms_task_board): exact counts plus each column's first page. */
export function decodeFmsBoard(value: unknown): FmsBoard {
  const v = obj(value); const c = obj(v.counts);
  const counts: FmsBoardCounts = { active: num(c.active), overdue: num(c.overdue), dueToday: num(c.dueToday), upcoming: num(c.upcoming), noDue: num(c.noDue), waiting: num(c.waiting), completed: num(c.completed), shown: num(c.shown) };
  if (counts.overdue + counts.dueToday + counts.upcoming + counts.noDue !== counts.active) throw invalid();
  const raw = list(v.stages, 1000).map(obj);
  const summaries = decodeFmsStages(raw);
  const stages = summaries.map((summary, index): FmsBoardStage => { const s = raw[index]!; const records = decodeFmsRecordList(s.records);
    if (records.length > summary.count) throw invalid();
    return { ...summary, stepType: str(s.stepType), overdue: num(s.overdue), dueToday: num(s.dueToday), records }; });
  const cards = stages.flatMap(stage => stage.records.map(record => record.id));
  if (new Set(cards).size !== cards.length) throw invalid();
  return { name: v.name === null || v.name === undefined ? null : str(v.name), counts, stages };
}
/** Tasks -> FMS (Level 1) and one workflow's board (Level 2). Both entry points use these links. */
export const FMS_TASKS_BOARD_BASE = "/tasks?view=fms";
export function fmsTaskBoardPath(familyId?: string): string {
  if (!familyId) return FMS_TASKS_BOARD_BASE;
  if (!uuidPattern.test(familyId)) throw new Error("Invalid FMS workflow");
  return `${FMS_TASKS_BOARD_BASE}&workflow=${familyId}`;
}
/** The workflow a Tasks -> FMS URL opens, or "" for the workflow list. */
export function fmsTaskBoardFamily(search: string): string {
  const params = new URLSearchParams(search);
  const id = params.get("view") === "fms" ? params.get("workflow") ?? "" : "";
  return uuidPattern.test(id) ? id.toLowerCase() : "";
}
