import { supabase } from "@jewelos/api-client";
import type { Json, Tables } from "@jewelos/core";
import { normalizeFormDefinition, type FormFieldDefinition, type FormTemplateDefinition } from "@jewelos/core";

export type FormTemplate = Tables<"form_templates">;
export type FormField = Tables<"form_fields">;
export type FormSubmission = Tables<"form_submissions">;
export type FormBundle = FormTemplate & { fields: FormFieldDefinition[]; submissionCount: number };
const fail = (label: string, error: { message: string } | null) => { if (error) throw new Error(`${label}: ${error.message}`); };
const object = (value: Json | null): Record<string, Json> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};

export function toDefinition(template: FormTemplate, fields: FormField[]): FormTemplateDefinition {
  return normalizeFormDefinition({ name: template.name, description: template.description ?? undefined,
    permissions: { roles: ((object(template.permissions).roles ?? []) as string[]).filter((role): role is import("@jewelos/core").UserRole => ["super_admin","admin","manager","hr","crm","staff","doer","housekeeping"].includes(role)) },
    fields: fields.map((field) => {
      const condition = object(field.conditional_logic);
      return { id: field.id, key: field.field_key, label: field.field_name, type: field.field_type as FormFieldDefinition["type"], sortOrder: field.sort_order, required: field.is_required, shown: field.is_shown, editable: field.is_editable, placeholder: field.placeholder ?? undefined, helperText: field.helper_text ?? undefined, options: Array.isArray(field.options) ? field.options.filter((value): value is string => typeof value === "string") : undefined, validation: object(field.validation) as FormFieldDefinition["validation"], ...(Object.keys(condition).length ? { condition: condition as FormFieldDefinition["condition"] } : {}) };
    }) });
}

