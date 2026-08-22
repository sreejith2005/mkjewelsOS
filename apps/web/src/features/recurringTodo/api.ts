import { supabase } from "@jewelos/api-client";
import type { Json } from "@jewelos/core";
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

export async function deleteRecurringTemplate(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("delete_recurring_todo_template_with_audit", { p_template_id: id });
  if (error) throw new Error(`Delete recurring schedule: ${error.message}`);
  return data;
}

export async function runRecurringTemplateNow(id: string, planned: string): Promise<void> {
  const { error } = await supabase.rpc("use_task_template_with_audit", { p_template_id: id, p_planned_datetime: planned });
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
