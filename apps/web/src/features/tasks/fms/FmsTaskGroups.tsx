import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmsAssignedWorkPath, orderFmsWorkspaceStages, type FmsFamilySummary, type FmsStageSummary, type FmsWorkspaceFilters } from "@jewelos/core";
import { loadFmsTaskStages, loadFmsTaskStagePage } from "@jewelos/data/fms/taskWorkspace";
import { Button, Notice } from "@/components/ui";
import { useFmsRead } from "./useFmsRead";

export function FmsReadState({ loading, error, retry }: { loading: boolean; error?: string | undefined; retry: () => void }) {
 if (error) return <div className="space-y-2 p-3"><Notice tone="danger">{error}</Notice><Button variant="secondary" onClick={retry}>Retry</Button></div>;
 return loading ? <div aria-label="Loading FMS work" className="m-3 h-14 animate-pulse rounded-xl bg-task-muted" /> : null;
}
function Disclosure({ name, count, open, onClick, controls, detail }: { name: string; count: number; open: boolean; onClick: () => void; controls: string; detail?: string | undefined }) {
 const Icon = open ? ChevronDown : ChevronRight;
 return <button type="button" aria-expanded={open} aria-controls={controls} onClick={onClick} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-task-muted ${count ? "text-task-text" : "text-task-text-muted"}`}>
  <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 break-words font-semibold">{name}{detail ? <span className="ml-2 text-xs font-normal text-task-text-muted">{detail}</span> : null}</span>
  <span className="rounded-full bg-task-muted px-2.5 py-1 text-xs tabular-nums">{count}</span>
 </button>;
}
export function FmsWorkflowGroup({ family, filters, epoch, onNavigate, open, onToggle, expandedStages, onToggleStage }: { open: boolean; onToggle: () => void; expandedStages: ReadonlySet<string>; onToggleStage: (id: string) => void; family: FmsFamilySummary; filters: FmsWorkspaceFilters; epoch: number; onNavigate: (path: string) => void }) {
 const id = useId();
 const result = useFmsRead(open, `${family.id}|${JSON.stringify(filters)}`, () => loadFmsTaskStages(family.id, filters), epoch);
 const stages = result.data ? orderFmsWorkspaceStages(result.data) : [];
 const versions = new Set(stages.map(stage => stage.flowId)).size;
 return <section className="rounded-2xl border border-task-border bg-task-bg">
  <Disclosure name={family.name} count={family.count} open={open} onClick={onToggle} controls={id} />
  {open ? <div id={id} className="space-y-1 border-t border-task-border p-2 sm:px-4">
   <FmsReadState {...result} />
   {stages.map((stage, index) => <div key={stage.id}>
    {stage.pipeline && (index === 0 || stages[index - 1]?.pipeline !== stage.pipeline || stages[index - 1]?.flowId !== stage.flowId) ? <p className="px-4 pt-3 text-xs font-semibold text-task-text-muted">{stage.pipeline}</p> : null}
    <FmsStageGroup familyId={family.id} stage={stage} open={expandedStages.has(stage.id)} onToggle={() => onToggleStage(stage.id)} filters={filters} epoch={epoch} showVersion={versions > 1} onNavigate={onNavigate} />
   </div>)}
  </div> : null}
 </section>;
}
function FmsStageGroup({ familyId, stage, filters, epoch, showVersion, onNavigate, open, onToggle }: { open: boolean; onToggle: () => void; familyId: string; stage: FmsStageSummary; filters: FmsWorkspaceFilters; epoch: number; showVersion: boolean; onNavigate: (path: string) => void }) {
 const [offset, setOffset] = useState(0); const id = useId();
 const filterKey = JSON.stringify(filters);
 useEffect(() => setOffset(0), [filterKey]);
 const result = useFmsRead(open && stage.count > 0, `${stage.id}|${filterKey}|${offset}`, () => loadFmsTaskStagePage({ familyId, ...stage }, filters, offset), epoch);
 useEffect(() => { if (result.data && offset > 0 && offset >= result.data.total) setOffset(Math.max(0, Math.floor((result.data.total - 1) / 50) * 50)); }, [result.data, offset]);
 const page = stage.count > 0 ? result.data : undefined;
 return <section>
  <Disclosure name={stage.name} detail={showVersion ? `v${stage.version}` : undefined} count={stage.count} open={open} onClick={onToggle} controls={id} />
  {open ? <div id={id} className="space-y-2 px-2 pb-3 sm:pl-8">
   <FmsReadState {...result} />
   {stage.count === 0 || page?.total === 0 ? <p className="px-3 py-2 text-sm text-task-text-muted">No work in this stage for these filters.</p> : null}
   {page?.records.map(record => <a key={record.id} href={fmsAssignedWorkPath(record.target)} aria-label={`Open Work — ${record.name}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); onNavigate(fmsAssignedWorkPath(record.target)); } }} className="block rounded-xl border border-task-border p-4 transition-colors hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent">
    <h3 className="break-words font-semibold text-task-text">{record.name}</h3>
    {record.description ? <p className="mt-1 line-clamp-2 text-sm text-task-text-muted">{record.description}</p> : null}
    <p className="mt-2 text-xs text-task-text-muted">{record.reference}{record.visitNumber > 1 ? ` · Visit ${record.visitNumber}` : ""}</p>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
     <span className={record.status === "overdue" ? "font-semibold text-danger" : "text-task-text-muted"}>{record.status === "waiting" ? "Waiting" : record.status === "overdue" ? "Overdue" : record.status === "completed" ? "Completed" : "Pending"}</span>
     {record.dueAt ? <time dateTime={record.dueAt} className="text-task-text-muted">Due {new Date(record.dueAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time> : null}
    </div>
    <span className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-task-border px-3 text-sm font-semibold">Open Work</span>
   </a>)}
   {page && page.total > 50 ? <nav aria-label={`${stage.name} pages`} className="flex flex-wrap items-center justify-center gap-3 py-2">
    <Button variant="secondary" disabled={result.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
    <span className="text-xs text-task-text-muted">{offset + 1} - {Math.min(offset + 50, page.total)} of {page.total}</span>
    <Button variant="secondary" disabled={result.loading || offset + 50 >= page.total} onClick={() => setOffset(offset + 50)}>Next</Button>
   </nav> : null}
  </div> : null}
 </section>;
}
