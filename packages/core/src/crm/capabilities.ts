import type { CrmCapability, CrmCapabilityInput } from "./types";

export function deriveCrmCapability({ role, active, sameBranch = false, assigned = false }: CrmCapabilityInput): CrmCapability {
  const none: CrmCapability = { canAccess: false, canCreateClient: false, canEditClient: false, canReassignClient: false, canMergeClients: false, canRecordWalkin: false, canLogInteraction: false, canManageFollowups: false, canManageDocuments: false, scope: "none" };
  if (!active || !["super_admin", "admin", "manager", "crm"].includes(role)) return none;
  if (role === "super_admin" || role === "admin") return { canAccess: true, canCreateClient: true, canEditClient: true, canReassignClient: true, canMergeClients: true, canRecordWalkin: true, canLogInteraction: true, canManageFollowups: true, canManageDocuments: true, scope: "tenant" };
  if (role === "manager") return { canAccess: sameBranch, canCreateClient: true, canEditClient: sameBranch, canReassignClient: sameBranch, canMergeClients: false, canRecordWalkin: sameBranch, canLogInteraction: sameBranch, canManageFollowups: sameBranch, canManageDocuments: sameBranch, scope: "branch" };
  const permitted = sameBranch && assigned;
  return { canAccess: permitted, canCreateClient: true, canEditClient: permitted, canReassignClient: false, canMergeClients: false, canRecordWalkin: sameBranch, canLogInteraction: permitted, canManageFollowups: permitted, canManageDocuments: permitted, scope: "assigned" };
}
