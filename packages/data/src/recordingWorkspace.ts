import { supabase, type Json } from "@jewelos/api-client";
import {
  followUpPayload, parseActionTaskLinks, parseCoachingLists, parseConversationCard, parseConversationIntegration, parseConversationPage, parseDevicePage,
  parseFollowUpOptions, parseInsights, parseIntegrationHealth, parseToday, parseWorkspaceSettings,
  type ActionTaskLink, type CoachingLists, type ConversationCard, type ConversationFilters, type ConversationIntegration, type ConversationPage,
  type CustomerLinkTarget, type DevicePage, type DeviceStatus, type FollowUpInput, type FollowUpOptions, type Insights, type IntegrationHealth,
  type TodayView, type WorkspaceSettings,
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
  // 0384: customer links and follow-ups.
  recording_link_denied: ["Only the salesperson or a branch manager with CRM access can change this conversation's customer.", "denied"],
  recording_invalid_link: ["That customer could not be used. Search again and choose from the list.", "invalid"],
  recording_reason_required: ["Write a short reason for the change.", "invalid"],
  recording_request_reused: ["That request was already used for something else. Refresh and try again.", "invalid"],
  recording_owner_denied: ["You can give a follow-up only to yourself or the salesperson.", "denied"],
  recording_supervisor_denied: ["Choose a branch manager other than yourself and the owner for the coaching reminder.", "denied"],
  recording_flow_not_startable: ["That workflow cannot be started by hand. Choose another or create a task.", "invalid"],
  recording_invalid_follow_up: ["Check the follow-up details and try again.", "invalid"],
  recording_invalid_config: ["Use 1 to 90 days and a positive average ticket, or leave the ticket blank.", "invalid"],
  // 0389: analytics.
  recording_branch_denied: ["You can only see analytics for your own branch.", "denied"],
};
/** Maps a server error to a WorkspaceError (shared with recordingAnalytics). */
export function recordingFail(error: { message?: string; code?: string } | null): never {
  const key = Object.keys(MESSAGES).find((code) => error?.message?.includes(code));
  if (key) { const [message, kind] = MESSAGES[key]!; throw new WorkspaceError(message, kind); } // key comes from MESSAGES.
  // Module/section refusals arrive as 42501 without one of our codes.
  if (error?.code === "42501") throw new WorkspaceError("Store Intelligence is not available on your account.", "denied");
  throw new WorkspaceError("This could not be loaded. Check your connection and try again.", "unavailable");
}
export function recordingParsed<T>(parse: (raw: unknown) => T, data: unknown): T {
  try { return parse(data); } catch { throw new WorkspaceError("The server sent something unexpected. Refresh and try again.", "unavailable"); }
}

export type ConversationCursor = Readonly<{ before: string; beforeId: string }>;
export async function fetchConversationPage(filters: ConversationFilters, cursor?: ConversationCursor, limit = 25): Promise<ConversationPage> {
  const { data, error } = await supabase.rpc("recording_conversations_page", {
    p_filters: filters as Json, // Plain JSON built from validated filter fields; the server re-validates every key.
    p_limit: limit, ...(cursor ? { p_before: cursor.before, p_before_id: cursor.beforeId } : {}),
  });
  if (error) recordingFail(error);
  return recordingParsed(parseConversationPage, data);
}
export async function fetchConversationCard(sessionId: string): Promise<ConversationCard> {
  const { data, error } = await supabase.rpc("recording_conversation_card", { p_session_id: sessionId });
  if (error) recordingFail(error);
  return recordingParsed(parseConversationCard, data);
}
export async function fetchToday(): Promise<TodayView> {
  const { data, error } = await supabase.rpc("recording_today");
  if (error) recordingFail(error);
  return recordingParsed(parseToday, data);
}
export async function fetchActionTasks(sessionId: string): Promise<readonly ActionTaskLink[]> {
  const { data, error } = await supabase.rpc("recording_session_action_tasks", { p_session_id: sessionId });
  if (error) recordingFail(error);
  return recordingParsed(parseActionTaskLinks, data);
}
/** Creates the follow-up task once; a repeat tap returns the same task. */
export async function createActionTask(analysisId: string, actionIndex: number, plannedAt: string): Promise<{ taskId: string; alreadyCreated: boolean }> {
  const { data, error } = await supabase.rpc("recording_create_action_task", { p_analysis_id: analysisId, p_action_index: actionIndex, p_planned_at: plannedAt });
  if (error) {
    // The task contract's own refusal (section off, authoring rules) has no recording code.
    if (!Object.keys(MESSAGES).some((code) => error.message?.includes(code))) throw new WorkspaceError("The task could not be created. You may not be allowed to create tasks.", "denied");
    recordingFail(error);
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.task_id !== "string") throw new WorkspaceError("The task could not be confirmed. Refresh to check.", "unavailable");
  return { taskId: data.task_id, alreadyCreated: data.already_created === true };
}
export async function fetchDevices(status: DeviceStatus | null, search: string, offset: number, limit = 25): Promise<DevicePage> {
  const { data, error } = await supabase.rpc("recording_devices_page", { ...(status ? { p_status: status } : {}), ...(search.trim() ? { p_q: search.trim() } : {}), p_offset: offset, p_limit: limit });
  if (error) recordingFail(error);
  return recordingParsed(parseDevicePage, data);
}
export async function fetchInsights(from: string, to: string, employeeId?: string): Promise<Insights> {
  const { data, error } = await supabase.rpc("recording_insights", { p_from: from, p_to: to, ...(employeeId ? { p_employee_id: employeeId } : {}) });
  if (error) recordingFail(error);
  return recordingParsed(parseInsights, data);
}
export async function fetchCoachingLists(from: string, to: string): Promise<CoachingLists> {
  const { data, error } = await supabase.rpc("recording_coaching_lists", { p_from: from, p_to: to });
  if (error) recordingFail(error);
  return recordingParsed(parseCoachingLists, data);
}
export async function fetchWorkspaceSettings(): Promise<WorkspaceSettings> {
  const { data, error } = await supabase.rpc("recording_workspace_settings");
  if (error) recordingFail(error);
  return recordingParsed(parseWorkspaceSettings, data);
}
/** Recording access (0377 recorder_configure, Super Admin only; audited server-side). */
export async function saveRecordingAccess(input: Readonly<{ enabled: boolean; employeeIds: readonly string[]; branchIds: readonly string[]; retentionDays: number; coachingEnabled: boolean }>): Promise<void> {
  const { error } = await supabase.rpc("recorder_configure", {
    p_enabled: input.enabled, p_employee_ids: [...input.employeeIds], p_branch_ids: [...input.branchIds], p_retention_days: input.retentionDays, p_coaching_enabled: input.coachingEnabled,
  });
  if (error) throw new WorkspaceError(error.message?.includes("recorder_invalid_config") ? "Check the people, branches and retention days (1 to 90)." : "Only a Super Admin can change recording access.", error.message?.includes("recorder_invalid_config") ? "invalid" : "denied");
}

