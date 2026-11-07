import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Users, User } from "lucide-react";
import {
  completionSegments,
  decodePerformanceSearch,
  encodePerformanceSearch,
  formatTaskPerformanceScore,
  hasPermission,
  performanceAttentionOrder,
  performanceReconciles,
  performanceScores,
  selectorCount,
  timingSegments,
  TASK_DELAYED_SCORE_LABEL,
  TASK_PENDING_SCORE_LABEL,
  type PerformanceCounts,
  type PerformanceEmployee,
  type PerformanceFilter,
  type PerformancePayload,
  type PerformanceRecordSelector,
  type PerformanceTrendPoint,
} from "@jewelos/core";
import { fetchTaskPerformance, fetchTaskPerformanceOptions, fetchTaskPerformanceRecords } from "@jewelos/data/analytics/index";
import { useAuth } from "@/auth/AuthContext";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { Panel } from "../components";
import { usePerformanceRequest } from "./usePerformanceRequest";
import { PerformanceFilters } from "./PerformanceFilters";
import { Donut, Legend, ScoreBars, StackedBars, TrendColumns, swatchStyle, type StackedRow } from "./charts";
import { EmployeeTable } from "./EmployeeTable";
import { FmsPerformance } from "./FmsPerformance";
import { RecordsDrawer, performanceRecordPath, type RecordsSelection } from "./RecordsDrawer";
import { Accountability } from "./Accountability";

