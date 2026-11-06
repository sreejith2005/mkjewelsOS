import { taskDelayedScore, taskPendingScore } from "../taskControlView.ts";

/**
 * Employee task performance (migration 0382, docs/REPORTS.md "Employee task performance").
 *
 * The server returns assignment-level COUNTS only: one assignment is one person on one work
 * item, and every assignment due in the period sits in exactly one bucket. Scores are never
 * computed on the server or inline in a screen: `performanceScores` passes the counts to
 * `taskPendingScore` / `taskDelayedScore`, the same functions Task Control uses.
 */

export const PERFORMANCE_SCOPES = ["me", "team"] as const;
export type PerformanceScope = (typeof PERFORMANCE_SCOPES)[number];

/** Task Control's work kinds; `fms` covers FMS person steps. */
export const PERFORMANCE_KINDS = ["all", "one_time", "recurring", "crm", "fms"] as const;
export type PerformanceKind = (typeof PERFORMANCE_KINDS)[number];
export const PERFORMANCE_KIND_LABELS: Readonly<Record<PerformanceKind, string>> = {
  all: "All task types",
  one_time: "One-time",
  recurring: "Recurring",
  crm: "CRM",
  fms: "FMS steps",
};

export const PERFORMANCE_GRANULARITIES = ["day", "week", "month"] as const;
export type PerformanceGranularity = (typeof PERFORMANCE_GRANULARITIES)[number];

export const PERFORMANCE_PERIODS = ["today", "this_week", "this_month", "week", "month", "year", "custom"] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];
export const PERFORMANCE_PERIOD_LABELS: Readonly<Record<PerformancePeriod, string>> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  week: "Week",
  month: "Month",
  year: "Year",
  custom: "Custom",
};

/** Mutually exclusive: every eligible assignment is in exactly one. */
export const PERFORMANCE_BUCKETS = ["on_time", "late", "completed_untimed", "in_progress", "pending", "overdue"] as const;
export type PerformanceBucket = (typeof PERFORMANCE_BUCKETS)[number];

/** Record lists the drilldown can open; each matches one count on screen. */
export const PERFORMANCE_RECORD_SELECTORS = [
  "assigned", "completed", "on_time", "late", "completed_untimed", "remaining", "pending", "in_progress", "overdue", "excluded", "backlog",
] as const;
export type PerformanceRecordSelector = (typeof PERFORMANCE_RECORD_SELECTORS)[number];

export const PERFORMANCE_SELECTOR_LABELS: Readonly<Record<PerformanceRecordSelector, string>> = {
  assigned: "All assigned work",
  completed: "Completed",
  on_time: "Completed on time",
  late: "Completed late",
  completed_untimed: "Completed, no completion time",
  remaining: "Not completed",
  pending: "Pending, not overdue",
  in_progress: "In progress",
  overdue: "Overdue",
  excluded: "Not counted (rejected, skipped, stopped, cancelled)",
  backlog: "Overdue from before this period",
};

export type PerformanceFilter = {
  scope: PerformanceScope;
  period: PerformancePeriod;
  from: string;
  to: string;
  branch_id?: string | undefined;
  department_id?: string | undefined;
  user_profile_id?: string | undefined;
  flow_id?: string | undefined;
  kind: PerformanceKind;
  granularity?: PerformanceGranularity | undefined;
};

export type PerformanceCounts = {
  assigned: number;
  on_time: number;
  late: number;
  completed_untimed: number;
  pending: number;
  in_progress: number;
  overdue: number;
};

export type PerformanceSummary = PerformanceCounts & {
  excluded: number;
  excluded_rejected: number;
  excluded_skipped: number;
  excluded_stopped: number;
  excluded_cancelled_run: number;
  work_items: number;
};

export type PerformanceEmployee = PerformanceCounts & {
  user_profile_id: string;
  employee_name: string;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
  active: boolean;
};

export type PerformanceFlow = PerformanceCounts & { flow_id: string; flow_name: string; visits: number };
export type PerformanceRollup = PerformanceCounts & { id: string | null; name: string };
export type PerformanceTrendPoint = {
  bucket_start: string;
  due: number;
  on_time: number;
  late: number;
  completed_untimed: number;
  remaining: number;
};
export type PerformanceKindRow = { work_kind: string; assigned: number; completed: number; on_time: number; overdue: number };

export type PerformancePayload = {
  version: 1;
  generatedAt: string;
  timezone: string;
  scope: PerformanceScope;
  canTeam: boolean;
  from: string;
  to: string;
  granularity: PerformanceGranularity;
  summary: PerformanceSummary;
  employees: PerformanceEmployee[];
  flows: PerformanceFlow[];
  trend: PerformanceTrendPoint[];
  kinds: PerformanceKindRow[];
  branches: PerformanceRollup[];
  departments: PerformanceRollup[];
  backlog: { overdue_before_period: number; people: number };
  pendingStartForms: number;
};

