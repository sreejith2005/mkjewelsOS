import { describeDue, fmsWorkTitle, presentFmsWorkContext } from "@jewelos/core";
import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Clock, Eye, FileText, FileUp, ListChecks, PauseCircle, Users } from "lucide-react";
import { calculateTaskChecklistProgress, effectiveTaskDeadline, isTaskFeedItemOverdue, TASK_EVIDENCE_ACCEPT, taskEvidenceFileError, type Enums, type TaskMutationCapability } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { TaskBundle } from "./api";
import { FmsWorkContext } from "@/features/fms/FmsWorkContext";
import { TaskChecklist } from "./TaskChecklist";
import { TaskDetails } from "./TaskDetails";
import { TaskRemarks } from "./TaskRemarks";

export type TaskCardAction =
  | { checklistId: string; completed: boolean; kind: "checklist" }
  | { kind: "complete" }
  | { file: File; kind: "upload" }
  | { file: File; kind: "upload_and_complete" }
  | { kind: "fill_form" }
  | { kind: "fill_fms_form" }
  | { kind: "open_fms_stage" }
  | { datetime: string; kind: "revise"; reason: string };

const PRIORITY_CLASS: Record<Enums<"task_priority">, string> = {
  high: "border-task-overdue/40 bg-task-overdue/10 text-task-overdue",
  medium: "border-task-warning/40 bg-task-warning/10 text-task-text",
  low: "border-task-border bg-task-muted text-task-text-muted",
};

// Full width and 44px tall on a phone; compact beside the title from the small breakpoint up.
const FACE_ACTION_CLASS = "min-h-11 w-full shrink-0 bg-task-accent text-task-text hover:bg-task-accent/90 sm:min-h-10 sm:w-auto";