const REALTIME_TOPICS = ["tasks", "fms"] as const;
const time = (date: Date) => date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function useFilterState(canTeam: boolean) {
  const [filter, setFilter] = useState(() => decodePerformanceSearch(window.location.search, canTeam));
  useEffect(() => {
    const restore = () => setFilter(decodePerformanceSearch(window.location.search, canTeam));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [canTeam]);
  const update = useCallback((next: PerformanceFilter) => {
    window.history.pushState({}, "", `${window.location.pathname}?${encodePerformanceSearch(next)}`);
    setFilter(next);
  }, []);
  return { filter, update };
}

export function PerformanceDashboard({ onOpenInsights }: { onOpenInsights: () => void }) {
  const { profile, access } = useAuth();
  // Presentation only: the server decides team access on every read.
  const canTeam = !!access && hasPermission(access, "dashboard.view_team_performance");
  const crmAllowed = !!access && hasPermission(access, "crm.view");
  const { filter, update } = useFilterState(canTeam);
  const [selection, setSelection] = useState<RecordsSelection | null>(null);
  const [employee, setEmployee] = useState<PerformanceEmployee | null>(null);

  const key = JSON.stringify(filter);
  const load = useCallback((signal: AbortSignal) => fetchTaskPerformance(filter, signal), [filter]);
  const main = usePerformanceRequest(key, load);
  const loadOptions = useCallback((signal: AbortSignal) => fetchTaskPerformanceOptions(signal), []);
  const options = usePerformanceRequest("options", loadOptions);
  // Realtime only nudges a quiet background refresh, at most every few seconds; the last good
  // numbers stay on screen while it runs.
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: REALTIME_TOPICS, refresh: main.refresh, debounceMs: 5000 });
  useEffect(() => setEmployee(null), [key]);

  const open = useCallback((selector: PerformanceRecordSelector, title: string, expected?: number, narrow?: Partial<PerformanceFilter>, stageKey?: string) => {
    setSelection({ filter: { ...filter, ...narrow }, selector, title, expected, stageKey });
  }, [filter]);

  const data = main.data;
  const team = filter.scope === "team";
  const setScope = (scope: PerformanceFilter["scope"]) => {
    const { branch_id: _b, department_id: _d, user_profile_id: _u, ...rest } = filter;
    update(scope === "team" ? { ...filter, scope } : { ...rest, scope });
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-task-text-muted">Employee task performance</p>
          <h1 className="mt-1 font-display text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
            {team ? (filter.user_profile_id ? options.data?.employees.find((e) => e.id === filter.user_profile_id)?.name ?? "Selected employee" : "All employees") : "My performance"}
          </h1>
          <StatusLine refreshing={main.refreshing} stale={main.stale} updatedAt={main.updatedAt} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canTeam ? (
            <div aria-label="Whose performance" className="flex rounded-xl bg-task-muted p-1" role="group">
              <button aria-pressed={!team} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm ${!team ? "bg-task-bg font-semibold shadow-card" : "text-task-text-muted"}`} onClick={() => setScope("me")} type="button"><User className="size-4" /> My performance</button>
              <button aria-pressed={team} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm ${team ? "bg-task-bg font-semibold shadow-card" : "text-task-text-muted"}`} onClick={() => setScope("team")} type="button"><Users className="size-4" /> All employees</button>
            </div>
          ) : null}
          <button className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-task-border bg-task-bg px-3 text-sm disabled:opacity-60" disabled={main.loading || main.refreshing} onClick={() => void main.refresh()} type="button">
            <RefreshCw className={`size-4 ${main.refreshing || main.loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      <PerformanceFilters filter={filter} onChange={(next) => { setSelection(null); update(next); }} options={options.data} />
      {options.error ? <p className="text-xs text-task-text-muted">Filter choices could not load; the dashboard still works. <button className="text-task-accent" onClick={() => void options.refresh()} type="button">Retry</button></p> : null}

      {main.error && !data ? (
        <div className="rounded-2xl border border-task-overdue/40 bg-task-bg p-5" role="alert">
          <p className="font-semibold">Performance could not load</p>
          <p className="mt-1 text-sm text-task-text-muted">{main.error}</p>
          <button className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-task-border px-3 text-sm" onClick={() => void main.refresh()} type="button"><RefreshCw className="size-4" /> Retry</button>
        </div>
      ) : null}
      {main.error && data ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="status">
          {main.error} Showing the numbers from {main.updatedAt ? time(main.updatedAt) : "earlier"}. <button className="font-medium text-task-accent" onClick={() => void main.refresh()} type="button">Retry now</button>
        </p>
      ) : null}

      {main.loading && !data ? <Skeleton /> : null}
      {data ? (
        <div className={`space-y-4 transition-opacity ${main.refreshing ? "opacity-90" : ""}`}>
          <KpiRow data={data} onOpen={open} />
          <Lifecycle data={data} onOpen={open} />
          {team ? (
            <Panel description="Every employee in scope, worst first: overdue work, then unfinished work. Click a name for their detail, or any number for the matching records." title="Employee task performance">
              <EmployeeTable
                employees={data.employees}
                onOpenCell={(row, selector, count) => open(selector, row.employee_name, count, { user_profile_id: row.user_profile_id })}
                onOpenEmployee={(row) => { setEmployee(row); window.setTimeout(() => document.getElementById("employee-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}
              />
              <a className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-task-accent" href={`/reports?report=employee_task_performance&from=${filter.from}&to=${filter.to}${filter.branch_id ? `&branch_id=${filter.branch_id}` : ""}${filter.department_id ? `&department_id=${filter.department_id}` : ""}`}>
                Export this report (Reports › Employee Task Performance) &rarr;
              </a>
            </Panel>
          ) : <PersonalWork filter={filter} onOpen={open} />}
          {employee ? <EmployeeDetail employee={employee} onClose={() => setEmployee(null)} onOpen={open} /> : null}
          <Panel description="Every configured FMS workflow. Click a workflow for stage-wise performance and who is responsible." id="fms-performance" title="FMS performance">
            <FmsPerformance filter={filter} flows={data.flows} onOpen={(selector, title, count, flowId, stageKey) => open(selector, title, count, { flow_id: flowId, kind: "fms" }, stageKey)} />
          </Panel>
          <Comparisons data={data} filter={filter} onOpen={open} onGranularity={(granularity) => update({ ...filter, granularity })} />
          {crmAllowed ? <Accountability from={filter.from} to={filter.to} /> : null}
          <p className="text-xs text-task-text-muted">
            Want the earlier analysis views (workflows & forms, people & availability, CRM summary)? <button className="font-medium text-task-accent" onClick={onOpenInsights} type="button">Open Management insights</button>.
          </p>
        </div>
      ) : null}
      {selection ? <RecordsDrawer onClose={() => setSelection(null)} selection={selection} /> : null}
    </div>
  );
}

type Open = (selector: PerformanceRecordSelector, title: string, expected?: number, narrow?: Partial<PerformanceFilter>, stageKey?: string) => void;

function StatusLine({ updatedAt, refreshing, stale }: { updatedAt: Date | null; refreshing: boolean; stale: boolean }) {
  return (
    <p aria-live="polite" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-task-text-muted">
      {updatedAt ? <span>Updated {time(updatedAt)} IST</span> : <span>Loading…</span>}
      {refreshing ? <span className="inline-flex items-center gap-1"><RefreshCw className="size-3 animate-spin" /> Refreshing</span> : null}
      {stale ? <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">Not current</span> : null}
      <span>· Updates automatically when work changes</span>
    </p>
  );
}

function Skeleton() {
  return (
    <div aria-label="Loading performance" className="space-y-4" role="status">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{Array.from({ length: 8 }, (_, i) => <div className="skeleton h-24 rounded-2xl" key={i} />)}</div>
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">{Array.from({ length: 3 }, (_, i) => <div className="skeleton h-64 rounded-2xl" key={i} />)}</div>
      <div className="skeleton h-80 rounded-2xl" />
    </div>
  );
}

// ------------------------------------------------------------------------------------ KPIs

function Kpi({ label, value, hint, tone, onClick, icon }: { label: string; value: string; hint: string; tone?: "bad" | "good" | "warn" | "score" | undefined; onClick?: (() => void) | undefined; icon?: ReactNode }) {
  const color = tone === "bad" || tone === "score" ? "text-task-overdue" : tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-task-text";
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-xs text-task-text-muted">{label}{icon}</span>
      <span className={`mt-1.5 block text-2xl font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="mt-1 block text-[0.6875rem] leading-snug text-task-text-muted">{hint}</span>
    </>
  );
  const className = "flex min-w-0 flex-col rounded-2xl border border-task-border bg-task-bg p-3.5 text-left shadow-card";
  return onClick ? (
    <button className={`${className} transition-colors hover:border-task-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent`} onClick={onClick} type="button">{body}</button>
  ) : <div className={className}>{body}</div>;
}

