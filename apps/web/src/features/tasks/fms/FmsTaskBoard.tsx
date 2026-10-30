import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import {
  defaultFmsWorkspaceFilters, describeDue, fmsAssignedWorkPath, fmsBoardColumns, fmsTaskBoardPath, fmsWorkspaceFilter, formatKolkataDateTime,
  type FmsBoardStage, type FmsWorkspaceDue, type FmsWorkspaceFilters, type FmsWorkspacePriority, type FmsWorkspaceRecord, type FmsWorkspaceSort, type FmsWorkspaceStatus,
} from "@jewelos/core";
import { FMS_BOARD_PAGE_SIZE, loadFmsTaskBoard, loadFmsTaskStagePage } from "@jewelos/data/fms/taskWorkspace";
import { loadTaskAssignmentUsers } from "@jewelos/data/tasks/api";
import { Button } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { cn } from "@/lib/utils";
import { readFmsBoardView, rememberFmsBoardReturn, saveFmsBoardView } from "./boardReturn";
import { FmsReadState, fmsRecordAction } from "./FmsTaskGroups";
import { useFmsRead } from "./useFmsRead";

const TOPICS = ["tasks", "fms", "forms", "organization"] as const;
const DUE_TABS: readonly { value: FmsWorkspaceDue; label: string }[] = [
  { value: "all", label: "All" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" },
];
const STATUS_OPTIONS: readonly { value: FmsWorkspaceStatus; label: string }[] = [
  { value: "active", label: "To do" }, { value: "waiting", label: "Waiting for others" }, { value: "completed", label: "Done" },
];
const PRIORITY_LABEL = { high: "High priority", medium: "Medium", low: "Low" } as const;
type BoardView = Readonly<{ filters: FmsWorkspaceFilters; scrollLeft: number; stageId: string }>;

/** Desktop shows every column side by side; a phone shows one readable column at a time. */
function useWideLayout(): boolean {
  const query = "(min-width: 768px)";
  const read = () => typeof window.matchMedia !== "function" || window.matchMedia(query).matches;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query); const update = () => setWide(list.matches);
    list.addEventListener?.("change", update); return () => list.removeEventListener?.("change", update);
  }, []);
  return wide;
}
function restoredFilters(familyId: string, initialStatus: FmsWorkspaceStatus): FmsWorkspaceFilters {
  const saved = readFmsBoardView<BoardView>(familyId).filters;
  const merged: FmsWorkspaceFilters = { ...defaultFmsWorkspaceFilters(), ...(saved ?? {}), status: saved?.status ?? initialStatus, familyId: "", stageId: "", from: "", to: "" };
  try { fmsWorkspaceFilter(merged); return merged; } catch { return { ...defaultFmsWorkspaceFilters(), status: initialStatus }; }
}

/**
 * Level 2 of Tasks -> FMS: one workflow as a spreadsheet-style board. Columns
 * are the workflow's person steps in graph order; each card is one assigned
 * visit. Counts are exact (server), each column holds its first page, and
 * "Show more" pages the rest. Opening a card runs the existing FMS work page.
 */
