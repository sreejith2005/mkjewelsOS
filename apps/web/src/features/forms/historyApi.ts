import { supabase } from "@jewelos/api-client";
import { normalizeFormDefinition, type FormTemplateDefinition, type Json } from "@jewelos/core";

export type FormCheckpoint = { id: string; template_id: string; family_id: string; version: number; sequence: number; action: string; lifecycle: string; actor_name: string | null; created_at: string; definition: FormTemplateDefinition; change_note: string | null; previous_id: string | null };
export type FormProvenance = { origin: string; family_id: string; creator?: string; created_at: string; source_template_id?: string; import_method?: string; source_flow_id?: string; source_flow_name?: string; source_stage_key?: string; source_stage_name?: string; source_deleted?: boolean; used_in_fms?: boolean; workflows?: Array<{ id: string; name: string; stage_name?: string; active_instances?: number }> };
export type FormOrigin = { kind: "fms"; flow_id: string; stage_key: string } | { kind: "ai_import"; import_method: "html" };

export async function loadFormHistory(templateId: string): Promise<FormCheckpoint[]> {
  const { data, error } = await supabase.rpc("list_form_history", { p_template_id: templateId });
  if (error) throw new Error(error.message);
  // Only the authorized database RPC constructs this canonical definition shape.
  const rows = data as unknown as FormCheckpoint[];
  if (!Array.isArray(rows) || rows.some(row => !row.id || !row.definition || !Array.isArray(row.definition.fields))) throw new Error("Form history could not be read. Please reload.");
  return rows.map(row => ({ ...row, definition: normalizeFormDefinition(row.definition) }));
}
export async function loadFormProvenance(templateIds: string[]): Promise<Record<string, FormProvenance>> {
  if (!templateIds.length) return {};
  const { data, error } = await supabase.rpc("get_form_provenance", { p_template_ids: templateIds });
  if (error) throw new Error(error.message);
  // The server removes workflow details outside the caller's FMS scope.
  return (data ?? {}) as unknown as Record<string, FormProvenance>;
}
export async function saveFormWorkspace(templateId: string | null, payload: Json, fields: Json, expectedUpdatedAt: string | null, origin?: FormOrigin, note?: string): Promise<string> {
  const { data, error } = await supabase.rpc("save_form_workspace_with_audit", { p_template_id: templateId, p_payload: payload, p_fields: fields, p_expected_updated_at: expectedUpdatedAt, p_origin: (origin ?? {}) as Json, p_change_note: note?.trim() || null });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The server did not confirm the saved form.");
  return data;
}
export async function restoreFormCheckpoint(checkpointId: string, asNewFamily: boolean, expectedCheckpointId: string): Promise<string> {
  const { data, error } = await supabase.rpc("restore_form_checkpoint_with_audit", { p_checkpoint_id: checkpointId, p_as_new_family: asNewFamily, p_expected_checkpoint_id: expectedCheckpointId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The server did not confirm the new draft.");
  return data;
}
