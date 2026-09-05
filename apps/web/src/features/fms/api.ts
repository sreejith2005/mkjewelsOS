import { supabase } from "@jewelos/api-client";
import type { FmsFlowDefinition, FmsFormFieldOption, FmsFormFieldRef, Json } from "@jewelos/core";
import { parseFormOptions } from "@jewelos/core";
import { loadMasterOptions } from "@/features/dropdowns/api";

type DbError = { message: string } | null;
const fail = (label: string, error: DbError) => { if (error) throw new Error(`${label}: ${error.message}`); };

export type FmsFlowRow = {
  id: string; family_id: string; version: number; name: string; description: string | null; status: "draft" | "published" | "archived";
  scope_type: "tenant" | "branch" | "department"; branch_id: string | null; department_id: string | null; module_context?: string | null; is_active: boolean; usage_count: number;
};
export type FmsStageRow = {
  id: string; fms_flow_id: string; stage_key: string; name: string; method: string | null; step_type: FmsFlowDefinition["stages"][number]["type"];
  sort_order: number; is_required: boolean; planned_time_rule: Json; completion_rule: "all_doers" | "any_doer" | "manager_approval" | null; allow_multiple_doers: boolean | null;
  requires_upload: boolean | null; requires_remark: boolean | null; checklist_definition: Json; form_template_id: string | null; requires_next_doer_handoff: boolean | null;
  can_move_backward: boolean | null; can_reject: boolean | null; can_request_revision: boolean | null; can_escalate: boolean | null; default_next_stage_id: string | null;
  parallel_target_stage_ids: string[]; join_rule: "all" | "any" | "specific" | null; join_required_stage_ids: string[] | null; split_to_flow_id: string | null; canvas_position?: { x: number; y: number } | null;
};
export type FmsInstance = { id: string; fms_flow_id: string; reference_number: string; title: string; status: "active" | "completed" | "cancelled" | "on_hold" | "overdue"; priority: "high" | "medium" | "low" | null; context: Json; branch_id: string | null; department_id: string | null; started_by: string; started_at: string | null; completed_at: string | null; parent_instance_id: string | null; flow_version: number };
export type FmsInstanceStage = { id: string; fms_instance_id: string; fms_stage_id: string; status: string; assigned_to: string[] | null; planned_datetime: string | null; actual_datetime: string | null; delay_minutes: number | null; sla_breached: boolean | null; form_submission_id: string | null; remark: string | null; outcome: string | null; completed_by: string | null; escalation_count: number };
export type FmsChecklistItem = { id: string; fms_instance_stage_id: string; item_key: string; label: string; is_required: boolean; is_completed: boolean; sort_order: number };
export type FmsEvidence = { id: string; fms_instance_stage_id: string; storage_path: string; original_filename: string; mime_type: string; size_bytes: number; uploaded_by: string; created_at: string };
export type FmsLog = { id: string; fms_instance_stage_id: string; actor_id: string | null; action: string; details: Json | null; created_at: string | null };
export type FmsAvailability = "present" | "absent" | "half_day" | "remote";
export type FmsData = { flows: FmsFlowRow[]; stages: FmsStageRow[]; assignees: Array<{ fms_stage_id: string; assignee_type: string; user_profile_id: string | null; fallback_user_profile_id?: string | null; role_value: string | null; allow_next_selection: boolean; sort_order: number }>; branchRules: Array<{ id: string; fms_stage_id: string; source_type: string; source_key: string | null; condition_operator: string; condition_value: string | null; next_stage_id: string | null; next_flow_id: string | null; label: string | null; sort_order: number | null }>; forms: Array<{ id: string; name: string; version: number; family_id: string; lifecycle: string }>; formFields: Record<string, readonly FmsFormFieldRef[]>; statusOptions?: Array<{ label: string; value: string }>; contextDefaults?: Array<{ module_context: string; user_profile_id: string }>; users: Array<{ id: string; employee_name: string; employee_code?: string; account_status?: string; user_role: string; branch_id: string; department_id: string; working_status: string; is_login_enabled: boolean | null }>; availability: Array<{ user_profile_id: string; status: FmsAvailability }>; branches: Array<{ id: string; name: string }>; departments: Array<{ id: string; branch_id: string | null; name: string }> };
export type FmsStartResult = { instance_id: string; reference_number: string };

