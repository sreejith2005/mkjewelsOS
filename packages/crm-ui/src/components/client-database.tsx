import { CLIENT_FILTER_KEYS, clientListHref, type ClientFilters } from "@/lib/client-browse";
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { useRouter } from "@/next-shim/navigation";
import { withBasePath } from "@/crm-port/runtime";

import { ExistingClientWalkinAction } from "@/components/existing-client-walkin-action";
import { CallButton } from "@/components/call-button";
import { displayDate } from "@/lib/clients";
import { formatPhone } from "@/lib/phone";

export type ClientDatabaseRow = {
  client_id: string;
  client_code: string;
  primary_name: string;
  primary_phone: string | null;
  city: string | null;
  state: string | null;
  total_visits: number;
  last_visit_date: string | null;
  last_buy_status: string | null;
  record_type?: "lead" | "client";
  registered_at?: string | null;
  latest_interaction_at?: string | null;
};

/** browse_clients_page returns at most 200 clients per call (supabase-crm 20261006000100). */
export const CLIENT_PAGE_SIZE = 200;

export type ClientDatabasePaging = { page: number; clientTotal: number; leadCount: number };

// crm-port fix (owner 2026-10-06): the original listed one call of at most 200 clients.
function ClientPager({ paging, search, filters }: { paging: ClientDatabasePaging; search: string; filters: ClientFilters }) {
  const pageCount = Math.max(1, Math.ceil(paging.clientTotal / CLIENT_PAGE_SIZE));
  const first = paging.clientTotal === 0 ? 0 : (paging.page - 1) * CLIENT_PAGE_SIZE + 1;
  const last = Math.min(paging.page * CLIENT_PAGE_SIZE, paging.clientTotal);
  return (
    <nav aria-label="Client pages" className="flex flex-wrap items-center gap-3 p-4 text-xs text-stone-600">
      <span>{paging.page > pageCount ? "NO CLIENTS ON THIS PAGE." : `SHOWING CLIENTS ${first}-${last} OF ${paging.clientTotal}`}</span>
      <span>PAGE {paging.page} OF {pageCount}</span>
      {paging.page > 1 ? <Link className="rounded border px-3 py-1" href={clientListHref(search, Math.min(paging.page - 1, pageCount), filters)}>PREVIOUS</Link> : null}
      {paging.page < pageCount ? <Link className="rounded border px-3 py-1" href={clientListHref(search, paging.page + 1, filters)}>NEXT</Link> : null}
    </nav>
  );
}