function KpiRow({ data, onOpen }: { data: PerformancePayload; onOpen: Open }) {
  const d = performanceScores(data.summary);
  const n = (value: number) => value.toLocaleString("en-IN");
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <Kpi hint="Due in this period" label="Tasks assigned" onClick={() => onOpen("assigned", "All assigned work", d.assigned)} value={n(d.assigned)} />
      <Kpi hint="Any completion time" label="Completed" onClick={() => onOpen("completed", "Completed work", d.completed)} tone="good" value={n(d.completed)} />
      <Kpi hint="Pending, in progress or overdue" label="Not completed" onClick={() => onOpen("remaining", "Work not completed", d.remaining)} value={n(d.remaining)} />
      <Kpi hint="Past the deadline, still open" icon={d.overdue ? <AlertTriangle className="size-3.5 text-task-overdue" /> : null} label="Overdue" onClick={() => onOpen("overdue", "Overdue work", d.overdue)} tone={d.overdue ? "bad" : undefined} value={n(d.overdue)} />
      <Kpi hint="By the deadline" icon={<CheckCircle2 className="size-3.5 text-success" />} label="Completed on time" onClick={() => onOpen("on_time", "Completed on time", d.onTime)} tone="good" value={n(d.onTime)} />
      <Kpi hint="After the deadline" icon={<Clock3 className="size-3.5 text-warning" />} label="Completed late" onClick={() => onOpen("late", "Completed late", d.late)} tone={d.late ? "warn" : undefined} value={n(d.late)} />
      <Kpi hint="Completed ÷ assigned × 100 − 100" label={`${TASK_PENDING_SCORE_LABEL} %`} tone={d.pendingScore === null ? undefined : "score"} value={formatTaskPerformanceScore(d.pendingScore)} />
      <Kpi hint="On time ÷ completed × 100 − 100" label={`${TASK_DELAYED_SCORE_LABEL} %`} tone={d.delayedScore === null ? undefined : "score"} value={formatTaskPerformanceScore(d.delayedScore)} />
    </div>
  );
}

// ------------------------------------------------------------------------------------ lifecycle

function Line({ label, value, onClick, strong, tone }: { label: string; value: string | number; onClick?: (() => void) | undefined; strong?: boolean; tone?: string }) {
  const content = (
    <>
      <span className={`flex min-w-0 items-center gap-2 ${strong ? "font-semibold" : ""}`}>{tone ? <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={swatchStyle(tone)} /> : null}<span className="truncate">{label}</span></span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{typeof value === "number" ? value.toLocaleString("en-IN") : value}</span>
    </>
  );
  return onClick ? (
    <button className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent" onClick={onClick} type="button">{content}</button>
  ) : <div className="flex min-h-9 items-center justify-between gap-3 px-2 text-sm">{content}</div>;
}

