import { supabase } from "@jewelos/api-client";
import type { Json } from "@jewelos/core";
import type { CrmClientDetail, CrmClientSummary, CrmFollowup, CrmOptions } from "./types";
import { finalizePrivateUpload, validateCrmDocumentFile } from "./viewModel";

const fail = (error: { message: string } | null, fallback: string) => { if (error) throw new Error(error.message || fallback); };
export const requestKey = () => crypto.randomUUID();

export async function searchClients(filter: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("search_crm_clients", { p_filter: filter as Json }); fail(error, "Client search failed");
  return (data ?? []) as unknown as CrmClientSummary[];
}
export async function lookupClient(phone: string) { const { data, error } = await supabase.rpc("lookup_crm_client_by_phone", { p_phone: phone }); fail(error, "Phone lookup failed"); return (data?.[0] ?? null) as { client_id: string; match_kind: string; record_version: number } | null; }
export async function loadClient(id: string) { const { data, error } = await supabase.rpc("get_crm_client_detail", { p_client_id: id }); fail(error, "Client detail failed"); return data as unknown as CrmClientDetail; }
export async function loadFollowups(filter: Record<string, unknown>) { const { data, error } = await supabase.rpc("list_crm_followups", { p_filter: filter as Json }); fail(error, "Follow-ups failed"); return (data ?? []) as unknown as CrmFollowup[]; }

export async function loadCrmOptions(): Promise<CrmOptions> {
  const [branches, profiles, dropdowns] = await Promise.all([
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("user_profiles").select("id,employee_name,branch_id,user_role").eq("is_login_enabled", true).neq("working_status", "inactive").neq("working_status", "resigned").order("employee_name"),
    supabase.from("dropdown_masters").select("id,label,value,master_type").eq("is_active", true).in("master_type", ["crm_source", "client_type", "potential_category", "product_category", "buy_status", "not_bought_reason", "communication_preference", "gender"]).order("sort_order"),
  ]);
  fail(branches.error, "Branches failed"); fail(profiles.error, "Profiles failed"); fail(dropdowns.error, "Dropdowns failed");
  return { branches: (branches.data ?? []).map((row) => ({ id: row.id, label: row.name })), profiles: (profiles.data ?? []).map((row) => ({ id: row.id, label: row.employee_name, branch_id: row.branch_id, user_role: row.user_role })), dropdowns: (dropdowns.data ?? []).map((row) => ({ id: row.id, label: row.label, value: row.value, master_type: row.master_type })) };
}

export async function createClient(input: Record<string, unknown>, key = requestKey()) { const { data, error } = await supabase.rpc("create_crm_client", { p_input: input as Json, p_request_key: key }); fail(error, "Client creation failed"); return data as string; }
export async function updateClient(id: string, changes: Record<string, unknown>, version: number, key = requestKey()) { const { data, error } = await supabase.rpc("update_crm_client", { p_client_id: id, p_changes: changes as Json, p_expected_version: version, p_request_key: key }); fail(error, "Client update failed"); return data as number; }
export async function reassignClient(id: string, assignedCrmId: string, branchId: string, version: number, key = requestKey()) { const { data, error } = await supabase.rpc("reassign_crm_client", { p_client_id: id, p_assigned_crm_id: assignedCrmId, p_branch_id: branchId, p_expected_version: version, p_request_key: key }); fail(error, "Reassignment failed"); return data as number; }
export async function mergeClients(survivorId: string, duplicateId: string, key = requestKey()) { const { data, error } = await supabase.rpc("merge_crm_clients", { p_survivor_id: survivorId, p_duplicate_id: duplicateId, p_request_key: key }); fail(error, "Merge failed"); return data as string; }
export async function recordWalkin(input: Record<string, unknown>, key: string) { const { data, error } = await supabase.rpc("record_crm_walkin", { p_input: input as Json, p_request_key: key }); fail(error, "Walk-in failed"); return data as unknown as { client_id: string; walkin_id: string; followup_id?: string; replayed: boolean }; }
export async function logInteraction(clientId: string, input: Record<string, unknown>, key = requestKey()) { const { data, error } = await supabase.rpc("log_crm_interaction", { p_client_id: clientId, p_input: input as Json, p_request_key: key }); fail(error, "Interaction failed"); return data as string; }
export async function createFollowup(clientId: string, input: Record<string, unknown>, key = requestKey()) { const { data, error } = await supabase.rpc("create_crm_followup", { p_client_id: clientId, p_input: input as Json, p_request_key: key }); fail(error, "Follow-up failed"); return data as string; }
export async function rescheduleFollowup(id: string, dueDate: string, assignedTo: string, reason: string, version: number, key = requestKey()) { const { data, error } = await supabase.rpc("reschedule_crm_followup", { p_followup_id: id, p_due_date: dueDate, p_assigned_to: assignedTo, p_reason: reason, p_expected_version: version, p_request_key: key }); fail(error, "Reschedule failed"); return data as number; }
export async function completeFollowup(id: string, outcome: string, version: number, key = requestKey()) { const { data, error } = await supabase.rpc("complete_crm_followup", { p_followup_id: id, p_outcome: outcome, p_expected_version: version, p_request_key: key }); fail(error, "Completion failed"); return data as number; }
export async function cancelFollowup(id: string, reason: string, version: number, key = requestKey()) { const { data, error } = await supabase.rpc("cancel_crm_followup", { p_followup_id: id, p_reason: reason, p_expected_version: version, p_request_key: key }); fail(error, "Cancellation failed"); return data as number; }

export async function uploadCrmDocument(clientId: string, parentType: "client" | "walkin" | "timeline", parentId: string, file: File) {
  const validationError = validateCrmDocumentFile(file); if (validationError) throw new Error(validationError);
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120); const tenant = (await supabase.rpc("current_tenant_id")).data; if (!tenant) throw new Error("Tenant context is unavailable.");
  const path = `${tenant}/${parentType}/${parentId}/${crypto.randomUUID()}_${safeName}`; const upload = await supabase.storage.from("crm-documents").upload(path, file, { contentType: file.type, upsert: false }); fail(upload.error, "Upload failed");
  return finalizePrivateUpload(async () => { const { data, error } = await supabase.rpc("register_crm_document", { p_client_id: clientId, p_parent_type: parentType, p_parent_id: parentId, p_storage_path: path, p_original_filename: safeName, p_mime_type: file.type, p_size_bytes: file.size, p_request_key: requestKey() }); fail(error, "Document registration failed"); return data as string; }, () => supabase.storage.from("crm-documents").remove([path]));
}
export async function signedDocumentUrl(documentId: string) { const pathResult = await supabase.rpc("get_crm_document_path", { p_document_id: documentId }); fail(pathResult.error, "Document access failed"); const signed = await supabase.storage.from("crm-documents").createSignedUrl(pathResult.data as string, 60); fail(signed.error, "Signed access failed"); return signed.data!.signedUrl; }
export async function removeDocument(documentId: string, reason: string) { const result = await supabase.rpc("remove_crm_document", { p_document_id: documentId, p_reason: reason, p_request_key: requestKey() }); fail(result.error, "Document removal failed"); const removed = await supabase.storage.from("crm-documents").remove([result.data as string]); fail(removed.error, "Object cleanup failed"); }
