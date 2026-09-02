import { useState } from "react";
import { ChevronRight, ListFilter, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CrmClientSummary, CrmOptions } from "./types";

type Filters = { query: string; branch_id: string; assigned_crm_id: string; client_type_id: string; source_id: string; potential_category: string; followup_status: string };
export const EMPTY_FILTERS: Filters = { query: "", branch_id: "", assigned_crm_id: "", client_type_id: "", source_id: "", potential_category: "", followup_status: "" };

export function CrmDirectory({ items, filters, loading, error, options, onFilters, onOpen, onMore, hasMore }: { items: CrmClientSummary[]; filters: Filters; loading: boolean; error: string | null; options: CrmOptions; onFilters: (next: Filters) => void; onOpen: (id: string) => void; onMore: () => void; hasMore: boolean }) {
  const set = (key: keyof Filters, value: string) => onFilters({ ...filters, [key]: value });
  const dropdown = (type: string) => options.dropdowns.filter((item) => item.master_type === type);
  // Six stacked selects pushed the results a full screen down on a phone, so
  // everything but the search box folds away until it is asked for.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== "query" && value).length;
  return <section aria-labelledby="directory-title" className="space-y-4">
    <div><h2 className="text-xl font-semibold text-task-text" id="directory-title">Client directory</h2><p className="text-sm text-task-text-muted">Server-bounded results with tenant and branch authorization.</p></div>
    <div className="rounded-xl border border-task-border bg-task-bg p-3">
      <div className="flex gap-2">
        <label className="relative flex-1"><span className="sr-only">Search clients</span><Search className="absolute left-3 top-3 size-4 text-task-text-muted"/><input className="task-field pl-9" onChange={(event)=>set("query",event.target.value)} placeholder="Search name, phone, or email" value={filters.query}/></label>
        <button aria-expanded={filtersOpen} className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-task-border px-3 text-sm font-semibold text-task-text-muted sm:hidden" onClick={()=>setFiltersOpen((open)=>!open)} type="button"><ListFilter className="size-4"/>Filters{activeFilters?<span className="rounded-full bg-task-accent px-1.5 text-xs text-white">{activeFilters}</span>:null}</button>
      </div>
      <div className={cn("mt-2 gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-3", filtersOpen ? "grid" : "hidden")}>
      <Filter label="Branch" value={filters.branch_id} onChange={(value)=>set("branch_id",value)} options={options.branches}/><Filter label="Assigned CRM" value={filters.assigned_crm_id} onChange={(value)=>set("assigned_crm_id",value)} options={options.profiles.filter((item)=>["crm","manager","admin","super_admin"].includes(item.user_role ?? ""))}/>
      <Filter label="Client type" value={filters.client_type_id} onChange={(value)=>set("client_type_id",value)} options={dropdown("client_type")}/><Filter label="Source" value={filters.source_id} onChange={(value)=>set("source_id",value)} options={dropdown("crm_source")}/><Filter label="Potential" value={filters.potential_category} onChange={(value)=>set("potential_category",value)} options={dropdown("potential_category").map((item)=>({...item,id:item.value ?? item.label}))}/>
      <label><span className="sr-only">Follow-up status</span><select className="task-field" onChange={(event)=>set("followup_status",event.target.value)} value={filters.followup_status}><option value="">All follow-up states</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="open">Open</option><option value="completed">Completed</option></select></label>
      </div>
    </div>
    {error ? <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</div> : null}
    {loading && items.length===0 ? <div aria-label="Loading clients" className="grid gap-3 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-xl bg-task-muted"/><div className="h-28 animate-pulse rounded-xl bg-task-muted"/></div> : items.length===0 ? <div className="rounded-xl border border-dashed border-task-border bg-task-bg p-10 text-center"><Users className="mx-auto size-10 text-task-text-muted"/><p className="mt-3 font-semibold text-task-text">No authorized clients found</p><p className="text-sm text-task-text-muted">Adjust the filters or create a client.</p></div> : <div className="grid gap-3 sm:grid-cols-2">{items.map((client)=><button className="rounded-xl border border-task-border bg-task-bg p-4 text-left transition hover:border-task-accent focus-visible:ring-offset-task-bg" key={client.id} onClick={()=>onOpen(client.id)} type="button"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-task-text">{client.first_name} {client.last_name}</p><p className="mt-1 text-sm text-task-text-muted">{client.phone}</p></div><ChevronRight className="size-5 shrink-0 text-task-text-muted"/></div><div className="mt-3 flex flex-wrap gap-2 text-xs text-task-text-muted"><span>{client.total_visits} visits</span><span>·</span><span>{client.last_visit_date ? `Last ${client.last_visit_date}` : "No visits"}</span>{client.next_visit_date?<span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">Follow-up {client.next_visit_date}</span>:null}</div></button>)}</div>}
    {hasMore?<button className="task-field mx-auto block min-h-12 w-full px-6 font-semibold sm:w-auto" disabled={loading} onClick={onMore} type="button">{loading?"Loading…":"Load more"}</button>:null}
  </section>;
}
function Filter({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:Array<{id:string;label:string}>}) { return <label><span className="sr-only">{label}</span><select className="task-field" onChange={(event)=>onChange(event.target.value)} value={value}><option value="">All {label.toLowerCase()}</option>{options.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>; }
