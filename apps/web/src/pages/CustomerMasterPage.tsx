import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage, titleCase } from "@/lib/format";
import { CUSTOMER_LIST_PAGE_SIZE, loadCustomerList, loadCustomerListFilters } from "@/features/customers/api";
import { CustomerInteractionView } from "@/features/customers/CustomerInteractionView";
import { CustomerProfileView } from "@/features/customers/CustomerProfileView";
import { CustomerReviewView } from "@/features/customers/CustomerReviewView";
import { SheetReadProblems } from "@/features/customers/SheetReadProblems";
import { formatDate, formatDateTime } from "@/features/customers/format";
import { Tags } from "@/features/customers/parts";
import {
  activeCustomerFilterCount, CUSTOMER_CONTACT_LABELS, CUSTOMER_DATA_PROBLEM_LABELS, CUSTOMER_DATA_PROBLEMS, CUSTOMER_SORT_LABELS, CUSTOMER_STAGE_LABELS,
  CUSTOMER_MASTER_PATH, CUSTOMER_REVIEW_PATH, customerInteractionPath, customerProfilePath, daysAgoLabel, EMPTY_CUSTOMER_LIST_FILTERS, formatPhone,
  parseCustomerMasterPath,
  type CustomerContactWindow, type CustomerDataProblem, type CustomerLifecycleStage, type CustomerListFilterOptions, type CustomerListFilters,
  type CustomerListPage, type CustomerListSort, type CustomerSegment,
} from "@jewelos/core";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * The list a person left is the list they come back to: filters, search text
 * and page are kept in memory while the app is open (never stored).
 */
let remembered: { filters: CustomerListFilters; searchText: string; page: number } | null = null;
/** Test hook: forget the remembered list state. */
export function resetCustomerMasterListState(): void { remembered = null; }

function sourceLabel(options: CustomerListFilterOptions | null, source: string | null): string {
  if (!source) return "";
  return options?.first_sources.find((item) => item.value === source)?.label ?? titleCase(source);
}

function SelectFilter<T extends string>({ label, value, onChange, children }: { label: string; value: T; onChange: (value: T) => void; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-sm font-medium text-task-text">{label}</span>
      {/* The option values are exactly the T members rendered by the caller. */}
      <select className="field" onChange={(event) => onChange(event.target.value as T)} value={value}>{children}</select>
    </label>
  );
}

/** Customer master: the list, one customer's page, or one interaction's page, by address. */
export function CustomerMasterPage({ path, navigate }: { path: string; navigate: (to: string) => void }) {
  const route = parseCustomerMasterPath(path) ?? { view: "list" as const };
  const openClient = (code: string) => navigate(customerProfilePath(code));
  const openInteraction = (code: string) => navigate(customerInteractionPath(code));
  const backToList = () => navigate(CUSTOMER_MASTER_PATH);
  if (route.view === "client") return <CustomerProfileView clientCode={route.code} key={route.code} onBack={backToList} onOpenClient={openClient} onOpenInteraction={openInteraction} />;
  if (route.view === "interaction") return <CustomerInteractionView interactionCode={route.code} key={route.code} onBack={backToList} onOpenClient={openClient} onOpenInteraction={openInteraction} />;
  if (route.view === "review") return <CustomerReviewView onBack={backToList} onOpenClient={openClient} />;
  return <CustomerMasterList onOpenClient={openClient} onOpenReview={() => navigate(CUSTOMER_REVIEW_PATH)} />;
}