export function FmsTaskBoard({ familyId, tenantId, canSeeTeam, initialStatus = "active", onNavigate, onBack }: { familyId: string; tenantId: string; canSeeTeam: boolean; initialStatus?: FmsWorkspaceStatus; onNavigate: (path: string) => void; onBack: () => void }) {
  const [filters, setFilters] = useState<FmsWorkspaceFilters>(() => restoredFilters(familyId, initialStatus));
  const [query, setQuery] = useState(filters.query.trim());
  const [epoch, setEpoch] = useState(0);
  const [activeStage, setActiveStage] = useState(() => readFmsBoardView<BoardView>(familyId).stageId ?? "");
  const [people, setPeople] = useState<readonly { id: string; name: string }[]>([]);
  const wide = useWideLayout();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => { const timer = window.setTimeout(() => setQuery(filters.query.trim()), 250); return () => window.clearTimeout(timer); }, [filters.query]);
  const refresh = useCallback(() => setEpoch((value) => value + 1), []);
  useTenantRealtimeRefresh({ tenantId, topics: TOPICS, refresh });
  const team = canSeeTeam && filters.scope === "all";
  const effective = useMemo<FmsWorkspaceFilters>(() => ({ ...filters, query, ...(team ? {} : { scope: "mine", assigneeId: "" }) }), [filters, query, team]);
  const identity = `${familyId}|${JSON.stringify(effective)}`;
  const result = useFmsRead(true, identity, () => loadFmsTaskBoard(familyId, effective), epoch);
  const board = result.data;
  const columns = useMemo(() => board ? fmsBoardColumns(board) : [], [board]);
  const versions = new Set(columns.map((column) => column.flowId)).size;
  const change = (patch: Partial<FmsWorkspaceFilters>) => setFilters((current) => ({ ...current, ...patch }));

  useEffect(() => { saveFmsBoardView(familyId, { filters, scrollLeft: scroller.current?.scrollLeft ?? readFmsBoardView<BoardView>(familyId).scrollLeft ?? 0, stageId: activeStage }); }, [familyId, filters, activeStage]);
  useEffect(() => {
    if (!team || people.length) return;
    let active = true;
    void loadTaskAssignmentUsers().then((users) => { if (active) setPeople(users.map((user) => ({ id: user.id, name: user.employee_name })).sort((a, b) => a.name.localeCompare(b.name))); }).catch(() => { /* The filter stays "Everyone". */ });
    return () => { active = false; };
  }, [team, people.length]);
  // Keep the phone's chosen stage valid; default to the first column with work.
  useEffect(() => {
    if (!columns.length || columns.some((column) => column.id === activeStage)) return;
    setActiveStage((columns.find((column) => column.count > 0) ?? columns[0]!).id);
  }, [columns, activeStage]);
  const measure = useCallback(() => {
    const element = scroller.current; if (!element) return;
    setEdges({ left: element.scrollLeft > 4, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
  }, []);
  // Restore the horizontal position once the first board has rendered.
  const restored = useRef(false);
  useEffect(() => {
    if (!board || !wide || !scroller.current) return;
    if (!restored.current) { restored.current = true; scroller.current.scrollLeft = readFmsBoardView<BoardView>(familyId).scrollLeft ?? 0; }
    measure();
  }, [board, wide, familyId, measure]);
  const onScroll = () => { measure(); saveFmsBoardView(familyId, { filters, scrollLeft: scroller.current?.scrollLeft ?? 0, stageId: activeStage }); };
  const nudge = (direction: -1 | 1) => scroller.current?.scrollBy({ left: direction * 320, behavior: "smooth" });

  const open = (record: FmsWorkspaceRecord) => {
    const path = fmsAssignedWorkPath(record.target);
    rememberFmsBoardReturn(fmsTaskBoardPath(familyId), path);
    onNavigate(path);
  };
  const counts = board?.counts;
  const visible = wide ? columns : columns.filter((column) => column.id === activeStage);

  return <div className="space-y-4 text-task-text">
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button className="-ml-2" onClick={onBack} variant="ghost"><ArrowLeft aria-hidden="true" className="size-4" />All FMS workflows</Button>
        {canSeeTeam ? <Button onClick={() => onNavigate(`/fms?runs=${familyId}`)} variant="ghost">Runs and outcomes</Button> : null}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="min-w-0 break-words text-xl font-semibold">{board?.name ?? "FMS workflow"}</h2>
        {counts ? <dl aria-label="Workflow counts" className="flex flex-wrap gap-2 text-sm">
          <Count label="Active" value={counts.active} />
          <Count label="Due today" tone="today" value={counts.dueToday} />
          <Count label="Overdue" tone="overdue" value={counts.overdue} />
        </dl> : null}
      </div>
    </header>

    <div className="space-y-3 rounded-2xl border border-task-border p-3" role="search" aria-label="Filter this workflow's tasks">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-task-text-muted" />
          <span className="sr-only">Search customer or reference</span>
          <input className="task-field pl-9" maxLength={200} onChange={(event) => change({ query: event.target.value })} placeholder="Search customer or reference" type="search" value={filters.query} />
        </label>
        <select aria-label="Show" className="task-field w-auto" onChange={(event) => change({ status: event.target.value as FmsWorkspaceStatus })} value={filters.status}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <select aria-label="Priority" className="task-field w-auto" onChange={(event) => change({ priority: event.target.value as FmsWorkspacePriority })} value={filters.priority ?? "all"}>
          <option value="all">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select aria-label="Sort" className="task-field w-auto" onChange={(event) => change({ sort: event.target.value as FmsWorkspaceSort })} value={filters.sort ?? "due"}>
          <option value="due">Due soonest</option><option value="priority">Highest priority</option>
        </select>
        {canSeeTeam ? <select aria-label="Whose work" className="task-field w-auto" onChange={(event) => change(event.target.value === "all" ? { scope: "all" } : { scope: "mine", assigneeId: "" })} value={team ? "all" : "mine"}>
          <option value="mine">My work</option><option value="all">My team</option>
        </select> : null}
        {team ? <select aria-label="Employee" className="task-field w-auto max-w-48" onChange={(event) => change({ assigneeId: event.target.value })} value={filters.assigneeId ?? ""}>
          <option value="">Everyone</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select> : null}
        <Button aria-label="Refresh" disabled={result.loading} onClick={refresh} variant="secondary"><RefreshCw aria-hidden="true" className={cn("size-4", result.loading && "animate-spin")} /><span className="hidden sm:inline">Refresh</span></Button>
      </div>
      {filters.status === "active" ? <div className="no-scrollbar scroll-x -mx-1 flex gap-2 px-1" role="group" aria-label="Due">
        {DUE_TABS.map((tab) => { const value = !counts ? undefined : tab.value === "all" ? counts.active : tab.value === "overdue" ? counts.overdue : tab.value === "today" ? counts.dueToday : counts.upcoming;
          const selected = (filters.due ?? "all") === tab.value;
          return <button aria-pressed={selected} className={cn("min-h-11 shrink-0 rounded-full border px-3 text-sm", selected ? "border-task-accent bg-task-accent-soft font-semibold" : "border-task-border text-task-text-muted hover:bg-task-muted", tab.value === "overdue" && value ? "text-danger" : "")} key={tab.value} onClick={() => change({ due: tab.value })} type="button">{tab.label}{value !== undefined ? ` (${value})` : ""}</button>; })}
      </div> : null}
    </div>

    <FmsReadState {...result} />
    {board && !columns.length ? <div className="rounded-2xl border border-task-border px-5 py-12 text-center"><h3 className="font-semibold">No tasks in this workflow</h3><p className="mt-1 text-sm text-task-text-muted">Nothing here matches these filters.</p></div> : null}

    {board && columns.length && !wide ? <nav aria-label="Stages" className="no-scrollbar scroll-x -mx-1 flex gap-2 px-1">
      {columns.map((column) => <button aria-pressed={column.id === activeStage} className={cn("flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm", column.id === activeStage ? "border-task-accent bg-task-accent-soft font-semibold" : "border-task-border text-task-text-muted")} key={column.id} onClick={() => setActiveStage(column.id)} type="button">
        <span className="max-w-40 truncate">{column.name}</span><span className="tabular-nums">{column.count}</span>{column.overdue ? <span className="size-2 rounded-full bg-danger" aria-label={`${column.overdue} overdue`} /> : null}
      </button>)}
    </nav> : null}

    {board && visible.length ? <div className="relative">
      {wide && edges.left ? <button aria-label="Scroll to earlier stages" className="absolute left-0 top-0 z-20 flex h-full w-10 items-center justify-center bg-gradient-to-r from-task-bg to-transparent" onClick={() => nudge(-1)} type="button"><ChevronLeft className="size-5" /></button> : null}
      {wide && edges.right ? <button aria-label="Scroll to more stages" className="absolute right-0 top-0 z-20 flex h-full w-10 items-center justify-center bg-gradient-to-l from-task-bg to-transparent" onClick={() => nudge(1)} type="button"><ChevronRight className="size-5" /></button> : null}
      <div aria-label="Workflow stages" className={cn(wide ? "scroll-x flex gap-3 overflow-x-auto pb-3" : "")} onScroll={wide ? onScroll : undefined} ref={scroller} role="region" tabIndex={wide ? 0 : undefined}>
        {visible.map((column) => <BoardColumn column={column} effective={effective} familyId={familyId} key={`${column.id}|${identity}|${epoch}`} onOpen={open} showVersion={versions > 1} wide={wide} />)}
      </div>
      {wide && edges.right ? <p className="text-xs text-task-text-muted">Scroll sideways for more stages.</p> : null}
    </div> : null}
  </div>;
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "today" | "overdue" }) {
  return <div className={cn("rounded-full border px-3 py-1", tone === "overdue" && value ? "border-danger/40 bg-danger/10 text-danger" : tone === "today" && value ? "border-task-accent/40 bg-task-accent-soft" : "border-task-border")}>
    <dt className="inline">{label}: </dt><dd className="inline font-semibold tabular-nums">{value}</dd>
  </div>;
}

