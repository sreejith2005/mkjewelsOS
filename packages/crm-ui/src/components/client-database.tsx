import { CLIENT_FILTER_KEYS, clientListHref, type ClientFilters } from "@/lib/client-browse";
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { useRouter } from "@/next-shim/navigation";
import { withBasePath } from "@/crm-port/runtime";
import { useState } from 'react';
import { FilterPanel } from '@/components/filter-panel';
import { ClientWorkspace } from '@/components/client-workspace';

import { ExistingClientWalkinAction } from "@/components/existing-client-walkin-action";
import { CallButton } from "@/components/call-button";
import { displayDate } from "@/lib/clients";
import { formatPhone } from '@/lib/phone';

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
  purchase_classification?: "Buyer"|"Repair-only Customer"|"Non-Buyer/Prospect"|"Unknown";
  registered_at?: string | null;
  latest_interaction_at?: string | null;
};

/** browse_clients_page returns at most 200 clients per call (supabase-crm 20261006000100). */
export const CLIENT_PAGE_SIZE = 50;

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
  const [expanded, setExpanded] = useState<string | null>(null);
  // Phones: filters stay behind one button (owner 2026-11-05); computers show the everyday ones.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== "sort" && value).length;
  const PURCHASE_STATUSES = ['YES','NO','STORE_VISIT','PRICE_CALCULATION','REPAIR_PLACED','REPAIR_PICKUP','ORDER_PLACED','ORDER_PICKUP','PRODUCT_RETURN','PRODUCT_EXCHANGE','YES_AND_ORDER_PLACED','REPAIR_PLACED_AND_BUYING_NEW_PRODUCT','REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT','ORDER_PLACED_AND_BUYING_NEW_PRODUCT','ORDER_PICKUP_AND_BUYING_NEW_PRODUCT','REPAIR_PLACED_AND_MAKING_NEW_ORDER','REPAIR_PICKUP_AND_MAKING_NEW_ORDER','ORDER_PLACED_AND_MAKING_NEW_ORDER','ORDER_PICKUP_AND_MAKING_NEW_ORDER'];
  const secondaryKeys = ['stage','city','state','source','potential','min_visits','max_visits','created_from','created_to','interaction_from','interaction_to'] as const;
  return (
    <ClientWorkspace preset="">
      {/* crm-port fix (owner 2026-09-30): the original's plain action="/clients" left the /crm base path (404 in the original, JewelOS Home here). */}
      <button type="button" className="crm-filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? "Hide filters" : "Filters"}{activeFilters ? ` (${activeFilters})` : ""}</button>
      <form key={JSON.stringify(filters)} className={`crm-workspace-filters${filtersOpen ? " is-open" : ""}`} action={withBasePath("/clients")} onSubmit={(event) => {
        event.preventDefault();
        const value = search;
        const submitted = new FormData(event.currentTarget);
        const nextFilters: ClientFilters = {};
        for (const key of CLIENT_FILTER_KEYS) { const entry = String(submitted.get(key) ?? "").trim(); if (entry) nextFilters[key] = entry; }
        router.push(clientListHref(value, 1, nextFilters));
      }}>
        <input type="hidden" name="search" value={search} />
        {/* The filters people use every day stay in view; the rest are one tap away and combine with these. */}
        <div className="crm-workspace-filter-row">
          <label>Record type<select aria-label="Record type" name="type" defaultValue={filters.type ?? ""}><option value="">All records</option><option value="lead">Leads</option><option value="client">Clients</option></select></label>
          <label>Branch<select aria-label="Branch" name="branch" defaultValue={filters.branch ?? ""}><option value="">All branches</option>{walkinContext.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>Commercial classification<select aria-label="Commercial classification" name="commercial" defaultValue={filters.commercial??""}><option value="">All classifications</option>{["Buyer","Repair-only Customer","Non-Buyer/Prospect","Unknown"].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
          <label>Purchase status<select aria-label="Purchase status" name="purchase" defaultValue={filters.purchase ?? ""}><option value="">All statuses</option>{PURCHASE_STATUSES.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
          <label>Sort by<select aria-label="Sort by" name="sort" defaultValue={filters.sort ?? ""}><option value="">Latest interaction</option><option value="created">Newest registration</option><option value="visit">Latest store visit</option><option value="name">Name</option></select></label>
          <div className="crm-workspace-filter-actions"><button className="rounded bg-stone-800 px-4 py-2 text-white" type="submit">Apply filters</button><Link className="rounded border px-4 py-2" href={clientListHref(search, 1)}>Clear filters</Link></div>
        </div>
        <FilterPanel activeCount={secondaryKeys.filter((key) => filters[key]).length}>
          <div className="crm-workspace-filter-grid">
            <label>Lifecycle stage<select aria-label="Lifecycle stage" name="stage" defaultValue={filters.stage ?? ""}><option value="">All stages</option>{["lead","engaged","visited","purchased"].map(stage=><option key={stage} value={stage}>{stage}</option>)}</select></label>
            {([['city','City'],['state','State'],['source','Lead source'],['potential','Potential category']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} name={key} defaultValue={filters[key] ?? ''}/></label>)}
            {([['min_visits','Minimum visits'],['max_visits','Maximum visits']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="0" name={key} defaultValue={filters[key] ?? ''}/></label>)}
            {([['created_from','Registered from'],['created_to','Registered to'],['interaction_from','Interacted from'],['interaction_to','Interacted to']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="date" name={key} defaultValue={filters[key] ?? ''}/></label>)}
          </div>
        </FilterPanel>
      </form>
      {search ? <p className="crm-search-summary">Results for <strong>{search}</strong> <Link href={clientListHref('', 1, filters)}>Clear search</Link></p> : null}
      <section className="crm-workspace-results" aria-labelledby="client-results">
        <div className="crm-workspace-results-head"><div><h2 id="client-results" className="sr-only">Search results</h2><p className="crm-flat-meta">{paging ? paging.clientTotal : clients.length} records</p></div>{paging ? <ClientPager paging={paging} search={search} filters={filters} /> : null}</div>
        <div className="overflow-x-auto">
          <table className="crm-record-table min-w-full text-left text-sm">
            <thead className="border-b bg-stone-50 text-xs uppercase text-stone-600"><tr><th className="p-3">Client</th><th className="p-3">Phone</th><th className="p-3">Location</th><th className="p-3">Visits</th><th className="p-3">Last status</th><th className="p-3">Commercial classification</th><th className="p-3">Activity</th><th className="p-3">Action</th></tr></thead>
            <tbody>
              {clients.map((client) => <tr tabIndex={0} aria-label={`Open profile for ${client.primary_name}`} onClick={(event) => {
                if (!(event.target instanceof Element) || event.target.closest('a,button,input,select,textarea,summary,label')) return;
                if (window.getSelection()?.toString()) return;
                router.push(`/clients/${client.client_id}`);
              }} onKeyDown={(event) => {
                if (event.target === event.currentTarget && event.key === 'Enter') router.push(`/clients/${client.client_id}`);
              }} className={`border-b crm-profile-row ${expanded === client.client_id ? 'is-expanded' : ''}`} key={`${client.record_type ?? "client"}-${client.client_id}`}>
                <td data-label="Client" className="p-3"><div className="flex flex-wrap items-center gap-2"><span className={client.record_type === "lead" ? "rounded bg-violet-100 px-2 py-1 text-xs font-bold text-violet-800" : "rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"}>{client.record_type === "lead" ? "LEAD" : "CLIENT"}</span><Link className="font-medium" href={`/clients/${client.client_id}`}>{client.primary_name}</Link></div><div className="mt-1 font-mono text-xs text-stone-600">{client.client_code}</div></td>
                <td data-label="Phone" className="p-3 whitespace-nowrap">{formatPhone(client.primary_phone)}</td>
                <td data-label="Location" data-secondary="true" className="p-3">{[client.city, client.state].filter(Boolean).join(", ") || "-"}</td>
                <td data-label="Visits" data-secondary="true" className="p-3"><div>{client.total_visits}</div><div className="text-xs text-stone-600">Last: {displayDate(client.last_visit_date)}</div></td>
                <td data-label="Last status" className="p-3">{client.last_buy_status ?? "-"}</td>
                <td data-label="Commercial classification" data-secondary="true" className="p-3">{client.purchase_classification??"Unknown"}</td>
                <td data-label="Activity" data-secondary="true" className="p-3"><div className="text-xs">Registered {displayDate(client.registered_at ?? null)}</div><div className="text-xs text-stone-600">Latest {displayDate(client.latest_interaction_at ?? null)}</div></td>
                <td data-label="Action" className="p-3 crm-record-actions"><button type="button" className="crm-record-details" aria-label={expanded === client.client_id ? "Hide record details" : "Show record details"} aria-expanded={expanded === client.client_id} onClick={() => setExpanded(expanded === client.client_id ? null : client.client_id)}>{expanded === client.client_id ? "Less" : "Details"}</button>{client.primary_phone ? <CallButton phone={client.primary_phone} /> : null}<><Link className="ml-3 mr-3 underline crm-hide-phone" href={`/clients/${client.client_id}`}>View Client Profile</Link><ExistingClientWalkinAction clientId={client.client_id} primaryName={client.primary_name} primaryPhone={client.primary_phone ?? ""} {...walkinContext} /></></td>
              </tr>)}
              {clients.length === 0 ? <tr><td className="p-5 text-stone-600" colSpan={8}>No leads or clients match this search.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {paging ? <ClientPager paging={paging} search={search} filters={filters} /> : null}
      </section>
    </ClientWorkspace>
  );
}
