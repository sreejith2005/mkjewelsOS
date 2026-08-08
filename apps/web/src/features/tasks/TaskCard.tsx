import { useState, type ChangeEvent } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock, Eye, FileUp, PauseCircle, Play, UserRoundPlus, Users } from "lucide-react";
import { calculateTaskChecklistProgress, isTaskFeedItemOverdue, type Enums, type TaskMutationCapability } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { TaskBundle } from "./api";

export type TaskCardAction =
  | { kind: "start" }
  | { checklistId: string; completed: boolean; kind: "checklist" }
  | { kind: "complete"; remark: string }
  | { file: File; kind: "upload" }
  | { kind: "delegate" }
  | { datetime: string; kind: "revise"; reason: string };

const PRIORITY_CLASS: Record<Enums<"task_priority">, string> = {
  high: "border-task-overdue/40 bg-task-overdue/10 text-task-overdue",
  medium: "border-task-warning/40 bg-task-warning/10 text-task-text",
  low: "border-task-border bg-task-muted text-task-text-muted",
};

export function TaskCard({ capability, categoryLabel, onAction, task }: {
  capability: TaskMutationCapability;
  categoryLabel: string;
  onAction: (action: TaskCardAction) => Promise<void>;
  task: TaskBundle;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [revision, setRevision] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const checklistProgress = calculateTaskChecklistProgress(task.checklists);
  const overdue = isTaskFeedItemOverdue(task);
  const completed = task.status === "completed";
  const blocked = task.status === "blocked";
  const readOnly = !capability.canMutate || task.task_type === "fms";
  const canComplete = checklistProgress.canCompleteRequiredItems && (!task.requires_upload || task.hasAttachment)
    && (!task.requires_form || task.hasFormSubmission);

  const act = async (action: TaskCardAction) => {
    setBusy(true);
    setError(null);
    try {
      await onAction(action);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task update failed");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      setError("Upload a JPG, PNG, or PDF up to 10 MB.");
      return;
    }
    await act({ kind: "upload", file });
  };

  const statusLabel = completed ? "Completed" : blocked ? "Coverage required" : overdue ? "Overdue" : task.status === "in_progress" ? "In Progress" : "Pending";
  const StatusIcon = completed ? CheckCircle2 : blocked ? PauseCircle : overdue ? AlertTriangle : Clock;

  return (
    <article className={cn("overflow-hidden rounded-2xl border bg-task-bg shadow-sm", completed ? "border-success/40 opacity-80" : blocked ? "border-task-warning/60" : overdue ? "border-task-overdue/50" : task.isWatchedByViewer ? "border-task-accent/50" : "border-task-border")}>
      <button aria-expanded={expanded} className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setExpanded((value) => !value)} type="button">
        <StatusIcon className={cn("mt-0.5 size-5 shrink-0", completed ? "text-success" : blocked ? "text-task-warning" : overdue ? "text-task-overdue" : "text-task-accent")} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-semibold text-task-text", completed && "line-through text-task-text-muted")}>{task.title}</span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", completed ? "border-success/40 bg-success/10 text-success" : blocked ? "border-task-warning/50 bg-task-warning/10 text-task-text" : overdue ? "border-task-overdue/40 bg-task-overdue/10 text-task-overdue" : "border-task-border bg-task-muted text-task-text-muted")}>{statusLabel}</span>
            {capability.watcherLabel ? <span className="inline-flex items-center gap-1 rounded-full bg-task-accent-soft px-2 py-0.5 text-[10px] font-semibold text-task-text"><Eye className="size-3" />{capability.watcherLabel}</span> : null}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-task-text-muted">
            <span className="inline-flex min-w-0 items-center gap-1"><Users className="size-3" /><span className="truncate">{task.assigneeName}</span></span>
            <span>{task.planned_datetime ? new Date(task.revised_datetime ?? task.planned_datetime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Unscheduled"}</span>
            {task.priority ? <span className={cn("rounded-full border px-2 py-0.5 capitalize", PRIORITY_CLASS[task.priority])}>{task.priority}</span> : null}
            <span>{categoryLabel}</span>
          </span>
          {task.checklists.length > 0 ? <span className="mt-3 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-task-muted"><span className="block h-full rounded-full bg-task-accent" style={{ width: `${checklistProgress.displayPercent}%` }} /></span><span className="text-xs tabular-nums text-task-text-muted">{checklistProgress.completedItems}/{checklistProgress.totalItems}</span></span> : null}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-task-text-muted transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded ? <div className="flex flex-col gap-4 border-t border-task-border bg-task-muted p-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {task.description ? <p className="text-sm leading-relaxed text-task-text">{task.description}</p> : null}
        {blocked ? <Notice tone="task">Coverage required. An authorized manager must resolve coverage through a future database-backed workflow; no simulated resolution is available here.</Notice> : null}
        {task.checklists.map((item) => (
          <div className="flex items-start gap-3 text-sm text-task-text" key={item.id}>
            <button aria-label={item.is_completed ? "Mark incomplete" : "Mark complete"} className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border", item.is_completed ? "border-task-accent bg-task-accent text-task-text" : "border-task-border bg-task-bg")} disabled={busy || completed || readOnly || blocked} onClick={() => void act({ kind: "checklist", checklistId: item.id, completed: !item.is_completed })} type="button">{item.is_completed ? <Check className="size-3" /> : null}</button>
            <span className={cn(item.is_completed && "line-through text-task-text-muted")}>{item.item_text}{item.is_required ? <span className="ml-1 text-task-overdue">*</span> : null}</span>
          </div>
        ))}
        {!readOnly && task.requires_upload && !completed ? <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-task-border bg-task-bg p-3 text-sm text-task-text"><FileUp className="size-4" /><span>{task.hasAttachment ? "Evidence uploaded · add another" : "Upload required evidence"}</span><input accept="image/jpeg,image/png,application/pdf" className="sr-only" disabled={busy} onChange={(event) => void upload(event)} type="file" /></label> : null}
        {task.requires_form && !task.hasFormSubmission ? <Notice tone="task">A linked form submission is required before completion. Form rendering remains in the Forms phase.</Notice> : null}
        {!readOnly && task.requires_remark && !completed ? <Field label="Completion remark"><textarea className="task-field min-h-16" onChange={(event) => setRemark(event.target.value)} value={remark} /></Field> : null}
        {!readOnly && !completed && !blocked ? <div className="flex flex-wrap gap-2">{task.status === "pending" ? <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={busy} onClick={() => void act({ kind: "start" })} variant="secondary"><Play />Start</Button> : null}<Button className="bg-task-accent text-task-text hover:bg-task-accent/90" disabled={busy || !canComplete || Boolean(task.requires_remark && !remark.trim())} onClick={() => void act({ kind: "complete", remark })}><CheckCircle2 />Complete</Button>{task.assignees.length ? <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={busy} onClick={() => void act({ kind: "delegate" })} variant="secondary"><UserRoundPlus />Delegate</Button> : null}</div> : null}
        {task.task_type === "fms" ? <Notice tone="task">FMS stage actions arrive in Phase 3; this stage is read-only in the unified feed.</Notice> : null}
        {capability.canUseElevatedActions && task.task_type === "delegation" && !completed && !blocked ? <form className="grid gap-3 rounded-xl border border-task-border bg-task-bg p-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); void act({ kind: "revise", datetime: new Date(revision).toISOString(), reason: revisionReason }); }}><Field label="Revised date"><input className="task-field" onChange={(event) => setRevision(event.target.value)} required type="datetime-local" value={revision} /></Field><Field label="Reason"><input className="task-field" onChange={(event) => setRevisionReason(event.target.value)} required value={revisionReason} /></Field><Button className="self-end bg-task-accent text-task-text hover:bg-task-accent/90" disabled={busy} type="submit">Revise</Button></form> : null}
      </div> : null}
    </article>
  );
}
