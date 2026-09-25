export type QueueVisibilityRow = { branch_id: string; assigned_crm_name: string | null; status: string };

// Legacy getCrmQueueFromWalkin filters PENDING + branch + CRM only; deliberately
// no created-at/day condition is present here.
export function queueMatchesLegacyScope(row: QueueVisibilityRow, branchId: string, crmName = ""): boolean {
  return row.branch_id === branchId
    && row.status.toUpperCase() === "PENDING"
    && (!crmName || row.assigned_crm_name === crmName);
}