export async function loadForms(): Promise<{ bundles: FormBundle[]; submissions: FormSubmission[] }> {
  const [templates, fields, submissions] = await Promise.all([supabase.from("form_templates").select("*").order("updated_at", { ascending: false }).limit(200), supabase.from("form_fields").select("*").order("sort_order").limit(2000), supabase.from("form_submissions").select("*").order("submitted_at", { ascending: false }).limit(500)]);
  fail("Load forms", templates.error); fail("Load form fields", fields.error); fail("Load form submissions", submissions.error);
  const fieldRows = fields.data ?? []; const submissionRows = submissions.data ?? []; const templateRows = templates.data ?? [];
  const fieldsByTemplate = new Map<string, FormField[]>(); for (const field of fieldRows) fieldsByTemplate.set(field.form_template_id, [...(fieldsByTemplate.get(field.form_template_id) ?? []), field]);
  const counts = new Map<string, number>(); for (const submission of submissionRows) counts.set(submission.form_template_id, (counts.get(submission.form_template_id) ?? 0) + 1);
  return { bundles: templateRows.map((template) => ({ ...template, fields: toDefinition(template, fieldsByTemplate.get(template.id) ?? []).fields as FormFieldDefinition[], submissionCount: counts.get(template.id) ?? 0 })), submissions: submissionRows };
}
export async function loadTaskForms(templateIds: string[], taskIds: string[]): Promise<{ bundles: FormBundle[]; submissions: FormSubmission[] }> {
  if (!templateIds.length) return { bundles: [], submissions: [] };
  const [templates, fields, submissions] = await Promise.all([
    supabase.from("form_templates").select("*").in("id", templateIds).limit(templateIds.length),
    supabase.from("form_fields").select("*").in("form_template_id", templateIds).order("sort_order").limit(1000),
    taskIds.length ? supabase.from("form_submissions").select("*").in("linked_record_id", taskIds).in("form_template_id", templateIds).order("submitted_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] as FormSubmission[], error: null }),
  ]); fail("Load task forms", templates.error); fail("Load task form fields", fields.error); fail("Load task form submissions", submissions.error);
  const fieldsByTemplate = new Map<string, FormField[]>(); for (const item of fields.data ?? []) fieldsByTemplate.set(item.form_template_id, [...(fieldsByTemplate.get(item.form_template_id) ?? []), item]);
  const submissionRows = submissions.data ?? []; const counts = new Map<string, number>(); for (const item of submissionRows) counts.set(item.form_template_id, (counts.get(item.form_template_id) ?? 0) + 1);
  return { bundles: (templates.data ?? []).map((item) => ({ ...item, fields: toDefinition(item, fieldsByTemplate.get(item.id) ?? []).fields as FormFieldDefinition[], submissionCount: counts.get(item.id) ?? 0 })), submissions: submissionRows };
}
export async function loadFormDynamicOptions() {
  const [users, branches, departments] = await Promise.all([
    supabase.from("v_task_users").select("id,employee_name").eq("working_status", "active").order("employee_name").limit(500),
    supabase.from("branches").select("id,name").eq("is_active", true).order("name").limit(100),
    supabase.from("departments").select("id,name,branch_id").eq("is_active", true).order("name").limit(500),
  ]);
  fail("Load form users", users.error); fail("Load form branches", branches.error); fail("Load form departments", departments.error);
  return { users: (users.data ?? []).flatMap((row) => row.id && row.employee_name ? [{ id: row.id, label: row.employee_name }] : []), branches: (branches.data ?? []).map((row) => ({ id: row.id, label: row.name })), departments: (departments.data ?? []).map((row) => ({ id: row.id, branchId: row.branch_id, label: row.name })) };
}
export const saveDraft = async (id: string | null, payload: Json, fields: Json) => { const { error } = await supabase.rpc("save_form_draft_with_audit", { p_template_id: id as string, p_payload: payload, p_fields: fields }); fail("Save form draft", error); };
export const savePublishedForm = async (id: string, payload: Json, fields: Json) => { const { error } = await supabase.rpc("save_published_form_with_audit", { p_template_id: id, p_payload: payload, p_fields: fields }); fail("Save published form", error); };
export const reviseForm = async (id: string) => { const { error } = await supabase.rpc("create_form_revision_with_audit", { p_source_template_id: id, p_payload: {} }); fail("Create form revision", error); };
export const publishForm = async (id: string) => { const { error } = await supabase.rpc("publish_form_with_audit", { p_template_id: id }); fail("Publish form", error); };
export const archiveForm = async (id: string) => { const { error } = await supabase.rpc("archive_form_with_audit", { p_template_id: id }); fail("Archive form", error); };
export const deleteForm = async (id: string) => { const { error } = await supabase.rpc("delete_form_with_audit", { p_template_id: id }); fail("Delete form", error); };
export const duplicateForm = async (id: string, name?: string) => {
  const { data, error } = await supabase.rpc("duplicate_form_with_audit", { p_source_template_id: id, ...(name ? { p_name: name } : {}) });
  fail("Duplicate form", error);
  if (!data) throw new Error("Duplicate form: the server did not return the new draft");
  return data;
};
export const publishAsNewForm = async (id: string) => {
  const draftId = await duplicateForm(id);
  await publishForm(draftId);
  return draftId;
};
export const submitForm = async (id: string, answers: object, linkedModule?: string, linkedRecordId?: string) => { const { data, error } = await supabase.rpc("submit_form_with_audit", { p_form_template_id: id, p_answers: answers as Json, ...(linkedModule ? { p_linked_module: linkedModule } : {}), ...(linkedRecordId ? { p_linked_record_id: linkedRecordId } : {}) }); fail("Submit form", error); if (!data) throw new Error("Submit form: the server did not return a submission id"); return data as string; };
export async function startFmsFromFormSubmission(submissionId: string): Promise<{ instanceId: string; referenceNumber: string } | null> {
  const { data, error } = await supabase.rpc("start_fms_from_form_submission_with_audit", { p_submission_id: submissionId });
  fail("Start linked FMS", error);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { instanceId: row.instance_id as string, referenceNumber: row.reference_number as string } : null;
}
export const reviewSubmission = async (id: string, decision: "approved" | "rejected", notes: string) => { const { error } = await supabase.rpc("review_form_submission_with_audit", { p_submission_id: id, p_decision: decision, p_review_notes: notes }); fail("Review submission", error); };
