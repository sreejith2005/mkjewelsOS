import { supabase } from "@jewelos/api-client";
import { parseTaskTemplateDeletion, parseTaskTemplateDirectory, type TaskTemplateDeletion, type TaskTemplateDirectory } from "./model";

export * from "./model";

export async function loadTaskTemplateDirectory(filter: { search?: string } = {}): Promise<TaskTemplateDirectory> {
  const { data, error } = await supabase.rpc("get_task_template_directory", { p_filter: filter });
  if (error) throw new Error(`Load task templates: ${error.message}`);
  return parseTaskTemplateDirectory(data);
}

export async function setTaskTemplateSchedule(templateId: string, startsOn: string): Promise<void> {
  const { error } = await supabase.rpc("set_task_template_schedule_with_audit", { p_template_id: templateId, p_starts_on: startsOn });
  if (error) throw new Error(`Save task schedule: ${error.message}`);
}

export async function deleteTaskTemplate(templateId: string): Promise<TaskTemplateDeletion> {
  const { data, error } = await supabase.rpc("delete_task_template_with_audit", { p_template_id: templateId });
  if (error) throw new Error(`Delete task template: ${error.message}`);
  return parseTaskTemplateDeletion(data);
}
