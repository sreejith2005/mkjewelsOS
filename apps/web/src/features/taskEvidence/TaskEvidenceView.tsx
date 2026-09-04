import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Image as ImageIcon, RefreshCw } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui";
import { EmptyMessage, ErrorPanel, LoadingPanels, PageHeading, PageSurface, Panel, StatusDot } from "@/features/analytics/components";
import { fetchReportingOptions, type ReportingOptions } from "@/features/analytics/api";
import { titleCase } from "@/lib/format";
import { fetchTaskEvidenceWorkspace, signedTaskEvidenceUrl } from "./api";
import type { EvidenceRow, EvidenceStats, EvidenceWorkspace, OutstandingRow } from "./types";

const EVIDENCE_ROLES = ["super_admin", "admin", "manager", "hr"];
const iso = (date: Date) => date.toISOString().slice(0, 10);
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const fileSize = (bytes: number | null) => bytes === null ? "—" : bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
const isImage = (mime: string | null) => Boolean(mime?.startsWith("image/"));

type Query = { from: string; to: string; branch_id: string; department_id: string; user_profile_id: string; search: string; page: number; page_size: number };

const STAT_TILES = [
  { key: "upload_tasks", label: "Upload tasks", hint: "Tasks that require a file" },
  { key: "upload_tasks_with_evidence", label: "Evidence received", hint: "At least one file uploaded" },
  { key: "upload_tasks_awaiting_evidence", label: "Awaiting evidence", hint: "Required file not uploaded" },
  { key: "completed", label: "Completed", hint: "All tasks in this range" },
  { key: "remaining", label: "Remaining", hint: "Not yet completed" },
  { key: "overdue", label: "Overdue", hint: "Past the effective deadline" },
] as const;

