import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import {
  defaultFmsRecordFilters, defaultFmsReportFilters, describeDue, fmsAssignedWorkPath, fmsEmployeeStatusLabel, fmsPeriodRange, fmsTerminalOutcomeLabel, formatKolkataDateTime,
  type FmsFlowRecord, type FmsFlowReport, type FmsRecordFilters, type FmsRecordStatus, type FmsReportPeriod,
} from "@jewelos/core";
import { FMS_RECORD_PAGE_SIZE, loadFmsFlowRecords, loadFmsFlowReport } from "@jewelos/data/fms/outcomes";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Notice } from "@/components/ui";
import { FMS_OUTCOME_STYLE } from "@/features/fms/outcomeStyle";
import { FmsFunnelDetails, FmsOutcomeStrip } from "@/features/fms/workspace/FmsOutcomeStrip";
import { FmsInstanceDetail } from "@/features/fms/workspace/FmsInstanceDetail";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { cn } from "@/lib/utils";

export type FmsWorkspacePerson = Readonly<{ id: string; employee_name: string }>;
export type FmsWorkspaceVersion = Readonly<{ id: string; version: number; status: string }>;

const PERIODS: readonly { value: FmsReportPeriod; label: string }[] = [
  { value: "all", label: "All time" }, { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "custom", label: "Custom dates" },
];
const STATUS_OPTIONS: readonly { value: FmsRecordStatus; label: string }[] = [
  { value: "all", label: "All statuses" }, { value: "running", label: "Running" }, { value: "overdue", label: "Overdue" }, { value: "on_hold", label: "On hold" },
  { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "do_not_contact", label: "Do not contact" }, { value: "other", label: "Other ending" },
  { value: "unspecified", label: "Finished without End Node" }, { value: "completed", label: "All completed" }, { value: "cancelled", label: "Cancelled" },
];
const navigate = (path: string) => { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); };

/** What the row's main button does, named for what is waiting. */
export function fmsRecordNextAction(record: FmsFlowRecord): { label: string; path: string | null } {
  const mine = record.current.find((step) => step.mine);
  if (mine) return { label: mine.formTemplateId ? "Fill form" : "Open work", path: fmsAssignedWorkPath(mine.formTemplateId ? { kind: "stage_form", instanceId: record.id, instanceStageId: mine.visitId, formTemplateId: mine.formTemplateId } : { kind: "stage", instanceId: record.id, instanceStageId: mine.visitId }) };
  return { label: record.status === "completed" || record.status === "cancelled" ? "View journey" : "View details", path: null };
}
function recordStatus(record: FmsFlowRecord): { label: string; className: string } {
  if (record.status === "completed") return { label: record.outcome && record.outcome !== "unspecified" ? `${fmsTerminalOutcomeLabel(record.outcome)}${record.endStageName ? ` · ${record.endStageName}` : ""}` : "Completed", className: FMS_OUTCOME_STYLE[record.outcome ?? "unspecified"] };
  if (record.status === "cancelled") return { label: "Cancelled", className: "border-soft-grey/40 bg-charcoal text-soft-grey" };
  if (record.status === "on_hold") return { label: "On hold", className: "border-warning/40 bg-warning/10 text-warning" };
  if (record.overdue) return { label: "Overdue", className: "border-danger/40 bg-danger/10 text-danger" };
  return { label: record.current.length ? "In progress" : fmsEmployeeStatusLabel(record.status), className: "border-gold/40 bg-gold/10 text-gold-secondary" };
}

/**
 * One workspace for one workflow: counts, a single filter bar, every run the
 * employee may see (server-filtered and paged), and the run's details. It
 * replaces the separate My Stages / Started by Me / Branch View lists.
 */
