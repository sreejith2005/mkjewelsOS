export const NOTIFICATION_EVENT_TYPES = [
  "task_assigned",
  "task_delegated",
  "task_completed",
  "task_overdue",
  "task_coverage_required",
  "form_submitted",
  "form_approved",
  "form_rejected",
  "fms_stage_assigned",
  "fms_stage_completed",
  "fms_stage_rejected",
  "fms_revision_requested",
  "fms_stage_escalated",
  "fms_sla_breached",
  "fms_completed",
  "system_alert",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const EVENT_VARIABLES: Readonly<Record<NotificationEventType, readonly string[]>> = {
  task_assigned: ["actor_name", "assignee_name", "task_title", "planned_datetime", "priority"],
  task_delegated: ["actor_name", "assignee_name", "task_title", "planned_datetime", "priority", "reason"],
  task_completed: ["actor_name", "task_title", "completed_at", "priority"],
  task_overdue: ["assignee_name", "task_title", "planned_datetime", "priority"],
  task_coverage_required: ["task_title", "planned_datetime", "priority", "reason"],
  form_submitted: ["actor_name", "form_name", "submitted_at"],
  form_approved: ["actor_name", "form_name", "reviewed_at", "review_notes"],
  form_rejected: ["actor_name", "form_name", "reviewed_at", "review_notes"],
  fms_stage_assigned: ["actor_name", "assignee_name", "flow_name", "stage_name", "reference", "planned_datetime", "priority"],
  fms_stage_completed: ["actor_name", "flow_name", "stage_name", "reference", "completed_at", "priority"],
  fms_stage_rejected: ["actor_name", "flow_name", "stage_name", "reference", "reason", "priority"],
  fms_revision_requested: ["actor_name", "flow_name", "stage_name", "reference", "reason", "priority"],
  fms_stage_escalated: ["actor_name", "flow_name", "stage_name", "reference", "reason", "priority"],
  fms_sla_breached: ["flow_name", "stage_name", "reference", "planned_datetime", "priority"],
  fms_completed: ["actor_name", "flow_name", "reference", "completed_at", "priority"],
  system_alert: ["alert_title", "alert_message", "priority"],
};

export const NOTIFICATION_CHANNELS = ["in_app", "email", "whatsapp", "sms", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DELIVERY_STATES = [
  "pending", "scheduled", "processing", "delivered", "retry_wait",
  "failed_terminal", "blocked_configuration", "cancelled",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export function isNotificationEventType(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value);
}