export type PerformanceRecord = {
  work_id: string;
  person_id: string;
  employee_name: string | null;
  work_kind: string;
  title: string;
  task_id: string | null;
  instance_id: string | null;
  stage_id: string | null;
  reference_number: string | null;
  flow_name: string | null;
  stage_name: string | null;
  status: string;
  bucket: string;
  excluded_reason: string | null;
  due: string | null;
  done_at: string | null;
  overdue_minutes: number | null;
  delay_minutes: number | null;
};
export type PerformanceRecordPage = { total: number; offset: number; limit: number; rows: PerformanceRecord[] };

export type PerformanceStagePerson = { user_profile_id: string; employee_name: string; assigned: number; completed: number; late: number; overdue: number; remaining: number };
export type PerformanceStage = PerformanceCounts & {
  stage_key: string;
  stage_name: string;
  stage_order: number | null;
  visits: number;
  median_hours: number | null;
  average_hours: number | null;
  people: PerformanceStagePerson[];
};

export type PerformanceOption = { id: string; name: string };
export type PerformanceOptions = {
  canTeam: boolean;
  me: PerformanceOption;
  branches: PerformanceOption[];
  departments: Array<PerformanceOption & { branch_id: string | null }>;
  employees: Array<PerformanceOption & { branch_id: string | null; department_id: string | null }>;
  flows: PerformanceOption[];
};

// ------------------------------------------------------------------------------- derived counts

export type DerivedPerformance = {
  assigned: number;
  completed: number;
  remaining: number;
  onTime: number;
  late: number;
  untimed: number;
  pending: number;
  inProgress: number;
  overdue: number;
  pendingScore: number | null;
  delayedScore: number | null;
};

export function completedCount(row: PerformanceCounts): number {
  return row.on_time + row.late + row.completed_untimed;
}

export function remainingCount(row: PerformanceCounts): number {
  return row.pending + row.in_progress + row.overdue;
}

/**
 * The one place a performance row becomes scores. Work Not Done % and Work Not Done On Time %
 * come from Task Control's own functions, so the same counts always give the same score.
 */
export function performanceScores(row: PerformanceCounts): DerivedPerformance {
  const completed = completedCount(row);
  const counts = { assigned: row.assigned, completed, onTimeCompleted: row.on_time };
  return {
    assigned: row.assigned,
    completed,
    remaining: remainingCount(row),
    onTime: row.on_time,
    late: row.late,
    untimed: row.completed_untimed,
    pending: row.pending,
    inProgress: row.in_progress,
    overdue: row.overdue,
    pendingScore: taskPendingScore(counts),
    delayedScore: taskDelayedScore(counts),
  };
}

/** True when the buckets account for every assignment; the screen says so when they do not. */
export function performanceReconciles(row: PerformanceCounts): boolean {
  return completedCount(row) + remainingCount(row) === row.assigned;
}

export function sumPerformance(rows: readonly PerformanceCounts[]): PerformanceCounts {
  return rows.reduce<PerformanceCounts>(
    (sum, row) => ({
      assigned: sum.assigned + row.assigned,
      on_time: sum.on_time + row.on_time,
      late: sum.late + row.late,
      completed_untimed: sum.completed_untimed + row.completed_untimed,
      pending: sum.pending + row.pending,
      in_progress: sum.in_progress + row.in_progress,
      overdue: sum.overdue + row.overdue,
    }),
    { assigned: 0, on_time: 0, late: 0, completed_untimed: 0, pending: 0, in_progress: 0, overdue: 0 },
  );
}

/** Default table order: overdue first, then the backlog, then the worse pending score. */
export function performanceAttentionOrder<T extends PerformanceCounts & { employee_name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const a = performanceScores(left);
    const b = performanceScores(right);
    return (
      b.overdue - a.overdue ||
      b.remaining - a.remaining ||
      (a.pendingScore ?? 1) - (b.pendingScore ?? 1) ||
      left.employee_name.localeCompare(right.employee_name)
    );
  });
}

// ------------------------------------------------------------------------------- donut segments

export type DonutSegment = { key: PerformanceRecordSelector; label: string; value: number };

/** Chart A: completed against what is left. Exhaustive: segments sum to the assigned total. */
export function completionSegments(row: PerformanceCounts): DonutSegment[] {
  return [
    { key: "completed", label: "Completed", value: completedCount(row) },
    { key: "in_progress", label: "In progress", value: row.in_progress },
    { key: "pending", label: "Pending, not overdue", value: row.pending },
    { key: "overdue", label: "Overdue", value: row.overdue },
  ];
}

