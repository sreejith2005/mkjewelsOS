import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)

import { ExistingClientWalkinAction } from "@/components/existing-client-walkin-action";
import { CallButton } from "@/components/call-button";
import { displayDate } from "@/lib/clients";

export type ClientDatabaseRow = {
  client_id: string;
  client_code: string;
  primary_name: string;
  primary_phone: string;
  city: string | null;
  state: string | null;
  total_visits: number;
  last_visit_date: string | null;
  last_buy_status: string | null;
  record_type?: "lead" | "client";
};

export function ClientDatabase({ clients, search, walkinContext }: {
  clients: ClientDatabaseRow[];
  search: string;
  walkinContext: { role: string; branchId: string | null; branches: { id: string; name: string }[] };
}) {
  return (
    <main className="mx-auto max-w-7xl px-5 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">CLIENT DATABASE</h1>
          <p className="mt-2 text-sm text-stone-600">SEARCH LEADS AND CLIENTS BY PHONE OR NAME. Type is highlighted for every record.</p>
        </div>
        <Link className="rounded bg-amber-800 px-4 py-2 font-medium text-white" href="/queue">Register Client</Link>
      </div>
      <form className="mt-5 flex flex-wrap gap-2" action="/clients">
        <label className="sr-only" htmlFor="client-database-search">Search clients</label>
        <input id="client-database-search" className="w-full max-w-xl rounded border p-2" name="search" defaultValue={search} placeholder="Search by client ID, phone, or name" />
        <button className="rounded bg-stone-800 px-4 py-2 text-white" type="submit">SEARCH</button>
        <Link className="rounded border px-4 py-2" href="/clients">CLEAR</Link>
      </form>
      <section className="mt-6 overflow-hidden rounded border bg-white">
        <div className="border-b p-4"><h2 className="text-sm font-semibold tracking-wide">SEARCH RESULTS</h2><p className="mt-1 text-xs text-stone-600">{clients.length} RESULT(S) FOUND.</p></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-stone-50 text-xs uppercase text-stone-600"><tr><th className="p-3">Type</th><th className="p-3">Client ID</th><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">City</th><th className="p-3">State</th><th className="p-3">Total visits</th><th className="p-3">Last visit</th><th className="p-3">Last status</th><th className="p-3">Action</th></tr></thead>
            <tbody>
              {clients.map((client) => <tr className="border-b" key={`${client.record_type ?? "client"}-${client.client_id}`}><td className="p-3"><span className={client.record_type === "lead" ? "rounded bg-violet-100 px-2 py-1 text-xs font-bold text-violet-800" : "rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"}>{client.record_type === "lead" ? "LEAD" : "CLIENT"}</span></td><td className="p-3 font-mono text-xs">{client.client_code}</td><td className="p-3 font-medium">{client.primary_name}</td><td className="p-3">{client.primary_phone}</td><td className="p-3">{client.city ?? "-"}</td><td className="p-3">{client.state ?? "-"}</td><td className="p-3">{client.total_visits}</td><td className="p-3">{displayDate(client.last_visit_date)}</td><td className="p-3">{client.last_buy_status ?? "-"}</td><td className="p-3 whitespace-nowrap"><CallButton phone={client.primary_phone} />{client.record_type === "lead" ? null : <><Link className="ml-3 mr-3 underline" href={`/clients/${client.client_id}`}>View Client Profile</Link><ExistingClientWalkinAction clientId={client.client_id} primaryName={client.primary_name} primaryPhone={client.primary_phone} {...walkinContext} /></>}</td></tr>)}
              {clients.length === 0 ? <tr><td className="p-5 text-stone-600" colSpan={10}>No leads or clients match this search.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
