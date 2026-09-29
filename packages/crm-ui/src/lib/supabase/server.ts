// crm-port: the original server pages used a cookie-bound @supabase/ssr server client.
// The ported route loaders run in the browser with the same signed-in JewelOS session
// (schema crm) as the components, running the same queries in the same order.
import { crmSupabase } from "@/crm-port/runtime";

export async function createClient() {
  return crmSupabase();
}
