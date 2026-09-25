"use client";

import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type Result = Database["public"]["Functions"]["search_clients"]["Returns"][number] & { total_visits?: number; last_buy_status?: string | null };

export function ClientSearch({ onSelect }: { onSelect?: (client: Result) => void } = {}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const canSearch = term.trim().length >= 3 || term.replace(/\D/g, "").length >= 3;

  useEffect(() => {
    if (!canSearch) return;

    let cancelled = false;
    const value = term.trim();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const { data } = await createClient().rpc("search_clients", {
        search_text: value,
        result_limit: 8,
      });
      if (!cancelled) {
        setResults(data ?? []);
        setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canSearch, term]);

  return (
    <div className="relative w-full max-w-xl">
      <label className="sr-only" htmlFor="global-client-search">Search client</label>
      <input id="global-client-search" className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by phone or client name" />
      {canSearch ? <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg">
        {loading ? <p className="p-3 text-sm text-stone-500">Searching…</p> : null}
        {!loading ? results.map((result) => onSelect ? <button className="block w-full border-b border-stone-100 px-4 py-3 text-left hover:bg-amber-50" type="button" onClick={() => { onSelect(result); setTerm(""); setResults([]); }} key={result.client_id}><b>{result.primary_name}</b><span className="ml-2 text-sm text-stone-600">{result.matched_phone ?? result.primary_phone}</span><span className="float-right text-xs text-stone-500">Select</span></button> : <div className="border-b border-stone-100 px-4 py-3" key={result.client_id}><div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-semibold hover:underline" href={`/clients/${result.client_id}`}>{result.primary_name} <span className="font-normal text-stone-600">{result.matched_phone ?? result.primary_phone}</span></Link><span className="text-xs text-stone-500">{result.total_visits ?? 0} visits · Last status {result.last_buy_status ?? "—"}</span></div><div className="mt-2 flex gap-3 text-xs"><Link className="underline" href={`/clients/${result.client_id}`}>View Client Profile</Link><Link className="underline" href={`/visits/new?client=${result.client_id}`}>Make Walk-in Entry</Link></div></div>) : null}
        {!loading && results.length === 0 ? <p className="p-3 text-sm">No client found — <Link className="font-semibold text-amber-800 underline" href={`/clients/new?phone=${encodeURIComponent(term)}`}>create new?</Link></p> : null}
      </div> : null}
    </div>
  );
}
