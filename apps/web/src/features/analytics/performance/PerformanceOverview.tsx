import {
  formatTaskPerformanceScore,
  performanceAttentionOrder,
  performanceReconciles,
  performanceScores,
  TASK_DELAYED_SCORE_LABEL,
  TASK_PENDING_SCORE_LABEL,
  type PerformanceFilter,
  type PerformancePayload,
  type PerformanceRecordSelector,
} from "@jewelos/core";
import { Panel } from "../components";

type Open = (selector: PerformanceRecordSelector, title: string, expected?: number, narrow?: Partial<PerformanceFilter>) => void;
const number = (value: number) => value.toLocaleString("en-IN");

function Count({ value, label, onClick, tone = "neutral", large = false }: {
  value: number; label: string; onClick: () => void; tone?: "neutral" | "good" | "warn" | "bad"; large?: boolean;
}) {
  const color = value === 0 ? "text-task-text-muted" : tone === "bad" ? "text-task-overdue" : tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-task-text";
  return (
    <button aria-label={`${number(value)} ${label}`} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-left hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent ${color}`} onClick={onClick} type="button">
      <span className={`font-semibold tabular-nums ${large ? "text-2xl" : "text-sm"}`}>{number(value)}</span>
      {large ? null : <span className="text-xs text-task-text-muted">{label}</span>}
    </button>
  );
}

function Score({ label, value }: { label: string; value: number | null }) {
  return <div className="space-y-1"><p className="text-xs text-task-text-muted">{label} %</p><p className={`text-lg font-semibold tabular-nums ${value === null ? "text-task-text-muted" : value < 0 ? "text-task-overdue" : "text-success"}`}>{formatTaskPerformanceScore(value)}</p></div>;
}

export function PerformanceOverview({ data, onOpen }: { data: PerformancePayload; onOpen: Open }) {
  const s = data.summary;
  const d = performanceScores(s);
  const reconciled = performanceReconciles(s);
  const count = (selector: PerformanceRecordSelector, label: string, value: number, tone: "neutral" | "good" | "warn" | "bad" = "neutral", large = false) =>
    <Count label={label} large={large} onClick={() => onOpen(selector, label, value)} tone={tone} value={value} />;

  return (
    <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,1fr)]">
      <Panel description="Work due in the selected period. Click a count to inspect its assignments." title="Task work lifecycle">
        <p className="mb-2 text-xs text-task-text-muted md:hidden">Swipe across the table for breakdowns and scores →</p>
        <div aria-label="Scroll task work lifecycle" className="overflow-x-auto rounded-xl border border-task-border" role="region" tabIndex={0}>
          <table aria-label="Task work lifecycle" className="w-full min-w-[38rem] text-left text-sm">
            <thead className="bg-task-muted text-xs text-task-text-muted">
              <tr>{["Work measure", "Assignments", "Breakdown", "Performance"].map((label) => <th className="px-3 py-3 font-semibold" key={label} scope="col">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-task-border">
              <tr>
                <th className="px-3 py-4 align-top font-medium" scope="row">Assigned work</th>
                <td className="px-1 py-2 align-top">{count("assigned", "All assigned work", d.assigned, "neutral", true)}</td>
                <td className="px-3 py-4 text-xs leading-relaxed text-task-text-muted">Tasks and FMS steps.<br />Shared work counts once per person.</td>
                <td className="px-3 py-4 text-xs leading-relaxed text-task-text-muted">Completed + unfinished<br />must equal assigned.</td>
              </tr>
              <tr>
                <th className="px-3 py-4 align-top font-medium" scope="row">Completed</th>
                <td className="px-1 py-2 align-top">{count("completed", "Completed work", d.completed, "good", true)}</td>
                <td className="px-1 py-2"><div className="flex flex-wrap gap-x-2">{count("on_time", "On time", d.onTime, "good")}{count("late", "Late", d.late, "warn")}{d.untimed ? count("completed_untimed", "No completion time", d.untimed, "warn") : null}</div></td>
                <td className="px-3 py-4"><Score label={TASK_DELAYED_SCORE_LABEL} value={d.delayedScore} /></td>
              </tr>
              <tr>
                <th className="px-3 py-4 align-top font-medium" scope="row">Unfinished</th>
                <td className="px-1 py-2 align-top">{count("remaining", "Unfinished work", d.remaining, "neutral", true)}</td>
                <td className="px-1 py-2"><div className="flex flex-wrap gap-x-2">{count("pending", "Pending, not overdue", d.pending)}{count("in_progress", "In progress", d.inProgress)}{count("overdue", "Overdue", d.overdue, "bad")}</div></td>
                <td className="px-3 py-4"><Score label={TASK_PENDING_SCORE_LABEL} value={d.pendingScore} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        {!reconciled ? <p className="mt-3 rounded-lg bg-task-overdue/10 px-3 py-2 text-xs text-task-overdue" role="alert">These counts do not add up. Refresh; if it persists, report it.</p> : null}
        <details className="mt-3 text-xs text-task-text-muted">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">Counting rules &amp; excluded work</summary>
          <div className="space-y-2 border-t border-task-border pt-3 leading-relaxed">
            <p>Each assignment belongs to one breakdown category. Completed includes work finished at any time; the deadline determines the period. {number(s.work_items)} distinct tasks and FMS steps are represented.</p>
            <p>{TASK_PENDING_SCORE_LABEL} % = completed ÷ assigned × 100 − 100. {TASK_DELAYED_SCORE_LABEL} % = on time ÷ completed × 100 − 100. Zero is best; nothing assigned shows No data; assigned work with nothing completed scores −100.</p>
            <p>Outside the score: rejected {number(s.excluded_rejected)}, skipped {number(s.excluded_skipped)}, stopped {number(s.excluded_stopped)}, cancelled runs {number(s.excluded_cancelled_run)}.</p>
            {s.excluded ? <button className="min-h-11 font-medium text-task-accent hover:underline" onClick={() => onOpen("excluded", "Due in the period but not counted", s.excluded)} type="button">Inspect {number(s.excluded)} excluded assignments →</button> : null}
          </div>
        </details>
      </Panel>
      <Attention data={data} onOpen={onOpen} />
    </div>
  );
}

function Attention({ data, onOpen }: { data: PerformancePayload; onOpen: Open }) {
  const people = data.scope === "team" ? performanceAttentionOrder(data.employees.filter((row) => row.overdue > 0)).slice(0, 2) : [];
  const flows = performanceAttentionOrder(data.flows.filter((row) => row.overdue > 0).map((row) => ({ ...row, employee_name: row.flow_name }))).slice(0, 2);
  const followUpClass = "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent";
  return (
    <section aria-label="Needs attention" className="min-w-0">
      <Panel description="Start with older backlog, then follow up on overdue work due in this period." title="Needs attention">
        <div className="space-y-3">
          {data.backlog.overdue_before_period > 0 ? <button className="w-full rounded-xl border border-task-overdue/25 bg-task-overdue/5 p-3 text-left hover:border-task-overdue/50 focus-visible:outline-task-accent" onClick={() => onOpen("backlog", "Overdue from before this period", data.backlog.overdue_before_period)} type="button">
            <span className="text-2xl font-semibold tabular-nums text-task-overdue">{number(data.backlog.overdue_before_period)}</span>
            <span className="ml-2 text-sm font-medium">Older overdue assignments</span>
            <span className="mt-1 block text-xs leading-relaxed text-task-text-muted">Deadlines before {data.from}; still open now. Outside this period’s scores. Review backlog →</span>
          </button> : <p className="text-xs text-task-text-muted">No older overdue assignments.</p>}
          {people.length ? <div aria-label="Employee follow-up" className="border-t border-task-border pt-3" role="group">
            <p className="mb-1 px-2 text-xs font-semibold">Employee follow-up</p>
            {people.map((person) => <button className={followUpClass} key={person.user_profile_id} onClick={() => onOpen("overdue", `${person.employee_name} · Overdue work`, person.overdue, { user_profile_id: person.user_profile_id })} type="button">
              <span className="min-w-0"><span className="block break-words text-sm font-medium">{person.employee_name}</span><span className="block text-xs text-task-text-muted">{[person.branch_name, person.department_name].filter(Boolean).join(" · ")}</span></span><span className="shrink-0 text-xs text-task-accent">Review overdue →</span>
            </button>)}
          </div> : null}
          {flows.length ? <div aria-label="Workflow follow-up" className="border-t border-task-border pt-3" role="group">
            <p className="mb-1 px-2 text-xs font-semibold">Workflow follow-up</p>
            {flows.map((flow) => <button className={followUpClass} key={flow.flow_id} onClick={() => onOpen("overdue", `${flow.flow_name} · Overdue work`, flow.overdue, { flow_id: flow.flow_id, kind: "fms" })} type="button"><span className="min-w-0 break-words text-sm font-medium">{flow.flow_name}</span><span className="shrink-0 text-xs text-task-accent">Review overdue →</span></button>)}
          </div> : null}
          {people.length || flows.length ? <p className="text-xs text-task-text-muted">Highest overdue counts first. Use the tables below for the full comparison.</p> : null}
          {data.pendingStartForms > 0 ? <p className="border-t border-task-border pt-3 text-xs leading-relaxed text-task-text-muted"><span className="font-semibold text-task-text">{number(data.pendingStartForms)} FMS start forms waiting.</span> Current standing assignments; outside the period’s scores.</p> : null}
        </div>
      </Panel>
    </section>
  );
}