function BoardColumn({ column, familyId, effective, showVersion, wide, onOpen }: { column: FmsBoardStage; familyId: string; effective: FmsWorkspaceFilters; showVersion: boolean; wide: boolean; onOpen: (record: FmsWorkspaceRecord) => void }) {
  const [more, setMore] = useState<readonly FmsWorkspaceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const records = useMemo(() => { const seen = new Set<string>(); return [...column.records, ...more].filter((record) => !seen.has(record.id) && seen.add(record.id)); }, [column.records, more]);
  const remaining = Math.max(0, column.count - records.length);
  // A newer board (filters, refresh, realtime) remounts the column, so a late page is ignored.
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const loadMore = () => {
    setLoading(true); setError(null);
    void loadFmsTaskStagePage({ familyId, flowId: column.flowId, stageId: column.stageId, starting: column.starting }, effective, records.length, FMS_BOARD_PAGE_SIZE)
      .then((page) => { if (alive.current) setMore((current) => [...current, ...page.records]); })
      .catch((caught: unknown) => { if (alive.current) setError(caught instanceof Error ? caught.message : "Unable to load more tasks"); })
      .finally(() => { if (alive.current) setLoading(false); });
  };
  return <section aria-label={`${column.name}: ${column.count} tasks`} className={cn("flex flex-col rounded-2xl border border-task-border bg-task-muted/40", wide ? "w-72 shrink-0" : "w-full")}>
    <header className="sticky top-0 z-10 rounded-t-2xl border-b border-task-border bg-task-bg px-3 py-2.5">
      <h3 className="break-words text-sm font-semibold uppercase tracking-wide">{column.starting ? "Forms to start" : column.name}{showVersion ? <span className="ml-1.5 text-xs font-normal normal-case text-task-text-muted">v{column.version}</span> : null}</h3>
      <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-full bg-task-muted px-2 py-0.5 tabular-nums">{column.count} {effective.status === "active" ? "pending" : effective.status === "waiting" ? "waiting" : "done"}</span>
        {column.overdue ? <span className="rounded-full bg-danger/10 px-2 py-0.5 font-semibold tabular-nums text-danger">{column.overdue} overdue</span> : null}
        {column.dueToday ? <span className="rounded-full bg-task-accent-soft px-2 py-0.5 tabular-nums">{column.dueToday} today</span> : null}
      </p>
    </header>
    <div className={cn("space-y-2 p-2", wide && "max-h-[65dvh] overflow-y-auto")}>
      {!records.length ? <p className="px-2 py-6 text-center text-sm text-task-text-muted">No pending work.</p> : null}
      {records.map((record) => <BoardCard key={record.id} onOpen={onOpen} record={record} showAssignee={effective.scope === "all" || record.assignees.length > 1} />)}
      {error ? <p className="px-2 text-xs text-danger" role="alert">{error}</p> : null}
      {remaining ? <Button className="w-full" disabled={loading} onClick={loadMore} variant="secondary">{loading ? "Loading..." : `Show ${Math.min(remaining, FMS_BOARD_PAGE_SIZE)} more`}</Button> : null}
    </div>
  </section>;
}