export function TaskCard({ management, capability, categoryLabel, onAction, task: taskInput, viewerId }: {
  management?: ReactNode;
  capability: TaskMutationCapability;
  categoryLabel: string;
  onAction: (action: TaskCardAction) => Promise<void>;
  task: TaskBundle;
  viewerId?: string;
}) {
  // Ticks show at once and save in order in the background. A local value wins
  // until the server copy agrees with it, so a slow save or a list reload never
  // flips a tick back or blocks the next tap.
  const [checklistOverrides, setChecklistOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [checklistSaves, setChecklistSaves] = useState(0);
  const checklistQueue = useRef<Promise<void>>(Promise.resolve());
  const serverChecklist = useRef(taskInput.checklists);
  serverChecklist.current = taskInput.checklists;
  useEffect(() => {
    if (checklistSaves > 0) return;
    setChecklistOverrides((current) => {
      if (current.size === 0) return current;
      const next = new Map([...current].filter(([id, value]) => serverChecklist.current.find((item) => item.id === id)?.is_completed !== value));
      return next.size === current.size ? current : next;
    });
  }, [taskInput.checklists, checklistSaves]);
  const checklists = checklistOverrides.size === 0 ? taskInput.checklists
    : taskInput.checklists.map((item) => checklistOverrides.has(item.id) ? { ...item, is_completed: checklistOverrides.get(item.id) ?? item.is_completed } : item);
  const task = { ...taskInput, checklists, planned_datetime: effectiveTaskDeadline(taskInput) };
  const fmsWork = task.fmsWorkContext ? presentFmsWorkContext(task.fmsWorkContext) : null;
  const detailsId = `task-details-${taskInput.id ?? "task"}`;
  const detailsLabel = `Details for ${taskInput.title ?? "task"}`;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checklistPanel = useRef<HTMLElement>(null);
  const [checklistRequested, setChecklistRequested] = useState(false);
  useEffect(() => {
    if (expanded && checklistRequested) {
      const panel = checklistPanel.current;
      panel?.focus({ preventScroll: true });
      // The checklist opens right under the card, so usually nothing needs to
      // move. Only when the next step is off screen, bring just that step into
      // view, instantly, so it can be tapped straight away.
      const nextStep = panel?.querySelector<HTMLElement>("[data-next-step]") ?? panel;
      nextStep?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
      setChecklistRequested(false);
    }
  }, [expanded, checklistRequested]);
  const toggleChecklistItem = (item: TaskBundle["checklists"][number]) => {
    const completedValue = !item.is_completed;
    setError(null);
    setChecklistOverrides((current) => new Map(current).set(item.id, completedValue));
    setChecklistSaves((count) => count + 1);
    checklistQueue.current = checklistQueue.current.then(async () => {
      try {
        await onAction({ kind: "checklist", checklistId: item.id, completed: completedValue });
      } catch (caught) {
        setChecklistOverrides((current) => { const next = new Map(current); next.delete(item.id); return next; });
        setError(caught instanceof Error ? `${caught.message}. Tap the step again.` : "That tick was not saved. Tap the step again.");
      } finally {
        setChecklistSaves((count) => count - 1);
      }
    });
  };
  const [revision, setRevision] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const checklistProgress = calculateTaskChecklistProgress(task.checklists);
  const overdue = isTaskFeedItemOverdue(task);
  const completed = task.status === "completed";
  const blocked = task.status === "blocked";
  const readOnly = !capability.canMutate || task.task_type === "fms";
  const formOnlyAction = task.requires_form && !completed;
  const fmsFormAction = task.task_type === "fms" && task.requires_form && !completed;
  // A runtime stage without a pinned form is still assigned work. Without its own
  // action the card is a dead end, so route it to the stage workspace instead.
  const fmsStageAction = task.task_type === "fms" && !task.requires_form && !completed;
  // Evidence follows the saved upload requirement on either task type.
  const requiresEvidence = task.requires_upload;
  // The checklist gates completion: every required item is ticked by hand first
  // (migration 0342 enforces it server-side). Until then the card's action opens
  // the checklist instead of completing, uploading or opening the form.
  const hasChecklist = task.task_type !== "fms" && task.checklists.length > 0;
  const checklistPending = hasChecklist && !completed && !checklistProgress.canCompleteRequiredItems;
  const openChecklist = () => { setExpanded(true); setChecklistRequested(true); };
  const canComplete = !checklistPending && (!requiresEvidence || task.hasAttachment) && (!task.requires_form || task.hasFormSubmission);
  const canShowDirectComplete = !formOnlyAction && !readOnly && !completed && !blocked;
  const canShowDirectUpload = canShowDirectComplete && requiresEvidence && !task.hasAttachment;
  const act = async (action: TaskCardAction) => {
    setBusy(true);
    setError(null);
    try {
      // Let any tick still saving land first, so completion sees the full checklist.
      await checklistQueue.current;
      await onAction(action);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task update failed");
      setExpanded(true);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>, kind: "upload" | "upload_and_complete" = "upload") => {
    const input = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    const fileError = taskEvidenceFileError(file);
    if (fileError) {
      setError(fileError);
      setExpanded(true);
      input.value = "";
      return;
    }
    try {
      await act({ kind, file });
    } finally {
      input.value = "";
    }
  };
  const statusLabel = completed ? "Completed" : blocked ? "Coverage required" : overdue ? "Overdue" : task.status === "in_progress" ? "In Progress" : "Pending";
  const dueAt = task.planned_datetime ? task.revised_datetime ?? task.planned_datetime : null;
  const due = describeDue(dueAt, undefined, { completed });
  const titleText = task.title ?? "task";
  // Your own task does not need your own name on it.
  const ownTask = task.assignees.length === 1 && task.assignees[0]?.id === viewerId;
  // Work that needs a form or the workflow runner gets its action on the card itself, not hidden in the details.
  const faceAction = completed || blocked ? null
    : fmsFormAction ? { label: "Fill form", name: `Fill FMS form: ${titleText}`, action: { kind: "fill_fms_form" } as const, disabled: !task.form_template_id, Icon: FileText }
    : fmsStageAction ? { label: "Open work", name: `Open FMS work: ${titleText}`, action: { kind: "open_fms_stage" } as const, disabled: false, Icon: ArrowRight }
    : formOnlyAction && !readOnly ? { label: "Fill form", name: `Fill form: ${titleText}`, action: { kind: "fill_form" } as const, disabled: !task.form_template_id, Icon: FileText }
    : null;
  const StatusIcon = completed ? CheckCircle2 : blocked ? PauseCircle : overdue ? AlertTriangle : Clock;

  return <article className={cn("overflow-hidden rounded-2xl border bg-task-bg shadow-card transition-shadow duration-200 hover:shadow-lift", completed ? "border-success/40 opacity-80" : blocked ? "border-task-warning/60" : overdue ? "border-task-overdue/50" : task.isWatchedByViewer ? "border-task-accent/50" : "border-task-border")}>
    {/* On a phone the title gets the full width and the main action sits under it as a large, thumb-sized button. */}
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-2">
      <button aria-controls={detailsId} aria-expanded={expanded} className="flex w-full min-w-0 items-start gap-3 text-left sm:w-auto sm:flex-1" onClick={() => setExpanded((value) => !value)} type="button">
        <StatusIcon className={cn("mt-0.5 size-5 shrink-0", completed ? "text-success" : blocked ? "text-task-warning" : overdue ? "text-task-overdue" : "text-task-accent")} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("text-[15px] font-semibold leading-snug text-task-text sm:text-sm", completed && "line-through text-task-text-muted")}>{fmsWork && task.fmsWorkContext ? fmsWorkTitle(fmsWork.title, task.fmsWorkContext.reference) : task.title}</span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold sm:text-[10px]", completed ? "border-success/40 bg-success/10 text-success" : blocked ? "border-task-warning/50 bg-task-warning/10 text-task-text" : overdue ? "border-task-overdue/40 bg-task-overdue/10 text-task-overdue" : "border-task-border bg-task-muted text-task-text-muted")}>{statusLabel}</span>
            {capability.watcherLabel ? <span className="inline-flex items-center gap-1 rounded-full bg-task-accent-soft px-2 py-0.5 text-[11px] font-semibold sm:text-[10px] text-task-text"><Eye className="size-3" />{capability.watcherLabel}</span> : null}
            {task.task_type === "fms" ? <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] font-semibold sm:text-[10px] text-gold-secondary">FMS</span> : null}
            {task.coverageOriginalAssigneeName ? <span className="rounded-full border border-task-accent/40 bg-task-accent-soft px-2 py-0.5 text-[11px] font-semibold sm:text-[10px] text-task-text">Covering for: {task.coverageOriginalAssigneeName}</span> : null}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-task-text-muted">
            {ownTask ? null : <span className="inline-flex min-w-0 items-center gap-1"><Users className="size-3" /><span className="truncate">{task.assigneeName}</span></span>}
            <span className={cn(due.tone === "overdue" ? "font-semibold text-task-overdue" : due.tone === "today" ? "font-medium text-task-text" : undefined)} title={dueAt ? new Date(dueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : undefined}>{due.label}</span>
            {task.priority ? <span className={cn("rounded-full border px-2 py-0.5 capitalize", PRIORITY_CLASS[task.priority])}>{task.priority}</span> : null}
            {task.category_id ? <span>{categoryLabel}</span> : null}
          </span>
          {fmsWork ? <span className="mt-2 block space-y-1 text-xs text-task-text-muted"><span className="block text-gold">{task.fmsWorkContext?.workflowName} | {task.fmsWorkContext?.stageName}</span>{fmsWork.answers.slice(0, 3).map((answer, index) => <span className="block break-words" key={index}><b>{answer.label}:</b> {answer.display}</span>)}<span className="block">{fmsWork.shortDescription || fmsWork.instructions}</span></span> : task.fmsContextUnavailable ? <span className="mt-2 block text-xs text-task-text-muted">Work information is temporarily unavailable. Open the step to retry.</span> : null}
          {hasChecklist ? <span className="mt-3 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-task-muted"><span className="block h-full rounded-full bg-task-accent" style={{ width: `${checklistProgress.displayPercent}%` }} /></span><span className="text-xs tabular-nums text-task-text-muted">{checklistProgress.completedItems}/{checklistProgress.totalItems}</span></span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-task-text-muted"><span className="sr-only sm:not-sr-only">{expanded ? "Hide details" : "View details"}</span><ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} /></span>
      </button>
      {checklistPending && !readOnly && !blocked ? <Button aria-expanded={expanded} aria-label={`Open checklist: ${titleText}`} className={FACE_ACTION_CLASS} onClick={expanded ? () => setChecklistRequested(true) : openChecklist} type="button"><ListChecks />{checklistProgress.completedItems > 0 ? `Checklist ${checklistProgress.completedItems}/${checklistProgress.totalItems}` : "Checklist"}</Button>
        : canShowDirectUpload ? <label className={cn("inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-[0.97]", FACE_ACTION_CLASS)}><FileUp className="size-4" />Upload<input accept={TASK_EVIDENCE_ACCEPT} aria-label={`Upload task: ${task.title ?? "task"}`} className="sr-only" disabled={busy} onChange={(event) => void upload(event, "upload_and_complete")} type="file" /></label> : canShowDirectComplete ? <Button aria-label={`Complete task: ${task.title ?? "task"}`} className={FACE_ACTION_CLASS} disabled={busy || !canComplete} onClick={() => void act({ kind: "complete" })} type="button"><CheckCircle2 />{busy ? "Saving…" : "Complete"}</Button>
        : faceAction ? <Button aria-label={faceAction.name} className={FACE_ACTION_CLASS} disabled={busy || faceAction.disabled} onClick={() => void act(faceAction.action)} type="button"><faceAction.Icon />{faceAction.label}</Button> : null}
    </div>
    {expanded ? <section aria-label={detailsLabel} className="flex flex-col gap-4 border-t border-task-border bg-task-muted p-4" id={detailsId}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {blocked ? <Notice tone="task">Coverage required. This task is waiting for a manager to arrange cover, so it cannot be completed yet. Ask your manager if it is urgent.</Notice> : null}
      {hasChecklist ? <TaskChecklist disabled={busy} interactive={!completed && !readOnly && !blocked} items={task.checklists} onToggle={toggleChecklistItem} ref={checklistPanel} saving={checklistSaves > 0}
        footer={!checklistPending && !completed && !readOnly && !blocked && !task.requires_form && (!requiresEvidence || task.hasAttachment) ? <Button aria-label={`Complete checklist: ${titleText}`} className="w-full bg-task-accent text-task-text hover:bg-task-accent/90 sm:w-auto sm:self-end" disabled={busy || !canComplete} onClick={() => void act({ kind: "complete" })} type="button"><CheckCircle2 />Complete task</Button> : null} /> : null}
      {!readOnly && requiresEvidence && !completed ? <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-task-border bg-task-bg p-3 text-sm text-task-text"><FileUp className="size-4" /><span>{task.hasAttachment ? "Evidence uploaded · add another" : "Upload required evidence"}</span><input accept={TASK_EVIDENCE_ACCEPT} className="sr-only" disabled={busy} onChange={(event) => void upload(event)} type="file" /></label> : null}
      {fmsFormAction && !blocked ? <Button disabled={busy || !task.form_template_id} onClick={() => void act({ kind: "fill_fms_form" })} type="button"><CheckCircle2 />Complete FMS form</Button> : fmsStageAction && !blocked ? <Button disabled={busy} onClick={() => void act({ kind: "open_fms_stage" })} type="button"><CheckCircle2 />Open FMS workflow</Button> : formOnlyAction && !readOnly && !blocked ? <Button disabled={busy || !task.form_template_id || checklistPending} onClick={() => void act({ kind: "fill_form" })} type="button"><CheckCircle2 />Complete form</Button> : null}
      {task.task_type === "fms" ? task.fms_instance_id && task.fms_instance_stage_id ? <FmsWorkContext instanceId={task.fms_instance_id} instanceStageId={task.fms_instance_stage_id} /> : <Notice tone="task">Complete the initial form to start this workflow.</Notice> : <TaskDetails task={taskInput} />}
      {task.task_type !== "fms" && task.id ? <TaskRemarks canComment={task.isWatchedByViewer} taskId={task.id} /> : null}
      {!formOnlyAction && capability.canUseElevatedActions && task.task_type === "delegation" && !completed && !blocked ? <form className="grid gap-3 rounded-xl border border-task-border bg-task-bg p-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); void act({ kind: "revise", datetime: new Date(revision).toISOString(), reason: revisionReason }); }}><Field label="Revised date"><input className="task-field" onChange={(event) => setRevision(event.target.value)} required type="datetime-local" value={revision} /></Field><Field label="Reason"><input className="task-field" onChange={(event) => setRevisionReason(event.target.value)} required value={revisionReason} /></Field><Button className="self-end bg-task-accent text-task-text hover:bg-task-accent/90" disabled={busy} type="submit">Revise</Button></form> : null}
      {management}
    </section> : null}
  </article>;
}
