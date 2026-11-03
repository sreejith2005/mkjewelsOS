// Which Forms Library forms CRM uses (CRM Form Settings, 2026-11-03), so Forms Library can list
// them under CRM forms and send "Fill form" to CRM, where filling them registers the client or lead.
import { supabase } from "@jewelos/api-client";
import type { CrmFormPurpose } from "@jewelos/core";

/** Form family -> the CRM registration that uses it. Empty without CRM access. */
export async function loadCrmLinkedFamilies(): Promise<ReadonlyMap<string, CrmFormPurpose>> {
  const { data, error } = await supabase.rpc("get_crm_form_bindings");
  if (error) return new Map();
  // get_crm_form_bindings (migration 0373) returns { bindings: [{ purpose, formFamilyId, ... }] }.
  const bindings = ((data ?? {}) as unknown as { bindings?: Array<{ purpose: CrmFormPurpose; formFamilyId: string }> }).bindings ?? [];
  return new Map(bindings.map((binding) => [binding.formFamilyId, binding.purpose]));
}

/** Where a CRM form is filled: CRM registration, client queue or lead. */
export function crmFormFillPath(purpose: CrmFormPurpose): string {
  return purpose === "lead" ? "/crm/queue?register=lead" : "/crm/queue?register=client";
}
