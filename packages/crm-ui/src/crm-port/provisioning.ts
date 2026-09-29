// crm-port: D2 (owner decision 2026-09-28). Before the CRM root loader runs any other CRM
// query, it asks the database to provision a CRM user for the signed-in JewelOS profile when
// that profile is eligible and not yet linked (crm.ensure_my_crm_user, migration 0191:
// audited, idempotent, never matches existing CRM users by name or email, fails closed).
// Access is still decided only by the identity functions of 0183; the result is not used for
// any decision here, and a failed call simply leaves access as it was.
import type { CrmSupabaseClient } from "./runtime";

export async function ensureMyCrmUser(supabase: CrmSupabaseClient): Promise<void> {
  try {
    await supabase.rpc("ensure_my_crm_user");
  } catch {
    // Network failure: the layout's own get_my_profile call decides what the user sees.
  }
}
