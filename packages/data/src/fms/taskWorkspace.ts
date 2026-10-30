import { getSupabase } from "@jewelos/api-client/client";
import { decodeFmsBoard, decodeFmsWorkspace, decodeFmsStages, decodeFmsRecords, fmsWorkspaceFilter, type FmsWorkspaceFilters } from "@jewelos/core";

/** Cards per board column on first load; "Show more" pages the rest. */
export const FMS_BOARD_PAGE_SIZE = 20;

export async function loadFmsTaskWorkspace(filters: FmsWorkspaceFilters, offset = 0) {
 const result = await getSupabase().rpc("get_fms_task_workspace", { p_filter: fmsWorkspaceFilter(filters), p_offset: offset, p_limit: 50 });
 if (result.error) throw new Error(result.error.message); return decodeFmsWorkspace(result.data);
}
export async function loadFmsTaskStages(familyId: string, filters: FmsWorkspaceFilters) {
 const result = await getSupabase().rpc("get_fms_task_stages", { p_family_id: familyId, p_filter: fmsWorkspaceFilter(filters) });
 if (result.error) throw new Error(result.error.message); return decodeFmsStages(result.data);
}
export async function loadFmsTaskStagePage(group: Readonly<{ familyId: string; flowId: string; stageId: string; starting: boolean }>, filters: FmsWorkspaceFilters, offset = 0, limit = 50) {
 const result = await getSupabase().rpc("get_fms_task_stage_page", { p_family_id: group.familyId, p_flow_id: group.flowId, p_stage_id: group.stageId, p_starting: group.starting, p_filter: fmsWorkspaceFilter(filters), p_offset: offset, p_limit: limit });
 if (result.error) throw new Error(result.error.message); return decodeFmsRecords(result.data);
}
/** One workflow board: exact counts for every column plus each column's first page, in one read. */
export async function loadFmsTaskBoard(familyId: string, filters: FmsWorkspaceFilters, limit = FMS_BOARD_PAGE_SIZE) {
 const result = await getSupabase().rpc("get_fms_task_board", { p_family_id: familyId, p_filter: fmsWorkspaceFilter(filters), p_limit: limit });
 if (result.error) throw new Error(result.error.message); return decodeFmsBoard(result.data);
}
