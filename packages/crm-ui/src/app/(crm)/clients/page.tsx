import { getCrmUser } from "@/crm-port/crm-user"; // crm-port: see getCrmUser
import { ClientDatabase, type ClientDatabaseRow } from "@/components/client-database";
import { createClient } from "@/lib/supabase/server";

type ClientBrowser = {
  rpc(name: string, args: Record<string, string | number | null>): Promise<{ data: unknown }>;
};

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const params = await searchParams;
  const search = params.search?.trim() ?? "";
  const supabase = await createClient();
  const [{ data }, { data: profileRows }, { data: auth }, { data: branches }, { data: leads }] = await Promise.all([
    (supabase as unknown as ClientBrowser).rpc("browse_clients", { search_text: search || null, potential_category: null, page_offset: 0, result_limit: 1000 }),
    supabase.rpc("get_my_profile"),
    getCrmUser(supabase) /* crm-port: auth.getUser().id is used as the CRM user id -> crm.current_crm_user_id() */,
    supabase.from("branches").select("id,name").eq("active", true).order("name"),
    supabase.from("leads").select("id,phone_number,name,field_values,created_at").order("created_at", { ascending: false }).limit(1000),
  ]);
  const profile = profileRows?.[0];
  const { data: user } = auth.user
    ? await supabase.from("users").select("branch_id").eq("id", auth.user.id).single()
    : { data: null };
  const rows = Array.isArray(data) ? data as ClientDatabaseRow[] : [];
  const normalizedSearch = search.toLowerCase();
  const leadRows: ClientDatabaseRow[] = (leads ?? []).filter((lead) => !search || `${lead.name ?? ""} ${lead.phone_number}`.toLowerCase().includes(normalizedSearch)).map((lead) => {
    const values = lead.field_values as Record<string, unknown>;
    return { client_id: lead.id, client_code: "LEAD", primary_name: lead.name ?? "Unnamed lead", primary_phone: lead.phone_number, city: typeof values.city === "string" ? values.city : null, state: typeof values.state === "string" ? values.state : null, total_visits: 0, last_visit_date: lead.created_at, last_buy_status: null, record_type: "lead" };
  });

  return <ClientDatabase clients={[...leadRows, ...rows.map((row) => ({ ...row, record_type: "client" as const }))]} search={search} walkinContext={{ role: profile?.role ?? "", branchId: user?.branch_id ?? null, branches: branches ?? [] }} />;
}
