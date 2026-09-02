import type { ReactNode } from "react";
import { calculateTaskChecklistProgress } from "@jewelos/core";
import type { TaskBundle } from "./api";

const FREQUENCY_LABEL: Record<string, string> = {
  as_required: "As Required",
  daily: "Daily",
  monthly: "Monthly",
  quarterly: "Quarterly",
  recurring: "Recurring",
  weekly: "Weekly",
  yearly: "Yearly",
};

const TASK_TYPE_LABEL: Record<string, string> = {
  checklist: "Checklist",
  delegation: "Task",
  fms: "FMS stage",
};

/** Sheet dates and times are India business time; render them that way regardless of the viewer's device. */
export function formatIndiaDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

function frequencyLabel(scheduleKind: string | null | undefined): string {
  if (!scheduleKind) return "One Time";
  return FREQUENCY_LABEL[scheduleKind] ?? "Recurring";
}

function verificationLabel(task: TaskBundle): string {
  if (!task.verification_required) return "Not required";
  if (task.verification_status === "verified") return "Verified";
  if (task.verification_status === "rejected") return "Verification rejected";
  if (task.verification_status === "pending") return "Verification pending";
  return "Verification required";
}

function evidenceLabel(task: TaskBundle): string {
  if (!task.requires_upload) return "Not required";
  return task.hasAttachment ? "Evidence required · Uploaded" : "Evidence required";
}

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
    { label: "Task type", value: task.task_type ? TASK_TYPE_LABEL[task.task_type] ?? "Task" : "Task" },
    task.core_task_label ? { label: "Core task", value: task.core_task_label } : null,
    { label: "Frequency", value: frequencyLabel(task.schedule_kind) },
    { label: "Start", value: formatIndiaDateTime(task.planned_datetime) },
    { label: "Due", value: deadlineValue(task) },
    task.priority ? { label: "Priority", value: <span className="capitalize">{task.priority}</span> } : null,
    { label: "Evidence", value: evidenceLabel(task) },
    { label: "Verification", value: verificationLabel(task) },
    task.verifierName ? { label: "Verifier", value: task.verifierName } : null,
    typeof task.buddy_assignment_allowed === "boolean"
      ? { label: "Buddy coverage", value: task.buddy_assignment_allowed ? "Buddy coverage allowed" : "Buddy coverage not allowed" }
      : null,
    task.task_template_id ? { label: "Schedule state", value: task.is_active ? "Schedule active" : "Schedule paused" } : null,
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
  </div>;
}
