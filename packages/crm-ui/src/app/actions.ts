// crm-port: the original "use server" action signed out of the CRM Supabase session and
// redirected to the CRM /login page. JewelOS login is the only CRM login, so sign-out is the
// JewelOS sign-out, after which JewelOS shows its login.
import { crmHost, forgetCrmSession } from "@/crm-port/runtime";

export async function signOut() {
  const host = crmHost();
  forgetCrmSession(); // two-project design: drop the cached CRM token with the JewelOS session
  await host.onSignOut();
  host.navigate(host.jewelosHomePath);
}