function dateInKolkata(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function loadFmsBuilderData(): Promise<FmsData> {
  const kolkataDate = dateInKolkata(new Date());
  const results = await Promise.all([
    supabase.from("fms_flows").select("*").order("name").order("version", { ascending: false }).limit(300),
    supabase.from("fms_stages").select("*").order("sort_order").limit(1000),
    supabase.from("fms_stage_assignees").select("*").order("sort_order").limit(1000),
    supabase.from("fms_branch_rules").select("*").order("sort_order").limit(1000),
    supabase.from("form_templates").select("id,name,version,family_id,lifecycle").eq("lifecycle", "published").eq("is_active", true).order("name").limit(300),
    supabase.from("dropdown_masters").select("label,value").eq("master_type", "buy_status").eq("is_active", true).order("sort_order").limit(300),
    supabase.from("user_profiles").select("id,employee_name,employee_code,account_status,user_role,branch_id,department_id,working_status,is_login_enabled").order("employee_name").limit(500),
    supabase.from("branches").select("id,name").eq("is_active", true).order("name").limit(100),
    supabase.from("departments").select("id,branch_id,name").eq("is_active", true).order("name").limit(300),
    supabase.from("user_availability").select("user_profile_id,status").eq("date", kolkataDate).limit(1000),
    supabase.from("fms_context_assignee_defaults").select("module_context,user_profile_id").limit(100),
  ]);
  results.forEach((result) => fail("Load FMS builder", result.error));
  const stages = results[1].data as FmsStageRow[];
  const forms = await withPinnedFormVersions(results[4].data ?? [], stages);
  return { flows: results[0].data as FmsFlowRow[], stages, assignees: results[2].data ?? [], branchRules: results[3].data ?? [], forms, formFields: await formFieldIndex(forms.map((form) => form.id)), statusOptions: results[5].data ?? [], users: results[6].data ?? [], branches: results[7].data ?? [], departments: results[8].data ?? [], availability: results[9].data ?? [], contextDefaults: results[10].data ?? [] };
}

type FormRef = FmsData["forms"][number];

/**
 * A stage pins an exact Form version, and publishing a Form revision archives
 * the version it replaces. Without the archived rows the builder would lose the
 * questions of a flow that is still perfectly runnable, so pinned versions are
 * loaded alongside the currently published ones.
 */
async function withPinnedFormVersions(published: readonly FormRef[], stages: readonly FmsStageRow[]): Promise<FormRef[]> {
  const pinned = [...new Set(stages.flatMap((stage) => stage.form_template_id ? [stage.form_template_id] : []))].filter((id) => !published.some((form) => form.id === id));
  if (!pinned.length) return [...published];
  const { data, error } = await supabase.from("form_templates").select("id,name,version,family_id,lifecycle").in("id", pinned).limit(300);
  fail("Load pinned FMS form versions", error);
  return [...published, ...(data ?? [])];
}

type FormFieldRow = { form_template_id: string; field_key: string; field_name: string; field_type: string; options: Json | null; option_source: string | null; dropdown_master_type: string | null };

/**
 * Indexes the published Forms' questions by template so FMS route configuration
 * and publish readiness reference stable field keys and option values rather
 * than display labels. Dropdown Master questions resolve through the master.
 */
async function formFieldIndex(templateIds: readonly string[]): Promise<Record<string, readonly FmsFormFieldRef[]>> {
  if (!templateIds.length) return {};
  const { data, error } = await supabase.from("form_fields").select("form_template_id,field_key,field_name,field_type,options,option_source,dropdown_master_type").in("form_template_id", [...templateIds]).order("sort_order").limit(5000);
  fail("Load FMS form questions", error);
  const rows = (data ?? []) as FormFieldRow[];
  const masterTypes = [...new Set(rows.flatMap((row) => row.option_source === "dropdown_master" && row.dropdown_master_type ? [row.dropdown_master_type] : []))];
  const masters = masterTypes.length ? await loadMasterOptions(masterTypes, true).catch(() => []) : [];
  const index: Record<string, FmsFormFieldRef[]> = {};
  for (const row of rows) {
    if (STRUCTURAL_FIELD_TYPES.has(row.field_type)) continue;
    const options: FmsFormFieldOption[] = row.option_source === "dropdown_master" && row.dropdown_master_type
      ? masters.filter((option) => option.master_type === row.dropdown_master_type).map((option) => ({ value: option.value, label: option.label || option.value }))
      : (parseFormOptions(row.options) ?? []).map((option) => ({ value: option.value, label: option.label || option.value }));
    (index[row.form_template_id] ??= []).push({ key: row.field_key, label: row.field_name || row.field_key, ...(options.length ? { options, optionValues: options.map((option) => option.value) } : {}) });
  }
  return index;
}

/** Layout-only questions carry no answer, so they can never decide a route. */
const STRUCTURAL_FIELD_TYPES: ReadonlySet<string> = new Set(["section_header", "divider"]);

export async function saveFmsDraft(flowId: string | null, definition: FmsFlowDefinition): Promise<string> {
  const metadata = { name: definition.name, description: definition.description ?? "", scope_type: definition.scope, branch_id: definition.branchId ?? "", department_id: definition.departmentId ?? "", module_context: definition.moduleContext ?? "", trigger_type: "manual", is_active: true };
  const { data, error } = await supabase.rpc("save_fms_flow_draft_with_audit", { p_flow_id: flowId as string, p_metadata: metadata as Json, p_stages: definition.stages as unknown as Json }); fail("Save FMS draft", error); if (!data) throw new Error("Save FMS draft returned no ID"); const { error: contextError } = await supabase.rpc("set_fms_flow_context_with_audit", { p_flow_id: data, ...(definition.moduleContext ? { p_module_context: definition.moduleContext } : {}) }); fail("Save FMS workflow context", contextError); return data;
}
export const saveFmsContextAssigneeDefault = async (moduleContext: string, userProfileId: string) => { const { error } = await supabase.rpc("save_fms_context_assignee_default_with_audit", { p_module_context: moduleContext, p_user_profile_id: userProfileId }); fail("Save FMS default assignee", error); };
export const reviseFmsFlow = async (id: string) => { const { data, error } = await supabase.rpc("create_fms_revision_with_audit", { p_flow_id: id }); fail("Create FMS revision", error); return data; };
export const publishFmsFlow = async (id: string) => { const { error } = await supabase.rpc("publish_fms_flow_with_audit", { p_flow_id: id }); fail("Publish FMS flow", error); };
export const archiveFmsFlow = async (id: string, reason: string) => { const { error } = await supabase.rpc("archive_fms_flow_with_audit", { p_flow_id: id, p_reason: reason }); fail("Archive FMS flow", error); };
export const deleteFmsFlow = async (id: string) => { const { error } = await supabase.rpc("delete_fms_flow_with_audit" as any, { p_flow_id: id }); fail("Delete FMS flow", error); };

export async function loadFmsRuntime(): Promise<{ instances: FmsInstance[]; stages: FmsInstanceStage[]; definitions: FmsStageRow[]; flows: FmsFlowRow[]; checklist: FmsChecklistItem[]; evidence: FmsEvidence[]; logs: FmsLog[]; users: FmsData["users"] }> {
  const [instances, stages, definitions, flows, checklist, evidence, logs, users] = await Promise.all([
    supabase.from("fms_instances").select("*").order("started_at", { ascending: false }).limit(200), supabase.from("fms_instance_stages").select("*").order("created_at").limit(1500),
    supabase.from("fms_stages").select("*").order("sort_order").limit(1000), supabase.from("fms_flows").select("*").limit(300), supabase.from("fms_instance_checklist_items").select("*").order("sort_order").limit(2000),
    supabase.from("fms_evidence").select("*").is("removed_at", null).order("created_at").limit(1000), supabase.from("fms_stage_logs").select("*").order("created_at").limit(3000),
    supabase.from("user_profiles").select("id,employee_name,user_role,branch_id,department_id,working_status,is_login_enabled").order("employee_name").limit(500),
  ]); [instances, stages, definitions, flows, checklist, evidence, logs, users].forEach((result) => fail("Load FMS runtime", result.error));
  return { instances: instances.data as FmsInstance[], stages: stages.data as FmsInstanceStage[], definitions: definitions.data as FmsStageRow[], flows: flows.data as FmsFlowRow[], checklist: checklist.data as FmsChecklistItem[], evidence: evidence.data as FmsEvidence[], logs: logs.data as FmsLog[], users: users.data ?? [] };
}
export async function startFmsInstance(input: { flowId: string; title: string; priority: "high" | "medium" | "low"; context: Json; branchId: string; departmentId: string; firstAssigneeId: string | null }): Promise<FmsStartResult> { const { data, error } = await supabase.rpc("start_fms_instance_with_audit", { p_flow_id: input.flowId, p_title: input.title, p_priority: input.priority, p_context: input.context, p_branch_id: input.branchId, p_department_id: input.departmentId, ...(input.firstAssigneeId ? { p_first_assignee_id: input.firstAssigneeId } : {}) }); fail("Start FMS instance", error); const result = data?.[0]; if (!result) throw new Error("Start FMS instance returned no reference"); return result; }
export const claimFmsStage = async (id: string) => { const { error } = await supabase.rpc("claim_fms_stage_with_audit", { p_instance_stage_id: id }); fail("Claim FMS stage", error); };
export const completeFmsStage = async (id: string, outcome: string, remark: string, checklist: Record<string, boolean>, nextAssigneeId: string | null) => { const { error } = await supabase.rpc("complete_fms_stage_with_audit", { p_instance_stage_id: id, p_checklist: checklist, ...(outcome ? { p_outcome: outcome } : {}), ...(remark ? { p_remark: remark } : {}), ...(nextAssigneeId ? { p_next_assignee_id: nextAssigneeId } : {}) }); fail("Complete FMS stage", error); };
export async function submitFmsFormAndProgress(input: { formTemplateId: string; answers: Json; instanceStageId: string; idempotencyKey: string; outcome: string; remark: string; checklist: Record<string, boolean>; nextAssigneeId: string | null }) {
  const { data, error } = await supabase.rpc("submit_fms_form_and_progress_with_audit" as never, {
    p_form_template_id: input.formTemplateId,
    p_answers: input.answers,
    p_linked_module: "fms_stage",
    p_linked_record_id: input.instanceStageId,
    p_idempotency_key: input.idempotencyKey,
    ...(input.outcome ? { p_outcome: input.outcome } : {}),
    ...(input.remark ? { p_remark: input.remark } : {}),
    p_checklist: input.checklist,
    ...(input.nextAssigneeId ? { p_next_assignee_id: input.nextAssigneeId } : {}),
  } as never);
  fail("Submit and progress FMS stage", error);
  return data;
}
export const reviewFmsStage = async (id: string, decision: "approved" | "rejected" | "revision_requested", remark: string, nextAssigneeId: string | null) => { const { error } = await supabase.rpc("review_fms_stage_with_audit", { p_instance_stage_id: id, p_decision: decision, ...(remark ? { p_remark: remark } : {}), ...(nextAssigneeId ? { p_next_assignee_id: nextAssigneeId } : {}) }); fail("Review FMS stage", error); };
export const reassignFmsStage = async (id: string, from: string, to: string, reason: string) => { const { error } = await supabase.rpc("reassign_fms_stage_with_audit", { p_instance_stage_id: id, p_from_user_id: from, p_to_user_id: to, p_reason: reason }); fail("Reassign FMS stage", error); };
export const moveFmsStageBackward = async (id: string, target: string, reason: string, assignee: string | null) => { const { error } = await supabase.rpc("move_fms_stage_backward_with_audit", { p_instance_stage_id: id, p_target_stage_id: target, p_reason: reason, ...(assignee ? { p_assignee_id: assignee } : {}) }); fail("Move FMS stage backward", error); };
export const requestFmsRevision = async (id: string, target: string, reason: string, assignee: string | null) => { const { error } = await supabase.rpc("request_fms_revision_with_audit", { p_instance_stage_id: id, p_target_stage_id: target, p_reason: reason, ...(assignee ? { p_assignee_id: assignee } : {}) }); fail("Request FMS revision", error); };
export const escalateFmsStage = async (id: string, reason: string) => { const { error } = await supabase.rpc("escalate_fms_stage_with_audit", { p_instance_stage_id: id, p_reason: reason }); fail("Escalate FMS stage", error); };
export const setFmsInstanceStatus = async (id: string, action: "hold" | "resume" | "cancel", reason: string) => {
  const rpc = action === "hold" ? "hold_fms_instance_with_audit" : action === "resume" ? "resume_fms_instance_with_audit" : "cancel_fms_instance_with_audit";
  const { error } = await supabase.rpc(rpc, { p_instance_id: id, p_reason: reason });
  fail(`${action} FMS instance`, error);
};
export const updateFmsChecklistItem = async (id: string, completed: boolean) => { const { error } = await supabase.rpc("update_fms_checklist_item_with_audit", { p_item_id: id, p_completed: completed }); fail("Update FMS checklist", error); };
export async function uploadFmsEvidence(stageId: string, tenantId: string, file: File) { const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]; const allowed = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]); if (!extension || !allowed.has(extension) || file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) throw new Error("Evidence must be a JPG, PNG, WebP, or PDF up to 10 MB"); const path = `${tenantId}/${stageId}/${crypto.randomUUID()}${extension}`; const { error: uploadError } = await supabase.storage.from("fms-evidence").upload(path, file, { contentType: file.type, upsert: false }); fail("Upload FMS evidence", uploadError); const { error } = await supabase.rpc("register_fms_evidence_with_audit", { p_instance_stage_id: stageId, p_storage_path: path, p_original_filename: file.name.slice(0, 240), p_mime_type: file.type, p_size_bytes: file.size }); fail("Register FMS evidence", error); }
export async function signedFmsEvidenceUrl(path: string) { const { data, error } = await supabase.storage.from("fms-evidence").createSignedUrl(path, 60); fail("Open FMS evidence", error); if (!data) throw new Error("Signed URL was not created"); return data.signedUrl; }
