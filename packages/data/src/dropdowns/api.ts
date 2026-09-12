import { getSupabase as db } from "@jewelos/api-client/client";
import type { FormMasterOption, Json, Tables } from "@jewelos/core";
import { writeError } from "../writeErrors.ts";

export type MasterOption = Pick<Tables<"dropdown_masters">, "id" | "master_type" | "label" | "value" | "sort_order" | "is_active">;
const cached = new Map<string, Promise<MasterOption[]>>();

export function loadMasterOptions(types: readonly string[], activeOnly = true): Promise<MasterOption[]> {
  const key = `${activeOnly ? "active" : "all"}:${[...types].sort().join(",")}`;
  const existing = cached.get(key); if (existing) return existing;
  const query = db().from("dropdown_masters").select("id,master_type,label,value,sort_order,is_active").eq("is_active", activeOnly).order("master_type").order("sort_order");
  const request = Promise.resolve(types.length ? query.in("master_type", [...types]) : query).then(({ data, error }) => { if (error) throw new Error(error.message); return data ?? []; });
  cached.set(key, request); return request;
}
export function invalidateMasterOptions() { cached.clear(); }

export async function loadAllMasterOptions(): Promise<MasterOption[]> {
  const { data, error } = await db().from("dropdown_masters")
    .select("id,master_type,label,value,sort_order,is_active")
    .order("master_type")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function changeMasterOption(input: {
  id?: string;
  masterType: string;
  label: string;
  value: string;
  sortOrder: number;
  active: boolean;
}): Promise<void> {
  const { error } = await db().rpc("change_dropdown_with_audit", {
    p_operation: input.id ? "update" : "create",
    ...(input.id ? { p_record_id: input.id } : {}),
    p_master_type: input.masterType,
    p_label: input.label,
    p_value: input.value,
    p_sort_order: input.sortOrder,
    p_is_active: input.active,
  });
  // A unique-index refusal here is a person re-adding a value that exists, not
  // a fault, so it is re-worded before it reaches either client.
  if (error) throw writeError(error.message);
  invalidateMasterOptions();
}

/** The Dropdown Master rows in the shape the forms engine resolves references with. */
export const toFormMasterOptions = (options: readonly MasterOption[]): FormMasterOption[] =>
  options.map((option) => ({ masterType: option.master_type, value: option.value, label: option.label }));

/** Creates a brand-new Dropdown Master list and returns its master_type key. */
export async function createMasterList(masterType: string, options: readonly { value: string; label: string }[]): Promise<string> {
  const { data, error } = await db().rpc("create_dropdown_list_with_audit", { p_master_type: masterType, p_options: options as unknown as Json });
  if (error) throw writeError(error.message);
  invalidateMasterOptions();
  return (data as string | null) ?? masterType;
}
