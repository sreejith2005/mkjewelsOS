import { useState, type ComponentType } from "react";
import { CircleDot, Contact, FileText, Image as ImageIcon, Paperclip, Repeat, Video, Workflow } from "lucide-react";
import { Button } from "@/components/ui";
import { EmptyMessage, Panel, StatusDot } from "@/features/analytics/components";
import { signedTaskEvidenceUrl } from "@/features/taskEvidence/api";
import type { EvidenceWorkspace, TaskAttachmentSummary, TaskRow, TaskView } from "@/features/taskEvidence/types";
import {
  evidenceFileSize, isFmsWorkKind, taskRowTone, taskWorkKind,
  TASK_VIEW_LABELS as CORE_TASK_VIEW_LABELS, TASK_WORK_KIND_FILTERS, TASK_WORK_KIND_LABELS,
  type TaskWorkKind, type TaskWorkKindFilter,
} from "@jewelos/core";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const fileSize = evidenceFileSize;

export const TASK_VIEW_LABELS = CORE_TASK_VIEW_LABELS as ReadonlyArray<readonly [TaskView, string]>;

const statusTone = taskRowTone;
type TaskSelection = Readonly<{ ids: readonly string[]; onChange: (ids: string[]) => void }>;

/**
 * Each kind of work has its own icon, label and tone, so a row reads as
 * one-time, recurring, FMS or CRM at a glance -- the label carries the meaning,
 * the colour only speeds up scanning.
 */
const KIND_STYLE: Readonly<Record<TaskWorkKind, { Icon: ComponentType<{ className?: string }>; badge: string; edge: string }>> = {
  one_time: { Icon: CircleDot, badge: "border border-task-border bg-task-muted text-task-text", edge: "border-l-task-text-muted/50" },
  recurring: { Icon: Repeat, badge: "bg-gold/15 text-gold-secondary", edge: "border-l-gold" },
  fms_step: { Icon: Workflow, badge: "bg-task-accent-soft text-task-text", edge: "border-l-task-accent" },
  fms_start: { Icon: Workflow, badge: "bg-task-accent-soft text-task-text", edge: "border-l-task-accent" },
  crm: { Icon: Contact, badge: "bg-champagne/40 text-task-text", edge: "border-l-champagne" },
};

function KindBadge({ kind }: { kind: TaskWorkKind }) {
  const { Icon, badge } = KIND_STYLE[kind];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", badge)} data-testid="work-kind">
      <Icon className="size-3.5 shrink-0" />
      {TASK_WORK_KIND_LABELS[kind]}
    </span>
  );
}