/** Chart B: completed work by timing. Exhaustive over completed work. */
export function timingSegments(row: PerformanceCounts): DonutSegment[] {
  const segments: DonutSegment[] = [
    { key: "on_time", label: "On time", value: row.on_time },
    { key: "late", label: "Late", value: row.late },
  ];
  if (row.completed_untimed > 0) segments.push({ key: "completed_untimed", label: "No completion time", value: row.completed_untimed });
  return segments;
}

// ------------------------------------------------------------------------------- periods (Asia/Kolkata)

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function performanceToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday of the week containing `day` (business weeks start on Monday, like Postgres). */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

/**
 * Dates for a period. "This week" and "This month" end today, as in Task Control; a chosen
 * Week, Month or Year covers the whole of it. `anchor` is a day inside the chosen week, a
 * `YYYY-MM` month or a `YYYY` year.
 */
export function performancePeriodRange(period: PerformancePeriod, anchor?: string, today: string = performanceToday()): { from: string; to: string } {
  if (period === "this_week") return { from: weekStart(today), to: today };
  if (period === "this_month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (period === "week") {
    const start = weekStart(anchor && DAY.test(anchor) ? anchor : today);
    return { from: start, to: addDays(start, 6) };
  }
  if (period === "month") {
    const month = anchor && /^\d{4}-\d{2}$/.test(anchor) ? anchor : today.slice(0, 7);
    return { from: `${month}-01`, to: monthEnd(month) };
  }
  if (period === "year") {
    const year = anchor && /^\d{4}$/.test(anchor) ? anchor : today.slice(0, 4);
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { from: today, to: today };
}

export function defaultPerformanceFilter(scope: PerformanceScope = "me", today: string = performanceToday()): PerformanceFilter {
  return { scope, period: "this_month", ...performancePeriodRange("this_month", undefined, today), kind: "all" };
}

/** Validates a filter the same way the server will; throws a readable message. */
export function parsePerformanceFilter(input: unknown, today: string = performanceToday()): PerformanceFilter {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid filters");
  const o = input as Record<string, unknown>;
  const scope = o.scope === "team" ? "team" : "me";
  const period = PERFORMANCE_PERIODS.find((p) => p === o.period) ?? "this_month";
  const base = defaultPerformanceFilter(scope, today);
  const from = typeof o.from === "string" && DAY.test(o.from) ? o.from : undefined;
  const to = typeof o.to === "string" && DAY.test(o.to) ? o.to : undefined;
  const range = from && to ? { from, to } : performancePeriodRange(period, undefined, today);
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (!(days >= 1 && days <= 366)) throw new Error("Choose 1 to 366 days");
  const result: PerformanceFilter = { ...base, period, ...range };
  for (const key of ["branch_id", "department_id", "user_profile_id", "flow_id"] as const) {
    const value = o[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid scope");
    result[key] = value;
  }
  if (scope === "me") {
    delete result.branch_id;
    delete result.department_id;
    delete result.user_profile_id;
  }
  const kind = PERFORMANCE_KINDS.find((k) => k === o.kind);
  if (kind) result.kind = kind;
  const granularity = PERFORMANCE_GRANULARITIES.find((g) => g === o.granularity);
  if (granularity) result.granularity = granularity;
  return result;
}

/** The RPC context: only keys the server accepts, empty values left out. */
export function performanceContext(filter: PerformanceFilter): Record<string, string> {
  const context: Record<string, string> = { scope: filter.scope, from: filter.from, to: filter.to };
  for (const key of ["branch_id", "department_id", "user_profile_id", "flow_id", "granularity"] as const) {
    const value = filter[key];
    if (value) context[key] = value;
  }
  if (filter.kind !== "all") context.kind = filter.kind;
  return context;
}

const SEARCH_KEYS = ["scope", "period", "from", "to", "branch_id", "department_id", "user_profile_id", "flow_id", "kind", "granularity"] as const;

export function encodePerformanceSearch(filter: PerformanceFilter): string {
  const params = new URLSearchParams();
  for (const key of SEARCH_KEYS) {
    const value = filter[key];
    if (value) params.set(key, String(value));
  }
  return params.toString();
}

/** Never throws: a broken link falls back to the default view for the caller. */
export function decodePerformanceSearch(search: string, canTeam: boolean, today: string = performanceToday()): PerformanceFilter {
  const params = new URLSearchParams(search);
  const raw: Record<string, string> = {};
  for (const key of SEARCH_KEYS) {
    const value = params.get(key);
    if (value) raw[key] = value;
  }
  if (!raw.scope) raw.scope = canTeam ? "team" : "me";
  if (raw.scope === "team" && !canTeam) raw.scope = "me";
  try {
    return parsePerformanceFilter(raw, today);
  } catch {
    return defaultPerformanceFilter(canTeam ? "team" : "me", today);
  }
}

// ------------------------------------------------------------------------------- response checks

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const COUNT_KEYS = ["assigned", "on_time", "late", "completed_untimed", "pending", "in_progress", "overdue"] as const;
const hasCounts = (v: Record<string, unknown>) => COUNT_KEYS.every((k) => isCount(v[k]));
const nullableString = (v: unknown) => v === null || v === undefined || typeof v === "string";

/**
 * A malformed response must never render as zeros. Every count the screen draws is checked
 * here; anything else is rejected as an error the screen reports.
 */
export function parsePerformancePayload(v: unknown): PerformancePayload {
  if (!isObject(v) || v.version !== 1 || !["generatedAt", "timezone", "from", "to", "granularity"].every((k) => typeof v[k] === "string"))
    throw new Error("Invalid performance response");
  if (!isObject(v.summary) || !hasCounts(v.summary) || !["excluded", "work_items"].every((k) => isCount((v.summary as Record<string, unknown>)[k])))
    throw new Error("Invalid performance summary");
  if (!Array.isArray(v.employees) || !v.employees.every((e) => isObject(e) && typeof e.user_profile_id === "string" && typeof e.employee_name === "string" && hasCounts(e)))
    throw new Error("Invalid employee performance");
  if (!Array.isArray(v.flows) || !v.flows.every((f) => isObject(f) && typeof f.flow_id === "string" && typeof f.flow_name === "string" && hasCounts(f) && isCount(f.visits)))
    throw new Error("Invalid FMS performance");
  if (!Array.isArray(v.trend) || !v.trend.every((t) => isObject(t) && typeof t.bucket_start === "string" && ["due", "on_time", "late", "completed_untimed", "remaining"].every((k) => isCount(t[k]))))
    throw new Error("Invalid performance trend");
  for (const key of ["branches", "departments"] as const) {
    const list = v[key];
    if (!Array.isArray(list) || !list.every((r) => isObject(r) && typeof r.name === "string" && hasCounts(r))) throw new Error("Invalid performance roll-up");
  }
  if (!Array.isArray(v.kinds) || !isObject(v.backlog) || !isCount(v.backlog.overdue_before_period) || !isCount(v.pendingStartForms))
    throw new Error("Invalid performance response");
  // Every rendered field has been checked above.
  return v as unknown as PerformancePayload;
}

export function parsePerformanceRecordPage(v: unknown): PerformanceRecordPage {
  if (!isObject(v) || !isCount(v.total) || !isCount(v.offset) || !isCount(v.limit) || !Array.isArray(v.rows)) throw new Error("Invalid record response");
  const ok = v.rows.every(
    (r) =>
      isObject(r) &&
      typeof r.work_id === "string" &&
      typeof r.person_id === "string" &&
      typeof r.title === "string" &&
      typeof r.status === "string" &&
      typeof r.bucket === "string" &&
      ["task_id", "instance_id", "stage_id", "reference_number", "flow_name", "stage_name", "due", "done_at", "employee_name", "excluded_reason"].every((k) => nullableString(r[k])),
  );
  if (!ok) throw new Error("Invalid record response");
  return v as unknown as PerformanceRecordPage;
}

export function parsePerformanceStages(v: unknown): PerformanceStage[] {
  if (!isObject(v) || !Array.isArray(v.stages) || !v.stages.every((s) => isObject(s) && typeof s.stage_key === "string" && hasCounts(s) && isCount(s.visits) && Array.isArray(s.people)))
    throw new Error("Invalid stage performance");
  return v.stages as PerformanceStage[];
}

export function parsePerformanceOptions(v: unknown): PerformanceOptions {
  const options = (x: unknown) => Array.isArray(x) && x.every((o) => isObject(o) && typeof o.id === "string" && typeof o.name === "string");
  if (!isObject(v) || typeof v.canTeam !== "boolean" || !isObject(v.me) || !["branches", "departments", "employees", "flows"].every((k) => options(v[k])))
    throw new Error("Invalid filter options");
  return v as unknown as PerformanceOptions;
}

/** "3 h 20 m late" style durations for drilldown rows. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} m`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** The count a record list must match, for any selector except the two outside the cohort. */
export function selectorCount(row: PerformanceCounts, selector: PerformanceRecordSelector): number | undefined {
  switch (selector) {
    case "assigned": return row.assigned;
    case "completed": return completedCount(row);
    case "remaining": return remainingCount(row);
    case "on_time": case "late": case "completed_untimed": case "pending": case "in_progress": case "overdue": return row[selector];
    default: return undefined;
  }
}
