import { decodeSidebarCounts, type SidebarCounts } from "@jewelos/core";
import { getSupabase } from "@jewelos/api-client/client";
export async function loadMySidebarCounts(): Promise<SidebarCounts> {
  const { data, error } = await getSupabase().rpc("get_my_sidebar_counts");
  if (error) throw error;
  return decodeSidebarCounts(data);
}
export async function loadMyLeaveUpdateIds(): Promise<string[]> {
  const { data, error } = await getSupabase().rpc("get_my_leave_update_ids");
  if (error) throw error;
  return data ?? [];
}
export async function markMyLeaveUpdatesRead(notificationIds: string[], leaveIds: string[]): Promise<number> {
  const { data, error } = await getSupabase().rpc("mark_my_leave_updates_read", { p_notification_ids: notificationIds, p_leave_ids: leaveIds });
  if (error) throw error;
  return typeof data === "number" && Number.isSafeInteger(data) && data >= 0 ? data : 0;
}
