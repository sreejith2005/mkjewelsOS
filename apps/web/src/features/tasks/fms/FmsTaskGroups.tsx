import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import { describeDue, fmsAssignedWorkPath, orderFmsWorkspaceStages, type FmsFamilySummary, type FmsStageSummary, type FmsWorkspaceFilters, type FmsWorkspaceRecord } from "@jewelos/core";
import { loadFmsTaskStages, loadFmsTaskStagePage } from "@jewelos/data/fms/taskWorkspace";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useFmsRead } from "./useFmsRead";

export function FmsReadState({ loading, error, retry }: { loading: boolean; error?: string | undefined; retry: () => void }) {
 if (error) return <div className="space-y-2 p-3"><Notice tone="danger">{error}</Notice><Button variant="secondary" onClick={retry}>Retry</Button></div>;
 return loading ? <div aria-label="Loading FMS work" className="m-3 h-14 animate-pulse rounded-xl bg-task-muted" /> : null;
}
const LEVEL_LABEL = { workflow: "Workflow", stage: "Stage", starter: "Form to start" } as const;
function Disclosure({ name, count, open, onClick, controls, detail, level }: { name: string; count: number; open: boolean; onClick: () => void; controls: string; detail?: string | undefined; level: keyof typeof LEVEL_LABEL }) {
 const Icon = open ? ChevronDown : ChevronRight;
 return <button type="button" aria-expanded={open} aria-controls={controls} onClick={onClick} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-task-muted ${count ? "text-task-text" : "text-task-text-muted"}`}>
  <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 break-words"><span className="block text-[11px] font-medium uppercase tracking-wider text-task-text-muted">{LEVEL_LABEL[level]}</span><span className="font-semibold">{name}</span>{detail ? <span className="ml-2 text-xs font-normal text-task-text-muted">{detail}</span> : null}</span>
  <span className={cn("rounded-full px-2.5 py-1 text-xs tabular-nums", count ? "bg-task-accent-soft font-semibold text-task-text" : "bg-task-muted")}>{count}</span>
 </button>;
}
export function FmsWorkflowGroup({ family, filters, epoch, onNavigate, open, onToggle, expandedStages, onToggleStage, onStagesLoaded }: { open: boolean; onToggle: () => void; expandedStages: ReadonlySet<string>; onToggleStage: (id: string) => void; family: FmsFamilySummary; filters: FmsWorkspaceFilters; epoch: number; onNavigate: (path: string) => void; onStagesLoaded?: ((stages: readonly FmsStageSummary[]) => void) | undefined }) {
 const id = useId();
 const result = useFmsRead(open, `${family.id}|${JSON.stringify(filters)}`, () => loadFmsTaskStages(family.id, filters), epoch);
 const stages = result.data ? visibleFmsWorkspaceStages(result.data) : [];
 const versions = new Set(stages.map(stage => stage.flowId)).size;
 const loaded = useRef(onStagesLoaded); loaded.current = onStagesLoaded;
 useEffect(() => { if (result.data) loaded.current?.(visibleFmsWorkspaceStages(result.data)); }, [result.data]);
 return <section className="rounded-2xl border border-task-border bg-task-bg">
  <Disclosure name={family.name} count={family.count} open={open} onClick={onToggle} controls={id} level="workflow" />
  {open ? <div id={id} className="space-y-1 border-t border-task-border p-2 sm:px-4">
   <FmsReadState {...result} />
   {result.data && !stages.length ? <p className="px-4 py-3 text-sm text-task-text-muted">No work in this workflow for these filters.</p> : null}
   {stages.map((stage, index) => <div key={stage.id}>
    {stage.pipeline && (index === 0 || stages[index - 1]?.pipeline !== stage.pipeline || stages[index - 1]?.flowId !== stage.flowId) ? <p className="px-4 pt-3 text-xs font-semibold text-task-text-muted">{stage.pipeline}</p> : null}
    <FmsStageGroup familyId={family.id} stage={stage} open={expandedStages.has(stage.id)} onToggle={() => onToggleStage(stage.id)} filters={filters} epoch={epoch} showVersion={versions > 1} onNavigate={onNavigate} />
   </div>)}
  </div> : null}
 </section>;
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
 overdue: { label: "Overdue", className: "border-danger/40 bg-danger/10 text-danger" },
 waiting: { label: "Waiting", className: "border-task-border bg-task-muted text-task-text-muted" },
 completed: { label: "Completed", className: "border-success/40 bg-success/10 text-success" },
 pending: { label: "To do", className: "border-task-accent/40 bg-task-accent-soft text-task-text" },
};
/** The record's main action, named for what is actually waiting. */
export function fmsRecordAction(record: Pick<FmsWorkspaceRecord, "status" | "target">): string {
 if (record.status === "completed") return "View";
 if (record.status === "waiting") return "View details";
 return record.target.kind === "starter_form" ? "Start form" : record.target.kind === "stage_form" ? "Fill form" : "Open work";
}
function FmsRecordCard({ record, stageName, onNavigate }: { record: FmsWorkspaceRecord; stageName: string; onNavigate: (path: string) => void }) {
 const path = fmsAssignedWorkPath(record.target);
 const status = STATUS_STYLE[record.status] ?? STATUS_STYLE.pending!;
 const due = describeDue(record.dueAt, undefined, { completed: record.status === "completed" });
 const action = fmsRecordAction(record);
 return <a href={path} aria-label={`${action} — ${record.name}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); onNavigate(path); } }} className={cn("block rounded-xl border bg-task-bg p-4 transition-colors hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent", record.status === "overdue" ? "border-danger/40" : "border-task-border")}>
  <div className="flex items-start justify-between gap-2">
   <div className="min-w-0"><p className="truncate text-xs font-semibold text-gold-secondary">{stageName}</p><h3 className="break-words font-semibold text-task-text">{record.name}</h3></div>
   <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", status.className)}>{status.label}</span>
  </div>
  {record.description ? <p className="mt-1 line-clamp-2 text-sm text-task-text-muted">{record.description}</p> : null}
  {record.visitNumber > 1 ? <p className="mt-2 text-xs text-task-text-muted">Visit {record.visitNumber}</p> : null}
  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
   {record.dueAt ? <time dateTime={record.dueAt} className={cn("inline-flex items-center gap-1.5 text-sm", due.tone === "overdue" ? "font-semibold text-danger" : due.tone === "today" ? "font-medium text-task-text" : "text-task-text-muted")}><CalendarClock aria-hidden="true" className="size-4" />{due.label}</time> : <span className="text-sm text-task-text-muted">No due date</span>}
   <span className={cn("inline-flex min-h-11 items-center gap-1 rounded-lg px-4 text-sm font-semibold", record.status === "completed" || record.status === "waiting" ? "border border-task-border text-task-text" : "bg-gold-sheen text-on-gold shadow-gold")}>{action}<ChevronRight aria-hidden="true" className="size-4" /></span>
  </div>
 </a>;
}
/**
 * Only stages holding the employee's work are listed. The starting form is filled
 * from the Forms Library, so it is never a stage; a pending starter assignment is
 * still open work and stays reachable, labelled as a form to start.
 */
