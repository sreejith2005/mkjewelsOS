import {
  formatTaskPerformanceScore,
  performanceReconciles,
  performanceScores,
  PERFORMANCE_SELECTOR_LABELS,
  selectorCount,
  timingSegments,
  TASK_DELAYED_SCORE_LABEL,
  TASK_PENDING_SCORE_LABEL,
  type PerformanceFilter,
  type PerformancePayload,
  type PerformanceRecordSelector,
} from "@jewelos/core";
import { Panel } from "../components";
import { Donut } from "./charts";

type Open = (selector: PerformanceRecordSelector, title: string, expected?: number, narrow?: Partial<PerformanceFilter>) => void;
const number = (value: number) => value.toLocaleString("en-IN");
const share = (value: number, total: number, basis: string) => total > 0 ? `${(value / total * 100).toFixed(1)}% ${basis}` : "No data";

function Cell({ label, value, hint, onClick, tone = "neutral" }: {
  label: string; value: number | string; hint: string; onClick?: (() => void) | undefined; tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const color = value === 0 || value === "No data" ? "text-task-text-muted" : tone === "good" ? "text-success" : tone === "bad" ? "text-task-overdue" : tone === "warn" ? "text-warning" : "text-task-text";
  const formatted = typeof value === "number" ? number(value) : value;
  const body = <><span className="block text-[0.6875rem] font-semibold leading-snug text-task-text">{label}</span><span className={`my-1 block text-2xl font-semibold leading-tight tabular-nums ${color}`}>{formatted}</span><span className="block text-[0.6875rem] leading-snug text-task-text-muted">{hint}</span></>;
  return <td className={`border-l border-task-border align-middle ${tone === "good" ? "bg-success/5" : tone === "bad" ? "bg-task-overdue/5" : tone === "warn" ? "bg-warning/5" : "bg-task-bg"}`}>
    {onClick ? <button aria-label={`${formatted} ${label}`} className="min-h-28 w-full px-2 py-3 text-center transition-colors hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent" onClick={onClick} type="button">{body}</button> : <div className="px-2 py-3 text-center">{body}</div>}
  </td>;
}

function Columns() { return <colgroup><col className="w-[24%]" /><col /><col /><col /></colgroup>; }

export function LifecycleMatrix({ data, onOpen }: { data: PerformancePayload; onOpen: Open }) {
  const s = data.summary;
  const d = performanceScores(s);
  const open = (key: PerformanceRecordSelector, title = PERFORMANCE_SELECTOR_LABELS[key]) => onOpen(key, title, selectorCount(s, key));
  const rowHeader = "sticky left-0 z-10 bg-task-accent-soft px-3 py-4 text-center text-xs font-bold tracking-wide";
  return <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
    <Panel className="min-w-0 lg:col-span-2 2xl:col-span-1" description="Task and FMS assignments due in this period. Click a value for its records." title="Task work lifecycle">
      <p className="mb-2 text-xs text-task-text-muted md:hidden">Swipe across the table for all measures →</p>
      <div aria-label="Scroll task work lifecycle" className="overflow-x-auto rounded-xl border border-task-border" role="region" tabIndex={0}>
        <table aria-label="Task work lifecycle" className="w-full min-w-[32rem] table-fixed text-sm">
          <Columns />
          <thead className="bg-task-accent-soft text-xs font-bold tracking-wide text-task-text"><tr><th aria-label="Work measure" className="sticky left-0 z-10 bg-task-accent-soft" scope="col" />{["TOTAL", "COMPLETED", "PENDING %"].map(label => <th className="px-2 py-4 text-center" key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            <tr className="border-t border-task-border">
              <th className={rowHeader} scope="row">TASK COUNT</th>
              <Cell hint={d.assigned ? "100% of total tasks" : "No assignments due"} label="Total Task" onClick={() => open("assigned")} value={d.assigned} />
              <Cell hint={share(d.completed, d.assigned, "of total tasks")} label="Completed" onClick={() => open("completed")} tone="good" value={d.completed} />
              <Cell hint={`${number(d.remaining)} tasks`} label="Task Not Done" onClick={() => open("remaining")} tone={d.pendingScore === 0 ? "good" : "bad"} value={formatTaskPerformanceScore(d.pendingScore)} />
            </tr>
            <tr className="border-t border-task-border">
              <th className={rowHeader} scope="row">COMPLETION</th>
              <Cell hint={share(d.completed, d.assigned, "of total tasks")} label="Completed" onClick={() => open("completed")} tone="good" value={d.completed} />
              <Cell hint={share(d.onTime, d.completed, "of completed")} label="On Time" onClick={() => open("on_time")} tone="good" value={d.onTime} />
              <Cell hint={`${number(d.late)} late${d.untimed ? `; ${number(d.untimed)} timing unknown` : " tasks"}`} label="Delayed" onClick={() => open("late")} tone={d.delayedScore === 0 ? "good" : "bad"} value={formatTaskPerformanceScore(d.delayedScore)} />
            </tr>
          </tbody>
        </table>
      </div>
      <div aria-label="Scroll pending work breakdown" className="mt-3 overflow-x-auto rounded-xl border border-task-border" role="region" tabIndex={0}>
        <table aria-label="Pending work breakdown" className="w-full min-w-[32rem] table-fixed text-sm">
          <Columns /><tbody><tr>
            <th className={rowHeader} scope="row">PENDING</th>
            <Cell hint="Before the deadline" label="Pending, not overdue" onClick={() => open("pending")} tone="warn" value={d.pending} />
            <Cell hint="In progress or in review, before deadline" label="In Progress" onClick={() => open("in_progress")} tone="warn" value={d.inProgress} />
            <Cell hint="Still open past the deadline" label="Overdue" onClick={() => open("overdue")} tone="bad" value={d.overdue} />
          </tr></tbody>
        </table>
      </div>
      {d.untimed ? <p className="mt-3 text-xs leading-relaxed text-task-text-muted"><button aria-label={`${number(d.untimed)} No completion time`} className="min-h-11 font-medium text-task-accent hover:underline" onClick={() => open("completed_untimed")} type="button">{number(d.untimed)} completed with no completion time →</button> Included in Completed; timing cannot be classified. The Delayed score includes all completions in its denominator.</p> : null}
      {!performanceReconciles(s) ? <p className="mt-3 rounded-lg bg-task-overdue/10 px-3 py-2 text-xs text-task-overdue" role="alert">These counts do not add up. Refresh; if it persists, report it.</p> : null}
      <details className="mt-3 text-xs text-task-text-muted">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">Counting rules &amp; excluded work</summary>
        <div className="space-y-2 border-t border-task-border pt-3 leading-relaxed">
          <p>One assignment is one person on a task or FMS step. Shared work counts once per person. {number(s.work_items)} distinct tasks and FMS steps are represented. The deadline determines the period; Completed includes work finished at any time.</p>
          <p>Task Not Done ({TASK_PENDING_SCORE_LABEL} %) = completed ÷ total tasks × 100 − 100. Delayed ({TASK_DELAYED_SCORE_LABEL} %) = on time ÷ completed × 100 − 100. Zero is best; no assigned work shows No data; assigned work with no completions scores −100.</p>
          <p>Pending in the chart and Task Not Done count all unfinished assignments: pending before deadline + in progress + overdue. The PENDING strip shows these separate parts of unfinished work.</p>
          <p>Outside the score: rejected {number(s.excluded_rejected)}, skipped {number(s.excluded_skipped)}, stopped {number(s.excluded_stopped)}, cancelled runs {number(s.excluded_cancelled_run)}.</p>
          {s.excluded ? <button className="min-h-11 font-medium text-task-accent hover:underline" onClick={() => onOpen("excluded", "Due in the period but not counted", s.excluded)} type="button">Inspect {number(s.excluded)} excluded assignments →</button> : null}
        </div>
      </details>
    </Panel>
    <Panel className="min-w-0" description="All assigned work, split into completed and unfinished assignments." title="Completed vs Pending">
      <Donut centerLabel="Total Task" onSelect={key => open(key)} segments={[{key:"completed",label:"Completed",value:d.completed},{key:"remaining",label:"Pending",value:d.remaining}]} title="Completed vs Pending" total={d.assigned} variant="ring" />
    </Panel>
    <Panel className="min-w-0" description="Completed assignments only. Unknown completion times stay separate." title="On-Time vs Delayed">
      <Donut centerLabel="Completed" onSelect={key => open(key)} segments={timingSegments(s).map(segment => ({...segment,label:segment.key === "on_time" ? "On Time" : segment.key === "late" ? "Delayed" : segment.label}))} title="On-Time vs Delayed" total={d.completed} variant="ring" />
    </Panel>
  </div>;
}
