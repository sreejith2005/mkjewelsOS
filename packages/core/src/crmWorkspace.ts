import { normalizeIndianPhone } from "./crm/phone";

export type CrmDirectoryFilter = {
  query?: string;
  branch_id?: string;
  assigned_crm_id?: string;
  client_type_id?: string;
  source_id?: string;
  potential_category?: string;
  followup_status?: string;
  cursor?: string;
  limit?: number;
};

export function buildCrmSearchFilter(filter: CrmDirectoryFilter): CrmDirectoryFilter {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) result[key] = trimmed;
    } else if (value !== undefined && value !== null) result[key] = value;
  }
  return result as CrmDirectoryFilter;
}

export type CrmClientDraft = {
  firstName: string;
  primaryPhone: string;
  branchId: string;
};

export function validateCrmClientDraft(draft: CrmClientDraft): string | null {
  if (!draft.firstName.trim()) return "First name is required.";
  if (!normalizeIndianPhone(draft.primaryPhone)) return "Enter a supported Indian phone number.";
  if (!draft.branchId.trim()) return "Home branch is required.";
  return null;
}

export function crmMergeConfirmed(survivorId: string, duplicateId: string, confirmation: string): boolean {
  return Boolean(survivorId && duplicateId && survivorId !== duplicateId && confirmation.trim() === "MERGE");
}

export function crmStaleEditMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /record.changed|stale|version|conflict/i.test(message)
    ? "This record changed after you opened it. Refresh the client and review the latest values before saving again."
    : message;
}

export type CrmFollowupDraft = {
  subject?: string;
  dueDate?: string;
  assignedTo?: string;
  action?: "reschedule" | "complete" | "cancel";
  actionText?: string;
};

export function validateCrmFollowupDraft(draft: CrmFollowupDraft): string | null {
  if (draft.action === "complete" && !draft.actionText?.trim()) return "Outcome is required.";
  if (draft.action === "cancel" && !draft.actionText?.trim()) return "Cancellation reason is required.";
  if (draft.action === "reschedule" && !draft.dueDate?.trim()) return "New due date is required.";
  if (draft.action) return null;
  if (!draft.subject?.trim()) return "Follow-up subject is required.";
  if (!draft.dueDate?.trim()) return "Follow-up due date is required.";
  if (!draft.assignedTo?.trim()) return "Follow-up assignee is required.";
  return null;
}