function Lifecycle({ data, onOpen }: { data: PerformancePayload; onOpen: Open }) {
  const s = data.summary;
  const d = performanceScores(s);
  const reconciled = performanceReconciles(s);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Panel className="lg:col-span-2" description="Every assignment due in the period, in exactly one row." title="Task work lifecycle">
        <div className="overflow-x-auto">
          <table aria-label="Task work lifecycle" className="w-full text-left text-sm tabular-nums">
            <thead><tr className="border-b border-task-border text-xs text-task-text-muted">
              {["Assigned", "Completed", "On time", "Late", ...(d.untimed ? ["No completion time"] : []), "Pending, not overdue", "In progress", "Overdue", "Remaining", `${TASK_PENDING_SCORE_LABEL} %`, `${TASK_DELAYED_SCORE_LABEL} %`].map((label) => <th className="min-w-28 px-3 py-3 font-medium align-bottom" key={label} scope="col">{label}</th>)}
            </tr></thead>
            <tbody><tr>
              {([["assigned", "All assigned work", d.assigned], ["completed", "Completed work", d.completed], ["on_time", "Completed on time", d.onTime], ["late", "Completed late", d.late], ...(d.untimed ? [["completed_untimed", "Completed without a recorded time", d.untimed] as const] : []), ["pending", "Pending, not overdue", d.pending], ["in_progress", "In progress or in review", d.inProgress], ["overdue", "Overdue work", d.overdue], ["remaining", "Work not completed", d.remaining]] as const).map(([selector, label, count]) => <td className="px-3 py-3" key={selector}><button className="min-h-10 rounded-lg px-2 font-semibold hover:bg-task-muted focus-visible:outline-task-accent" onClick={() => onOpen(selector, label, count)} type="button">{count.toLocaleString("en-IN")}<span className="sr-only"> {label}</span></button></td>)}
              <td className="px-3 py-3 font-semibold text-task-overdue">{formatTaskPerformanceScore(d.pendingScore)}</td>
              <td className="px-3 py-3 font-semibold text-task-overdue">{formatTaskPerformanceScore(d.delayedScore)}</td>
            </tr></tbody>
          </table>
        </div>
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${reconciled ? "bg-success/10 text-task-text" : "bg-task-overdue/10 text-task-overdue"}`}>
          {reconciled
            ? `Reconciled: ${d.completed.toLocaleString("en-IN")} completed + ${d.remaining.toLocaleString("en-IN")} remaining = ${d.assigned.toLocaleString("en-IN")} assigned (${s.work_items.toLocaleString("en-IN")} distinct tasks and FMS steps; shared work counts once per person).`
            : "These counts do not add up. Refresh; if it persists, report it."}
        </p>
        <div className="mt-3 border-t border-task-border pt-2">
          <p className="mb-1 px-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-task-text-muted">Outside the score</p>
          <Line label="Overdue from before this period (current backlog)" onClick={data.backlog.overdue_before_period ? () => onOpen("backlog", "Overdue from before this period", data.backlog.overdue_before_period) : undefined} value={data.backlog.overdue_before_period} />
          <Line label={`Not counted: rejected ${s.excluded_rejected}, skipped ${s.excluded_skipped}, stopped ${s.excluded_stopped}, cancelled runs ${s.excluded_cancelled_run}`} onClick={s.excluded ? () => onOpen("excluded", "Due in the period but not counted", s.excluded) : undefined} value={s.excluded} />
          <Line label="FMS start forms waiting (standing assignments, current)" value={data.pendingStartForms} />
        </div>
      </Panel>
      <Panel description="Click a segment for its records." title="Completed vs remaining">
        <Donut centerLabel="assigned" onSelect={(key) => onOpen(key, key === "completed" ? "Completed work" : key === "overdue" ? "Overdue work" : key === "pending" ? "Pending, not overdue" : "In progress or in review")} segments={completionSegments(s)} title="Completed vs remaining" total={s.assigned} />
      </Panel>
      <Panel description="Completed work only, by its deadline." title="On time vs delayed">
        <Donut centerLabel="completed" onSelect={(key) => onOpen(key, key === "on_time" ? "Completed on time" : key === "late" ? "Completed late" : "Completed without a recorded time")} segments={timingSegments(s)} title="On time vs delayed" total={d.completed} />
        <p className="mt-3 text-xs text-task-text-muted">
          {TASK_DELAYED_SCORE_LABEL}: <span className="font-semibold text-task-overdue">{formatTaskPerformanceScore(d.delayedScore)}</span>. The score is on time ÷ completed × 100 − 100; it is not the share of late completions.
        </p>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------------------------ personal

function PersonalWork({ filter, onOpen }: { filter: PerformanceFilter; onOpen: Open }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RecordPreview filter={filter} onOpen={onOpen} selector="remaining" title="My unfinished work" empty="Nothing left to do in this period." />
      <RecordPreview filter={filter} onOpen={onOpen} selector="completed" title="My completion history" empty="No completed work due in this period yet." />
    </div>
  );
}

function RecordPreview({ filter, selector, title, empty, onOpen }: { filter: PerformanceFilter; selector: PerformanceRecordSelector; title: string; empty: string; onOpen: Open }) {
  const key = JSON.stringify([filter, selector]);
  const load = useCallback((signal: AbortSignal) => fetchTaskPerformanceRecords({ filter, selector, limit: 8 }, signal), [filter, selector]);
  const { data, error, loading, refresh } = usePerformanceRequest(key, load);
  const fmt = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—");
  return (
    <Panel {...(data ? { description: `${data.total} in this period` } : {})} title={title}>
      {loading && !data ? <div className="skeleton h-40 rounded-xl" /> : null}
      {error ? <p className="text-sm" role="alert">{error} <button className="text-task-accent" onClick={() => void refresh()} type="button">Retry</button></p> : null}
      {data ? (
        data.rows.length ? (
          <ul className="grid gap-1.5">
            {data.rows.map((row) => {
              const path = performanceRecordPath(row);
              const body = (
                <>
                  <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={swatchStyle(row.bucket)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{row.title}</span>
                    <span className="block text-[0.6875rem] text-task-text-muted">Due {fmt(row.due)}{row.done_at ? ` · done ${fmt(row.done_at)}` : ""}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${row.bucket === "overdue" ? "font-semibold text-task-overdue" : row.bucket === "late" ? "text-warning" : "text-task-text-muted"}`}>{row.bucket.replaceAll("_", " ")}</span>
                </>
              );
              return <li key={`${row.work_id}:${row.person_id}`}>{path ? <a className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-task-muted" href={path}>{body}</a> : <div className="flex min-h-11 items-center gap-2 px-2">{body}</div>}</li>;
            })}
          </ul>
        ) : <p className="py-6 text-center text-sm text-task-text-muted">{empty}</p>
      ) : null}
      {data && data.total > data.rows.length ? <button className="mt-2 min-h-10 text-sm font-medium text-task-accent" onClick={() => onOpen(selector, title, data.total)} type="button">See all {data.total} &rarr;</button> : null}
    </Panel>
  );
}