function WorkTypeChip({ row }: { row: TaskRow }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        row.is_upload_work ? "bg-task-border/60 text-task-text-muted" : "bg-gold/15 text-gold-secondary"
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
  const Icon = file.mime_type?.startsWith("image/") ? ImageIcon : file.mime_type?.startsWith("video/") ? Video : FileText;
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

/** FMS work that is still open can be removed; finished FMS history stays. */
const OPEN_FMS_STATUSES = new Set(["pending", "in_progress", "in_review", "overdue"]);

function TaskCard({ row, onOpen, onManage, onDelete, selection }: { row: TaskRow; onOpen: (file: TaskAttachmentSummary) => void; onManage?: ((id: string) => void) | undefined; onDelete?: ((row: TaskRow) => void) | undefined; selection?: TaskSelection | undefined }) {
  const kind = taskWorkKind(row);
  const fms = isFmsWorkKind(kind);
  const late = row.overdue && row.task_status !== "completed";
  return (
    <article className={cn("rounded-lg border border-l-4 border-task-border p-3", KIND_STYLE[kind].edge)}>
      {selection && row.task_type !== "fms" ? <label className="mb-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selection.ids.includes(row.task_id)} onChange={(event) => selection.onChange(event.target.checked ? [...selection.ids, row.task_id] : selection.ids.filter((id) => id !== row.task_id))} />Select {row.task_title}</label> : null}
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={kind} />
        {fms ? null : <WorkTypeChip row={row} />}
        <span className={cn("ml-auto inline-flex items-center gap-1.5 text-xs", late ? "font-semibold text-task-overdue" : "text-task-text-muted")}>
          <StatusDot tone={statusTone(row)} />
          {late ? "Overdue" : titleCase(row.task_status)}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 break-words text-sm font-medium">{row.task_title}</p>
      {row.work_context ? <p className="mt-0.5 break-words text-xs font-medium text-task-text">{row.work_context}</p> : null}
      <p className="mt-0.5 break-words text-xs text-task-text-muted">
        {row.assignee_names ?? "Unassigned"} · {row.branch_name ?? "No branch"}
        {row.department_name ? ` · ${row.department_name}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-task-text-muted">
        {kind === "fms_start" ? `Assigned ${dateTime(row.planned_datetime)} · not started yet` : `Due ${dateTime(row.due_datetime ?? row.planned_datetime)}`}
        {row.actual_datetime ? ` · Completed ${dateTime(row.actual_datetime)}` : ""}
      </p>
      <div className="mt-2 border-t border-task-border pt-2">
        {fms
          ? <span className="text-xs text-task-text-muted">Forms and files for FMS work stay on the FMS step.</span>
          : <EvidenceCell onOpen={onOpen} row={row} />}
        {!fms && (onManage || onDelete) ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {onManage ? <Button variant="secondary" onClick={() => onManage(row.task_id)}>Edit task</Button> : null}
            {onDelete ? <Button variant="danger" onClick={() => onDelete(row)}>Delete</Button> : null}
          </div>
        ) : null}
        {fms && onDelete && OPEN_FMS_STATUSES.has(row.task_status) ? (
          <Button className="mt-2" variant="danger" onClick={() => onDelete(row)}>{kind === "fms_start" ? "Delete start form" : "Delete FMS task"}</Button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Every piece of work assigned in the current scope -- one-time, recurring, FMS
 * and CRM together. The view and type chips narrow the same server-paginated
 * list, so the counts on screen and the rows on screen describe the same set.
 */
export function TasksTab({
  evidence,
  view,
  kind = "all",
  page,
  pageSize,
  onView,
  onKind,
  onPage,
  onPageSize,
  onManage,
  onDelete,
  selection,
  onBulkDelete,
}: {
  evidence: EvidenceWorkspace;
  view: TaskView;
  kind?: TaskWorkKindFilter;
  page: number;
  pageSize: number;
  onView: (view: TaskView) => void;
  onKind?: ((kind: TaskWorkKindFilter) => void) | undefined;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onManage?: ((id: string) => void) | undefined;
  onDelete?: ((row: TaskRow) => void) | undefined;
  selection?: TaskSelection | undefined;
  onBulkDelete?: ((ids: readonly string[] | null) => void) | undefined;
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
      {selection && onBulkDelete ? <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => selection.onChange([...new Set([...selection.ids, ...evidence.tasks.filter((row) => row.task_type !== "fms").map((row) => row.task_id)])])}>Select this page</Button>
        <Button variant="secondary" disabled={!selection.ids.length} onClick={() => selection.onChange([])}>Clear selection</Button>
        <span className="text-sm">{selection.ids.length} selected</span>
        <Button variant="danger" disabled={!selection.ids.length} onClick={() => onBulkDelete(selection.ids)}>Delete selected</Button>
        <Button variant="danger" onClick={() => onBulkDelete(null)}>Delete all matching</Button>
      </div> : null}
      <div className="scroll-x no-scrollbar flex gap-2 pb-1" role="group" aria-label="Task view">
        {TASK_VIEW_LABELS.map(([value, label]) => (
          <button
            aria-pressed={view === value}
            className={
              view === value
                ? "min-h-9 shrink-0 rounded-full bg-gold px-4 text-xs font-semibold text-on-gold"
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

      {onKind ? (
        <div className="scroll-x no-scrollbar flex items-center gap-2 pb-1" role="group" aria-label="Work type">
          <span className="shrink-0 text-xs font-semibold text-task-text-muted">Type</span>
          {TASK_WORK_KIND_FILTERS.map(([value, label]) => {
            const count = evidence.kind_counts?.[value];
            return (
              <button
                aria-pressed={kind === value}
                className={
                  kind === value
                    ? "min-h-9 shrink-0 rounded-full border border-task-accent bg-task-accent-soft px-3 text-xs font-semibold text-task-text"
                    : "min-h-9 shrink-0 rounded-full border border-task-border px-3 text-xs font-medium text-task-text hover:bg-task-muted"
                }
                key={value}
                onClick={() => onKind(value)}
                type="button"
              >
                {label}{count === undefined ? "" : ` · ${count.toLocaleString("en-IN")}`}
              </button>
            );
          })}
        </div>
      ) : null}

      {openError ? (
        <p aria-live="polite" className="rounded-lg border border-task-overdue/40 bg-task-bg p-3 text-sm text-task-overdue" role="alert">{openError}</p>
      ) : null}

      <Panel
        description={`${evidence.tasks_total.toLocaleString("en-IN")} task${evidence.tasks_total === 1 ? "" : "s"} in this view, of ${(evidence.kind_counts?.all ?? evidence.stats.tasks_total).toLocaleString("en-IN")} in scope. ${evidence.stats.evidence_files.toLocaleString("en-IN")} file${evidence.stats.evidence_files === 1 ? "" : "s"} uploaded, ${fileSize(evidence.stats.evidence_bytes)} total. Files open in a new tab through a 60-second signed link.`}
        title="Assigned tasks"
      >
        {evidence.tasks.length === 0 ? (
          <EmptyMessage>No tasks match these filters.</EmptyMessage>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {evidence.tasks.map((row) => <TaskCard key={row.task_id} onOpen={(file) => void openFile(file)} onManage={onManage} onDelete={onDelete} selection={selection} row={row} />)}
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
