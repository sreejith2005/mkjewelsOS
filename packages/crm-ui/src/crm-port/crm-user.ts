// crm-port: the original used supabase.auth.getUser().id as the acting CRM user id
// (crm.users lookups, leads.created_by, lead_call_history.entered_by). Through the JewelOS
// identity bridge (0182) the Auth user is a JewelOS user and the CRM user id is
// crm.current_crm_user_id(). This keeps the original { data: { user } } shape so each call
// site changes only the call; user.email stays the signed-in Auth email.
import type { CrmSupabaseClient } from "./runtime";

export type CrmUser = { id: string; email: string | undefined };

export async function getCrmUser(supabase: CrmSupabaseClient): Promise<{ data: { user: CrmUser | null } }> {
  const [{ data: auth }, { data: crmUserId }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("current_crm_user_id"),
  ]);
  return { data: { user: auth.user && crmUserId ? { id: crmUserId, email: auth.user.email } : null } };
}
