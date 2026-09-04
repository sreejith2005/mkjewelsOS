/**
 * The Task Control workspace runs every panel -- overview, people, evidence and
 * templates -- off one filter object. Both server contracts it calls
 * (`get_employee_task_progress` and `get_task_evidence_workspace`) accept the
 * same keys, so the translation below is a projection, never a re-interpretation.
 */

export const TASK_CONTROL_TABS = ["overview", "people", "evidence", "templates"] as const;
export type TaskControlTab = (typeof TASK_CONTROL_TABS)[number];

export const RANGE_PRESETS = ["today", "last_7_days", "last_30_days", "this_month", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Readonly<Record<RangePreset, string>> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_month: "This month",
  custom: "Custom",
};

export type TaskControlFilters = Readonly<{
  preset: RangePreset;
  from: string;
  to: string;
  branch_id: string;
  department_id: string;
  user_profile_id: string;
  search: string;
}>;

/** Tenant-local calendar date. Every server range is expressed in Asia/Kolkata. */
export function tenantToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function shiftDays(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00+05:30`);
  shifted.setDate(shifted.getDate() + days);
  return shifted.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function presetRange(preset: RangePreset, today: string = tenantToday()): { from: string; to: string } {
  if (preset === "last_7_days") return { from: shiftDays(today, -6), to: today };
  if (preset === "last_30_days") return { from: shiftDays(today, -29), to: today };
  if (preset === "this_month") return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: today, to: today };
}

export function defaultFilters(today: string = tenantToday()): TaskControlFilters {
  return { preset: "last_30_days", ...presetRange("last_30_days", today), branch_id: "", department_id: "", user_profile_id: "", search: "" };
}

/** Switching preset rewrites the dates; `custom` keeps whatever dates are set. */
export function applyPreset(filters: TaskControlFilters, preset: RangePreset, today: string = tenantToday()): TaskControlFilters {
  return preset === "custom" ? { ...filters, preset } : { ...filters, preset, ...presetRange(preset, today) };
}

/** A branch change invalidates the department chosen under the previous branch. */
export function applyBranch(filters: TaskControlFilters, branchId: string): TaskControlFilters {
  return { ...filters, branch_id: branchId, department_id: "" };
}

function scopeKeys(filters: TaskControlFilters): Record<string, string> {
  const scope: Record<string, string> = { from: filters.from, to: filters.to };
  if (filters.branch_id) scope.branch_id = filters.branch_id;
  if (filters.department_id) scope.department_id = filters.department_id;
  if (filters.user_profile_id) scope.user_profile_id = filters.user_profile_id;
  return scope;
}

export function progressContext(filters: TaskControlFilters): Record<string, string> {
  return scopeKeys(filters);
}

export function evidenceFilter(
  filters: TaskControlFilters,
  page: number,
  pageSize: number,
): Record<string, string | number> {
  const filter: Record<string, string | number> = { ...scopeKeys(filters), page, page_size: pageSize };
  if (filters.search.trim()) filter.search = filters.search.trim();
  return filter;
}

export function rangeIsValid(filters: TaskControlFilters): boolean {
  if (!filters.from || !filters.to || filters.to < filters.from) return false;
  const days = (Date.parse(`${filters.to}T00:00:00Z`) - Date.parse(`${filters.from}T00:00:00Z`)) / 86_400_000;
  return days <= 366;
}

export type ProgressCounts = Readonly<{ assigned: number; completed: number; remaining: number; overdue: number }>;

export function completionRate(row: ProgressCounts): number {
  return row.assigned === 0 ? 0 : Math.round((row.completed / row.assigned) * 100);
}

export function totals<T extends ProgressCounts>(rows: readonly T[]): ProgressCounts {
  return rows.reduce<ProgressCounts>(
    (sum, row) => ({
      assigned: sum.assigned + row.assigned,
      completed: sum.completed + row.completed,
      remaining: sum.remaining + row.remaining,
      overdue: sum.overdue + row.overdue,
    }),
    { assigned: 0, completed: 0, remaining: 0, overdue: 0 },
  );
}

/**
 * "Who is not completing" ordering: overdue work is the loudest signal, then the
 * size of the backlog, then the completion rate. People with nothing assigned
 * are not behind on anything, so they are excluded rather than ranked at zero.
 */
export function needsAttention<T extends ProgressCounts & { employee_name: string }>(rows: readonly T[]): T[] {
  return rows
    .filter((row) => row.assigned > 0 && (row.overdue > 0 || row.remaining > 0))
    .sort(
      (left, right) =>
        right.overdue - left.overdue ||
        right.remaining - left.remaining ||
        completionRate(left) - completionRate(right) ||
        left.employee_name.localeCompare(right.employee_name),
    );
}
