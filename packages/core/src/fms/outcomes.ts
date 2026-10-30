import type { FmsRecordedOutcome, FmsStageDefinition, FmsTerminalOutcome } from "./types.ts";

/** Plain employee words for each stable End Node outcome code. */
export const FMS_TERMINAL_OUTCOME_LABELS: Readonly<Record<FmsRecordedOutcome, string>> = {
  won: "Won",
  lost: "Lost",
  do_not_contact: "Do not contact",
  other: "Other closure",
  unspecified: "Completed (no End Node)",
};
/** One-line meaning shown next to the End type choice. */
export const FMS_TERMINAL_OUTCOME_HELP: Readonly<Record<FmsTerminalOutcome, string>> = {
  won: "A successful sale or purchase milestone.",
  lost: "The customer is not interested; the lead is closed.",
  do_not_contact: "The customer asked not to be contacted again.",
  other: "Any other business ending you define.",
};
export const fmsTerminalOutcomeLabel = (outcome: string | null | undefined): string =>
  outcome && outcome in FMS_TERMINAL_OUTCOME_LABELS ? FMS_TERMINAL_OUTCOME_LABELS[outcome as FmsRecordedOutcome] : FMS_TERMINAL_OUTCOME_LABELS.unspecified;
/** Won instances out of started instances, as a whole percentage with one decimal. Zero started is 0%. */
export function fmsConversionPercent(won: number, started: number): number {
  if (!Number.isFinite(won) || !Number.isFinite(started) || started <= 0) return 0;
  return Math.round(Math.min(won, started) / started * 1000) / 10;
}

// ---- Server read contracts (0359). Decoders reject malformed data, like the task workspace decoders. ----
export type FmsReportFilters = Readonly<{ from: string; to: string; flowId: string; branchId: string; outcome: "" | FmsRecordedOutcome }>;
export const defaultFmsReportFilters = (): FmsReportFilters => ({ from: "", to: "", flowId: "", branchId: "", outcome: "" });
export type FmsOutcomeCounts = Readonly<{ won: number; lost: number; doNotContact: number; other: number; unspecified: number; completed: number }>;
export type FmsFlowReport = Readonly<FmsOutcomeCounts & {
  period: Readonly<{ from: string | null; to: string | null }>;
  started: number; running: number; onHold: number; cancelled: number; conversionPercent: number;
  endNodes: readonly Readonly<{ stageKey: string; name: string; outcome: FmsRecordedOutcome; instances: number }>[];
  stages: readonly Readonly<{ stageKey: string; name: string; type: string; instances: number; visits: number }>[];
  completedInPeriod: FmsOutcomeCounts;
}>;
export type FmsLibraryOutcome = Readonly<FmsOutcomeCounts & { familyId: string; started: number; running: number; onHold: number; cancelled: number; mine: number }>;
export const FMS_RECORD_STATUSES = ["all", "running", "overdue", "on_hold", "won", "lost", "do_not_contact", "other", "unspecified", "completed", "cancelled"] as const;
export type FmsRecordStatus = typeof FMS_RECORD_STATUSES[number];
export type FmsRecordFilters = Readonly<{ query: string; status: FmsRecordStatus; stageKey: string; assigneeId: string; from: string; to: string; flowId: string; scope: "all" | "mine" }>;
export const defaultFmsRecordFilters = (): FmsRecordFilters => ({ query: "", status: "all", stageKey: "", assigneeId: "", from: "", to: "", flowId: "", scope: "all" });
export type FmsRecordCurrentStep = Readonly<{ visitId: string; stageKey: string; stageName: string; status: string; dueAt: string | null; overdue: boolean; visitNumber: number; assignees: readonly string[]; mine: boolean; formTemplateId: string | null }>;
export type FmsFlowRecord = Readonly<{ id: string; reference: string; title: string; name: string; status: string; outcome: FmsRecordedOutcome | null; endStageName: string | null;
  closedAt: string | null; startedAt: string | null; updatedAt: string | null; version: number; overdue: boolean; current: readonly FmsRecordCurrentStep[] }>;
export type FmsJourneyEvent = Readonly<{ action: string; at: string; by: string | null; reason: string | null }>;
export type FmsJourneyVisit = Readonly<{ id: string; stageKey: string; stageName: string; stageType: string; visitNumber: number; status: string; outcome: string | null; remark: string | null;
  stopped: boolean; skipped: boolean; activatedAt: string | null; completedAt: string | null; dueAt: string | null; completedBy: string | null; assignees: readonly string[];
  formName: string | null; submittedAt: string | null; routeLabel: string | null; nextStages: readonly string[]; answers: readonly Readonly<{ label: string; value: string }>[]; events: readonly FmsJourneyEvent[] }>;
