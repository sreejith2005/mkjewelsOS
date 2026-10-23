import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { defaultFmsWorkspaceFilters, fmsWorkspaceFilter, type FmsStageSummary, type FmsWorkspaceStatus } from "@jewelos/core";
import { loadFmsTaskWorkspace, loadFmsTaskStages } from "@jewelos/data/fms/taskWorkspace";
import { Button, Field } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { useFmsRead } from "./useFmsRead";
import { FmsReadState, FmsWorkflowGroup } from "./FmsTaskGroups";
/** Tasks opened on its FMS tab: where finished FMS work returns the employee. */
export const FMS_TASKS_PATH = "/tasks?view=fms";
const TOPICS = ["tasks", "fms", "forms", "organization"] as const;
const STATUSES: readonly FmsWorkspaceStatus[] = ["active", "pending", "overdue", "waiting", "completed"];
const STATUS_HELP: Record<FmsWorkspaceStatus, string> = {
 active: "Work you can do now: to do and overdue.",
 pending: "Work you can do now that is not late yet.",
 overdue: "Work that is past its due time. Do these first.",
 waiting: "Your work that is waiting for other employees or an approval.",
 completed: "Work you have already finished.",
};
export function FmsTaskWorkspace({ actorId, tenantId, onNavigate, onCount }: { actorId: string; tenantId: string; onNavigate: (path: string) => void; onCount: (count: number) => void }) {
 const [filters, setFilters] = useState(defaultFmsWorkspaceFilters); const [query, setQuery] = useState(""); const [offset, setOffset] = useState(0);
 const [expandedFamilies, setExpandedFamilies] = useState<ReadonlySet<string>>(new Set());
 const [expandedStages, setExpandedStages] = useState<ReadonlySet<string>>(new Set());
 const toggle = (previous: ReadonlySet<string>, id: string) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; };
 // One workflow, one stage with work: open them so the employee sees their work without two taps.
 // Larger lists stay collapsed and load lazily. Happens once, so a closed group stays closed.
 const autoOpened = useRef(false);
 const [autoStageFamily, setAutoStageFamily] = useState<string | null>(null);
 const [epoch, setEpoch] = useState(0);
 useEffect(() => { const timer = window.setTimeout(() => setQuery(filters.query.trim()), 250); return () => window.clearTimeout(timer); }, [filters.query]);
 const effective = { ...filters, query }; const filterKey = JSON.stringify(effective);
 const refresh = useCallback(() => { setEpoch(value => value + 1); }, []);
 useTenantRealtimeRefresh({ tenantId, topics: TOPICS, refresh });
 const result = useFmsRead(true, `${actorId}|${filterKey}|${offset}`, async () => {
  fmsWorkspaceFilter(effective); return loadFmsTaskWorkspace(effective, offset);
 }, epoch);
 const [knownFamilies, setKnownFamilies] = useState<NonNullable<typeof result.data>["families"]>([]);
 const [knownStages, setKnownStages] = useState<FmsStageSummary[]>([]);
 useEffect(() => { if (result.data) { onCount(result.data.activeTotal); setKnownFamilies(previous => [...new Map([...previous, ...result.data!.families].map(f => [f.id, f])).values()]);
  if (offset > 0 && offset >= result.data.familyTotal) setOffset(Math.max(0, Math.floor((result.data.familyTotal - 1) / 50) * 50)); } }, [result.data, onCount, offset]);
 useEffect(() => { let active = true; setKnownStages([]); if (filters.familyId) void loadFmsTaskStages(filters.familyId, { ...effective, stageId: "" }).then(rows => { if (active) setKnownStages(rows); }).catch(() => { /* Main hierarchy keeps its explicit retry state. */ }); return () => { active = false; }; }, [filters.familyId, query, filters.status, filters.from, filters.to, epoch]);
 const change = (next: typeof filters) => { setFilters(next); setOffset(0); };
 const data = result.data;
 useEffect(() => {
  if (!data || autoOpened.current) return;
  autoOpened.current = true;
  const only = data.familyTotal === 1 ? data.families[0] : undefined;
  if (only && only.count > 0) { setExpandedFamilies(new Set([only.id])); setAutoStageFamily(only.id); }
 }, [data]);
 const autoOpenStage = useCallback((stages: readonly FmsStageSummary[]) => {
  setAutoStageFamily(null);
  const withWork = stages.filter(stage => stage.count > 0);
  if (withWork.length === 1) setExpandedStages(previous => new Set([...previous, withWork[0]!.id]));
 }, []);
 return <div className="space-y-4 text-task-text">
  <div className="space-y-3 rounded-2xl border border-task-border p-3 sm:p-4" role="search" aria-label="Find FMS work">
   <Field label="Search FMS work"><input type="search" className="task-field" maxLength={200} placeholder="Record name or workflow reference" value={filters.query} onChange={event => change({ ...filters, query: event.target.value })} /></Field>
   <details className="group rounded-xl border border-task-border px-3">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">Workflow and date filters{filters.familyId || filters.stageId || filters.from || filters.to ? <span className="rounded-full bg-task-accent-soft px-2 py-0.5 text-xs">Applied</span> : null}<ChevronDown aria-hidden="true" className="ml-auto size-4 transition-transform group-open:rotate-180" /></summary>
   <div className="grid grid-cols-1 gap-3 pb-3 sm:grid-cols-2 lg:grid-cols-4">
    <Field label="Workflow"><select className="task-field" value={filters.familyId} onChange={event => change({ ...filters, familyId: event.target.value, stageId: "" })}><option value="">All my workflows</option>{knownFamilies.map(family => <option key={family.id} value={family.id}>{family.name}</option>)}</select></Field>
    <Field label="Stage"><select className="task-field" value={filters.stageId} disabled={!filters.familyId} onChange={event => change({ ...filters, stageId: event.target.value })}><option value="">All stages</option>{knownStages.filter(stage => stage.count > 0 || stage.stageId === filters.stageId).map(stage => <option key={stage.id} value={stage.stageId}>{stage.name} · v{stage.version}</option>)}</select></Field>
    <Field label="Due from"><input className="task-field" type="date" value={filters.from} onChange={event => change({ ...filters, from: event.target.value })} /></Field>
    <Field label="Due to"><input className="task-field" type="date" value={filters.to} onChange={event => change({ ...filters, to: event.target.value })} /></Field>
   </div>
   </details>
   <div className="no-scrollbar scroll-x -mx-1 flex items-center gap-2 px-1">{STATUSES.map(status => <button key={status} type="button" aria-pressed={filters.status === status} className={`min-h-11 shrink-0 rounded-full border px-3 text-sm capitalize ${filters.status === status ? "border-task-accent bg-task-accent-soft font-semibold" : "border-task-border text-task-text-muted hover:bg-task-muted"}`} onClick={() => change({ ...filters, status })}>{status}{data ? ` (${data.counts[status]})` : ""}</button>)}<Button className="shrink-0" variant="ghost" onClick={() => { change(defaultFmsWorkspaceFilters()); setQuery(""); }}>Clear all</Button></div>
   <p className="text-xs text-task-text-muted">{STATUS_HELP[filters.status]}</p>
  </div>
  <FmsReadState {...result} />
  {data ? <><p className="px-1 text-sm text-task-text-muted">{data.total} {filters.status} {data.total === 1 ? "assignment" : "assignments"}{filters.status === "active" ? " · Waiting work is shown separately." : ""}</p>
   {data.families.length ? <div className="space-y-3">{data.families.map(family => <FmsWorkflowGroup key={family.id} family={family} open={expandedFamilies.has(family.id)} onToggle={() => setExpandedFamilies(previous => toggle(previous, family.id))} expandedStages={expandedStages} onToggleStage={id => setExpandedStages(previous => toggle(previous, id))} filters={effective} epoch={epoch} onNavigate={onNavigate} onStagesLoaded={autoStageFamily === family.id ? autoOpenStage : undefined} />)}</div> : <div className="rounded-2xl border border-task-border px-5 py-12 text-center"><h2 className="font-semibold">No FMS work here</h2><p className="mt-1 text-sm text-task-text-muted">{filters.status === "active" && !filters.query && !filters.familyId && !filters.from && !filters.to ? "You have no workflow work to do right now." : "Try another status or clear your filters."}</p></div>}
   {data.familyTotal > 50 ? <nav aria-label="Workflow pages" className="flex items-center justify-center gap-3"><Button variant="secondary" disabled={result.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous workflows</Button><span className="text-xs">{offset + 1} - {Math.min(offset + 50, data.familyTotal)} of {data.familyTotal}</span><Button variant="secondary" disabled={result.loading || offset + 50 >= data.familyTotal} onClick={() => setOffset(offset + 50)}>Next workflows</Button></nav> : null}
  </> : null}
 </div>;
}
