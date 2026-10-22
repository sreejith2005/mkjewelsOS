import { useState, type ChangeEvent } from "react";
import { deriveRecurringWorkCardState, recurringStatusPill } from "@jewelos/core";
import { Check, CheckCircle2, MessageSquareMore, ShieldCheck, Upload } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { completeRecurringTaskWithImage, updateTask, uploadTaskAttachment } from "@/features/tasks/api";
import { sendRecurringFollowup, verifyRecurringTask, type RecurringInstance } from "@/features/recurringTodo/api";
import { titleCase } from "@/lib/format";

function dueLabel(value: string): string {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

const PILL_TONE = {
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  neutral: "bg-gold/10 text-gold-secondary",
} as const;

function StatusPill({ task }: { task: RecurringInstance }) {
  const { label, tone } = recurringStatusPill(task);
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${PILL_TONE[tone]}`}>{titleCase(label)}</span>;
}

/**
 * One recurring occurrence in Task Control → Review, with the actions the
 * retired Recurring / To-Do page offered: complete (on behalf, with a remark),
 * checklist, evidence upload, required form, follow-up, verify and reject.
 * Every decision is `deriveRecurringWorkCardState`'s, and every action is the
 * same audited RPC as before.
 */
export function RecurringWorkCard({
  task,
  canManage,
  followupEnabled,
  onChanged,
  onOpenForm,
}: {
  task: RecurringInstance;
  canManage: boolean;
  followupEnabled: boolean;
  onChanged: () => Promise<void>;
  onOpenForm: (task: RecurringInstance) => void;
}) {
  const { profile } = useAuth();
  const state = deriveRecurringWorkCardState({ task, viewerId: profile?.id, canManage, followupEnabled });
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const guarded = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
      await onChanged();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The action failed");
    }
  };
  const act = () => guarded(async () => {
    // The doer's own remark, never a placeholder: a template that requires a
    // remark and an on-behalf completion both have to be explained.
    const entered = state.needsRemark ? window.prompt(state.remarkPrompt) : null;
    if (state.needsRemark && !entered?.trim()) return;
    await updateTask(task.id, "complete", entered?.trim() ? { remark: entered.trim() } : undefined);
  });
  const checklist = (id: string, completed: boolean) => guarded(() => updateTask(task.id, "checklist", { checklistId: id, completed }));
  const followup = () => guarded(async () => {
    const message = window.prompt("Follow-up message");
    if (!message?.trim()) return;
    await sendRecurringFollowup(task.id, message);
  });
  const verify = (decision: "verified" | "rejected") => guarded(async () => {
    const note = decision === "rejected" ? (window.prompt("Why is this rejected?") ?? "") : "";
    if (decision === "rejected" && !note.trim()) return;
    await verifyRecurringTask(task.id, decision, note);
  });
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    await guarded(async () => {
      if (task.requires_form || state.needsRemark) await uploadTaskAttachment(profile.tenant_id, task.id, file);
      else await completeRecurringTaskWithImage(profile.tenant_id, task.id, file);
    });
    setUploading(false);
    input.value = "";
  };

  return (
    <article className="rounded-2xl border border-task-border bg-charcoal p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">{task.title}</h3>
          <p className="mt-1 text-xs text-soft-grey">
            Start {dueLabel(task.planned_datetime)} · Due {dueLabel(task.revised_datetime ?? task.due_datetime ?? task.planned_datetime)} |{" "}
            {task.assignees.map((item) => item.name).join(", ") || "Coverage required"}
          </p>
        </div>
        <StatusPill task={task} />
      </div>
      {task.description ? <p className="mt-3 line-clamp-2 text-sm text-soft-grey">{task.description}</p> : null}
      {task.on_time_status ? (
        <p className="mt-2 text-xs text-soft-grey">
          <span className={task.on_time_status === "delayed" ? "text-danger" : "text-success"}>
            {task.on_time_status === "delayed" ? `Delayed by ${task.completion_delay_minutes ?? 0} min` : "On time"}
          </span>
          {task.completion_mode === "on_behalf" ? " · Completed on behalf" : null}
          {task.completion_remark ? ` · ${task.completion_remark}` : null}
        </p>
      ) : null}
      {task.verification_status === "verified" && task.verified_at ? (
        <p className="mt-2 text-xs text-success">Verified {dueLabel(task.verified_at)}{task.verification_note ? ` · ${task.verification_note}` : ""}</p>
      ) : null}
      {task.status === "rejected" && task.verification_note ? <p className="mt-2 text-xs text-danger">Returned for rework: {task.verification_note}</p> : null}
      {task.followups?.length ? (
        <details className="mt-3 rounded-lg border border-task-border p-2">
          <summary className="cursor-pointer text-xs text-task-text-muted">
            {task.followups.length} follow-up{task.followups.length === 1 ? "" : "s"}
            {task.last_followup_at ? ` · last ${dueLabel(task.last_followup_at)}` : null}
          </summary>
          <ul className="mt-2 space-y-1">
            {task.followups.map((entry) => (
              <li className="text-xs text-soft-grey" key={entry.id}>
                <span className="text-champagne">{entry.author ?? "System"}</span> · {dueLabel(entry.created_at)} — {entry.comment}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {state.showChecklist ? (
        <div className="mt-3 space-y-2">
          {task.checklist.map((item) => (
            <button className="flex w-full items-center gap-2 rounded-lg border border-task-border p-2 text-left text-xs text-soft-grey" key={item.id} onClick={() => void checklist(item.id, !item.is_completed)} type="button">
              <span className={`flex size-4 items-center justify-center rounded border ${item.is_completed ? "border-gold bg-gold text-on-gold" : "border-task-border"}`}>
                {item.is_completed ? <Check className="size-3" /> : null}
              </span>
              {item.item_text}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {state.showCompleteForm ? <Button disabled={state.completeFormDisabled} onClick={() => onOpenForm(task)}><CheckCircle2 className="size-4" />Complete form</Button> : null}
        {state.showCompleteChecklist ? <Button aria-label="Complete checklist" onClick={() => void act()}><CheckCircle2 className="size-4" />Complete checklist</Button> : null}
        {state.showComplete ? <Button onClick={() => void act()}><CheckCircle2 className="size-4" />Complete</Button> : null}
        {state.showUpload ? (
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-gold/30 px-4 py-2 text-sm font-semibold text-gold-secondary">
            <Upload className="size-4" />
            {uploading ? "Uploading…" : task.requires_form || state.needsRemark ? "Upload evidence" : "Upload image to complete"}
            <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(event) => void uploadImage(event)} type="file" />
          </label>
        ) : null}
        {state.showFollowup ? <Button onClick={() => void followup()} variant="secondary"><MessageSquareMore className="size-4" />Follow up</Button> : null}
        {state.showVerify ? (
          <>
            <Button onClick={() => void verify("verified")}><ShieldCheck className="size-4" />Verify</Button>
            <Button onClick={() => void verify("rejected")} variant="danger">Reject</Button>
          </>
        ) : null}
      </div>
      {actionError ? <div className="mt-3"><Notice tone="danger">{actionError}</Notice></div> : null}
    </article>
  );
}