/** Every client and lead in one filtered list (/crm/master). */
function CustomerMasterList({ onOpenClient, onOpenReview }: { onOpenClient: (clientCode: string) => void; onOpenReview: () => void }) {
  const [filters, setFilters] = useState<CustomerListFilters>(() => ({ ...EMPTY_CUSTOMER_LIST_FILTERS, ...remembered?.filters }));
  const [searchText, setSearchText] = useState(() => remembered?.searchText ?? "");
  const [page, setPage] = useState(() => remembered?.page ?? 0);
  useEffect(() => { remembered = { filters, searchText, page }; }, [filters, searchText, page]);
  const [result, setResult] = useState<CustomerListPage | null>(null);
  const [options, setOptions] = useState<CustomerListFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    // A newer filter or page makes this response obsolete; it is then dropped.
    const request = ++requestRef.current;
    setLoading(true); setError(null);
    try {
      const next = await loadCustomerList(filters, page);
      if (request === requestRef.current) setResult(next);
    } catch (reason) {
      if (request === requestRef.current) setError(errorMessage(reason));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { void load(); }, [load]);

  // Filter values are optional detail: the list works without them. They follow the franchise shown.
  useEffect(() => {
    let current = true;
    loadCustomerListFilters(filters.franchise).then((value) => { if (current) setOptions(value); }).catch(() => undefined);
    return () => { current = false; };
  }, [filters.franchise]);

  useEffect(() => {
    // Nothing to do when the box already matches the applied search (first load, or coming back to the list).
    if (filters.query === searchText) return;
    const timer = window.setTimeout(() => {
      setFilters((existing) => ({ ...existing, query: searchText }));
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText, filters.query]);

  const change = (patch: Partial<CustomerListFilters>) => { setFilters((existing) => ({ ...existing, ...patch })); setPage(0); };
  const clear = () => { setSearchText(""); setFilters(EMPTY_CUSTOMER_LIST_FILTERS); setPage(0); };
  const total = result?.total ?? 0;
  const first = total === 0 ? 0 : page * CUSTOMER_LIST_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * CUSTOMER_LIST_PAGE_SIZE);
  const activeFilters = activeCustomerFilterCount({ ...filters, query: searchText });
  const lastImport = options?.import.map((item) => item.last_run_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  const franchises = options?.franchises ?? [];
  // The franchise buttons: only for people who may read more than one franchise.
  const activeFranchise = filters.franchise || (options?.franchise_view?.length === 1 ? options.franchise_view[0] : "all");
  const showingSeveralFranchises = franchises.length > 1 && activeFranchise === "all";
  const segmentCount = (key: CustomerSegment) => options?.segments[key];
  const leadCount = options ? (options.segments.lead ?? 0) + (options.segments["non-buyer"] ?? 0) : undefined;
  type Chip = { label: string; clear: Partial<CustomerListFilters> };
  const chips: Chip[] = [];
  if (filters.lifecycleStage) chips.push({ label: CUSTOMER_STAGE_LABELS[filters.lifecycleStage], clear: { lifecycleStage: "" } });
  if (filters.city) chips.push({ label: filters.city, clear: { city: "" } });
  if (filters.community) chips.push({ label: filters.community, clear: { community: "" } });
  if (filters.firstSource) chips.push({ label: sourceLabel(options, filters.firstSource), clear: { firstSource: "" } });
  if (filters.contact !== "any") chips.push({ label: CUSTOMER_CONTACT_LABELS[filters.contact], clear: { contact: "any" } });
  if (filters.followUpDue) chips.push({ label: "Follow-up due", clear: { followUpDue: false } });
  if (filters.dataProblem) chips.push({ label: filters.dataProblem === "any" ? "All data problems" : CUSTOMER_DATA_PROBLEM_LABELS[filters.dataProblem], clear: { dataProblem: "" } });
  const panelFilters = chips.length;
  const reviewCount = (options?.duplicates_to_review ?? 0) + (options?.same_name_to_review ?? 0) + (options?.shared_phone_to_review ?? 0);

  return (
    <section className="w-full">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.9rem] font-semibold leading-tight text-task-text sm:text-[2.2rem]">Customers</h1>
          <p className="text-sm text-task-text-muted">
            {options ? `${(options.total - (options.with_data_problems ?? 0)).toLocaleString("en-IN")} people` : "Every client and lead"}
            {lastImport ? `, sheets read ${formatDateTime(lastImport)}` : ""}
            {options?.with_data_problems ? `. ${options.with_data_problems.toLocaleString("en-IN")} with data problems are set aside (Filters, Data problems).` : ""}
          </p>
          {options ? <SheetReadProblems items={options.import} /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {reviewCount ? <Button onClick={onOpenReview} variant="secondary">Review duplicates ({reviewCount.toLocaleString("en-IN")})</Button> : null}
        </div>
      </header>

      <div className="sticky top-[calc(3.5rem_+_env(safe-area-inset-top))] z-20 -mx-1 md:top-16 mb-3 space-y-2 bg-obsidian/95 px-1 py-2 backdrop-blur">
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-task-text-muted" />
            <input aria-label="Search customers" className="field min-h-12 pl-10 text-base" onChange={(event) => setSearchText(event.target.value)}
              placeholder="Name, phone or MKC number" type="search" value={searchText} />
          </label>
          <button aria-controls="customer-filters" aria-expanded={filtersOpen} className={`inline-flex min-h-12 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${filtersOpen || panelFilters ? "border-gold bg-gold/15 text-task-text" : "border-task-border bg-task-bg text-task-text"}`} onClick={() => setFiltersOpen((value) => !value)} type="button">
            <SlidersHorizontal aria-hidden className="h-5 w-5" /><span className="hidden sm:inline">Filters</span>
            {panelFilters ? <span className="rounded-full bg-gold px-1.5 text-xs text-on-gold">{panelFilters}</span> : null}
          </button>
        </div>
        {franchises.length > 1 ? (
          <div aria-label="Franchise" className="flex gap-1.5 overflow-x-auto" role="group">
            {[...franchises.map((item) => [item.id, item.name] as const), ["all", "All franchises"] as const].map(([key, label]) => (
              <button aria-pressed={activeFranchise === key} className={`min-h-10 shrink-0 rounded-lg border px-3 text-sm font-semibold ${activeFranchise === key ? "border-gold bg-gold text-on-gold" : "border-task-border bg-task-bg text-task-text hover:border-gold/60"}`} key={key} onClick={() => change({ franchise: key, city: "", community: "", firstSource: "" })} type="button">
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div aria-label="Type" className="flex gap-1.5 overflow-x-auto" role="group">
          {([["", "All", options ? options.total - (options.with_data_problems ?? 0) : undefined], ["buyer", "Clients", segmentCount("buyer")], ["lead", "Leads", leadCount]] as const).map(([key, label, n]) => (
            <button aria-pressed={filters.segment === key} className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold ${filters.segment === key ? "border-gold bg-gold/15 text-task-text" : "border-task-border bg-task-bg text-task-text-muted hover:text-task-text"}`} key={label} onClick={() => change({ segment: key })} type="button">
              {label}{n !== undefined ? <span className="ml-1.5 font-normal">{n.toLocaleString("en-IN")}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {filtersOpen ? (
        <div className="mb-3 rounded-xl border border-task-border bg-task-bg p-4 shadow-card" id="customer-filters">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectFilter<CustomerLifecycleStage | ""> label="Stage" onChange={(lifecycleStage) => change({ lifecycleStage })} value={filters.lifecycleStage}>
              <option value="">All stages</option>
              {(Object.keys(CUSTOMER_STAGE_LABELS) as CustomerLifecycleStage[]).map((key) => <option key={key} value={key}>{CUSTOMER_STAGE_LABELS[key]}</option>)}
            </SelectFilter>
            <SelectFilter<string> label="City" onChange={(city) => change({ city })} value={filters.city}>
              <option value="">All cities</option>
              {options?.cities.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
            </SelectFilter>
            <SelectFilter<string> label="Community" onChange={(community) => change({ community })} value={filters.community}>
              <option value="">All communities</option>
              {options?.communities.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
            </SelectFilter>
            <SelectFilter<string> label="First source" onChange={(firstSource) => change({ firstSource })} value={filters.firstSource}>
              <option value="">All sources</option>
              {options?.first_sources.map((item) => <option key={item.value} value={item.value}>{item.label ?? item.value} ({item.count})</option>)}
            </SelectFilter>
            <SelectFilter<CustomerContactWindow> label="Last contact" onChange={(contact) => change({ contact })} value={filters.contact}>
              {(Object.keys(CUSTOMER_CONTACT_LABELS) as CustomerContactWindow[]).map((key) => <option key={key} value={key}>{CUSTOMER_CONTACT_LABELS[key]}</option>)}
            </SelectFilter>
            <SelectFilter<CustomerDataProblem | "any" | ""> label="Data problems" onChange={(dataProblem) => change({ dataProblem })} value={filters.dataProblem}>
              <option value="">Hidden (not in the list)</option>
              <option value="any">All data problems{options?.with_data_problems !== undefined ? ` (${options.with_data_problems})` : ""}</option>
              {CUSTOMER_DATA_PROBLEMS.map((key) => <option key={key} value={key}>{CUSTOMER_DATA_PROBLEM_LABELS[key]}{options?.data_problems ? ` (${options.data_problems[key] ?? 0})` : ""}</option>)}
            </SelectFilter>
            <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-task-border px-3 text-[15px] font-medium text-task-text">
              <input checked={filters.followUpDue} className="h-5 w-5" onChange={(event) => change({ followUpDue: event.target.checked })} type="checkbox" />
              Follow-up due
            </label>
          </div>
          <div className="mt-3 flex justify-end"><Button onClick={() => setFiltersOpen(false)} variant="secondary">Done</Button></div>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-sm font-medium text-task-text">
          {loading ? "Loading…" : total === 0 ? "No customers match." : `${first.toLocaleString("en-IN")}–${last.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
        </p>
        <label className="flex items-center gap-2 text-sm text-task-text-muted">
          Sort
          {/* The option values are exactly the CustomerListSort keys rendered below. */}
          <select aria-label="Sort by" className="min-h-10 rounded-lg border border-task-border bg-task-bg px-2 text-sm font-medium text-task-text" onChange={(event) => change({ sort: event.target.value as CustomerListSort })} value={filters.sort}>
            {(Object.keys(CUSTOMER_SORT_LABELS) as CustomerListSort[]).map((key) => <option key={key} value={key}>{CUSTOMER_SORT_LABELS[key]}</option>)}
          </select>
        </label>
      </div>
      {chips.length || activeFilters ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button aria-label={`Remove filter ${chip.label}`} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-gold/50 bg-gold/10 pl-3 pr-2 text-sm font-medium text-task-text" key={chip.label} onClick={() => change(chip.clear)} type="button">
              {chip.label}<X aria-hidden className="h-4 w-4" />
            </button>
          ))}
          {activeFilters > 0 ? <Button className="min-h-9" onClick={clear} variant="ghost">Clear all</Button> : null}
        </div>
      ) : null}

      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice><Button className="mt-3" onClick={() => void load()} variant="secondary">Retry</Button></div> : null}

      <ul className="overflow-hidden rounded-xl border border-task-border bg-task-bg shadow-card">
        <li aria-hidden className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] gap-4 border-b border-task-border bg-task-muted px-4 py-2 text-[13px] font-semibold text-task-text-muted lg:grid">
          <span>Name</span><span>Type</span><span>Place</span><span>Last contact</span>
        </li>
        {result?.rows.map((row) => {
          const contact = row.last_contacted_at ? daysAgoLabel(row.last_contacted_at) : row.last_attempt_at ? "Not reached" : "Never";
          return (
            <li className="border-b border-task-border last:border-b-0" key={row.client_id}>
              <button aria-label={`Open ${row.primary_name ?? row.client_code}`} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-3 text-left hover:bg-gold/5 focus-visible:bg-gold/5 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-4" onClick={() => onOpenClient(row.client_code)} type="button">
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-task-text">{row.primary_name ?? "No name"}</span>
                  <span className="block truncate text-sm text-task-text-muted">{row.primary_phone ? formatPhone(row.primary_phone) : row.client_code}</span>
                </span>
                <span className="text-right text-sm text-task-text lg:hidden">
                  <span className="block font-medium">{contact}</span>
                  {row.next_follow_up_at ? <span className="block text-[13px] text-task-text-muted">Follow-up {formatDate(row.next_follow_up_at)}</span> : null}
                </span>
                <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 lg:col-span-1">
                  <Tags keys={showingSeveralFranchises && row.franchise ? [...(row.tags ?? []), `franchise:${row.franchise}`] : row.tags} segment={row.segment} />
                  {row.place ?? row.city ? <span className="inline-flex items-center gap-1 text-sm text-task-text lg:hidden"><MapPin aria-hidden className="h-3.5 w-3.5 text-task-text-muted" />{row.place ?? row.city}</span> : null}
                </span>
                <span className="hidden truncate text-sm text-task-text lg:block">{row.place ?? row.city ?? ""}</span>
                <span className="hidden text-sm text-task-text lg:block">
                  <span className="block font-medium">{contact}</span>
                  {row.next_follow_up_at ? <span className="block text-[13px] text-task-text-muted">Follow-up {formatDate(row.next_follow_up_at)}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
        {result && result.rows.length === 0 && !loading ? <li className="p-6 text-center text-[15px] text-task-text-muted">{activeFilters > 0 ? "No customers match these filters. Remove a filter to see more." : "No customers yet. They appear here as the sheets are read."}</li> : null}
        {result === null && loading ? <li className="p-6 text-center text-[15px] text-task-text-muted">Loading customers…</li> : null}
      </ul>

      {total > CUSTOMER_LIST_PAGE_SIZE ? (
        <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-2">
          <Button disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))} variant="secondary"><ChevronLeft className="h-4 w-4" />Previous</Button>
          <span className="text-sm text-task-text-muted">Page {page + 1} of {Math.ceil(total / CUSTOMER_LIST_PAGE_SIZE).toLocaleString("en-IN")}</span>
          <Button disabled={last >= total || loading} onClick={() => setPage((value) => value + 1)} variant="secondary">Next<ChevronRight className="h-4 w-4" /></Button>
        </nav>
      ) : null}
    </section>
  );
}
