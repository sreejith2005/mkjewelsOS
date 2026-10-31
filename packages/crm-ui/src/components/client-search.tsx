"use client";
import Link from '@/next-shim/link';
import { useEffect, useId, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatPhone } from '@/lib/phone';
import { clientListHref } from '@/lib/client-browse';
import type { Database } from '@/lib/supabase/database.types';
type Result = Database['public']['Functions']['search_clients']['Returns'][number] & { total_visits?: number; last_buy_status?: string | null };

export function ClientSearch({ onSelect }: { onSelect?: (client: Result) => void } = {}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const value = term.trim();
  const canSearch = value.length > 0;
  const close = () => { setOpen(false); setTerm(''); setResults([]); };
  useEffect(() => {
    let cancelled = false;
    setResults([]); setError(false); setLoading(canSearch);
    if (!canSearch) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await createClient().rpc('search_clients', { search_text: value, result_limit: 8 });
        if (cancelled) return;
        if (response.error) { setError(true); setResults([]); }
        else setResults(response.data ?? []);
      } catch { if (!cancelled) { setError(true); setResults([]); } }
      finally { if (!cancelled) setLoading(false); }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [value, canSearch, retry]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return <div ref={root} role="search" className="crm-universal-search" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); input.current?.focus(); setOpen(false); }
    if (event.key === 'ArrowDown' && event.target === input.current) {
      event.preventDefault(); root.current?.querySelector<HTMLElement>('.crm-search-results a, .crm-search-results button')?.focus();
    }
    if (event.key === 'Enter' && event.target === input.current) {
      event.preventDefault();
      if (onSelect) root.current?.querySelector<HTMLButtonElement>('.crm-search-result')?.click();
      else if (canSearch) root.current?.querySelector<HTMLAnchorElement>('[data-all-results]')?.click();
    }
  }}>
    <label className="sr-only" htmlFor={id}>Search client</label>
    <input ref={input} id={id} autoComplete="off" type="search" aria-controls={`${id}-results`} aria-expanded={open && canSearch} value={term}
      onFocus={() => setOpen(true)} onChange={(event) => { const next=event.target.value; setTerm(next); setOpen(true); if(next.trim()!==value){setResults([]); setLoading(next.trim().length > 0);} }}
      placeholder="Search clients, leads, phone or ID" />
    {open && canSearch ? <div id={`${id}-results`} className="crm-search-results" aria-label="Client search results">
      <div aria-live="polite">{loading ? <p className="p-3 text-sm">Searching…</p> : null}</div>
      {error ? <div role="alert" className="p-3 text-sm">Search could not load. <button type="button" onClick={() => { setError(false); setLoading(true); setRetry(n => n + 1); }}>Retry search</button></div> : null}
      {!loading && !error ? results.map(result => onSelect
        ? <button className="crm-search-result" type="button" key={result.client_id} onClick={() => { onSelect(result); close(); }}><strong>{result.primary_name}</strong><span>{formatPhone(result.matched_phone ?? result.primary_phone)} · {result.client_code}</span></button>
        : <Link className="crm-search-result" href={`/clients/${result.client_id}`} onClick={close} key={result.client_id}><strong>{result.primary_name}</strong><span>{formatPhone(result.matched_phone ?? result.primary_phone)}</span><small>{[result.client_code, result.household_code, result.referral_code].filter(Boolean).join(' · ')}</small></Link>) : null}
      {!loading && !error && results.length === 0 ? <p className="p-3 text-sm">No matching clients or leads.</p> : null}
      {!onSelect ? <Link data-all-results className="crm-search-all" href={clientListHref(value, 1)} onClick={close}>See all results</Link> : null}
    </div> : null}
  </div>;
}