// ---------------------------------------------------------------------------
// 0384: CRM customer link, outcomes, follow-ups and readiness.

/** Customer link, AI vs CRM outcome, suggestions with their work, and readiness for one conversation. */
export async function fetchConversationIntegration(sessionId: string): Promise<ConversationIntegration> {
  const { data, error } = await supabase.rpc("recording_session_integration", { p_session_id: sessionId });
  if (error) recordingFail(error);
  return recordingParsed(parseConversationIntegration, data);
}
/**
 * Links the customer a person chose from the CRM search. It stays "waiting for CRM" until the CRM
 * acknowledges it; changing an existing link needs `reason` and withdraws the old CRM entry.
 */
export async function linkCrmCustomer(sessionId: string, target: CustomerLinkTarget, requestKey: string, reason?: string): Promise<{ linkId: string; alreadyLinked: boolean }> {
  const { data, error } = await supabase.rpc("recording_link_crm_customer", {
    p_session_id: sessionId, p_target: target as unknown as Json, // Built by linkTargetFor from a CRM-offered candidate; the server re-validates every key.
    p_request_key: requestKey, ...(reason?.trim() ? { p_reason: reason.trim() } : {}),
  });
  if (error) recordingFail(error);
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.link_id !== "string") throw new WorkspaceError("The link could not be confirmed. Refresh to check.", "unavailable");
  return { linkId: data.link_id, alreadyLinked: data.already_linked === true };
}
export async function unlinkCrmCustomer(sessionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("recording_unlink_crm_customer", { p_session_id: sessionId, p_reason: reason.trim() });
  if (error) recordingFail(error);
}
/** Sends a held or failed CRM entry again (same event; the CRM ignores repeats). */
export async function retryCrmSync(sessionId: string): Promise<number> {
  const { data, error } = await supabase.rpc("recording_retry_crm_sync", { p_session_id: sessionId });
  if (error) recordingFail(error);
  return data && typeof data === "object" && !Array.isArray(data) && typeof data.requeued === "number" ? data.requeued : 0;
}
export async function fetchFollowUpOptions(sessionId: string): Promise<FollowUpOptions> {
  const { data, error } = await supabase.rpc("recording_follow_up_options", { p_session_id: sessionId });
  if (error) recordingFail(error);
  return recordingParsed(parseFollowUpOptions, data);
}
export type FollowUpResult = Readonly<{ followUpId: string | null; taskId: string | null; fmsInstanceId: string | null; fmsReference: string | null; alreadyCreated: boolean }>;
/** One Task (or one manual FMS run) per suggestion; a repeat, retry or rescore returns the existing one. */
export async function createFollowUp(input: FollowUpInput): Promise<FollowUpResult> {
  const { data, error } = await supabase.rpc("recording_create_follow_up", { p_input: followUpPayload(input) });
  if (error) {
    // The task / FMS contracts' own refusals (section off, authoring scope) carry no recording code.
    if (!Object.keys(MESSAGES).some((code) => error.message?.includes(code))) throw new WorkspaceError("The follow-up could not be created. You may not be allowed to create this task or start this workflow.", "denied");
    recordingFail(error);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new WorkspaceError("The follow-up could not be confirmed. Refresh to check.", "unavailable");
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  if (!text(data.task_id) && !text(data.fms_instance_id)) throw new WorkspaceError("The follow-up could not be confirmed. Refresh to check.", "unavailable");
  return { followUpId: text(data.follow_up_id), taskId: text(data.task_id), fmsInstanceId: text(data.fms_instance_id), fmsReference: text(data.fms_reference), alreadyCreated: data.already_created === true };
}
export async function fetchIntegrationHealth(): Promise<IntegrationHealth> {
  const { data, error } = await supabase.rpc("recording_integration_health");
  if (error) recordingFail(error);
  return recordingParsed(parseIntegrationHealth, data);
}
/** Attribution window and the optional average ticket for estimates (Super Admin / Admin; audited). */
export async function saveCrmOutcomeSettings(attributionDays: number, estimatedTicketInr: number | null): Promise<void> {
  const { error } = await supabase.rpc("recording_configure_crm_outcomes", {
    p_attribution_days: attributionDays,
    // The SQL argument accepts NULL ("no estimate"); the generated type marks it required.
    p_estimated_ticket_inr: estimatedTicketInr as number,
  });
  if (error) recordingFail(error);
}