/** "5 Nov 2026 · 3:30 pm" in India time. */
const stamp = (value: string) => formatKolkataDateTime(value).replace(/, (?=\d{1,2}:)/, " · ");

function BoardCard({ record, showAssignee, onOpen }: { record: FmsWorkspaceRecord; showAssignee: boolean; onOpen: (record: FmsWorkspaceRecord) => void }) {
  const path = fmsAssignedWorkPath(record.target);
  const done = record.status === "completed";
  const due = describeDue(record.dueAt, undefined, { completed: done });
  const overdue = !done && record.urgency === "overdue";
  const today = !done && record.urgency === "today";
  return <a aria-label={`${fmsRecordAction(record)} — ${record.name}`} className={cn("block rounded-xl border bg-task-bg p-3 transition-colors hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent", overdue ? "border-danger/50" : "border-task-border")} href={path}
    onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); onOpen(record); } }}>
    <div className="flex items-start justify-between gap-2">
      <h4 className="min-w-0 break-words font-semibold leading-snug">{record.name}</h4>
      {record.priority === "high" ? <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">{PRIORITY_LABEL.high}</span>
        : record.priority ? <span className="shrink-0 rounded-full border border-task-border px-2 py-0.5 text-[11px] text-task-text-muted">{PRIORITY_LABEL[record.priority]}</span> : null}
    </div>
    {record.reference ? <p className="mt-0.5 text-xs text-task-text-muted">REF: {record.reference}</p> : null}
    <p className={cn("mt-2 flex items-center gap-1.5 text-sm", overdue ? "font-semibold text-danger" : today ? "font-semibold" : "text-task-text-muted")}>
      <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
      {record.dueAt ? <time dateTime={record.dueAt}>{overdue ? `Overdue · ${stamp(record.dueAt)}` : today ? due.label.replace(/^Due today, /, "DUE TODAY · ") : due.label}</time> : <span>No due date</span>}
    </p>
    {overdue ? <p className="text-xs text-danger">{due.label}</p> : null}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-task-text-muted">
      {showAssignee && record.assignees.length ? <span>Assigned: {record.assignees.map((person) => person.name).join(", ")}</span> : null}
      {record.visitNumber > 1 ? <span>Visit {record.visitNumber}</span> : null}
      {record.status === "waiting" ? <span>Waiting for others</span> : null}
    </div>
  </a>;
}
