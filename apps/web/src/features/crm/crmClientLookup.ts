// Client details in every form (owner request 2026-11-04): the CRM lookup used by the app-wide
// FormCrmServicesContext. The CRM code loads on the first lookup only.
import { supabase } from "@jewelos/api-client";
import type { FormCrmServices } from "@jewelos/core";
import type { CrmClientLookup } from "@jewelos/crm-ui";
import { crmProjectConfig } from "@/lib/crmProject";

let loading: Promise<CrmClientLookup> | null = null;

export const appCrmServices: FormCrmServices = {
  lookup: async (kind, value) => {
    loading ??= import("@jewelos/crm-ui").then((module) => module.createCrmClientLookup({ supabase, crmProject: crmProjectConfig }));
    try { return await (await loading)(kind, value); } catch { loading = null; return null; }
  },
};