export type FmsJourneyOutcome = Readonly<{ stageName: string; outcome: FmsTerminalOutcome; reasonCode: string | null; closedAt: string; routeLabel: string | null; sourceStageName: string | null;
  sourceQuestion: string | null; sourceValue: string | null; stoppedCount: number; closedBy: string | null }>;
export type FmsJourney = Readonly<{
  instance: Readonly<{ id: string; reference: string; title: string; name: string; status: string; version: number; workflowName: string | null; startedAt: string | null; completedAt: string | null;
    startedBy: string | null; cancelledAt: string | null; cancelReason: string | null; holdReason: string | null }>;
  outcome: FmsJourneyOutcome | null; visits: readonly FmsJourneyVisit[];
}>;

const invalidRead = () => new Error("Invalid FMS report response");
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isObj = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const obj = (value: unknown): Record<string, unknown> => { if (!isObj(value)) throw invalidRead(); return value; };
const str = (value: unknown): string => { if (typeof value !== "string") throw invalidRead(); return value; };
const optStr = (value: unknown): string | null => value === null || value === undefined ? null : str(value);
const count = (value: unknown): number => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalidRead(); return value; };
const percent = (value: unknown): number => { const n = typeof value === "string" ? Number(value) : value; if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) throw invalidRead(); return n; };
const uuid = (value: unknown): string => { const id = str(value); if (!UUID_RE.test(id)) throw invalidRead(); return id; };
const arr = (value: unknown, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) throw invalidRead(); return value; };
const RECORDED = new Set<string>(["won", "lost", "do_not_contact", "other", "unspecified"]);
const recorded = (value: unknown): FmsRecordedOutcome => { const text = str(value); if (!RECORDED.has(text)) throw invalidRead(); return text as FmsRecordedOutcome; };
const terminal = (value: unknown): FmsTerminalOutcome => { const text = recorded(value); if (text === "unspecified") throw invalidRead(); return text; };
const outcomeCounts = (v: Record<string, unknown>): FmsOutcomeCounts => ({ won: count(v.won), lost: count(v.lost), doNotContact: count(v.doNotContact), other: count(v.other), unspecified: count(v.unspecified), completed: count(v.completed) });
const validDay = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** Filters sent to get_fms_flow_report; empty values are left out. */
export function fmsReportFilterJson(filters: FmsReportFilters): Record<string, string> {
  if (!validDay(filters.from) || !validDay(filters.to) || filters.from && filters.to && filters.from > filters.to) throw new Error("Choose a valid period");
  if (filters.flowId && !UUID_RE.test(filters.flowId) || filters.branchId && !UUID_RE.test(filters.branchId)) throw new Error("Invalid report filter");
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
}
/** Filters sent to get_fms_flow_records; empty values and the defaults are left out. */
export function fmsRecordFilterJson(filters: FmsRecordFilters): Record<string, string> {
  if (filters.query.trim().length > 200 || !(FMS_RECORD_STATUSES as readonly string[]).includes(filters.status) || !validDay(filters.from) || !validDay(filters.to) || filters.from && filters.to && filters.from > filters.to
    || filters.assigneeId && !UUID_RE.test(filters.assigneeId) || filters.flowId && !UUID_RE.test(filters.flowId) || filters.stageKey.length > 64) throw new Error("Invalid FMS filters");
  return Object.fromEntries(Object.entries({ ...filters, query: filters.query.trim() }).filter(([key, value]) => value !== "" && !(key === "status" && value === "all") && !(key === "scope" && value === "all")));
}
export function decodeFmsFlowReport(raw: unknown): FmsFlowReport {
  const v = obj(raw); const period = obj(v.period);
  const report: FmsFlowReport = { ...outcomeCounts(v), period: { from: optStr(period.from), to: optStr(period.to) },
    started: count(v.started), running: count(v.running), onHold: count(v.onHold), cancelled: count(v.cancelled), conversionPercent: percent(v.conversionPercent),
    endNodes: arr(v.endNodes, 200).map((item) => { const e = obj(item); return { stageKey: str(e.stageKey), name: str(e.name), outcome: recorded(e.outcome), instances: count(e.instances) }; }),
    stages: arr(v.stages, 500).map((item) => { const s = obj(item); return { stageKey: str(s.stageKey), name: str(s.name), type: str(s.type), instances: count(s.instances), visits: count(s.visits) }; }),
    completedInPeriod: outcomeCounts(obj(v.completedInPeriod)) };
  // The cohort adds up: every started instance is running, on hold, completed or cancelled.
  if (report.running + report.onHold + report.completed + report.cancelled !== report.started) throw invalidRead();
  if (report.won + report.lost + report.doNotContact + report.other + report.unspecified !== report.completed) throw invalidRead();
  return report;
}
export function decodeFmsLibraryOutcomes(raw: unknown): ReadonlyMap<string, FmsLibraryOutcome> {
  return new Map(arr(raw, 5000).map((item) => {
    const v = obj(item);
    const row: FmsLibraryOutcome = { ...outcomeCounts(v), familyId: uuid(v.familyId), started: count(v.started), running: count(v.running), onHold: count(v.onHold), cancelled: count(v.cancelled), mine: count(v.mine) };
    return [row.familyId, row];
  }));
}
export function decodeFmsFlowRecords(raw: unknown): { total: number; records: FmsFlowRecord[] } {
  const v = obj(raw); const total = count(v.total);
  const records = arr(v.records, 50).map((item): FmsFlowRecord => {
    const r = obj(item);
    return { id: uuid(r.id), reference: str(r.reference), title: str(r.title), name: str(r.name), status: str(r.status), outcome: r.outcome === null || r.outcome === undefined ? null : recorded(r.outcome),
      endStageName: optStr(r.endStageName), closedAt: optStr(r.closedAt), startedAt: optStr(r.startedAt), updatedAt: optStr(r.updatedAt), version: count(r.version), overdue: r.overdue === true,
      current: arr(r.current, 100).map((step) => { const c = obj(step); return { visitId: uuid(c.visitId), stageKey: str(c.stageKey), stageName: str(c.stageName), status: str(c.status), dueAt: optStr(c.dueAt),
        overdue: c.overdue === true, visitNumber: count(c.visitNumber), assignees: arr(c.assignees, 100).map(str), mine: c.mine === true, formTemplateId: c.formTemplateId === null || c.formTemplateId === undefined ? null : uuid(c.formTemplateId) }; }) };
  });
  if (records.length > total || new Set(records.map((record) => record.id)).size !== records.length) throw invalidRead();
  return { total, records };
}
export function decodeFmsJourney(raw: unknown): FmsJourney {
  const v = obj(raw); const i = obj(v.instance);
  const o = v.outcome === null || v.outcome === undefined ? null : obj(v.outcome);
  return {
    instance: { id: uuid(i.id), reference: str(i.reference), title: str(i.title), name: str(i.name), status: str(i.status), version: count(i.version), workflowName: optStr(i.workflowName),
      startedAt: optStr(i.startedAt), completedAt: optStr(i.completedAt), startedBy: optStr(i.startedBy), cancelledAt: optStr(i.cancelledAt), cancelReason: optStr(i.cancelReason), holdReason: optStr(i.holdReason) },
    outcome: o ? { stageName: str(o.stageName), outcome: terminal(o.outcome), reasonCode: optStr(o.reasonCode), closedAt: str(o.closedAt), routeLabel: optStr(o.routeLabel), sourceStageName: optStr(o.sourceStageName),
      sourceQuestion: optStr(o.sourceQuestion), sourceValue: optStr(o.sourceValue), stoppedCount: count(o.stoppedCount), closedBy: optStr(o.closedBy) } : null,
    visits: arr(v.visits, 5000).map((item) => {
      const w = obj(item);
      return { id: uuid(w.id), stageKey: str(w.stageKey), stageName: str(w.stageName), stageType: str(w.stageType), visitNumber: count(w.visitNumber), status: str(w.status), outcome: optStr(w.outcome), remark: optStr(w.remark),
        stopped: w.stopped === true, skipped: w.skipped === true, activatedAt: optStr(w.activatedAt), completedAt: optStr(w.completedAt), dueAt: optStr(w.dueAt), completedBy: optStr(w.completedBy),
        assignees: arr(w.assignees, 100).map(str), formName: optStr(w.formName), submittedAt: optStr(w.submittedAt), routeLabel: optStr(w.routeLabel), nextStages: arr(w.nextStages, 100).map(str),
        answers: arr(w.answers, 100).map((answer) => { const a = obj(answer); return { label: str(a.label), value: optStr(a.value) ?? "" }; }),
        events: arr(w.events, 500).map((event) => { const e = obj(event); return { action: str(e.action), at: str(e.at), by: optStr(e.by), reason: optStr(e.reason) }; }) };
    }),
  };
}

