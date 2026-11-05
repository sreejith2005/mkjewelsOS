import { useCallback, useEffect, useRef, useState } from "react";
import {
  fmsAssignedWorkPath,
  formatMinutes,
  PERFORMANCE_SELECTOR_LABELS,
  TASK_WORK_KIND_LABELS,
  type PerformanceFilter,
  type PerformanceRecord,
  type PerformanceRecordSelector,
  type TaskWorkKind,
} from "@jewelos/core";
import { fetchTaskPerformanceRecords } from "@jewelos/data/analytics/index";
import { usePerformanceRequest } from "./usePerformanceRequest";
import { swatchStyle } from "./charts";

const PAGE = 25;
const when = (value: string | null) =>
  value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "—";

/** The existing task and FMS work links; no new route. */
export function performanceRecordPath(row: PerformanceRecord): string | null {
  if (row.instance_id) return fmsAssignedWorkPath({ kind: "stage", instanceId: row.instance_id, instanceStageId: row.stage_id ?? null });
  if (row.task_id) return `/tasks?task_id=${encodeURIComponent(row.task_id)}`;
  return null;
}

const EXCLUDED_LABELS: Readonly<Record<string, string>> = {
  rejected: "Rejected",
  skipped: "Skipped by a workflow condition",
  stopped: "Stopped when the workflow closed",
  cancelled_run: "Workflow run cancelled",
};

export type RecordsSelection = {
  filter: PerformanceFilter;
  selector: PerformanceRecordSelector;
  title: string;
  stageKey?: string | undefined;
  expected?: number | undefined;
};

export function RecordsDrawer({ selection, onClose }: { selection: RecordsSelection; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [selection]);
  const key = JSON.stringify([selection.filter, selection.selector, selection.stageKey ?? null, offset]);
  const load = useCallback(
    (signal: AbortSignal) => fetchTaskPerformanceRecords({ filter: selection.filter, selector: selection.selector, stageKey: selection.stageKey, offset, limit: PAGE }, signal),
    [selection, offset],
  );
  const { data, error, loading, refresh } = usePerformanceRequest(key, load);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  // The list is read with the same filter as the count that opened it; a mismatch means the
  // data moved in between (realtime), and the reader is told rather than shown a silent gap.
  const moved = data && selection.expected !== undefined && data.total !== selection.expected;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-obsidian/50" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        aria-label={selection.title}
        aria-modal="true"
        className="flex h-full w-full max-w-2xl flex-col bg-task-bg text-task-text shadow-xl duration-200 animate-in slide-in-from-right"
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-task-border p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-task-text-muted">{PERFORMANCE_SELECTOR_LABELS[selection.selector]}</p>
            <h2 className="mt-0.5 break-words font-semibold">{selection.title}</h2>
            <p className="text-xs text-task-text-muted" aria-live="polite">
              {data ? `${data.total.toLocaleString("en-IN")} assignment${data.total === 1 ? "" : "s"}` : "Loading…"} · {selection.filter.from} to {selection.filter.to}
            </p>
            {moved ? <p className="mt-1 text-xs text-warning">Work changed since the count was loaded ({selection.expected}). Refresh the dashboard to update it.</p> : null}
          </div>
          <button className="min-h-11 shrink-0 rounded-lg border border-task-border px-3 text-sm" onClick={onClose} ref={close} type="button">Close</button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading && !data ? Array.from({ length: 5 }, (_, i) => <div className="skeleton h-20 rounded-xl" key={i} />) : null}
          {error ? (
            <div className="rounded-xl border border-task-overdue/40 p-4" role="alert">
              <p className="text-sm">{error}</p>
              <button className="mt-2 min-h-11 text-sm font-medium text-task-accent" onClick={() => void refresh()} type="button">Retry</button>
            </div>
          ) : null}
          {data?.rows.map((row) => {
            const path = performanceRecordPath(row);
            const kind = TASK_WORK_KIND_LABELS[row.work_kind as TaskWorkKind] ?? row.work_kind;
            return (
              <article className="rounded-xl border border-task-border p-3.5" key={`${row.work_id}:${row.person_id}`}>
                <div className="flex items-start gap-2">
                  <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-sm" style={swatchStyle(row.bucket === "excluded" ? "due" : row.bucket)} />
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-sm font-medium">{row.title}</h3>
                    <p className="mt-0.5 text-xs text-task-text-muted">
                      {kind}
                      {row.reference_number ? ` · ${row.reference_number}` : ""}
                      {row.employee_name ? ` · ${row.employee_name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-task-muted px-2 py-0.5 text-[0.6875rem] capitalize">{row.status.replaceAll("_", " ")}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div><dt className="text-task-text-muted">Due</dt><dd className="tabular-nums">{when(row.due)}</dd></div>
                  <div><dt className="text-task-text-muted">Completed</dt><dd className="tabular-nums">{when(row.done_at)}</dd></div>
                  {row.overdue_minutes !== null ? <div><dt className="text-task-text-muted">Overdue by</dt><dd className="font-semibold text-task-overdue">{formatMinutes(row.overdue_minutes)}</dd></div> : null}
                  {row.delay_minutes !== null ? <div><dt className="text-task-text-muted">Late by</dt><dd className="font-semibold text-warning">{formatMinutes(row.delay_minutes)}</dd></div> : null}
                  {row.excluded_reason ? <div className="col-span-2"><dt className="text-task-text-muted">Not counted</dt><dd>{EXCLUDED_LABELS[row.excluded_reason] ?? row.excluded_reason}</dd></div> : null}
                </dl>
                {path ? <a className="mt-2 inline-flex min-h-10 items-center text-sm font-medium text-task-accent" href={path}>Open {row.instance_id ? "FMS step" : "task"} &rarr;</a> : null}
              </article>
            );
          })}
          {data && !data.rows.length && !loading ? <p className="py-8 text-center text-sm text-task-text-muted">No matching assignments.</p> : null}
        </div>
        <footer className="flex items-center justify-between border-t border-task-border p-3">
          <button className="min-h-11 px-3 text-sm disabled:opacity-40" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))} type="button">Previous</button>
          <span className="text-xs tabular-nums text-task-text-muted">{data && data.total ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${data.total}` : ""}</span>
          <button className="min-h-11 px-3 text-sm disabled:opacity-40" disabled={loading || !data || offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)} type="button">Next</button>
        </footer>
      </section>
    </div>
  );
}
