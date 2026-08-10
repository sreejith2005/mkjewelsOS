import type { UserRole } from "../roleMenu";

export type NormalizedPhone = { display: string; normalized: string };
export type ClientStatus = "active" | "inactive" | "merged";
export type FollowupStatus = "open" | "completed" | "cancelled";
export type FollowupAction = "reschedule" | "complete" | "cancel";
export type FollowupBucket = "today" | "overdue" | "upcoming" | "completed" | "cancelled";
export type TimelineEventType =
  | "client_created" | "client_updated" | "client_reassigned" | "walkin"
  | "call" | "message" | "email" | "note" | "interaction_corrected"
  | "followup_created" | "followup_rescheduled" | "followup_completed" | "followup_cancelled"
  | "task_linked" | "form_linked" | "fms_linked" | "document_uploaded" | "clients_merged";

export type ClientInput = {
  firstName: string;
  lastName?: string;
  primaryPhone: string;
  billingPhone?: string;
  email?: string;
  gender?: string;
  dateOfBirth?: string;
  anniversaryDate?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  sourceId?: string;
  clientTypeId?: string;
  potentialCategory?: string;
  tags?: string[];
  assignedCrmId?: string;
  branchId?: string;
  status?: ClientStatus;
  communicationPreference?: string;
  communicationConsent?: boolean;
};

export type NormalizedClientInput = Omit<ClientInput, "primaryPhone" | "billingPhone" | "email" | "tags"> & {
  primaryPhone: string;
  normalizedPhone: string;
  billingPhone?: string;
  normalizedBillingPhone?: string;
  email?: string;
  tags: string[];
};

export type WalkinValidationInput = {
  productBought?: boolean;
  buyStatus?: string;
  notBoughtReason?: string;
  nextFollowupDate?: string;
  followupRequiredStatuses?: readonly string[];
  notBoughtStatuses?: readonly string[];
  companions?: number;
};

export type CrmCapability = {
  canAccess: boolean;
  canCreateClient: boolean;
  canEditClient: boolean;
  canReassignClient: boolean;
  canMergeClients: boolean;
  canRecordWalkin: boolean;
  canLogInteraction: boolean;
  canManageFollowups: boolean;
  canManageDocuments: boolean;
  scope: "tenant" | "branch" | "assigned" | "none";
};

export type CrmCapabilityInput = {
  role: UserRole;
  active: boolean;
  sameBranch?: boolean;
  assigned?: boolean;
};

export type CrmSearchInput = {
  query?: string;
  branchId?: string;
  assignedCrmId?: string;
  clientTypeId?: string;
  sourceId?: string;
  potentialCategory?: string;
  followupStatus?: string;
  cursor?: string;
  limit?: number;
};

export type NormalizedCrmSearch = CrmSearchInput & { query: string; limit: number };