/** A sensible End type for a step being turned into an End Node, read from its name. The author can change it. */
export function suggestFmsTerminalOutcome(name: string): FmsTerminalOutcome {
  const text = name.toLowerCase();
  if (/do\s*not\s*contact|\bdnc\b|don'?t\s*contact/.test(text)) return "do_not_contact";
  if (/\blost\b|not\s*interested|lead\s*closed|declin|reject|drop/.test(text)) return "lost";
  if (/\bwon\b|\bwin\b|sale|sold|closure|closed|order\s*(placed|confirmed)|paid|payment\s*received/.test(text)) return "won";
  return "other";
}

/**
 * Turn the last step of a path into an End Node. The key, name, position and every
 * incoming route stay; the work it used to ask for (assignee, form, checklist,
 * deadline, decision) is removed because an End Node never creates work.
 */
export function convertFmsStageToEnd(stage: FmsStageDefinition): FmsStageDefinition {
  return {
    key: stage.key, name: stage.name, type: "end", order: stage.order, required: true, completionRule: "any_doer",
    allowMultipleDoers: false, requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [],
    requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false, canEscalate: false,
    branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [],
    ...(stage.method ? { method: stage.method } : {}), ...(stage.position ? { position: stage.position } : {}),
    sla: { timingMethod: "completion_date", deadlineEnabled: false, dueDate: "", decisionMode: "normal", terminal: { outcome: suggestFmsTerminalOutcome(stage.name) } },
  };
}

/** Turn an End Node back into an ordinary step with no deadline; the author then adds its questions and assignee. */
export function convertFmsEndToStage(stage: FmsStageDefinition, template: FmsStageDefinition): FmsStageDefinition {
  return { ...template, key: stage.key, name: stage.name, order: stage.order, ...(stage.method ? { method: stage.method } : {}), ...(stage.position ? { position: stage.position } : {}),
    sla: { ...template.sla, deadlineEnabled: false } };
}

/** Reporting periods offered in the workspace. Dates are calendar days in India time, like the server filter. */
export type FmsReportPeriod = "all" | "today" | "week" | "month" | "custom";
export function fmsPeriodRange(period: Exclude<FmsReportPeriod, "custom">, now: Date = new Date()): Readonly<{ from: string; to: string }> {
  if (period === "all") return { from: "", to: "" };
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (period === "today") return { from: today, to: today };
  const day = new Date(`${today}T00:00:00Z`);
  const start = period === "week" ? new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000) : new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  return { from: start.toISOString().slice(0, 10), to: today };
}

