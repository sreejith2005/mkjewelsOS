import type { ReactNode } from "react";
import {
  formatIndiaDateTime,
  taskEvidenceLabel,
  taskFrequencyLabel,
  taskVerificationLabel,
} from "@jewelos/core";
import type { TaskBundle } from "./api";
import { TaskAttachmentList } from "./TaskAttachmentList";

// The labels live in @jewelos/core so every surface reads the same words.
export { formatIndiaDateTime };

/**
 * The few facts the card header does not already say. The header carries the
 * title, status, assignee, due time, priority and category, and the checklist
 * shows its own progress, so none of those repeat here. A fact appears only
 * when it changes what the doer has to do: a written description, a repeat
 * schedule, a moved deadline, required evidence or verification, the core task.
 * Every value comes from the bounded task feed, so expanding a card never
 * issues an extra request, and identifiers and raw recurrence rules are never shown.
 */
export function TaskDetails({ task }: { task: TaskBundle }) {
  const description = task.description?.trim();
  const revised = formatIndiaDateTime(task.revised_datetime);
  const originalDue = formatIndiaDateTime(task.due_datetime);
  const paused = Boolean(task.task_template_id) && !task.is_active;
  const details: Array<{ label: string; value: ReactNode } | null> = [
    task.schedule_kind ? { label: "Repeats", value: paused ? `${taskFrequencyLabel(task.schedule_kind)} · paused` : taskFrequencyLabel(task.schedule_kind) } : null,
    revised ? { label: "Deadline moved", value: originalDue ? `${revised} (was ${originalDue})` : revised } : null,
    task.requires_upload ? { label: "Evidence", value: taskEvidenceLabel(task, task.hasAttachment) } : null,
    task.verification_required ? { label: "Verification", value: task.verifierName ? `${taskVerificationLabel(task)} · ${task.verifierName}` : taskVerificationLabel(task) } : null,
    task.core_task_label ? { label: "Core task", value: task.core_task_label } : null,
  ];
  const shown = details.flatMap((detail) => detail ? [detail] : []);
  const attachments = task.hasAttachment && task.id;
  if (!description && shown.length === 0 && !attachments) return null;

  return <div className="flex flex-col gap-3">
    {description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-task-text">{description}</p> : null}
    {shown.length ? <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {shown.map(({ label, value }) =>
        <div key={label}>
          <dt className="text-[11px] font-semibold tracking-wide text-task-text-muted">{label}</dt>
          <dd className="mt-0.5 text-sm text-task-text">{value}</dd>
        </div>)}
    </dl> : null}
    {attachments ? <TaskAttachmentList taskId={task.id ?? ""} /> : null}
  </div>;
}
