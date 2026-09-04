import { useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { EmptyMessage, Panel, StatusDot } from "@/features/analytics/components";
import { signedTaskEvidenceUrl } from "@/features/taskEvidence/api";
import type { EvidenceRow, EvidenceWorkspace, OutstandingRow } from "@/features/taskEvidence/types";
import { titleCase } from "@/lib/format";

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const isImage = (mime: string | null) => Boolean(mime?.startsWith("image/"));

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
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

export function EvidenceTab({
  evidence,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  evidence: EvidenceWorkspace;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const [openError, setOpenError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(evidence.evidence_total / pageSize));

  const openEvidence = async (row: EvidenceRow) => {
    setOpenError(null);
    try { window.open(await signedTaskEvidenceUrl(row.attachment_id), "_blank", "noopener,noreferrer"); }
    catch (failure) { setOpenError(failure instanceof Error ? failure.message : "The file could not be opened."); }
  };

  return <div className="space-y-4">
    {openError ? <p aria-live="polite" role="alert" className="rounded-lg border border-task-overdue/40 bg-task-bg p-3 text-sm text-task-overdue">{openError}</p> : null}

    <Panel
      description={`${evidence.evidence_total.toLocaleString("en-IN")} file${evidence.evidence_total === 1 ? "" : "s"} in scope, ${fileSize(evidence.stats.evidence_bytes)} total. Files open in a new tab through a 60-second signed link.`}
      title="Uploaded evidence"
    >
      {evidence.evidence.length === 0 ? <EmptyMessage>No files were uploaded against tasks matching these filters.</EmptyMessage> : <>
        <div className="flex flex-col gap-2">{evidence.evidence.map((row) => <EvidenceCard key={row.attachment_id} onOpen={(target) => void openEvidence(target)} row={row} />)}</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={page <= 1} onClick={() => onPage(page - 1)} variant="secondary">Previous</Button>
          <span className="text-xs text-task-text-muted">Page {page} of {totalPages}</span>
          <label className="flex items-center gap-2 text-xs text-task-text-muted">
            Per page
            <select className="task-field w-20 py-1" onChange={(event) => onPageSize(Number(event.target.value))} value={pageSize}>
              {[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}
            </select>
          </label>
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={page >= totalPages} onClick={() => onPage(page + 1)} variant="secondary">Next</Button>
        </div>
      </>}
    </Panel>

    <Panel
      description={`${evidence.missing_total.toLocaleString("en-IN")} task${evidence.missing_total === 1 ? "" : "s"} still owe evidence${evidence.missing_total > evidence.missing.length ? `; the ${evidence.missing.length} most urgent are listed` : ""}.`}
      title="Upload-required tasks with no file"
    >
      {evidence.missing.length === 0 ? <EmptyMessage>Every upload-required task in this range has a file.</EmptyMessage>
        : <div className="flex flex-col gap-2">{evidence.missing.map((row) => <OutstandingCard key={row.task_id} row={row} />)}</div>}
    </Panel>
  </div>;
}
