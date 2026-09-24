/**
 * The read-only labels a task's detail panel shows, shared so the web card and
 * the native task screen describe the same task in the same words.
 */

const FREQUENCY_LABEL: Readonly<Record<string, string>> = {
  as_required: "As Required",
  daily: "Daily",
  monthly: "Monthly",
  quarterly: "Quarterly",
  recurring: "Recurring",
  weekly: "Weekly",
  yearly: "Yearly",
};

const TASK_TYPE_LABEL: Readonly<Record<string, string>> = {
  checklist: "Checklist",
  delegation: "Task",
  fms: "FMS stage",
};

export function taskTypeLabel(taskType: string | null | undefined): string {
  return taskType ? TASK_TYPE_LABEL[taskType] ?? "Task" : "Task";
}

export function taskFrequencyLabel(scheduleKind: string | null | undefined): string {
  if (!scheduleKind) return "One Time";
  return FREQUENCY_LABEL[scheduleKind] ?? "Recurring";
}

export function taskVerificationLabel(task: Readonly<{ verification_required?: boolean | null; verification_status?: string | null }>): string {
  if (!task.verification_required) return "Not required";
  if (task.verification_status === "verified") return "Verified";
  if (task.verification_status === "rejected") return "Verification rejected";
  if (task.verification_status === "pending") return "Verification pending";
  return "Verification required";
}

export function taskEvidenceLabel(task: Readonly<{ task_type?: string | null; requires_upload?: boolean | null }>, hasAttachment: boolean): string {
  if (task.task_type === "checklist" || !task.requires_upload) return "Not required";
  return hasAttachment ? "Evidence required · Uploaded" : "Evidence required";
}

export function taskBuddyCoverageLabel(allowed: boolean | null | undefined): string | null {
  if (typeof allowed !== "boolean") return null;
  return allowed ? "Buddy coverage allowed" : "Buddy coverage not allowed";
}

/** Only a scheduled occurrence has a schedule that can be active or paused. */
export function taskScheduleStateLabel(task: Readonly<{ task_template_id?: string | null; is_active?: boolean | null }>): string | null {
  if (!task.task_template_id) return null;
  return task.is_active ? "Schedule active" : "Schedule paused";
}

/** Sheet dates and times are India business time; render them that way regardless of the viewer's device. */
export function formatIndiaDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}
