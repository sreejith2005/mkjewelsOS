// crm-port: customer search for Store Intelligence (owner request 2026-11-06). The "Link customer"
// drawer on a recorded conversation asks the CRM, through the same login bridge as /crm
// (crm-session-exchange), for every client matching an exact code, visit reference or phone. The
// CRM's own access rule decides what comes back; nothing is created, merged or guessed from a name.
import type { JewelosClient } from "@jewelos/api-client";
import { parseCrmCandidates, type CrmCandidateResult } from "@jewelos/core";

import { createCrmProjectClient, crmTokenSource, type CrmProjectConfig } from "./crm-project";

export type CrmCandidateSearch = (query: string) => Promise<CrmCandidateResult>;

/** Fixed error words the screen can act on; CRM messages are never shown. */
export class CrmSearchError extends Error {
  constructor(readonly kind: "unconfigured" | "denied" | "unavailable") { super(kind); }
}

export function createCrmCandidateSearch({ supabase, crmProject }: { supabase: JewelosClient; crmProject: CrmProjectConfig }): CrmCandidateSearch {
  if (!crmProject.url || !crmProject.anonKey) return async () => { throw new CrmSearchError("unconfigured"); };
  const source = crmTokenSource({ config: crmProject, jewelosAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null });
  const client = createCrmProjectClient({ config: crmProject, source });
  return async (query) => {
    const { data, error } = await client.rpc("crm_store_conversation_candidates", { p_query: query.slice(0, 60) });
    if (error) throw new CrmSearchError(error.code === "42501" ? "denied" : "unavailable");
    try { return parseCrmCandidates(data); } catch { throw new CrmSearchError("unavailable"); }
  };
}
