// crm-port: the original POSTed to its own Next route /api/leads/[leadId]/runo, which read
// RUNO_API_KEY on the server and pushed the lead to Runo. That route is the crm-runo-push
// Edge Function (supabase/functions/crm-runo-push): the caller's JewelOS JWT is sent by the
// host client, the lead id travels in the body, and RUNO_API_KEY stays a function secret.
// The result keeps the original shape: `ok` is the HTTP ok of the route, and the original
// lead form still shows its own message for a failed push ("Lead saved locally. Runo sync
// not yet configured.").
import { crmHost } from "./runtime";

export async function pushLeadToRuno(leadId: string): Promise<{ ok: boolean }> {
  try {
    const { error } = await crmHost().supabase.functions.invoke("crm-runo-push", { body: { leadId } });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
