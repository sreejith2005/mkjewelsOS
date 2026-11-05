import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  defaultPerformanceFilter,
  parsePerformanceFilter,
  performancePeriodRange,
  performanceToday,
  PERFORMANCE_KINDS,
  PERFORMANCE_KIND_LABELS,
  PERFORMANCE_PERIOD_LABELS,
  PERFORMANCE_PERIODS,
  type PerformanceFilter,
  type PerformanceOptions,
  type PerformancePeriod,
} from "@jewelos/core";

const field = "task-field min-h-10 w-full text-sm";

export function PerformanceFilters({ filter, options, onChange }: { filter: PerformanceFilter; options: PerformanceOptions | null; onChange: (next: PerformanceFilter) => void }) {
  const [error, setError] = useState("");
  const [custom, setCustom] = useState({ from: filter.from, to: filter.to });
  useEffect(() => setCustom({ from: filter.from, to: filter.to }), [filter.from, filter.to]);
  const today = performanceToday();
  const team = filter.scope === "team";

  const apply = (next: Partial<PerformanceFilter>) => {
    try {
      onChange(parsePerformanceFilter({ ...filter, ...next }));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid filters");
    }
  };
  const choosePeriod = (period: PerformancePeriod) => {
    if (period === "custom") return apply({ period, from: custom.from, to: custom.to });
    const anchor = period === "week" ? filter.from : period === "month" ? filter.from.slice(0, 7) : period === "year" ? filter.from.slice(0, 4) : undefined;
    apply({ period, ...performancePeriodRange(period, anchor, today) });
  };
  const departments = (options?.departments ?? []).filter((d) => !filter.branch_id || !d.branch_id || d.branch_id === filter.branch_id);
  const employees = (options?.employees ?? []).filter((e) => (!filter.branch_id || e.branch_id === filter.branch_id) && (!filter.department_id || e.department_id === filter.department_id));
  const years = Array.from({ length: 5 }, (_, index) => String(Number(today.slice(0, 4)) - index));

  return (
    <div className="rounded-2xl border border-task-border bg-task-bg p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <div aria-label="Period" className="flex flex-wrap gap-1 rounded-xl bg-task-muted p-1" role="group">
          {PERFORMANCE_PERIODS.map((period) => (
            <button
              aria-pressed={filter.period === period}
              className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors ${filter.period === period ? "bg-task-bg text-task-text shadow-card" : "text-task-text-muted hover:text-task-text"}`}
              key={period}
              onClick={() => choosePeriod(period)}
              type="button"
            >
              {PERFORMANCE_PERIOD_LABELS[period]}
            </button>
          ))}
        </div>
        {filter.period === "week" ? (
          <label className="text-xs">
            <span className="sr-only">Any day in the week</span>
            <input aria-label="Any day in the week" className={`${field} w-auto`} max={today} onChange={(e) => e.target.value && apply(performancePeriodRange("week", e.target.value, today))} type="date" value={filter.from} />
          </label>
        ) : null}
        {filter.period === "month" ? (
          <input aria-label="Month" className={`${field} w-auto`} max={today.slice(0, 7)} onChange={(e) => e.target.value && apply(performancePeriodRange("month", e.target.value, today))} type="month" value={filter.from.slice(0, 7)} />
        ) : null}
        {filter.period === "year" ? (
          <select aria-label="Year" className={`${field} w-auto`} onChange={(e) => apply(performancePeriodRange("year", e.target.value, today))} value={filter.from.slice(0, 4)}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        ) : null}
        {filter.period === "custom" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input aria-label="From" className={`${field} w-auto`} onChange={(e) => setCustom({ ...custom, from: e.target.value })} type="date" value={custom.from} />
            <span className="text-xs text-task-text-muted">to</span>
            <input aria-label="To" className={`${field} w-auto`} onChange={(e) => setCustom({ ...custom, to: e.target.value })} type="date" value={custom.to} />
            <button className="min-h-10 rounded-lg border border-task-border px-3 text-xs font-medium" onClick={() => apply({ period: "custom", from: custom.from, to: custom.to })} type="button">Apply</button>
          </div>
        ) : null}
        <span className="text-xs tabular-nums text-task-text-muted">{filter.from === filter.to ? filter.from : `${filter.from} → ${filter.to}`}</span>
        <button className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-task-text-muted hover:bg-task-muted hover:text-task-text" onClick={() => { setError(""); onChange(defaultPerformanceFilter(filter.scope, today)); }} type="button">
          <RotateCcw className="size-3.5" /> Reset
        </button>
      </div>
      <div className={`mt-2 grid gap-2 sm:grid-cols-2 ${team ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {team ? (
          <>
            <select aria-label="Branch" className={field} onChange={(e) => apply({ branch_id: e.target.value, department_id: undefined, user_profile_id: undefined })} value={filter.branch_id ?? ""}>
              <option value="">All branches</option>
              {(options?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select aria-label="Department" className={field} onChange={(e) => apply({ department_id: e.target.value, user_profile_id: undefined })} value={filter.department_id ?? ""}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select aria-label="Employee" className={field} onChange={(e) => apply({ user_profile_id: e.target.value })} value={filter.user_profile_id ?? ""}>
              <option value="">All employees</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </>
        ) : null}
        <select aria-label="FMS workflow" className={field} onChange={(e) => apply({ flow_id: e.target.value, kind: e.target.value ? "fms" : filter.kind === "fms" ? "all" : filter.kind })} value={filter.flow_id ?? ""}>
          <option value="">All work (any FMS)</option>
          {(options?.flows ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select aria-label="Task type" className={field} disabled={!!filter.flow_id} onChange={(e) => apply({ kind: e.target.value as PerformanceFilter["kind"] })} value={filter.kind}>
          {PERFORMANCE_KINDS.map((kind) => <option key={kind} value={kind}>{PERFORMANCE_KIND_LABELS[kind]}</option>)}
        </select>
      </div>
      {error ? <p className="mt-2 text-sm text-task-overdue" role="alert">{error}</p> : null}
    </div>
  );
}
