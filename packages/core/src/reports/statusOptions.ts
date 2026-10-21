/**
 * Status values each report's server filter compares against (report_rows_for_profile,
 * migration 0013): task_status for tasks and FMS stages, the derived SLA state for
 * FMS SLA, form_submission_status, and export_logs.status. Reports not listed filter
 * on free-form values and keep a text box.
 */
const TASK_STATUSES = ["pending", "in_progress", "in_review", "completed", "rejected", "blocked", "overdue"] as const;

export const REPORT_STATUS_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  task_operations: TASK_STATUSES,
  fms_instances_stages: TASK_STATUSES,
  fms_sla: ["within_sla", "at_risk", "on_time", "breached"],
  form_submissions_reviews: ["submitted", "approved", "rejected"],
  export_history: ["queued", "processing", "completed", "failed", "cancelled", "expired"],
};

export function reportStatusOptions(reportKey: string): readonly string[] | null {
  return REPORT_STATUS_OPTIONS[reportKey] ?? null;
}