export function visibleFmsWorkspaceStages(stages: readonly FmsStageSummary[]): FmsStageSummary[] {
 return orderFmsWorkspaceStages(stages).filter(stage => stage.count > 0);
}
function FmsStageGroup({ familyId, stage, filters, epoch, showVersion, onNavigate, open, onToggle }: { open: boolean; onToggle: () => void; familyId: string; stage: FmsStageSummary; filters: FmsWorkspaceFilters; epoch: number; showVersion: boolean; onNavigate: (path: string) => void }) {
 const [offset, setOffset] = useState(0); const id = useId();
 const filterKey = JSON.stringify(filters);
 useEffect(() => setOffset(0), [filterKey]);
 const result = useFmsRead(open && stage.count > 0, `${stage.id}|${filterKey}|${offset}`, () => loadFmsTaskStagePage({ familyId, ...stage }, filters, offset), epoch);
 useEffect(() => { if (result.data && offset > 0 && offset >= result.data.total) setOffset(Math.max(0, Math.floor((result.data.total - 1) / 50) * 50)); }, [result.data, offset]);
 const page = stage.count > 0 ? result.data : undefined;
 return <section>
  <Disclosure name={stage.name} detail={showVersion ? `v${stage.version}` : undefined} count={stage.count} open={open} onClick={onToggle} controls={id} level={stage.starting ? "starter" : "stage"} />
  {open ? <div id={id} className="space-y-2 px-2 pb-3 sm:pl-8">
   <FmsReadState {...result} />
   {stage.count === 0 || page?.total === 0 ? <p className="px-3 py-2 text-sm text-task-text-muted">No work in this stage for these filters.</p> : null}
   {page?.records.map(record => <FmsRecordCard key={record.id} onNavigate={onNavigate} record={record} stageName={stage.name} />)}
   {page && page.total > 50 ? <nav aria-label={`${stage.name} pages`} className="flex flex-wrap items-center justify-center gap-3 py-2">
    <Button variant="secondary" disabled={result.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
    <span className="text-xs text-task-text-muted">{offset + 1} - {Math.min(offset + 50, page.total)} of {page.total}</span>
    <Button variant="secondary" disabled={result.loading || offset + 50 >= page.total} onClick={() => setOffset(offset + 50)}>Next</Button>
   </nav> : null}
  </div> : null}
 </section>;
}
