import { supabase } from "@jewelos/api-client";
import { validateDailyChecklistDraft, type DailyChecklistDraft, type DailyChecklistStatus } from "@jewelos/core";

export type DailyChecklistRecord = DailyChecklistDraft & Readonly<{
  id: string;
  designationId: string;
  designationLabel: string;
  revision: number;
}>;

export type DailyChecklistManagementData = Readonly<{ checklists: readonly DailyChecklistRecord[]; designations: readonly { id: string; label: string }[] }>;

export type DailyChecklistSaveInput = DailyChecklistDraft & Readonly<{
  id: string | null;
  designationId: string;
  revision: number;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Daily checklist response is invalid");
  return value as Record<string, unknown>;
}

function asItems(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Daily checklist items are invalid");
  return value.map((item) => {
    const row = asRecord(item);
    if (typeof row.id !== "string" || typeof row.text !== "string") throw new Error("Daily checklist item is invalid");
    return { id: row.id, text: row.text };
  });
}

function asChecklist(value: unknown): DailyChecklistRecord {
  const row = asRecord(value);
  if (typeof row.id !== "string" || typeof row.designationId !== "string" || typeof row.designationLabel !== "string" || typeof row.revision !== "number" || typeof row.title !== "string" || typeof row.confirmationText !== "string" || typeof row.isActive !== "boolean") throw new Error("Daily checklist response is invalid");
  return { ...validateDailyChecklistDraft({ title: row.title, instruction: typeof row.instruction === "string" ? row.instruction : null, confirmationText: row.confirmationText, isActive: row.isActive, items: asItems(row.items) }), id: row.id, designationId: row.designationId, designationLabel: row.designationLabel, revision: row.revision };
}

export async function loadDailyChecklistManagement(): Promise<DailyChecklistManagementData> {
  const [checklistResult, designationResult] = await Promise.all([
    supabase.rpc("list_designation_daily_checklists"),
    supabase.from("dropdown_masters").select("id,label").eq("master_type", "designation").eq("is_active", true).order("label"),
  ]);
  if (checklistResult.error) throw checklistResult.error;
  if (designationResult.error) throw designationResult.error;
  const { data } = checklistResult;
  if (!Array.isArray(data)) throw new Error("Daily checklist response is invalid");
  return { checklists: data.map(asChecklist), designations: (designationResult.data ?? []).map((item) => ({ id: item.id, label: item.label })) };
}

export type DailyChecklistSaveResult = Readonly<{ id: string; revision: number }>;

export async function saveDailyChecklist(input: DailyChecklistSaveInput): Promise<DailyChecklistSaveResult> {
  const draft = validateDailyChecklistDraft(input);
  const { data, error } = await supabase.rpc("save_designation_daily_checklist_with_audit", {
    p_checklist_id: input.id as never,
    p_designation_id: input.designationId,
    p_title: draft.title,
    p_instruction: draft.instruction ?? "",
    p_items: draft.items as unknown as never,
    p_confirmation_text: draft.confirmationText,
    p_is_active: draft.isActive,
    p_expected_revision: input.revision,
  });
  if (error) throw error;
  const row = asRecord(data);
  if (typeof row.id !== "string" || typeof row.revision !== "number") throw new Error("Daily checklist save response is invalid");
  return { id: row.id, revision: row.revision };
}

export async function loadMyDailyChecklistStatus(): Promise<DailyChecklistStatus> {
  const { data, error } = await supabase.rpc("get_my_daily_checklist_status");
  if (error) throw error;
  const row = asRecord(data);
  if (typeof row.required !== "boolean" || typeof row.date !== "string") throw new Error("Daily checklist response is invalid");
  if (!row.required) return { required: false, date: row.date, checklist: null };
  const checklist = asRecord(row.checklist);
  if (typeof checklist.id !== "string" || typeof checklist.designationId !== "string" || typeof checklist.title !== "string" || typeof checklist.confirmationText !== "string" || typeof checklist.revision !== "number") throw new Error("Daily checklist response is invalid");
  return { required: true, date: row.date, checklist: { id: checklist.id, designationId: checklist.designationId, title: checklist.title, instruction: typeof checklist.instruction === "string" ? checklist.instruction : null, items: asItems(checklist.items), confirmationText: checklist.confirmationText, revision: checklist.revision } };
}

export async function acknowledgeDailyChecklist(id: string, revision: number, checkedIds: readonly string[]) {
  const { error } = await supabase.rpc("acknowledge_daily_checklist_with_audit", { p_checklist_id: id, p_revision: revision, p_checked_item_ids: [...checkedIds] });
  if (error) throw error;
}
