import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { defaultFmsWorkspaceFilters, fmsTaskBoardFamily, fmsTaskBoardPath, fmsWorkspaceFilter, FMS_TASKS_BOARD_BASE, hasPermission, type FmsFamilySummary, type FmsWorkspaceStatus } from "@jewelos/core";
import { loadFmsTaskWorkspace } from "@jewelos/data/fms/taskWorkspace";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { cn } from "@/lib/utils";
import { useFmsRead } from "./useFmsRead";
import { FmsReadState } from "./FmsTaskGroups";
import { FmsTaskBoard } from "./FmsTaskBoard";
import { FmsStaffWorkspace } from "./FmsStaffWorkspace";
/** Tasks opened on its FMS tab: where finished FMS work returns the employee. */
export const FMS_TASKS_PATH = FMS_TASKS_BOARD_BASE;
const TOPICS = ["tasks", "fms", "forms", "organization"] as const;
const STATUSES: readonly { value: FmsWorkspaceStatus; label: string }[] = [
 { value: "active", label: "To do" }, { value: "waiting", label: "Waiting" }, { value: "completed", label: "Done" },
];
const STATUS_HELP: Partial<Record<FmsWorkspaceStatus, string>> = {
 active: "Workflows with work you can do now. Open one to see its stages side by side.",
 waiting: "Workflows where your work is waiting for other employees or an approval.",
 completed: "Workflows where you have finished work.",
};
const readLocation = () => ({ familyId: fmsTaskBoardFamily(window.location.search), status: new URLSearchParams(window.location.search).get("status") });
/** The `workflow` (and optional `status`) of the current Tasks -> FMS URL; follows Back/Forward. */
function useBoardLocation() {
 const [, setTick] = useState(0);
 useEffect(() => { const update = () => setTick(value => value + 1); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);
 // The app's navigate() pushes the URL and re-renders this page, so reading it on render is enough.
 return readLocation();
}

/**
 * Tasks -> FMS. Level 1 lists the workflows with the employee's work and exact
 * counts; Level 2 (`?view=fms&workflow=<family>`) is that workflow's stage board.
 * The FMS Library's Tasks button opens the same board URL.
 */
export function FmsTaskWorkspace(props: { actorId: string; tenantId: string; onNavigate: (path: string) => void; onCount: (count: number) => void }) {
 const { access } = useAuth();
 // Managers, admins and super admins (team view) get the board; everyone else keeps the original list.
 const canSeeTeam = access ? hasPermission(access, "tasks.manage_team") || hasPermission(access, "tasks.view_all") : false;
 return canSeeTeam ? <FmsBoardWorkspace {...props} /> : <FmsStaffWorkspace {...props} />;
}

function FmsBoardWorkspace({ actorId, tenantId, onNavigate, onCount }: { actorId: string; tenantId: string; onNavigate: (path: string) => void; onCount: (count: number) => void }) {
 const location = useBoardLocation();
 const [status, setStatus] = useState<FmsWorkspaceStatus>("active");
 const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [offset, setOffset] = useState(0);
 const [epoch, setEpoch] = useState(0);
 useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
 const refresh = useCallback(() => { setEpoch(value => value + 1); }, []);
 useTenantRealtimeRefresh({ tenantId, topics: TOPICS, refresh });
 const filters = { ...defaultFmsWorkspaceFilters(), status, query };
 const result = useFmsRead(!location.familyId, `${actorId}|${JSON.stringify(filters)}|${offset}`, async () => { fmsWorkspaceFilter(filters); return loadFmsTaskWorkspace(filters, offset); }, epoch);
 const data = result.data;
 useEffect(() => { if (data) onCount(data.activeTotal); }, [data, onCount]);
 useEffect(() => { if (data && offset > 0 && offset >= data.familyTotal) setOffset(Math.max(0, Math.floor((data.familyTotal - 1) / 50) * 50)); }, [data, offset]);

 if (location.familyId) {
  const initial = STATUSES.some(item => item.value === location.status) ? location.status as FmsWorkspaceStatus : "active";
  return <FmsTaskBoard canSeeTeam familyId={location.familyId} initialStatus={initial} key={location.familyId} onBack={() => onNavigate(FMS_TASKS_PATH)} onNavigate={onNavigate} tenantId={tenantId} />;
 }
 const openBoard = (family: FmsFamilySummary) => onNavigate(`${fmsTaskBoardPath(family.id)}${status === "active" ? "" : `&status=${status}`}`);
 return <div className="space-y-4 text-task-text">
  <div className="space-y-3 rounded-2xl border border-task-border p-3 sm:p-4" role="search" aria-label="Find an FMS workflow">
   <label className="relative block"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-task-text-muted" /><span className="sr-only">Search FMS work</span>
    <input className="task-field pl-9" maxLength={200} onChange={event => { setSearch(event.target.value); setOffset(0); }} placeholder="Search workflow, customer or reference" type="search" value={search} /></label>
   <div className="no-scrollbar scroll-x -mx-1 flex items-center gap-2 px-1">{STATUSES.map(item => <button key={item.value} type="button" aria-pressed={status === item.value} className={cn("min-h-11 shrink-0 rounded-full border px-3 text-sm", status === item.value ? "border-task-accent bg-task-accent-soft font-semibold" : "border-task-border text-task-text-muted hover:bg-task-muted")} onClick={() => { setStatus(item.value); setOffset(0); }}>{item.label}{data ? ` (${data.counts[item.value]})` : ""}</button>)}</div>
   <p className="text-xs text-task-text-muted">{STATUS_HELP[status]}</p>
  </div>
  <FmsReadState {...result} />
  {data ? <>
   {data.families.length ? <ul className="space-y-2" aria-label="FMS workflows">{data.families.map(family => <li key={family.id}>
    <a href={fmsTaskBoardPath(family.id)} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); openBoard(family); } }}
     className={cn("flex min-h-16 items-center gap-3 rounded-2xl border bg-task-bg px-4 py-3 transition-colors hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent", status === "active" && family.overdue ? "border-danger/40" : "border-task-border")}>
     <span className="min-w-0 flex-1"><span className="block break-words font-semibold">{family.name}</span>
      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-task-text-muted">
       {status === "active" ? <><span><strong className="tabular-nums text-task-text">{family.active}</strong> active {family.active === 1 ? "task" : "tasks"}</span>
        <span className={family.overdue ? "font-semibold text-danger" : ""}><span className="tabular-nums">{family.overdue}</span> overdue</span>
        <span className={family.dueToday ? "font-semibold text-task-text" : ""}><span className="tabular-nums">{family.dueToday}</span> due today</span></>
        : <span><strong className="tabular-nums text-task-text">{family.count}</strong> {status === "waiting" ? "waiting" : "done"}</span>}
      </span></span>
     <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-task-text-muted" />
    </a></li>)}</ul>
    : <div className="rounded-2xl border border-task-border px-5 py-12 text-center"><h2 className="font-semibold">No FMS work here</h2><p className="mt-1 text-sm text-task-text-muted">{status === "active" && !query ? "You have no workflow work to do right now." : "Try another status or clear your search."}</p></div>}
   {data.familyTotal > 50 ? <nav aria-label="Workflow pages" className="flex items-center justify-center gap-3"><Button variant="secondary" disabled={result.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous workflows</Button><span className="text-xs">{offset + 1} - {Math.min(offset + 50, data.familyTotal)} of {data.familyTotal}</span><Button variant="secondary" disabled={result.loading || offset + 50 >= data.familyTotal} onClick={() => setOffset(offset + 50)}>Next workflows</Button></nav> : null}
  </> : null}
 </div>;
}
