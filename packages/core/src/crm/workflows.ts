import type { FollowupAction, FollowupBucket, FollowupStatus, TimelineEventType, WalkinValidationInput } from "./types";

export function validateWalkinConditional(input: WalkinValidationInput): string[] {
  const errors: string[] = [];
  const status = input.buyStatus?.trim().toLowerCase();
  const notBought = new Set((input.notBoughtStatuses ?? ["not_bought", "no", "lost"]).map((item) => item.toLowerCase()));
  const followup = new Set((input.followupRequiredStatuses ?? ["follow_up", "considering", "not_bought"]).map((item) => item.toLowerCase()));
  if (input.productBought === false && status && notBought.has(status) && !input.notBoughtReason?.trim()) errors.push("Not-bought reason is required for this outcome.");
  if (status && followup.has(status) && !input.nextFollowupDate) errors.push("A follow-up date is required for this outcome.");
  if (input.companions !== undefined && (!Number.isInteger(input.companions) || input.companions < 0 || input.companions > 50)) errors.push("Companions must be between 0 and 50.");
  return errors;
}

export function canTransitionFollowup(status: FollowupStatus, action: FollowupAction): boolean {
  return status === "open" && (action === "reschedule" || action === "complete" || action === "cancel");
}

export function zonedDateKey(value: Date, timeZone = "Asia/Kolkata"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function classifyFollowupDue(dueDate: string, status: FollowupStatus, now = new Date(), timeZone = "Asia/Kolkata"): FollowupBucket {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  const today = zonedDateKey(now, timeZone);
  return dueDate < today ? "overdue" : dueDate === today ? "today" : "upcoming";
}

const TIMELINE_LABELS: Record<TimelineEventType, string> = {
  client_created: "Client created", client_updated: "Client updated", client_reassigned: "Client reassigned", walkin: "Walk-in recorded",
  call: "Call", message: "Message", email: "Email", note: "Note", interaction_corrected: "Interaction corrected",
  followup_created: "Follow-up created", followup_rescheduled: "Follow-up rescheduled", followup_completed: "Follow-up completed", followup_cancelled: "Follow-up cancelled",
  task_linked: "Task linked", form_linked: "Form linked", fms_linked: "FMS flow linked", document_uploaded: "Document uploaded", clients_merged: "Clients merged",
};
export function timelineEventDisplay(type: TimelineEventType): { label: string; category: "profile" | "visit" | "interaction" | "followup" | "link" | "document" } {
  const category = type.startsWith("followup_") ? "followup" : type === "walkin" ? "visit" : ["call", "message", "email", "note", "interaction_corrected"].includes(type) ? "interaction" : type.endsWith("_linked") ? "link" : type === "document_uploaded" ? "document" : "profile";
  return { label: TIMELINE_LABELS[type], category };
}
