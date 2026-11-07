import { supabase } from "@jewelos/api-client";
import { isFmsFlowAccessLevel, type FmsFlowAccessLevel } from "@jewelos/core";

/** One person's access to one workflow (every version), from `list_fms_flow_access` (migration 0390). */
export type FmsFlowAccessGrant = Readonly<{
  grantId: string;
  userProfileId: string;
  employeeName: string;
  employeeCode: string | null;
  level: FmsFlowAccessLevel;
  grantedAt: string;
  grantedByName: string | null;
  accountActive: boolean;
}>;

const fail = (label: string, error: { message: string } | null) => { if (error) throw new Error(`${label}: ${error.message}`); };

/** The signed-in person's own grants, by workflow family. Informational: the server re-checks every action. */
export async function loadMyFmsFlowAccess(): Promise<ReadonlyMap<string, FmsFlowAccessLevel>> {
  const { data, error } = await supabase.rpc("list_my_fms_flow_access");
  fail("Load your workflow access", error);
  return new Map((data ?? []).flatMap((row) => isFmsFlowAccessLevel(row.access_level) ? [[row.family_id, row.access_level] as const] : []));
}

export async function loadFmsFlowAccess(flowId: string): Promise<FmsFlowAccessGrant[]> {
  const { data, error } = await supabase.rpc("list_fms_flow_access", { p_flow_id: flowId });
  fail("Load workflow access", error);
  return (data ?? []).flatMap((row) => isFmsFlowAccessLevel(row.access_level) ? [{
    grantId: row.grant_id, userProfileId: row.user_profile_id, employeeName: row.employee_name, employeeCode: row.employee_code,
    level: row.access_level, grantedAt: row.granted_at, grantedByName: row.granted_by_name, accountActive: row.account_active,
  }] : []);
}

export async function grantFmsFlowAccess(flowId: string, userProfileId: string, level: FmsFlowAccessLevel): Promise<void> {
  const { error } = await supabase.rpc("grant_fms_flow_access_with_audit", { p_flow_id: flowId, p_user_profile_id: userProfileId, p_access_level: level });
  fail("Give workflow access", error);
}

export async function revokeFmsFlowAccess(grantId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_fms_flow_access_with_audit", { p_grant_id: grantId, ...(reason ? { p_reason: reason } : {}) });
  fail("Remove workflow access", error);
}
