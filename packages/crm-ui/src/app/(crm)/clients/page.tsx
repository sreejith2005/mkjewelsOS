import { assertCrmRead, readCrmResults } from "@/crm-port/read-results";
import { getCrmUser } from "@/crm-port/crm-user"; // crm-port: see getCrmUser
import { CLIENT_PAGE_SIZE, ClientDatabase, type ClientDatabaseRow } from "@/components/client-database";
import { createClient } from "@/lib/supabase/server";

type ClientBrowser = {
  rpc(name: string, args: Record<string, string | number | boolean | null>): Promise<{ data: unknown }>;
};

type ClientPageRow = Omit<ClientDatabaseRow, "record_type"> & { total_count: number };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ search?: string; page?: string }> }) {
  const params = await searchParams;
  const search = params.search?.trim() ?? "";
  // crm-port fix (owner 2026-10-06): the list showed only the first 200 clients. It now pages
  // through browse_clients_page, 200 clients a page, with the total of all matches.
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const supabase = await createClient();
  const browser = supabase as unknown as ClientBrowser;
  const browseArgs = { search_text: search || null, potential_category: null, exclude_unvisited_leads: true };
  const [{ data }, { data: profileRows }, { data: auth }, { data: branches }, { data: leads }] = await readCrmResults([
    browser.rpc("browse_clients_page", { ...browseArgs, page_offset: (page - 1) * CLIENT_PAGE_SIZE, result_limit: CLIENT_PAGE_SIZE }),
    supabase.rpc("get_my_profile"),
    getCrmUser(supabase) /* crm-port: auth.getUser().id is used as the CRM user id -> crm.current_crm_user_id() */,
    supabase.from("branches").select("id,name").eq("active", true).order("name"),
    supabase.from("leads").select("id,phone_number,name,field_values,created_at,client_id,clients!leads_client_id_fkey(client_code,total_visits)").order("created_at", { ascending: false }).order("id", { ascending: false }) /* crm-port: deterministic order */.limit(1000),
  ]);
  const profile = profileRows?.[0];
  const { data: user } = auth.user
    ? assertCrmRead(await supabase.from("users").select("branch_id").eq("id", auth.user.id).single())
    : { data: null };
  const rows = Array.isArray(data) ? data as ClientPageRow[] : [];
  // A page past the last one has no rows to carry the total; ask for it once.
  const { data: totalRows } = rows.length === 0 && page > 1
    ? assertCrmRead(await browser.rpc("browse_clients_page", { ...browseArgs, page_offset: 0, result_limit: 1 }))
    : { data: null };
  const clientTotal = Number((rows[0] ?? (Array.isArray(totalRows) ? totalRows[0] as ClientPageRow | undefined : undefined))?.total_count ?? 0);
  const normalizedSearch = search.toLowerCase();
  // Approved identity extension: a lead has an MKC client from first contact. It is listed once,
  // as a LEAD with that MKC, until the person visits.
  const leadClientIds = new Set((leads ?? []).filter((lead) => lead.client_id && (lead.clients?.total_visits ?? 0) === 0).map((lead) => lead.client_id));
  const leadRows: ClientDatabaseRow[] = (leads ?? []).filter((lead) => !search || `${lead.name ?? ""} ${lead.phone_number}`.toLowerCase().includes(normalizedSearch)).map((lead) => {
    const values = lead.field_values as Record<string, unknown>;
    return { client_id: lead.id, client_code: lead.clients?.client_code ?? "LEAD", primary_name: lead.name ?? "Unnamed lead", primary_phone: lead.phone_number, city: typeof values.city === "string" ? values.city : null, state: typeof values.state === "string" ? values.state : null, total_visits: 0, last_visit_date: lead.created_at, last_buy_status: null, record_type: "lead" };
  });
  const clientRows: ClientDatabaseRow[] = rows.filter((row) => !leadClientIds.has(row.client_id)).map(({ total_count: _total, ...row }) => ({ ...row, record_type: "client" as const }));

  return <ClientDatabase clients={[...(page === 1 ? leadRows : []), ...clientRows]} search={search} paging={{ page, clientTotal, leadCount: leadRows.length }} walkinContext={{ role: profile?.role ?? "", branchId: user?.branch_id ?? null, branches: branches ?? [] }} />;
}
