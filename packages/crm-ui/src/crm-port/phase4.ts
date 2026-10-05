// crm-port: the original POSTed to its own Next route /api/leads/[leadId]/runo, which read
// RUNO_API_KEY on the server and pushed the lead to Runo. That route is the crm-runo-push
// Edge Function of the CRM project (supabase-crm/supabase/functions/crm-runo-push, 2026-10-01):
// the caller's CRM token is sent by the CRM-project client, the lead id travels in the body, and RUNO_API_KEY stays a function secret.
// The result keeps the original shape: `ok` is the HTTP ok of the route, and the original
// lead form still shows its own message for a failed push ("Lead saved locally. Runo sync
// not yet configured.").
import { crmProjectClient } from "./runtime";

export async function pushLeadToRuno(leadId: string): Promise<{ ok: boolean }> {
  try {
    const { error } = await crmProjectClient().functions.invoke("crm-runo-push", { body: { leadId } });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
