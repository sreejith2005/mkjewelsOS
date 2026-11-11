import {
  performanceAttentionOrder,
  type PerformanceFilter,
  type PerformancePayload,
  type PerformanceRecordSelector,
} from "@jewelos/core";
import { Panel } from "../components";
import { LifecycleMatrix } from "./LifecycleMatrix";

type Open = (selector: PerformanceRecordSelector, title: string, expected?: number, narrow?: Partial<PerformanceFilter>) => void;
const number = (value: number) => value.toLocaleString("en-IN");

export function PerformanceOverview({ data, onOpen }: { data: PerformancePayload; onOpen: Open }) {
  return <div className="min-w-0 space-y-4"><LifecycleMatrix data={data} onOpen={onOpen} /><Attention data={data} onOpen={onOpen} /></div>;
}

function Attention({ data, onOpen }: { data: PerformancePayload; onOpen: Open }) {
  const people = data.scope === "team" ? performanceAttentionOrder(data.employees.filter((row) => row.overdue > 0)).slice(0, 2) : [];
  const flows = performanceAttentionOrder(data.flows.filter((row) => row.overdue > 0).map((row) => ({ ...row, employee_name: row.flow_name }))).slice(0, 2);
  const followUpClass = "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent";
  return (
    <section aria-label="Needs attention" className="min-w-0">
      <Panel description="Start with older backlog, then follow up on overdue work due in this period." title="Needs attention">
        <div className="grid items-start gap-3 md:grid-cols-3">
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
          {people.length || flows.length ? <p className="text-xs text-task-text-muted md:col-span-3">Highest overdue counts first. Use the tables below for the full comparison.</p> : null}
          {data.pendingStartForms > 0 ? <p className="border-t border-task-border pt-3 text-xs leading-relaxed text-task-text-muted md:col-span-3"><span className="font-semibold text-task-text">{number(data.pendingStartForms)} FMS start forms waiting.</span> Current standing assignments; outside the period’s scores.</p> : null}
        </div>
      </Panel>
    </section>
  );
}