// ------------------------------------------------------------------------------------ one employee

function EmployeeDetail({ employee, onClose, onOpen }: { employee: PerformanceEmployee; onClose: () => void; onOpen: Open }) {
  const d = performanceScores(employee);
  const narrow = { user_profile_id: employee.user_profile_id };
  const chips: Array<[PerformanceRecordSelector, string, number]> = [
    ["assigned", "All", d.assigned], ["pending", "Pending", d.pending], ["in_progress", "In progress", d.inProgress], ["overdue", "Overdue", d.overdue],
    ["completed", "Completed", d.completed], ["on_time", "On time", d.onTime], ["late", "Delayed", d.late],
  ];
  return (
    <section aria-label={`${employee.employee_name} performance`} className="scroll-mt-24 rounded-2xl border border-task-accent/40 bg-task-bg p-4 shadow-card duration-200 animate-in fade-in" id="employee-detail">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-task-text-muted">Employee detail</p>
          <h2 className="text-lg font-semibold">{employee.employee_name}</h2>
          <p className="text-xs text-task-text-muted">{[employee.branch_name, employee.department_name].filter(Boolean).join(" · ")}</p>
        </div>
        <button className="min-h-10 rounded-lg border border-task-border px-3 text-sm" onClick={onClose} type="button">Close</button>
      </header>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi hint="Due in period" label="Assigned" value={String(d.assigned)} />
        <Kpi hint="Pending, in progress, overdue" label="Not done" value={String(d.remaining)} />
        <Kpi hint="Completed ÷ assigned × 100 − 100" label={TASK_PENDING_SCORE_LABEL} tone={d.pendingScore === null ? undefined : "score"} value={formatTaskPerformanceScore(d.pendingScore)} />
        <Kpi hint="On time ÷ completed × 100 − 100" label={TASK_DELAYED_SCORE_LABEL} tone={d.delayedScore === null ? undefined : "score"} value={formatTaskPerformanceScore(d.delayedScore)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map(([selector, label, count]) => (
          <button className="inline-flex min-h-10 items-center gap-2 rounded-full border border-task-border px-3 text-sm hover:border-task-accent disabled:opacity-50" disabled={!count} key={selector} onClick={() => onOpen(selector, `${employee.employee_name} · ${label}`, count, narrow)} type="button">
            <span aria-hidden className="size-2.5 rounded-sm" style={swatchStyle(selector === "assigned" ? "due" : selector)} />
            {label}<span className="tabular-nums font-semibold">{count}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-task-text-muted">Each list shows the task or FMS step, its status, deadline, completion time, how long it is overdue or how late it was, and opens the work itself.</p>
    </section>
  );
}

// ------------------------------------------------------------------------------------ comparisons

const PERSON_SEGMENTS = [["on_time", "On time"], ["late", "Late"], ["completed_untimed", "No completion time"], ["in_progress", "In progress"], ["pending", "Pending"], ["overdue", "Overdue"]] as const;

function stacked(row: PerformanceCounts) {
  return PERSON_SEGMENTS.map(([key, label]) => ({ key, label, value: row[key] }));
}

function trendLabel(point: PerformanceTrendPoint, granularity: string): string {
  const date = new Date(`${point.bucket_start}T00:00:00+05:30`);
  if (granularity === "month") return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "Asia/Kolkata" });
  const day = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  return granularity === "week" ? `w/c ${day}` : day;
}

function Comparisons({ data, filter, onOpen, onGranularity }: { data: PerformancePayload; filter: PerformanceFilter; onOpen: Open; onGranularity: (g: "day" | "week" | "month") => void }) {
  const [allPeople, setAllPeople] = useState(false);
  const team = filter.scope === "team";
  const ranked = useMemo(() => performanceAttentionOrder(data.employees.filter((e) => e.assigned > 0)), [data.employees]);
  const people = allPeople ? ranked : ranked.slice(0, 12);
  const personRows: StackedRow[] = people.map((e) => ({ id: e.user_profile_id, label: e.employee_name, sublabel: e.branch_name ?? undefined, segments: stacked(e) }));
  const byId = new Map(data.employees.map((e) => [e.user_profile_id, e]));
  const openPerson = (id: string, key: PerformanceRecordSelector) => {
    const person = byId.get(id);
    onOpen(key, person?.employee_name ?? "Employee", person ? selectorCount(person, key) : undefined, { user_profile_id: id });
  };
  const scoreRows = (pick: "pendingScore" | "delayedScore") =>
    ranked.map((e) => ({ id: e.user_profile_id, label: e.employee_name, score: performanceScores(e)[pick], basis: `${performanceScores(e).completed} of ${e.assigned} completed` }))
      .sort((a, b) => (a.score ?? 1) - (b.score ?? 1)).slice(0, allPeople ? undefined : 12);
  const flowRows: StackedRow[] = data.flows.filter((f) => f.assigned > 0).map((f) => ({ id: f.flow_id, label: f.flow_name, sublabel: `${f.visits} visits`, segments: stacked(f) }));
  const rollupRows = (rows: PerformancePayload["branches"], prefix: string): StackedRow[] => rows.map((r) => ({ id: `${prefix}:${r.id ?? "none"}`, label: r.name, segments: stacked(r) }));
  const legend = <Legend items={PERSON_SEGMENTS} />;
  // Branch/department bars narrow the same filter; "No branch/department" rows cannot be
  // expressed as a filter, so their segments open nothing rather than a wrong list.
  const openRollup = (rows: PerformancePayload["branches"], id: string, key: PerformanceRecordSelector, field: "branch_id" | "department_id") => {
    const raw = id.slice(2);
    const row = rows.find((r) => (r.id ?? "none") === raw);
    if (!row || !row.id) return;
    onOpen(key, row.name, selectorCount(row, key), field === "branch_id" ? { branch_id: row.id, department_id: undefined, user_profile_id: undefined } : { department_id: row.id, user_profile_id: undefined });
  };

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Panel description={`Assigned work by deadline (${data.granularity}). Cohort measure: each bar is work due in that ${data.granularity}, split by its outcome now.`} title="Task trend">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Legend items={[["on_time", "On time"], ["late", "Late"], ["completed_untimed", "No completion time"], ["remaining", "Remaining"]]} />
          <div className="flex gap-1 rounded-lg bg-task-muted p-0.5" role="group" aria-label="Trend interval">
            {(["day", "week", "month"] as const).map((g) => (
              <button aria-pressed={data.granularity === g} className={`min-h-8 rounded-md px-2.5 text-xs capitalize ${data.granularity === g ? "bg-task-bg font-semibold shadow-card" : "text-task-text-muted"}`} key={g} onClick={() => onGranularity(g)} type="button">{g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}</button>
            ))}
          </div>
        </div>
        <TrendColumns columns={data.trend.map((p) => ({ label: trendLabel(p, data.granularity), title: trendLabel(p, data.granularity), segments: [{ key: "on_time", label: "On time", value: p.on_time }, { key: "late", label: "Late", value: p.late }, { key: "completed_untimed", label: "No completion time", value: p.completed_untimed }, { key: "remaining", label: "Remaining", value: p.remaining }] }))} />
        <details className="mt-3">
          <summary className="min-h-10 cursor-pointer text-xs text-task-text-muted">Exact values</summary>
          <table className="mt-1 w-full text-xs tabular-nums">
            <thead className="text-task-text-muted"><tr><th className="text-left font-medium">Period</th><th className="text-right font-medium">Due</th><th className="text-right font-medium">On time</th><th className="text-right font-medium">Late</th><th className="text-right font-medium">Remaining</th></tr></thead>
            <tbody>{data.trend.map((p) => <tr className="border-t border-task-border" key={p.bucket_start}><td>{trendLabel(p, data.granularity)}</td><td className="text-right">{p.due}</td><td className="text-right">{p.on_time}</td><td className="text-right">{p.late}</td><td className="text-right">{p.remaining}</td></tr>)}</tbody>
          </table>
        </details>
      </Panel>
      <Panel description="Assignments per workflow by outcome. Click a segment for its records." title="FMS comparison">
        <div className="mb-3">{legend}</div>
        <StackedBars empty="No FMS step work due in this period." onSelect={(id, key) => { const flow = data.flows.find((f) => f.flow_id === id); onOpen(key, flow?.flow_name ?? "Workflow", flow ? selectorCount(flow, key) : undefined, { flow_id: id, kind: "fms" }); }} rows={flowRows} />
      </Panel>
      {team ? (
        <>
          <Panel className="xl:col-span-2" description="Each bar is one person's assigned work, by outcome, on one shared scale. Worst first. Click a segment for that person's records." title="Employee performance comparison">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{legend}{ranked.length > 12 ? <button className="min-h-9 text-xs font-medium text-task-accent" onClick={() => setAllPeople(!allPeople)} type="button">{allPeople ? "Show top 12" : `Show all ${ranked.length}`}</button> : null}</div>
            <StackedBars onSelect={openPerson} rows={personRows} />
          </Panel>
          <Panel description="Completed ÷ assigned × 100 − 100. 0 is everything done; −100 is nothing done." title={`${TASK_PENDING_SCORE_LABEL} by employee`}>
            <ScoreBars onSelect={(id) => openPerson(id, "remaining")} rows={scoreRows("pendingScore")} />
          </Panel>
          <Panel description="On time ÷ completed × 100 − 100. Nothing completed reads −100." title={`${TASK_DELAYED_SCORE_LABEL} by employee`}>
            <ScoreBars onSelect={(id) => openPerson(id, "late")} rows={scoreRows("delayedScore")} />
          </Panel>
          {data.branches.length > 1 ? (
            <Panel description="Assignments grouped by each employee's branch." title="By branch">
              <StackedBars onSelect={(id, key) => openRollup(data.branches, id, key, "branch_id")} rows={rollupRows(data.branches, "b")} />
            </Panel>
          ) : null}
          {data.departments.length > 1 ? (
            <Panel description="Assignments grouped by each employee's department." title="By department">
              <StackedBars onSelect={(id, key) => openRollup(data.departments, id, key, "department_id")} rows={rollupRows(data.departments, "d")} />
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
