// crm-port: client details for any JewelOS form (owner request 2026-11-04). When someone types a
// phone number that belongs to a registered client or lead, the form fills what CRM knows about
// that person; a pincode fills city, state and country. It reads through the same login bridge
// as /crm (crm-session-exchange), so CRM's own access rules decide what comes back, and someone
// without CRM access gets nothing.
import type { JewelosClient } from "@jewelos/api-client";
import type { FormClientLookup } from "@jewelos/core";

import { clientProfileAutofill } from "@/lib/client-phone-lookup";
import { composePhone, DEFAULT_COUNTRY_CODE, phoneKey } from "@/lib/phone";
import { parseWalkinProfileDefaults } from "@/lib/walkin-profile-defaults";

import { createCrmProjectClient, crmTokenSource, type CrmProjectConfig } from "./crm-project";

export type CrmClientLookup = (kind: "client_phone" | "pincode", value: string) => Promise<FormClientLookup | null>;

export function createCrmClientLookup({ supabase, crmProject }: { supabase: JewelosClient; crmProject: CrmProjectConfig }): CrmClientLookup {
  if (!crmProject.url || !crmProject.anonKey) return async () => null;
  const source = crmTokenSource({ config: crmProject, jewelosAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null });
  const client = createCrmProjectClient({ config: crmProject, source });
  return async (kind, value) => {
    try {
      if (kind === "pincode") {
        const pincode = value.trim();
        if (!/^\d{6}$/.test(pincode)) return null;
        const { data } = await client.from("lookup_pincodes").select("city,state,country").eq("pincode", pincode).eq("active", true).maybeSingle();
        return data ? { details: { city: data.city, state: data.state, country: data.country } } : null;
      }
      const phone = phoneKey(composePhone(DEFAULT_COUNTRY_CODE, value));
      if (!phone) return null;
      const { data, error } = await client.rpc("lookup_client_profile_by_phone", { p_phone: `+${phone}` });
      const matched = !error ? data?.[0] : undefined;
      if (!matched) return null;
      const defaults = await client.rpc("get_walkin_profile_defaults", { p_client_id: matched.client_id });
      return { details: clientProfileAutofill({ ...matched, walkin_defaults: parseWalkinProfileDefaults(defaults.error ? null : defaults.data) }) };
    } catch {
      return null;
    }
  };
}
