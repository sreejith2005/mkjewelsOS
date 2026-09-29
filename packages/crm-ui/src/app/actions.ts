// crm-port: the original "use server" action signed out of the CRM Supabase session and
// redirected to the CRM /login page. JewelOS login is the only CRM login, so sign-out is the
// JewelOS sign-out, after which JewelOS shows its login.
import { crmHost } from "@/crm-port/runtime";

export async function signOut() {
  const host = crmHost();
  await host.onSignOut();
  host.navigate(host.jewelosHomePath);
}
