// crm-port: the original POSTed to its own Next route /api/leads/[leadId]/runo, which read
// RUNO_API_KEY on the server and pushed the lead to Runo. That route is not part of the web
// port; it becomes the crm-runo-push Edge Function in Phase 4 (see the design document).
//
// TODO(phase4): call the crm-runo-push Edge Function with the caller's JWT.
// Until then the push is reported as not done, and the original lead form shows its own
// message for that case: "Lead saved locally. Runo sync not yet configured."
export async function pushLeadToRuno(leadId: string): Promise<{ ok: boolean }> {
  void leadId;
  return { ok: false };
}
