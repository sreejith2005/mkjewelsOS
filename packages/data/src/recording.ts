import { supabase } from "@jewelos/api-client";
import { parseRecordingSession, parseRecordingTicket, parseTranscriptSegment, recordingObject,
  type RecordingSession, type RecordingSnapshot, type RecordingTicket, type CoachingAlert } from "@jewelos/core";

/** Fixed public messages: never render function/server bodies that might contain sensitive data. */
function refused(): never { throw new Error("Recording is unavailable or access was refused. Your session and queued audio have been kept."); }
export async function startRecordingSession(deviceId: string, requestId: string): Promise<RecordingTicket> {
  const { data, error } = await supabase.functions.invoke("recorder-session", { body: { action: "start", device_id: deviceId, request_id: requestId, consent: true, consent_version: "pilot-v1" } });
  if (error) return refused(); return parseRecordingTicket(data);
}
export async function renewRecordingTicket(session: RecordingSession): Promise<RecordingTicket> {
  const { data, error } = await supabase.functions.invoke("recorder-session", { body: { action: "ticket", session_id: session.id, device_id: session.device_id } });
  if (error) return refused(); const ticket = parseRecordingTicket(data);
  if (ticket.session.id !== session.id || ticket.session.employee_id !== session.employee_id || ticket.session.device_id !== session.device_id || ticket.session.tenant_id !== session.tenant_id || ticket.session.branch_id !== session.branch_id) throw new Error("Recording scope changed. Ask your administrator to review this session.");
  return ticket;
}
export async function controlRecordingSession(id: string, action: "pause" | "resume" | "stop", lastSequence?: number): Promise<void> {
  const { error } = await supabase.rpc("recorder_control_session", { p_session_id: id, p_action: action, ...(lastSequence === undefined ? {} : { p_last_sequence: lastSequence }) });
  if (error) return refused();
}
export async function listRecordingSessions(): Promise<RecordingSession[]> {
  const { data, error } = await supabase.rpc("recorder_list_sessions");
  if (error || !Array.isArray(data)) return refused(); return data.map(parseRecordingSession);
}
export async function recordingSnapshot(id: string): Promise<RecordingSnapshot> {
  const { data, error } = await supabase.rpc("recorder_session_snapshot", { p_session_id: id });
  if (error) return refused(); const value = recordingObject(data);
  if (!Array.isArray(value.segments) || !Array.isArray(value.alerts)) throw new Error("Invalid recording response");
  const alerts: CoachingAlert[] = value.alerts.map((raw) => {
    const alert = recordingObject(raw);
    if (typeof alert.id !== "string" || typeof alert.segment_id !== "string" || typeof alert.message !== "string" || alert.message.length > 1000 || typeof alert.created_at !== "string") throw new Error("Invalid alert response");
    return { id: alert.id, segment_id: alert.segment_id, message: alert.message, created_at: alert.created_at };
  });
  return { session: parseRecordingSession(value.session), segments: value.segments.map(parseTranscriptSegment), alerts };
}
export async function recordingWalkins(): Promise<ReadonlyArray<{ ref: string; label: string }>> {
  const { data, error } = await supabase.rpc("recorder_linkable_walkins");
  if (error || !Array.isArray(data)) return refused();
  return data.map((raw) => { const item = recordingObject(raw); if (typeof item.ref !== "string" || typeof item.label !== "string") throw new Error("Invalid walk-in response"); return { ref: item.ref, label: item.label }; });
}
export async function linkRecordingWalkin(sessionId: string, ref: string): Promise<void> {
  const { error } = await supabase.rpc("recorder_link_customer", { p_session_id: sessionId, p_customer_ref: ref });
  if (error) return refused();
}