/** One readable line per journey step, in persisted order. Pure, so the timeline and tests share it. */
export type FmsJourneyLine = Readonly<{ id: string; title: string; detail: readonly string[]; tone: "done" | "open" | "stopped" | "skipped" | "end"; at: string | null }>;
export function fmsJourneyLines(journey: FmsJourney): readonly FmsJourneyLine[] {
  const repeats = new Map<string, number>();
  for (const visit of journey.visits) repeats.set(visit.stageKey, Math.max(repeats.get(visit.stageKey) ?? 0, visit.visitNumber));
  return journey.visits.map((visit): FmsJourneyLine => {
    const repeated = (repeats.get(visit.stageKey) ?? 1) > 1;
    const title = `${visit.stageName}${repeated ? ` (visit ${visit.visitNumber})` : ""}`;
    if (visit.stageType === "end") {
      const outcome = journey.outcome && journey.outcome.stageName === visit.stageName ? fmsTerminalOutcomeLabel(journey.outcome.outcome) : null;
      return { id: visit.id, title, tone: "end", at: visit.completedAt ?? visit.activatedAt, detail: ["Workflow ended automatically", ...(outcome ? [`Final outcome: ${outcome}`] : [])] };
    }
    const detail: string[] = [];
    if (visit.skipped) return { id: visit.id, title, tone: "skipped", at: visit.activatedAt, detail: ["Skipped: its condition did not apply"] };
    for (const answer of visit.answers) if (answer.value) detail.push(`${answer.label}: ${answer.value}`);
    if (visit.outcome) detail.push(`Decision: ${visit.outcome}`);
    if (visit.remark) detail.push(`Remark: ${visit.remark}`);
    if (visit.routeLabel) detail.push(`Route: ${visit.routeLabel}`);
    if (visit.nextStages.length && visit.status === "completed") detail.push(`Next: ${visit.nextStages.join(", ")}`);
    for (const event of visit.events) if (event.action !== "stopped_by_end_node") detail.push(`${event.action.replaceAll("_", " ")}${event.by ? ` by ${event.by}` : ""}${event.reason ? `: ${event.reason}` : ""}`);
    if (visit.stopped) return { id: visit.id, title, tone: "stopped", at: visit.activatedAt, detail: ["Stopped: the workflow reached its ending before this step was done", ...detail] };
    if (visit.status === "completed") return { id: visit.id, title, tone: "done", at: visit.completedAt, detail: [visit.completedBy ? `Completed by ${visit.completedBy}` : "Completed", ...detail] };
    return { id: visit.id, title, tone: "open", at: visit.activatedAt, detail: [visit.assignees.length ? `With ${visit.assignees.join(", ")}` : "Waiting for an owner", ...detail] };
  });
}
