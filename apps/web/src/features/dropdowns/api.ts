import { supabase } from "@jewelos/api-client";
import type { FormMasterOption, Json, Tables } from "@jewelos/core";

export type MasterOption = Pick<Tables<"dropdown_masters">, "id" | "master_type" | "label" | "value" | "sort_order" | "is_active">;
const cached = new Map<string, Promise<MasterOption[]>>();

export function loadMasterOptions(types: readonly string[], activeOnly = true): Promise<MasterOption[]> {
  const key = `${activeOnly ? "active" : "all"}:${[...types].sort().join(",")}`;
  const existing = cached.get(key); if (existing) return existing;
  const query = supabase.from("dropdown_masters").select("id,master_type,label,value,sort_order,is_active").eq("is_active", activeOnly).order("master_type").order("sort_order");
  const request = Promise.resolve(types.length ? query.in("master_type", [...types]) : query).then(({ data, error }) => { if (error) throw new Error(error.message); return data ?? []; });
  cached.set(key, request); return request;
}
export function invalidateMasterOptions() { cached.clear(); }

/** The Dropdown Master rows in the shape the forms engine resolves references with. */
export const toFormMasterOptions = (options: readonly MasterOption[]): FormMasterOption[] =>
  options.map((option) => ({ masterType: option.master_type, value: option.value, label: option.label }));

/** Creates a brand-new Dropdown Master list and returns its master_type key. */
export async function createMasterList(masterType: string, options: readonly { value: string; label: string }[]): Promise<string> {
  const { data, error } = await supabase.rpc("create_dropdown_list_with_audit", { p_master_type: masterType, p_options: options as unknown as Json });
  if (error) throw new Error(error.message);
  invalidateMasterOptions();
  return (data as string | null) ?? masterType;
}