export function ClientDatabase({ clients, search, paging, walkinContext, filters = {} }: {
  clients: ClientDatabaseRow[];
  search: string;
  filters?: ClientFilters;
  paging?: ClientDatabasePaging;
  walkinContext: { role: string; branchId: string | null; branches: { id: string; name: string }[] };
}) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-7xl px-5 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">CLIENT DATABASE</h1>
          <p className="mt-2 text-sm text-stone-600">SEARCH LEADS AND CLIENTS BY PHONE OR NAME. Type is highlighted for every record.</p>
        </div>
        <Link className="rounded bg-amber-800 px-4 py-2 font-medium text-white" href="/queue">Register Client</Link>
      </div>
      {/* crm-port fix (owner 2026-09-30): the original's plain action="/clients" left the /crm base path (404 in the original, JewelOS Home here). */}
      <form className="mt-5 flex flex-wrap gap-2" action={withBasePath("/clients")} onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("search") ?? "").trim();
        const submitted = new FormData(event.currentTarget);
        const nextFilters: ClientFilters = {};
        for (const key of CLIENT_FILTER_KEYS) { const entry = String(submitted.get(key) ?? "").trim(); if (entry) nextFilters[key] = entry; }
        router.push(clientListHref(value, 1, nextFilters));
      }}>
        <label className="sr-only" htmlFor="client-database-search">Search clients</label>
        <input id="client-database-search" className="w-full max-w-xl rounded border p-2" name="search" defaultValue={search} placeholder="Search by client ID, phone, or name" />
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label>Record type<select aria-label="Record type" name="type" defaultValue={filters.type ?? ""} className="mt-1 w-full rounded border p-2"><option value="">All records</option><option value="lead">Leads</option><option value="client">Clients</option></select></label>
          <label>Lifecycle stage<select aria-label="Lifecycle stage" name="stage" defaultValue={filters.stage ?? ""} className="mt-1 w-full rounded border p-2"><option value="">All stages</option>{["lead","engaged","visited","purchased"].map(stage=><option key={stage} value={stage}>{stage}</option>)}</select></label>
          <label>Branch<select aria-label="Branch" name="branch" defaultValue={filters.branch ?? ""} className="mt-1 w-full rounded border p-2"><option value="">All branches</option>{walkinContext.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>Sort by<select aria-label="Sort by" name="sort" defaultValue={filters.sort ?? ""} className="mt-1 w-full rounded border p-2"><option value="">Latest interaction</option><option value="created">Newest registration</option><option value="visit">Latest store visit</option><option value="name">Name</option></select></label>
          {([['city','City'],['state','State'],['source','Lead source'],['potential','Potential category']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} name={key} defaultValue={filters[key] ?? ''} className="mt-1 w-full rounded border p-2"/></label>)}
          <label>Purchase status<select aria-label="Purchase status" name="purchase" defaultValue={filters.purchase ?? ""} className="mt-1 w-full rounded border p-2"><option value="">All statuses</option>{['YES','NO','STORE_VISIT','PRICE_CALCULATION','REPAIR_PLACED','REPAIR_PICKUP','ORDER_PLACED','ORDER_PICKUP','PRODUCT_RETURN','PRODUCT_EXCHANGE','YES_AND_ORDER_PLACED','REPAIR_PLACED_AND_BUYING_NEW_PRODUCT','REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT','ORDER_PLACED_AND_BUYING_NEW_PRODUCT','ORDER_PICKUP_AND_BUYING_NEW_PRODUCT','REPAIR_PLACED_AND_MAKING_NEW_ORDER','REPAIR_PICKUP_AND_MAKING_NEW_ORDER','ORDER_PLACED_AND_MAKING_NEW_ORDER','ORDER_PICKUP_AND_MAKING_NEW_ORDER'].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
          {([['min_visits','Minimum visits'],['max_visits','Maximum visits']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="0" name={key} defaultValue={filters[key] ?? ''} className="mt-1 w-full rounded border p-2"/></label>)}
          {([['created_from','Registered from'],['created_to','Registered to'],['interaction_from','Interacted from'],['interaction_to','Interacted to']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="date" name={key} defaultValue={filters[key] ?? ''} className="mt-1 w-full rounded border p-2"/></label>)}
        </div>
        <button className="rounded bg-stone-800 px-4 py-2 text-white" type="submit">SEARCH</button>
        <Link className="rounded border px-4 py-2" href="/clients">CLEAR</Link>
      </form>
      <section className="mt-6 overflow-hidden rounded border bg-white">
        <div className="border-b p-4"><h2 className="text-sm font-semibold tracking-wide">SEARCH RESULTS</h2><p className="mt-1 text-xs text-stone-600">{paging ? paging.clientTotal : clients.length} RESULT(S) FOUND.</p></div>
        {paging ? <div className="border-b"><ClientPager paging={paging} search={search} filters={filters} /></div> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-stone-50 text-xs uppercase text-stone-600"><tr><th className="p-3">Type</th><th className="p-3">Client ID</th><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">City</th><th className="p-3">State</th><th className="p-3">Total visits</th><th className="p-3">Registered</th><th className="p-3">Latest interaction</th><th className="p-3">Last visit</th><th className="p-3">Last status</th><th className="p-3">Action</th></tr></thead>
            <tbody>
              {clients.map((client) => <tr className="border-b" key={`${client.record_type ?? "client"}-${client.client_id}`}><td className="p-3"><span className={client.record_type === "lead" ? "rounded bg-violet-100 px-2 py-1 text-xs font-bold text-violet-800" : "rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"}>{client.record_type === "lead" ? "LEAD" : "CLIENT"}</span></td><td className="p-3 font-mono text-xs">{client.client_code}</td><td className="p-3 font-medium">{client.primary_name}</td><td className="p-3">{formatPhone(client.primary_phone)}</td><td className="p-3">{client.city ?? "-"}</td><td className="p-3">{client.state ?? "-"}</td><td className="p-3">{client.total_visits}</td><td className="p-3">{displayDate(client.registered_at ?? null)}</td><td className="p-3">{displayDate(client.latest_interaction_at ?? null)}</td><td className="p-3">{displayDate(client.last_visit_date)}</td><td className="p-3">{client.last_buy_status ?? "-"}</td><td className="p-3 whitespace-nowrap">{client.primary_phone ? <CallButton phone={client.primary_phone} /> : null}<><Link className="ml-3 mr-3 underline" href={`/clients/${client.client_id}`}>View Client Profile</Link><ExistingClientWalkinAction clientId={client.client_id} primaryName={client.primary_name} primaryPhone={client.primary_phone ?? ""} {...walkinContext} /></></td></tr>)}
              {clients.length === 0 ? <tr><td className="p-5 text-stone-600" colSpan={12}>No leads or clients match this search.</td></tr> : null}

            </tbody>
          </table>
        </div>
        {paging ? <ClientPager paging={paging} search={search} filters={filters} /> : null}
      </section>
    </main>
  );
}
