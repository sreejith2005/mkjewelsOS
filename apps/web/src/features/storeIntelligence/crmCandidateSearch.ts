// The CRM customer search behind "Link customer" (migration 0384 / CRM 20261106000200). The CRM code
// loads on the first search only and reads through the /crm login bridge, so the CRM's own access
// rule decides what comes back.
import { supabase } from "@jewelos/api-client";
import type { CrmCandidateResult } from "@jewelos/core";
import type { CrmCandidateSearch } from "@jewelos/crm-ui";
import { crmProjectConfig } from "@/lib/crmProject";

let loading: Promise<CrmCandidateSearch> | null = null;

export class CandidateSearchFailure extends Error {}

export async function searchCrmCandidates(query: string): Promise<CrmCandidateResult> {
  loading ??= import("@jewelos/crm-ui").then((module) => module.createCrmCandidateSearch({ supabase, crmProject: crmProjectConfig }));
  try {
    return await (await loading)(query);
  } catch (cause) {
    const kind = cause && typeof cause === "object" && "kind" in cause ? String((cause as { kind: unknown }).kind) : "unavailable";
    if (kind === "unavailable") loading = null; // A network failure may recover; retry the bridge next time.
    throw new CandidateSearchFailure(kind === "denied" ? "Your account cannot search the CRM." : kind === "unconfigured" ? "The CRM is not connected on this site." : "The CRM could not be reached. Try again.");
  }
}
