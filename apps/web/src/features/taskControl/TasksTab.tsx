import { useState } from "react";
import { FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import { Button } from "@/components/ui";
import { EmptyMessage, Panel, StatusDot } from "@/features/analytics/components";
import { signedTaskEvidenceUrl } from "@/features/taskEvidence/api";
import type { EvidenceWorkspace, TaskAttachmentSummary, TaskRow, TaskView } from "@/features/taskEvidence/types";
import { titleCase } from "@/lib/format";

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export const TASK_VIEW_LABELS: ReadonlyArray<readonly [TaskView, string]> = [
  ["all", "All tasks"],
  ["remaining", "Not completed"],
  ["overdue", "Overdue"],
  ["completed", "Completed"],
  ["checklist", "Checklist"],
  ["upload", "Upload"],
  ["awaiting_evidence", "Awaiting evidence"],
];

function statusTone(row: TaskRow) {
  if (row.task_status === "completed") return "success" as const;
  if (row.task_status === "rejected") return "danger" as const;
  return row.overdue ? "danger" as const : "warning" as const;
}

function WorkTypeChip({ row }: { row: TaskRow }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        row.is_upload_work ? "bg-task-border/60 text-task-text-muted" : "bg-gold/15 text-gold"
      }`}
    >
      {row.is_upload_work ? "Upload" : "Checkbox"}
    </span>
  );
}

/**
 * Evidence opens through a short-lived signed URL requested at click time, so no
 * durable object link is ever rendered into the page.
 */
function AttachmentChip({ file, onOpen }: { file: TaskAttachmentSummary; onOpen: () => void }) {
  const Icon = file.mime_type?.startsWith("image/") ? ImageIcon : FileText;
  return (
    <button
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-task-border px-2.5 py-1 text-[11px] text-task-text hover:bg-gold/10"
      onClick={onOpen}
      title={`${file.original_filename ?? "Unnamed file"} · ${fileSize(file.size_bytes)} · uploaded by ${file.uploaded_by_name ?? "Unknown"} on ${dateTime(file.uploaded_at)}`}
      type="button"
    >
      <Icon className="size-3.5 shrink-0 text-task-text-muted" />
      <span className="truncate">{file.original_filename ?? "Unnamed file"}</span>
      <span className="shrink-0 text-task-text-muted">{fileSize(file.size_bytes)}</span>
    </button>
  );
}

/** What came back against this task, or why nothing did. */
function EvidenceCell({ row, onOpen }: { row: TaskRow; onOpen: (file: TaskAttachmentSummary) => void }) {
  if (row.attachments.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {row.attachments.map((file) => <AttachmentChip file={file} key={file.attachment_id} onOpen={() => onOpen(file)} />)}
      </div>
    );
  }
  if (row.requires_upload) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
        <Paperclip className="size-3.5" />
        Required, no file yet
      </span>
    );
  }
  return <span className="text-xs text-task-text-muted">No file required</span>;
}

function TaskCard({ row, onOpen }: { row: TaskRow; onOpen: (file: TaskAttachmentSummary) => void }) {
  return (
    <article className="rounded-lg border border-task-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.task_title}</p>
          <p className="mt-0.5 truncate text-xs text-task-text-muted">
            {row.assignee_names ?? "Unassigned"} · {row.branch_name ?? "No branch"}
            {row.department_name ? ` · ${row.department_name}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-task-text-muted">
            Due {dateTime(row.due_datetime ?? row.planned_datetime)}
            {row.actual_datetime ? ` · Completed ${dateTime(row.actual_datetime)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WorkTypeChip row={row} />
          <span className="inline-flex items-center gap-1.5 text-xs text-task-text-muted">
            <StatusDot tone={statusTone(row)} />
            {row.overdue && row.task_status !== "completed" ? "Overdue" : titleCase(row.task_status)}
          </span>
        </div>
      </div>
      <div className="mt-2 border-t border-task-border pt-2">
        <EvidenceCell onOpen={onOpen} row={row} />
      </div>
    </article>
  );
}

/**
 * Every task assigned in the current scope, checklist and upload together. The
 * view chips narrow the same server-paginated list, so the counts on screen and
 * the rows on screen always describe the same set.
 */
export function TasksTab({
  evidence,
  view,
  page,
  pageSize,
  onView,
  onPage,
  onPageSize,
}: {
  evidence: EvidenceWorkspace;
  view: TaskView;
  page: number;
  pageSize: number;
  onView: (view: TaskView) => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const [openError, setOpenError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(evidence.tasks_total / pageSize));

  const openFile = async (file: TaskAttachmentSummary) => {
    setOpenError(null);
    try { window.open(await signedTaskEvidenceUrl(file.attachment_id), "_blank", "noopener,noreferrer"); }
    catch (failure) { setOpenError(failure instanceof Error ? failure.message : "The file could not be opened."); }
  };

  return (
    <div className="space-y-4">
      <div className="scroll-x no-scrollbar flex gap-2 pb-1" role="group" aria-label="Task view">
        {TASK_VIEW_LABELS.map(([value, label]) => (
          <button
            aria-pressed={view === value}
            className={
              view === value
                ? "min-h-9 shrink-0 rounded-full bg-gold px-4 text-xs font-semibold text-obsidian"
                : "min-h-9 shrink-0 rounded-full bg-task-muted px-4 text-xs font-medium text-task-text hover:bg-gold/10"
            }
            key={value}
            onClick={() => onView(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {openError ? (
        <p aria-live="polite" className="rounded-lg border border-task-overdue/40 bg-task-bg p-3 text-sm text-task-overdue" role="alert">{openError}</p>
      ) : null}

      <Panel
        description={`${evidence.tasks_total.toLocaleString("en-IN")} task${evidence.tasks_total === 1 ? "" : "s"} in this view, of ${evidence.stats.tasks_total.toLocaleString("en-IN")} in scope. ${evidence.stats.evidence_files.toLocaleString("en-IN")} file${evidence.stats.evidence_files === 1 ? "" : "s"} uploaded, ${fileSize(evidence.stats.evidence_bytes)} total. Files open in a new tab through a 60-second signed link.`}
        title="Assigned tasks"
      >
        {evidence.tasks.length === 0 ? (
          <EmptyMessage>No tasks match these filters.</EmptyMessage>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {evidence.tasks.map((row) => <TaskCard key={row.task_id} onOpen={(file) => void openFile(file)} row={row} />)}
            </div>
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
          </>
        )}
      </Panel>
    </div>
  );
}
