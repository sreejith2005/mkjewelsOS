import type { ReactNode } from "react";
import {
  calculateTaskChecklistProgress,
  formatIndiaDateTime,
  taskBuddyCoverageLabel,
  taskEvidenceLabel,
  taskFrequencyLabel,
  taskScheduleStateLabel,
  taskTypeLabel,
  taskVerificationLabel,
} from "@jewelos/core";
import type { TaskBundle } from "./api";
import { TaskAttachmentList } from "./TaskAttachmentList";

// The labels live in @jewelos/core so the native task screen reads the same words.
export { formatIndiaDateTime };

function deadlineValue(task: TaskBundle): ReactNode {
  const revised = formatIndiaDateTime(task.revised_datetime);
  const due = formatIndiaDateTime(task.due_datetime);
  if (revised) {
    return <>
      <span className="block">Revised deadline: {revised}</span>
      {due ? <span className="block text-task-text-muted">Original due: {due}</span> : null}
    </>;
  }
  return due;
}

/**
 * Read-only operational context for one task. Every value comes from the bounded task feed,
 * so expanding a card never issues an extra request. Blank optional fields are omitted, and
 * identifiers and raw recurrence rules are deliberately never displayed.
 */
export function TaskDetails({ statusLabel, task }: { statusLabel: string; task: TaskBundle }) {
  const checklistProgress = calculateTaskChecklistProgress(task.checklists);
  const description = task.description?.trim();
  const details: Array<{ label: string; value: ReactNode } | null> = [
    { label: "Assigned to", value: task.assigneeName },
    task.branch_name ? { label: "Branch", value: task.branch_name } : null,
    task.department_name ? { label: "Department", value: task.department_name } : null,
    { label: "Task type", value: taskTypeLabel(task.task_type) },
    task.core_task_label ? { label: "Core task", value: task.core_task_label } : null,
    { label: "Frequency", value: taskFrequencyLabel(task.schedule_kind) },
    { label: "Start", value: formatIndiaDateTime(task.planned_datetime) },
    { label: "Due", value: deadlineValue(task) },
    task.priority ? { label: "Priority", value: <span className="capitalize">{task.priority}</span> } : null,
    { label: "Evidence", value: taskEvidenceLabel(task, task.hasAttachment) },
    { label: "Verification", value: taskVerificationLabel(task) },
    task.verifierName ? { label: "Verifier", value: task.verifierName } : null,
    taskBuddyCoverageLabel(task.buddy_assignment_allowed) ? { label: "Buddy coverage", value: taskBuddyCoverageLabel(task.buddy_assignment_allowed) } : null,
    taskScheduleStateLabel(task) ? { label: "Schedule state", value: taskScheduleStateLabel(task) } : null,
    { label: "Status", value: statusLabel },
    task.checklists.length > 0
      ? { label: "Checklist", value: `${checklistProgress.completedItems} of ${checklistProgress.totalItems} complete` }
      : null,
  ];

  return <div className="flex flex-col gap-4">
    <p className={description ? "text-sm leading-relaxed text-task-text" : "text-sm italic text-task-text-muted"}>
      {description ?? "No description provided"}
    </p>
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {details.flatMap((detail) => detail && detail.value ? [detail] : []).map(({ label, value }) =>
        <div key={label}>
          <dt className="text-[11px] font-semibold tracking-wide text-task-text-muted">{label}</dt>
          <dd className="mt-0.5 text-sm text-task-text">{value}</dd>
        </div>)}
    </dl>
    {task.hasAttachment && task.id ? <TaskAttachmentList taskId={task.id} /> : null}
  </div>;
}
