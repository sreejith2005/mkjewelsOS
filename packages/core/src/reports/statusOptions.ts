/**
 * Status values each report's server filter compares against (report_rows_for_profile,
 * migrations 0013 and 0370; get_crm_business_report in the CRM project). Reports not
 * listed have no status filter.
 */
const TASK_STATUSES = ["pending", "in_progress", "in_review", "completed", "rejected", "blocked", "overdue"] as const;

export const REPORT_STATUS_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  task_operations: TASK_STATUSES,
  fms_instances_stages: TASK_STATUSES,
  fms_sla: ["within_sla", "at_risk", "on_time", "breached"],
  form_submissions_reviews: ["submitted", "approved", "rejected"],
  export_history: ["queued", "processing", "completed", "failed", "cancelled", "expired"],
  form_answers: ["submitted", "approved", "rejected"],
  fms_workflow_summary: ["running", "overdue", "on_hold", "completed", "cancelled", "won", "lost", "do_not_contact"],
  fms_stage_visits: ["pending", "in_progress", "in_review", "completed", "overdue", "skipped", "stopped", "on_time", "delayed"],
  work_register: ["pending", "in_progress", "in_review", "completed", "overdue", "blocked", "rejected", "on_time", "delayed"],
  people_availability: ["present", "absent", "half_day", "remote"],
  customer_report_followups: ["open", "overdue", "due_today", "undated", "done"],
};

export function reportStatusOptions(reportKey: string): readonly string[] | null {
  return REPORT_STATUS_OPTIONS[reportKey] ?? null;
}
