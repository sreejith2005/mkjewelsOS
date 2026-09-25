// crm-port: replaces the original layout's redirect("/login") when the signed-in user has
// no CRM profile. The original login page is not ported (JewelOS login is the only CRM
// login), so a JewelOS user whose account is not linked to an active CRM user, or whose
// JewelOS role/branch gives no CRM access (crm_private.current_crm_identity, 0180), sees this.
import { crmHost, CrmLeave } from "./runtime";

/** The original redirected an unauthenticated visitor to /login; JewelOS shows its login at "/". */
export function leaveForJewelosLogin(): never {
  throw new CrmLeave("/");
}

export function NoCrmAccess() {
  const host = crmHost();
  return <main className="mx-auto max-w-xl px-5 py-7">
    <h1 className="text-3xl font-semibold">No CRM access</h1>
    <p className="mt-2 text-stone-600">Your JewelOS account does not have access to the CRM. Ask an admin to link your account to a CRM user.</p>
    <a className="mt-5 inline-block rounded border px-4 py-2" href={host.jewelosHomePath} onClick={(event) => { event.preventDefault(); host.navigate(host.jewelosHomePath); }}>← JewelOS</a>
  </main>;
}
