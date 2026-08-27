import { supabase } from "@jewelos/api-client";
import { kolkataDateKey, shouldGenerateRecurringTask, type Json } from "@jewelos/core";
import { parseRecurringWorkspace, type RecurringWorkspace } from "./model";
export { parseRecurringWorkspace, type RecurringInstance, type RecurringTemplate, type RecurringWorkspace } from "./model";

export async function loadRecurringWorkspace(filter: { date_from: string; date_to: string; search?: string; status?: string }): Promise<RecurringWorkspace> {
  const { data, error } = await supabase.rpc("get_recurring_todo_workspace", { p_filter: filter });
  if (error) throw new Error(`Load recurring workspace: ${error.message}`);
  return parseRecurringWorkspace(data);
}

export async function saveRecurringTemplate(id: string | null, payload: Json): Promise<string> {
  const { data, error } = await supabase.rpc("save_recurring_todo_template_with_audit", { p_template_id: id as string, p_payload: payload });
  if (error) throw new Error(`Save recurring schedule: ${error.message}`);
  if (!data) throw new Error("Save recurring schedule did not return an identifier");
  return data;
}

function scheduleIsDueOn(payload: Json, targetDate: string): boolean {
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") return false;
  const scheduleKind = typeof payload.schedule_kind === "string" ? payload.schedule_kind : "recurring";
  const startsOn = typeof payload.starts_on === "string" ? payload.starts_on : undefined;
  if (scheduleKind === "as_required") return false;
  if (scheduleKind === "one_time") return startsOn === targetDate;
  if (typeof payload.recurrence_rule !== "string") return false;
  try {
    return shouldGenerateRecurringTask(payload.recurrence_rule, targetDate, startsOn);
  } catch {
    return false;
  }
}

export async function materializeRecurringTemplate(
  templateId: string,
  payload?: Json,
  targetDate = kolkataDateKey(new Date()),
): Promise<{ created: number }> {
  const { data, error } = await supabase.functions.invoke("materialize-recurring-schedule", {
    body: { template_id: templateId },
    method: "POST",
  });
  if (!error) return data as { created: number };
  if (!payload || !scheduleIsDueOn(payload, targetDate)) return { created: 0 };

  // This RPC is authenticated, role-checked, and audited in Postgres. It is
  // a narrow fallback for a due occurrence when Edge Function availability is
  // transient; it never lets the browser choose an arbitrary due date.
  const { data: taskId, error: fallbackError } = await supabase.rpc("run_recurring_todo_template_now_with_audit", {
    p_target_date: targetDate,
    p_template_id: templateId,
  });
  if (fallbackError) throw new Error("Unable to create today's recurring task");
  return { created: taskId ? 1 : 0 };
}

export async function deleteRecurringTemplate(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("delete_recurring_todo_template_with_audit", { p_template_id: id });
  if (error) throw new Error(`Delete recurring schedule: ${error.message}`);
  return data;
}

export async function setRecurringTemplateActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_recurring_todo_template_active_with_audit", { p_template_id: id, p_active: active });
  if (error) throw new Error(`Update recurring schedule: ${error.message}`);
}

export async function runRecurringTemplateNow(id: string, targetDate: string): Promise<void> {
  const { error } = await supabase.rpc("run_recurring_todo_template_now_with_audit", { p_template_id: id, p_target_date: targetDate });
  if (error) throw new Error(`Run recurring schedule: ${error.message}`);
}

export async function verifyRecurringTask(id: string, decision: "verified" | "rejected", note: string): Promise<void> {
  const { error } = await supabase.rpc("verify_recurring_task_with_audit", { p_task_id: id, p_decision: decision, p_note: note });
  if (error) throw new Error(`Verify recurring task: ${error.message}`);
}

export async function sendRecurringFollowup(id: string, message: string): Promise<void> {
  const { error } = await supabase.rpc("send_recurring_followup_with_audit", { p_task_id: id, p_message: message });
  if (error) throw new Error(`Send recurring follow-up: ${error.message}`);
}
