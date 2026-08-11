import { supabase } from "@jewelos/api-client";
import type { Tables } from "@jewelos/core";

export type MasterOption = Pick<Tables<"dropdown_masters">, "id" | "master_type" | "label" | "value" | "sort_order" | "is_active">;
const cached = new Map<string, Promise<MasterOption[]>>();

export function loadMasterOptions(types: readonly string[], activeOnly = true): Promise<MasterOption[]> {
  const key = `${activeOnly ? "active" : "all"}:${[...types].sort().join(",")}`;
  const existing = cached.get(key); if (existing) return existing;
  const request = Promise.resolve(supabase.from("dropdown_masters").select("id,master_type,label,value,sort_order,is_active").in("master_type", [...types]).eq("is_active", activeOnly).order("master_type").order("sort_order")).then(({ data, error }) => { if (error) throw new Error(error.message); return data ?? []; });
  cached.set(key, request); return request;
}
export function invalidateMasterOptions() { cached.clear(); }