function StatGrid({ stats }: { stats: EvidenceStats }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
    {STAT_TILES.map((tile) => <div className="rounded-xl border border-task-border bg-task-bg p-4" key={tile.key}>
      <p className="text-xs text-task-text-muted">{tile.label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{stats[tile.key].toLocaleString("en-IN")}</p>
      <p className="mt-1 text-[0.6875rem] text-task-text-muted">{tile.hint}</p>
    </div>)}
  </div>;
}

/**
 * Evidence opens through a short-lived signed URL requested at click time, so no
 * durable object link is ever rendered into the page.
 */
function EvidenceCard({ row, onOpen }: { row: EvidenceRow; onOpen: (row: EvidenceRow) => void }) {
  return <article className="flex flex-col gap-3 rounded-lg border border-task-border p-3 sm:flex-row sm:items-center">
    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-task-muted text-task-text-muted">
      {isImage(row.mime_type) ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{row.task_title}</p>
      <p className="mt-0.5 truncate text-xs text-task-text-muted">
        {row.original_filename ?? "Unnamed file"} · {fileSize(row.size_bytes)} · {row.mime_type ?? "unknown type"}
      </p>
      <p className="mt-0.5 truncate text-xs text-task-text-muted">
        Uploaded by {row.uploaded_by_name ?? "Unknown"} on {dateTime(row.uploaded_at)}
        {row.assignee_names ? ` · Assigned to ${row.assignee_names}` : ""}
      </p>
      <p className="mt-0.5 truncate text-xs text-task-text-muted">
        {row.branch_name ?? "No branch"}{row.department_name ? ` · ${row.department_name}` : ""} · Due {dateTime(row.planned_datetime)}
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-3">
      <span className="inline-flex items-center gap-2 text-xs text-task-text-muted">
        <StatusDot tone={row.task_status === "completed" ? "success" : row.task_status === "rejected" ? "danger" : "warning"} />
        {titleCase(row.task_status)}
      </span>
      <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={() => onOpen(row)} variant="secondary">View file</Button>
    </div>
  </article>;
}

function OutstandingCard({ row }: { row: OutstandingRow }) {
  return <article className="grid gap-1 rounded-lg border border-task-border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{row.task_title}</p>
      <p className="mt-0.5 truncate text-xs text-task-text-muted">
        {row.assignee_names ?? "Unassigned"} · {row.branch_name ?? "No branch"}{row.department_name ? ` · ${row.department_name}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-task-text-muted">Due {dateTime(row.due_datetime ?? row.planned_datetime)}</p>
    </div>
    <span className="inline-flex items-center gap-2 text-xs sm:justify-self-end">
      <StatusDot tone={row.overdue ? "danger" : "warning"} />
      {row.overdue ? "Overdue, no file" : `${titleCase(row.task_status)}, no file`}
    </span>
  </article>;
}

export function TaskEvidenceView() {
  const { profile } = useAuth();
  const role = profile!.user_role;
  const canSelectBranch = ["super_admin", "admin", "hr"].includes(role);
  const [query, setQuery] = useState<Query>(() => ({
    from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(new Date()),
    branch_id: "", department_id: "", user_profile_id: "", search: "", page: 1, page_size: 25,
  }));
  const [data, setData] = useState<EvidenceWorkspace | null>(null);
  const [options, setOptions] = useState<ReportingOptions>({ branches: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => { void fetchReportingOptions().then(setOptions).catch(() => setOptions({ branches: [], departments: [] })); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setData(await fetchTaskEvidenceWorkspace({
        from: query.from, to: query.to, branch_id: query.branch_id || undefined,
        department_id: query.department_id || undefined, user_profile_id: query.user_profile_id || undefined,
        search: query.search || undefined, page: query.page, page_size: query.page_size,
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Evidence workspace request failed");
    } finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  const openEvidence = async (row: EvidenceRow) => {
    setOpenError(null);
    try { window.open(await signedTaskEvidenceUrl(row.attachment_id), "_blank", "noopener,noreferrer"); }
    catch (failure) { setOpenError(failure instanceof Error ? failure.message : "The file could not be opened."); }
  };

  const change = (key: keyof Query, value: string | number) =>
    setQuery((current) => ({ ...current, [key]: value, page: key === "page" ? Number(value) : 1 }));
  const scopedDepartments = useMemo(
    () => options.departments.filter((item) => !query.branch_id || item.branch_id === null || item.branch_id === query.branch_id),
    [options.departments, query.branch_id],
  );
  const totalPages = Math.max(1, Math.ceil((data?.evidence_total ?? 0) / query.page_size));

  if (!EVIDENCE_ROLES.includes(role)) {
    return <PageSurface><PageHeading title="Task Evidence" description="This workspace is limited to administrators, managers, and HR." />
      <EmptyMessage>You do not have access to task evidence tracking.</EmptyMessage></PageSurface>;
  }

  return <PageSurface>
    <PageHeading
      title="Task Evidence Tracking"
      description="Every file uploaded against a task in your authorized scope, plus the upload-required tasks that are still missing one."
      actions={<Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={() => void load()} variant="secondary"><RefreshCw />Refresh</Button>}
    />
    <div className="mb-4 rounded-xl border border-task-border bg-task-bg p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label><span className="mb-1 block text-xs font-medium text-task-text-muted">From</span><input className="task-field" onChange={(event) => change("from", event.target.value)} type="date" value={query.from} /></label>
        <label><span className="mb-1 block text-xs font-medium text-task-text-muted">To</span><input className="task-field" onChange={(event) => change("to", event.target.value)} type="date" value={query.to} /></label>
        {canSelectBranch ? <label><span className="mb-1 block text-xs font-medium text-task-text-muted">Branch</span><select className="task-field" onChange={(event) => { setQuery((current) => ({ ...current, branch_id: event.target.value, department_id: "", page: 1 })); }} value={query.branch_id}><option value="">All authorized branches</option>{options.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        <label><span className="mb-1 block text-xs font-medium text-task-text-muted">Department</span><select className="task-field" onChange={(event) => change("department_id", event.target.value)} value={query.department_id}><option value="">All authorized departments</option>{scopedDepartments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-task-text-muted">Search task title or description</span><input className="task-field" onChange={(event) => change("search", event.target.value)} placeholder="All tasks" value={query.search} /></label>
        <label><span className="mb-1 block text-xs font-medium text-task-text-muted">Files per page</span><select className="task-field" onChange={(event) => change("page_size", Number(event.target.value))} value={query.page_size}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label>
      </div>
      <p className="mt-3 text-xs text-task-text-muted">
        Showing {query.from} through {query.to}
        {query.branch_id ? " · selected branch" : " · all authorized branches"}
        {query.department_id ? " · selected department" : ""}. Maximum range 366 days. Manager scope is fixed to your own branch.
      </p>
    </div>

    {openError ? <p aria-live="polite" role="alert" className="mb-4 rounded-lg border border-task-overdue/40 bg-task-bg p-3 text-sm text-task-overdue">{openError}</p> : null}

    {loading ? <LoadingPanels count={4} /> : error ? <ErrorPanel message={error} onRetry={load} /> : data ? <div className="space-y-4">
      <StatGrid stats={data.stats} />
      <Panel
        title="Uploaded evidence"
        description={`${data.evidence_total.toLocaleString("en-IN")} file${data.evidence_total === 1 ? "" : "s"} in scope, ${fileSize(data.stats.evidence_bytes)} total. Files open in a new tab through a 60-second signed link.`}
      >
        {data.evidence.length === 0 ? <EmptyMessage>No files were uploaded against tasks matching these filters.</EmptyMessage> : <>
          <div className="flex flex-col gap-2">{data.evidence.map((row) => <EvidenceCard key={row.attachment_id} onOpen={(target) => void openEvidence(target)} row={row} />)}</div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={query.page <= 1} onClick={() => change("page", query.page - 1)} variant="secondary">Previous</Button>
            <span className="text-xs text-task-text-muted">Page {query.page} of {totalPages}</span>
            <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={query.page >= totalPages} onClick={() => change("page", query.page + 1)} variant="secondary">Next</Button>
          </div>
        </>}
      </Panel>
      <Panel
        title="Upload-required tasks with no file"
        description={`${data.missing_total.toLocaleString("en-IN")} task${data.missing_total === 1 ? "" : "s"} still owe evidence${data.missing_total > data.missing.length ? `; the ${data.missing.length} most urgent are listed` : ""}.`}
      >
        {data.missing.length === 0 ? <EmptyMessage>Every upload-required task in this range has a file.</EmptyMessage>
          : <div className="flex flex-col gap-2">{data.missing.map((row) => <OutstandingCard key={row.task_id} row={row} />)}</div>}
      </Panel>
    </div> : null}
  </PageSurface>;
}