export function FMSTasksPage({ familyId, workflowName, initialInstanceId, people = [], versions = [] }: { familyId?: string | undefined; workflowName?: string | undefined; initialInstanceId?: string | undefined; people?: readonly FmsWorkspacePerson[]; versions?: readonly FmsWorkspaceVersion[] }) {
  const { profile } = useAuth();
  const [openId, setOpenId] = useState(initialInstanceId ?? "");
  const [period, setPeriod] = useState<FmsReportPeriod>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [filters, setFilters] = useState<FmsRecordFilters>(defaultFmsRecordFilters);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<FmsFlowReport>();
  const [page, setPage] = useState<{ total: number; records: FmsFlowRecord[] }>();
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => setQuery(filters.query.trim()), 250); return () => window.clearTimeout(timer); }, [filters.query]);
  const range = period === "custom" ? custom : fmsPeriodRange(period);
  const reportFilters = useMemo(() => ({ ...defaultFmsReportFilters(), from: range.from, to: range.to, flowId: filters.flowId }), [range.from, range.to, filters.flowId]);
  const recordFilters = useMemo(() => ({ ...filters, query, from: range.from, to: range.to }), [filters, query, range.from, range.to]);
  const refresh = useCallback(() => setEpoch((value) => value + 1), []);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["fms"], refresh });
  useEffect(() => {
    if (!familyId || openId) return;
    let active = true; setError(null);
    void loadFmsFlowReport(familyId, reportFilters).then((value) => { if (active) setReport(value); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load counts"); });
    return () => { active = false; };
  }, [familyId, reportFilters, epoch, openId]);
  useEffect(() => {
    if (!familyId || openId) return;
    let active = true;
    void loadFmsFlowRecords(familyId, recordFilters, offset).then((value) => { if (active) setPage(value); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load workflow runs"); });
    return () => { active = false; };
  }, [familyId, recordFilters, offset, epoch, openId]);
  const change = (patch: Partial<FmsRecordFilters>) => { setFilters((current) => ({ ...current, ...patch })); setOffset(0); };

  if (!profile) return null;
  if (openId) return <FmsInstanceDetail instanceId={openId} onBack={() => { setOpenId(""); refresh(); }} />;
  if (!familyId) return <Notice>Choose a workflow from the FMS list to see its runs.</Notice>;
  const periodLabel = period === "custom" ? [custom.from || "the start", custom.to || "today"].join(" to ") : PERIODS.find((item) => item.value === period)?.label.toLowerCase() ?? "all time";
  const stageOptions = report?.stages ?? [];
  return <section className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><p className="text-xs uppercase tracking-wider text-champagne">Workflow</p><h1 className="break-words font-display text-2xl font-semibold text-white">{workflowName ?? "Workflow"}</h1></div>
      <label className="w-full sm:w-48"><span className="sr-only">Reporting period</span><select aria-label="Reporting period" className="field" onChange={(event) => { setPeriod(event.target.value as FmsReportPeriod); setOffset(0); }} value={period}>{PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    </header>
    {period === "custom" ? <div className="grid grid-cols-2 gap-2 sm:max-w-md"><Field label="From"><input className="field" onChange={(event) => setCustom((value) => ({ ...value, from: event.target.value }))} type="date" value={custom.from} /></Field><Field label="To"><input className="field" onChange={(event) => setCustom((value) => ({ ...value, to: event.target.value }))} type="date" value={custom.to} /></Field></div> : null}
    {error ? <Notice tone="danger">{error} <button className="underline" onClick={refresh} type="button">Retry</button></Notice> : null}
    <FmsOutcomeStrip active={filters.status} onPick={(status) => change({ status })} periodLabel={periodLabel} report={report} />
    {report ? <FmsFunnelDetails report={report} /> : null}
    <div aria-label="Find workflow runs" className="space-y-2 rounded-2xl border border-gold/20 p-3" role="search">
      <label className="relative block"><Search aria-hidden className="absolute left-3 top-3 size-4 text-soft-grey" /><input aria-label="Search customer or reference" className="field pl-9" maxLength={200} onChange={(event) => change({ query: event.target.value })} placeholder="Search customer or reference" type="search" value={filters.query} /></label>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <select aria-label="Status" className="field" onChange={(event) => change({ status: event.target.value as FmsRecordStatus })} value={filters.status}>{STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select aria-label="Step" className="field" onChange={(event) => change({ stageKey: event.target.value })} value={filters.stageKey}><option value="">All steps</option>{stageOptions.map((stage) => <option key={stage.stageKey} value={stage.stageKey}>{stage.type === "end" ? `Ended at ${stage.name}` : stage.name}</option>)}</select>
        <select aria-label="Employee" className="field" onChange={(event) => change({ assigneeId: event.target.value })} value={filters.assigneeId}><option value="">Any employee</option>{people.map((person) => <option key={person.id} value={person.id}>{person.employee_name}</option>)}</select>
        <select aria-label="Show" className="field" onChange={(event) => change({ scope: event.target.value as FmsRecordFilters["scope"] })} value={filters.scope}><option value="all">Everything I can see</option><option value="mine">Only my work</option></select>
        {versions.filter((item) => item.status !== "draft").length > 1 ? <select aria-label="Version" className="field" onChange={(event) => change({ flowId: event.target.value })} value={filters.flowId}><option value="">All versions</option>{versions.filter((item) => item.status !== "draft").map((item) => <option key={item.id} value={item.id}>Version {item.version}</option>)}</select> : null}
      </div>
    </div>
    {!page ? <div aria-label="Loading workflow runs" className="h-48 animate-pulse rounded-2xl bg-charcoal" />
      : page.records.length === 0 ? <Notice>No workflow runs match these filters.</Notice>
      : <>
        <p className="px-1 text-sm text-soft-grey">{page.total} run{page.total === 1 ? "" : "s"}</p>
        <ul className="space-y-2">{page.records.map((record) => <FmsRecordRow key={record.id} onOpen={() => setOpenId(record.id)} record={record} />)}</ul>
        {page.total > FMS_RECORD_PAGE_SIZE ? <nav aria-label="Workflow run pages" className="flex items-center justify-center gap-3"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - FMS_RECORD_PAGE_SIZE))} variant="secondary">Previous</Button><span className="text-xs text-soft-grey">{offset + 1} - {Math.min(offset + FMS_RECORD_PAGE_SIZE, page.total)} of {page.total}</span><Button disabled={offset + FMS_RECORD_PAGE_SIZE >= page.total} onClick={() => setOffset(offset + FMS_RECORD_PAGE_SIZE)} variant="secondary">Next</Button></nav> : null}
      </>}
  </section>;
}

function FmsRecordRow({ record, onOpen }: { record: FmsFlowRecord; onOpen: () => void }) {
  const status = recordStatus(record);
  const action = fmsRecordNextAction(record);
  const firstDue = record.current.find((step) => step.dueAt)?.dueAt ?? null;
  const due = describeDue(firstDue);
  const people = [...new Set(record.current.flatMap((step) => step.assignees))];
  return <li className={cn("rounded-2xl border bg-charcoal/60 p-3 sm:p-4", record.overdue && record.status !== "completed" ? "border-danger/40" : "border-gold/20")}>
    <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_17rem] md:items-center">
      <button className="min-w-0 text-left" onClick={onOpen} type="button">
        <p className="truncate text-xs text-gold-secondary">{record.reference} · v{record.version}</p>
        <p className="break-words font-semibold text-white">{record.name}</p>
      </button>
      <div className="min-w-0 text-sm">
        <p className="truncate text-white">{record.current.length ? record.current.map((step) => `${step.stageName}${step.visitNumber > 1 ? ` (visit ${step.visitNumber})` : ""}`).join(", ") : record.endStageName ?? "No open step"}</p>
        <p className="truncate text-xs text-soft-grey">{people.length ? people.join(", ") : record.status === "completed" || record.status === "cancelled" ? "Finished" : "No owner yet"}</p>
      </div>
      <div className="min-w-0 text-xs text-soft-grey">
        <span className={cn("inline-block rounded-full border px-2 py-0.5 font-semibold", status.className)}>{status.label}</span>
        {firstDue && record.current.length ? <p className={cn("mt-1", due.tone === "overdue" && "font-semibold text-danger")}>{due.label}</p> : null}
        {record.updatedAt ? <p className="mt-0.5">Updated {formatKolkataDateTime(record.updatedAt)}</p> : null}
      </div>
      <div className="flex gap-2 md:justify-end">
        {action.path ? <Button className="min-h-11 flex-1 md:flex-none" onClick={() => navigate(action.path!)}>{action.label}<ChevronRight aria-hidden className="size-4" /></Button> : null}
        <Button className="min-h-11 flex-1 md:flex-none" onClick={onOpen} variant="secondary">{action.path ? "View journey" : action.label}</Button>
      </div>
    </div>
  </li>;
}
