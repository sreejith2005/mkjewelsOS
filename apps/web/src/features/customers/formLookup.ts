// Client details in every form (owner request 2026-11-04): typing a phone number fills the form
// with what the customer master database knows about that person; a pincode fills city, state
// and country. Since 2026-11-20 this reads the customer database, not the retired CRM project.
import { CLIENT_PROFILE_KEYS, type ClientProfileKey, type FormCrmServices } from "@jewelos/core";
import { lookupCustomerForForm } from "@jewelos/data/customers/api";

const PROFILE_KEYS: ReadonlySet<string> = new Set(CLIENT_PROFILE_KEYS);

export const customerFormServices: FormCrmServices = {
  lookup: async (kind, value) => {
    try {
      const found = await lookupCustomerForForm(kind, value);
      if (!found) return null;
      const details: Partial<Record<ClientProfileKey, string | null>> = {};
      for (const [key, text] of Object.entries(found)) if (PROFILE_KEYS.has(key)) details[key as ClientProfileKey] = text;
      return { details };
    } catch {
      return null;
    }
  },
};
