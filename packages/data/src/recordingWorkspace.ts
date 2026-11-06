import { supabase, type Json } from "@jewelos/api-client";
import {
  parseActionTaskLinks, parseCoachingLists, parseConversationCard, parseConversationPage, parseDevicePage, parseInsights, parseToday, parseWorkspaceSettings,
  type ActionTaskLink, type CoachingLists, type ConversationCard, type ConversationFilters, type ConversationPage, type DevicePage, type DeviceStatus,
  type Insights, type TodayView, type WorkspaceSettings,
} from "@jewelos/core";

/**
 * Store Intelligence workspace reads and the follow-up task write (migration 0383).
 * Errors carry a fixed message and a `kind` the screen can act on; server text is never shown.
 */
export type WorkspaceErrorKind = "denied" | "invalid" | "expired" | "unavailable";
export class WorkspaceError extends Error {
  constructor(message: string, readonly kind: WorkspaceErrorKind) { super(message); }
}
const MESSAGES: Readonly<Record<string, [string, WorkspaceErrorKind]>> = {
  recording_review_denied: ["This view is for managers.", "denied"],
  recording_rubric_denied: ["These settings are for administrators and managers.", "denied"],
  recorder_session_denied: ["You do not have access to this conversation.", "denied"],
  recording_action_denied: ["You cannot create a task from this conversation.", "denied"],
  recorder_actor_denied: ["Store Intelligence is not available on your account.", "denied"],
  recording_invalid_filter: ["Those filters could not be used. Clear them and try again.", "invalid"],
  recording_action_not_found: ["That suggestion is no longer available.", "invalid"],
  recording_invalid_due: ["Choose a due date within the next 90 days.", "invalid"],
  recording_retention_expired: ["This conversation has passed its retention period.", "expired"],
};
function fail(error: { message?: string; code?: string } | null): never {
  const key = Object.keys(MESSAGES).find((code) => error?.message?.includes(code));
  if (key) { const [message, kind] = MESSAGES[key]!; throw new WorkspaceError(message, kind); } // key comes from MESSAGES.
  // Module/section refusals arrive as 42501 without one of our codes.
  if (error?.code === "42501") throw new WorkspaceError("Store Intelligence is not available on your account.", "denied");
  throw new WorkspaceError("This could not be loaded. Check your connection and try again.", "unavailable");
}
function parsed<T>(parse: (raw: unknown) => T, data: unknown): T {
  try { return parse(data); } catch { throw new WorkspaceError("The server sent something unexpected. Refresh and try again.", "unavailable"); }
}

export type ConversationCursor = Readonly<{ before: string; beforeId: string }>;
export async function fetchConversationPage(filters: ConversationFilters, cursor?: ConversationCursor, limit = 25): Promise<ConversationPage> {
  const { data, error } = await supabase.rpc("recording_conversations_page", {
    p_filters: filters as Json, // Plain JSON built from validated filter fields; the server re-validates every key.
    p_limit: limit, ...(cursor ? { p_before: cursor.before, p_before_id: cursor.beforeId } : {}),
  });
  if (error) fail(error);
  return parsed(parseConversationPage, data);
}
export async function fetchConversationCard(sessionId: string): Promise<ConversationCard> {
  const { data, error } = await supabase.rpc("recording_conversation_card", { p_session_id: sessionId });
  if (error) fail(error);
  return parsed(parseConversationCard, data);
}
export async function fetchToday(): Promise<TodayView> {
  const { data, error } = await supabase.rpc("recording_today");
  if (error) fail(error);
  return parsed(parseToday, data);
}
export async function fetchActionTasks(sessionId: string): Promise<readonly ActionTaskLink[]> {
  const { data, error } = await supabase.rpc("recording_session_action_tasks", { p_session_id: sessionId });
  if (error) fail(error);
  return parsed(parseActionTaskLinks, data);
}
/** Creates the follow-up task once; a repeat tap returns the same task. */
export async function createActionTask(analysisId: string, actionIndex: number, plannedAt: string): Promise<{ taskId: string; alreadyCreated: boolean }> {
  const { data, error } = await supabase.rpc("recording_create_action_task", { p_analysis_id: analysisId, p_action_index: actionIndex, p_planned_at: plannedAt });
  if (error) {
    // The task contract's own refusal (section off, authoring rules) has no recording code.
    if (!Object.keys(MESSAGES).some((code) => error.message?.includes(code))) throw new WorkspaceError("The task could not be created. You may not be allowed to create tasks.", "denied");
    fail(error);
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.task_id !== "string") throw new WorkspaceError("The task could not be confirmed. Refresh to check.", "unavailable");
  return { taskId: data.task_id, alreadyCreated: data.already_created === true };
}
export async function fetchDevices(status: DeviceStatus | null, search: string, offset: number, limit = 25): Promise<DevicePage> {
  const { data, error } = await supabase.rpc("recording_devices_page", { ...(status ? { p_status: status } : {}), ...(search.trim() ? { p_q: search.trim() } : {}), p_offset: offset, p_limit: limit });
  if (error) fail(error);
  return parsed(parseDevicePage, data);
}
export async function fetchInsights(from: string, to: string, employeeId?: string): Promise<Insights> {
  const { data, error } = await supabase.rpc("recording_insights", { p_from: from, p_to: to, ...(employeeId ? { p_employee_id: employeeId } : {}) });
  if (error) fail(error);
  return parsed(parseInsights, data);
}
export async function fetchCoachingLists(from: string, to: string): Promise<CoachingLists> {
  const { data, error } = await supabase.rpc("recording_coaching_lists", { p_from: from, p_to: to });
  if (error) fail(error);
  return parsed(parseCoachingLists, data);
}
export async function fetchWorkspaceSettings(): Promise<WorkspaceSettings> {
  const { data, error } = await supabase.rpc("recording_workspace_settings");
  if (error) fail(error);
  return parsed(parseWorkspaceSettings, data);
}
/** Recording access (0377 recorder_configure, Super Admin only; audited server-side). */
export async function saveRecordingAccess(input: Readonly<{ enabled: boolean; employeeIds: readonly string[]; branchIds: readonly string[]; retentionDays: number; coachingEnabled: boolean }>): Promise<void> {
  const { error } = await supabase.rpc("recorder_configure", {
    p_enabled: input.enabled, p_employee_ids: [...input.employeeIds], p_branch_ids: [...input.branchIds], p_retention_days: input.retentionDays, p_coaching_enabled: input.coachingEnabled,
  });
  if (error) throw new WorkspaceError(error.message?.includes("recorder_invalid_config") ? "Check the people, branches and retention days (1 to 90)." : "Only a Super Admin can change recording access.", error.message?.includes("recorder_invalid_config") ? "invalid" : "denied");
}
