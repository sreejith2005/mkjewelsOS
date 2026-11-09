import { useCallback, useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import {
  formatTaskPerformanceScore,
  performanceAttentionOrder,
  performanceScores,
  TASK_DELAYED_SCORE_LABEL,
  TASK_PENDING_SCORE_LABEL,
  type PerformanceFilter,
  type PerformanceFlow,
  type PerformanceRecordSelector,
  type PerformanceStage,
} from "@jewelos/core";
import { fetchTaskPerformanceStages } from "@jewelos/data/analytics/index";
import { usePerformanceRequest } from "./usePerformanceRequest";

type Open = (selector: PerformanceRecordSelector, title: string, count: number, flowId: string, stageKey?: string) => void;

function Count({ value, onClick, tone }: { value: number; onClick: () => void; tone?: "bad" | "good" | "warn" }) {
  const color = value === 0 ? "text-task-text-muted" : tone === "bad" ? "font-semibold text-task-overdue" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : "";
  return value > 0 ? (
    <button className={`min-h-8 min-w-8 rounded-md px-1.5 tabular-nums hover:bg-task-accent-soft hover:underline ${color}`} onClick={onClick} type="button">{value.toLocaleString("en-IN")}</button>
  ) : <span className={`px-1.5 tabular-nums ${color}`}>0</span>;
}

export function FmsPerformance({ flows, filter, onOpen }: { flows: PerformanceFlow[]; filter: PerformanceFilter; onOpen: Open }) {
  const [selected, setSelected] = useState<PerformanceFlow | null>(null);
  const ranked = useMemo(() => performanceAttentionOrder(flows.map((flow) => ({ ...flow, employee_name: flow.flow_name }))), [flows]);
  if (!flows.length) return <p className="py-6 text-center text-sm text-task-text-muted">No FMS workflows with work in this scope.</p>;
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-xl border border-task-border">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead className="bg-task-muted text-[0.6875rem] uppercase tracking-wider text-task-text-muted">
            <tr>
              {["FMS", "Step assignments", "Done", "Pending", "In progress", "Overdue", "On time", "Delayed", TASK_PENDING_SCORE_LABEL, TASK_DELAYED_SCORE_LABEL, ""].map((label, index) => (
                <th className={`whitespace-nowrap px-2.5 py-2 font-semibold ${index > 0 ? "text-right" : "sticky left-0 z-10 min-w-48 bg-task-muted"}`} key={label || index} scope="col">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((flow) => {
              const d = performanceScores(flow);
              const open = (selector: PerformanceRecordSelector, label: string, count: number) => onOpen(selector, `${flow.flow_name} · ${label}`, count, flow.flow_id);
              return (
                <tr className={`border-t border-task-border ${selected?.flow_id === flow.flow_id ? "bg-task-accent-soft/60" : "hover:bg-task-muted/60"}`} key={flow.flow_id}>
                  <th className="sticky left-0 z-10 min-w-48 max-w-64 bg-task-bg px-2.5 py-2 text-left font-medium" scope="row">
                    <button className="text-left hover:text-task-accent hover:underline" onClick={() => setSelected(flow)} type="button">{flow.flow_name}</button>
                    <span className="block text-[0.625rem] font-normal text-task-text-muted">{flow.visits} stage visit{flow.visits === 1 ? "" : "s"}</span>
                  </th>
                  <td className="px-1 text-right"><Count onClick={() => open("assigned", "all step assignments", d.assigned)} value={d.assigned} /></td>
                  <td className="px-1 text-right"><Count onClick={() => open("completed", "completed", d.completed)} tone="good" value={d.completed} /></td>
                  <td className="px-1 text-right"><Count onClick={() => open("pending", "pending", d.pending)} value={d.pending} /></td>
                  <td className="px-1 text-right"><Count onClick={() => open("in_progress", "in progress", d.inProgress)} value={d.inProgress} /></td>
                  <td className="px-1 text-right"><Count onClick={() => open("overdue", "overdue", d.overdue)} tone="bad" value={d.overdue} /></td>
                  <td className="px-1 text-right"><Count onClick={() => open("on_time", "on time", d.onTime)} tone="good" value={d.onTime} /></td>
                  <td className="px-1 text-right"><Count onClick={() => open("late", "delayed", d.late)} tone="warn" value={d.late} /></td>
                  <td className={`whitespace-nowrap px-2.5 text-right tabular-nums ${d.pendingScore === null ? "text-task-text-muted" : "font-semibold text-task-overdue"}`}>{formatTaskPerformanceScore(d.pendingScore)}</td>
                  <td className={`whitespace-nowrap px-2.5 text-right tabular-nums ${d.delayedScore === null ? "text-task-text-muted" : "font-semibold text-task-overdue"}`}>{formatTaskPerformanceScore(d.delayedScore)}</td>
                  <td className="px-1 text-right">
                    <button aria-label={`Stage-wise performance for ${flow.flow_name}`} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-task-accent hover:bg-task-accent-soft" onClick={() => setSelected(flow)} type="button">
                      Stages <ChevronRight className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-task-text-muted">
        Counts are person-step assignments (form, task and approval steps) due in the period; a step shared by two people counts for both. End, branch and notification nodes, skipped or stopped steps and cancelled runs are not counted.
      </p>
      {selected ? <StagePanel filter={filter} flow={selected} onClose={() => setSelected(null)} onOpen={onOpen} /> : null}
    </div>
  );
}

function StagePanel({ flow, filter, onClose, onOpen }: { flow: PerformanceFlow; filter: PerformanceFilter; onClose: () => void; onOpen: Open }) {
  const stageFilter = useMemo<PerformanceFilter>(() => ({ ...filter, flow_id: flow.flow_id, kind: "fms" }), [filter, flow.flow_id]);
  const key = JSON.stringify(stageFilter);
  const load = useCallback((signal: AbortSignal) => fetchTaskPerformanceStages(stageFilter, signal), [stageFilter]);
  const { data, error, loading, refresh } = usePerformanceRequest(key, load);
  return (
    <section aria-label={`${flow.flow_name} stage performance`} className="rounded-xl border border-task-accent/40 bg-task-bg p-4 duration-200 animate-in fade-in">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-task-text-muted">Stage-wise performance</p>
          <h3 className="font-semibold">{flow.flow_name}</h3>
        </div>
        <button aria-label="Close stage view" className="flex size-10 items-center justify-center rounded-lg hover:bg-task-muted" onClick={onClose} type="button"><X className="size-4" /></button>
      </header>
      {loading && !data ? <div className="skeleton h-32 rounded-xl" /> : null}
      {error ? <p className="text-sm" role="alert">{error} <button className="font-medium text-task-accent" onClick={() => void refresh()} type="button">Retry</button></p> : null}
      {data ? (
        data.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-xs">
              <thead className="text-[0.6875rem] uppercase tracking-wider text-task-text-muted">
                <tr>{["Stage", "Activated", "Assignments", "Done", "Pending", "In progress", "Overdue", "Late", "Median time", "Who is responsible"].map((label, index) => <th className={`whitespace-nowrap px-2 py-2 font-semibold ${index > 0 && index < 9 ? "text-right" : ""}`} key={label}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {data.map((stage: PerformanceStage) => {
                  const d = performanceScores(stage);
                  const open = (selector: PerformanceRecordSelector, label: string, count: number) => onOpen(selector, `${flow.flow_name} · ${stage.stage_name} · ${label}`, count, flow.flow_id, stage.stage_key);
                  return (
                    <tr className="border-t border-task-border align-top" key={stage.stage_key}>
                      <th className="px-2 py-2 text-left font-medium" scope="row">{stage.stage_name}</th>
                      <td className="px-2 py-2 text-right tabular-nums">{stage.visits}</td>
                      <td className="px-1 text-right"><Count onClick={() => open("assigned", "all", d.assigned)} value={d.assigned} /></td>
                      <td className="px-1 text-right"><Count onClick={() => open("completed", "completed", d.completed)} tone="good" value={d.completed} /></td>
                      <td className="px-1 text-right"><Count onClick={() => open("pending", "pending", d.pending)} value={d.pending} /></td>
                      <td className="px-1 text-right"><Count onClick={() => open("in_progress", "in progress", d.inProgress)} value={d.inProgress} /></td>
                      <td className="px-1 text-right"><Count onClick={() => open("overdue", "overdue", d.overdue)} tone="bad" value={d.overdue} /></td>
                      <td className="px-1 text-right"><Count onClick={() => open("late", "completed late", d.late)} tone="warn" value={d.late} /></td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums" title={stage.average_hours !== null ? `Average ${stage.average_hours} h` : undefined}>{stage.median_hours !== null ? `${stage.median_hours} h` : "—"}</td>
                      <td className="px-2 py-2">
                        <ul className="grid gap-0.5">
                          {stage.people.slice(0, 3).map((person) => (
                            <li className="flex justify-between gap-3" key={person.user_profile_id}>
                              <span className="truncate">{person.employee_name}</span>
                              <span className="shrink-0 tabular-nums text-task-text-muted">{person.completed}/{person.assigned}{person.overdue ? <span className="text-task-overdue"> · {person.overdue} overdue</span> : null}</span>
                            </li>
                          ))}
                          {stage.people.length > 3 ? <li className="text-task-text-muted">+{stage.people.length - 3} more</li> : null}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-task-text-muted">Activated = distinct stage visits; a looped stage counts each visit. Median time runs from activation to completion over completed visits.</p>
          </div>
        ) : <p className="py-4 text-center text-sm text-task-text-muted">No step work due in this period for this workflow.</p>
      ) : null}
    </section>
  );
}
