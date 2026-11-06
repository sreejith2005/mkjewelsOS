import { storedPhone } from "@/lib/phone";
import { parseWalkinProfileDefaults } from "@/lib/walkin-profile-defaults";
import { loadCrmMasterOptions } from "@/crm-port/master-options";

import { readCrmResults } from "@/crm-port/read-results";
import { getCrmUser } from "@/crm-port/crm-user"; // crm-port: see getCrmUser
import { WalkinVisitEntry } from "@/components/walkin-visit-entry"; // crm-port: linked Form Builder walk-in form when configured
import { redirect } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { createClient } from "@/lib/supabase/server";
import { availableCrmNames } from "@/lib/available-crm-names";
import { kolkataDateKey } from "@/lib/business-date";

export default async function NewVisitPage({ searchParams }: { searchParams: Promise<{ queue?: string }> }) {
  const params = await searchParams; const supabase = await createClient(); const masterOptionsPromise=loadCrmMasterOptions(supabase); const [{ data: profileRows }, { data: auth }] = await readCrmResults([supabase.rpc("get_my_profile"), getCrmUser(supabase) /* crm-port: auth.getUser().id is used as the CRM user id -> crm.current_crm_user_id() */]); const profile = profileRows?.[0]; if (!profile || !auth.user) return null;

  const queueId = params.queue;
  if (!queueId) redirect("/queue");
  const today = kolkataDateKey();
  // Independent roster reads run alongside the queue -> client -> saved-defaults chain.
  // Actor authorization above stays fresh; each read still uses the same CRM session.
  const [{ data: user }, { data: branches }, { data: allocation }, { data: availability }, { data: salespeople }, visit, masterFields] = await readCrmResults([
    supabase.from("users").select("branch_id,name").eq("id", auth.user.id).single(),
    supabase.from("branches").select("id,name").eq("active", true).order("name"),
    supabase.rpc("get_walkin_crm_roster"),
    supabase.from("crm_daily_availability").select("branch_id,crm_name,is_available").eq("date", today),
    supabase.rpc("get_walkin_salespeople"),
    (async () => {
      const [queueResult] = await readCrmResults([supabase.from("entry_queue").select("id,client_name,mobile,branch_id,assigned_crm_name,client_id,client_is_new,status").eq("id", queueId).single()]);
      if (!queueResult.data || queueResult.data.status === "complete") redirect("/queue");
      const selectedClientId = queueResult.data.client_id;
      const [{ data: client }] = await readCrmResults([selectedClientId ? (queueResult.data.client_is_new
        ? supabase.rpc("lookup_client_profile_by_phone", { p_phone: `+${storedPhone(queueResult.data.mobile) ?? ""}` })
        : supabase.rpc("get_client_profile", { p_client_id: selectedClientId })).single() : Promise.resolve({ data: null })]);
      if (selectedClientId && !client) throw new Error("The saved client profile could not be loaded. Reload before entering this visit.");
      const [defaultsResult] = await readCrmResults([client ? supabase.rpc("get_walkin_profile_defaults", { p_client_id: client.client_id }) : Promise.resolve({ data: null })]);
      return {
        client: client ? { ...client, walkin_defaults: parseWalkinProfileDefaults(defaultsResult.data) } : null,
        queue: client && client.client_id !== selectedClientId ? { ...queueResult.data, client_id: client.client_id, client_is_new: false } : queueResult.data,
      };
    })(),
    masterOptionsPromise,
  ]);
  const walkinClient = visit.client;
  const resolvedQueue = visit.queue;
  const branchId = resolvedQueue.branch_id ?? user?.branch_id ?? "";
  const salespeopleByBranch = Object.fromEntries((branches ?? []).map(branch => [branch.id, (salespeople ?? []).filter(person => person.branch_id === branch.id).map(person => ({ id: person.salesperson_id, name: person.salesperson_name }))]));
  const crmByBranch = Object.fromEntries((branches ?? []).map((branch) => [branch.id, availableCrmNames((allocation ?? []).filter((item) => item.branch_id === branch.id), (availability ?? []).filter((item) => item.branch_id === branch.id))]));
  return <main className="mx-auto max-w-7xl px-5 py-7"><p className="text-sm font-semibold uppercase tracking-wider text-amber-800">Visit intake</p><h1 className="mt-1 text-3xl font-semibold">Walk-in visit form</h1><p className="mt-2 text-stone-600">The client record and ID are already registered. Submit this form to save the visit details.</p><WalkinVisitEntry profile={{ role: profile.role, branchId: user?.branch_id ?? null, name: user?.name ?? "" }} branches={branches ?? []} crms={crmByBranch[branchId] ?? []} crmByBranch={crmByBranch} salespeopleByBranch={salespeopleByBranch} queue={resolvedQueue} client={walkinClient} lookups={{ masterFields, productCategories: masterFields.lookup_product_categories ?? [], notBoughtReasons: masterFields.lookup_not_bought_reasons ?? [], beverages: masterFields.lookup_beverages ?? [], snacks: masterFields.lookup_snacks ?? [], relations: masterFields.lookup_relations ?? [], sugarOptions: masterFields.lookup_sugar_options ?? [], sourceOfLeads: masterFields.lookup_source_of_leads ?? [], communities: masterFields.lookup_communities ?? [], gifts: masterFields.lookup_gifts ?? [] }} /></main>;

}
