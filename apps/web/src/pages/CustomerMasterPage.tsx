import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { Button, Modal, Notice } from "@/components/ui";
import { errorMessage, titleCase } from "@/lib/format";
import {
  CUSTOMER_LIST_PAGE_SIZE, loadCustomerList, loadCustomerListFilters, loadCustomerProfile, loadCustomerTimeline,
  type CustomerProfile, type CustomerTimelineEntry,
} from "@/features/customers/api";
import {
  activeCustomerFilterCount, CUSTOMER_CONTACT_LABELS, CUSTOMER_SEGMENT_LABELS, CUSTOMER_SORT_LABELS, CUSTOMER_STAGE_LABELS,
  daysAgoLabel, EMPTY_CUSTOMER_LIST_FILTERS, formatPhone,
  type CustomerContactWindow, type CustomerLifecycleStage, type CustomerListFilterOptions, type CustomerListFilters,
  type CustomerListPage, type CustomerListRow, type CustomerListSort, type CustomerSegment,
} from "@jewelos/core";

const SEARCH_DEBOUNCE_MS = 350;
const formatDateTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const formatDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
const RESULT_LABEL: Record<CustomerTimelineEntry["result"], string> = { positive: "Positive", negative: "Negative", not_connected: "Not connected", neutral: "Neutral" };
const RESULT_TONE: Record<CustomerTimelineEntry["result"], string> = {
  positive: "border-success/40 text-success", negative: "border-danger/40 text-danger",
  not_connected: "border-task-border text-soft-grey", neutral: "border-gold/30 text-champagne",
};

function sourceLabel(options: CustomerListFilterOptions | null, source: string | null): string {
  if (!source) return "";
  return options?.first_sources.find((item) => item.value === source)?.label ?? titleCase(source);
}

function SelectFilter<T extends string>({ label, value, onChange, children }: { label: string; value: T; onChange: (value: T) => void; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      {/* The option values are exactly the T members rendered by the caller. */}
      <select className="field" onChange={(event) => onChange(event.target.value as T)} value={value}>{children}</select>
    </label>
  );
}

function CustomerDetail({ row, options, onClose }: { row: CustomerListRow; options: CustomerListFilterOptions | null; onClose: () => void }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [timeline, setTimeline] = useState<CustomerTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);

  useEffect(() => {
    let current = true;
    setProfile(null); setTimeline(null); setError(null); setReachedEnd(false);
    // Independent reads start together; the timeline does not wait for the profile.
    loadCustomerProfile(row.client_id).then((value) => { if (current) setProfile(value); }).catch((reason: unknown) => { if (current) setError(errorMessage(reason)); });
    loadCustomerTimeline(row.client_id).then((value) => { if (current) { setTimeline(value); setReachedEnd(value.length < 50); } })
      .catch((reason: unknown) => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [row.client_id]);

  const loadMore = async () => {
    const last = timeline?.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const more = await loadCustomerTimeline(row.client_id, last.occurred_at);
      setTimeline((existing) => [...(existing ?? []), ...more]);
      setReachedEnd(more.length < 50);
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoadingMore(false); }
  };

  const client = profile?.client;
  const text = (key: string) => { const value = client?.[key]; return typeof value === "string" && value ? value : null; };
  const facts: [string, string | null][] = [
    ["City", text("city")], ["Community", text("community")], ["Email", text("email")],
    ["Date of birth", text("dob") ? (client?.dob_year_known === false ? new Date(`${text("dob")}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long" }) : formatDate(`${text("dob")}T00:00:00`)) : null],
    ["Anniversary", text("anniversary") ? (client?.anniversary_year_known === false ? new Date(`${text("anniversary")}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long" }) : formatDate(`${text("anniversary")}T00:00:00`)) : null],
    ["Marital status", text("marital_status")], ["Address", text("address")], ["Beverage", text("beverage")], ["Snack", text("snack")],
    ["First source", sourceLabel(options, row.first_source) || null], ["First seen", formatDate(row.first_seen_at) || null],
    ["Referral ID", text("referral_code")], ["Referred by", profile?.referred_by ? `${profile.referred_by.name ?? "Unnamed"} (${profile.referred_by.client_code})` : null],
  ];
  const otherNames = profile?.names.filter((item) => item.name !== row.primary_name).map((item) => item.name) ?? [];
  const otherPhones = profile?.phones.filter((item) => item.kind !== "primary") ?? [];
  const family = profile?.family?.members.filter((member) => member.client_id !== row.client_id) ?? [];

  return (
    <Modal mobileFullscreen onClose={onClose} title={row.primary_name ?? "Unnamed customer"} wide>
      <div className="space-y-4">
        <p className="text-sm text-soft-grey">
          <span className="font-mono text-champagne">{row.client_code}</span>
          {row.household_code ? <> · Family <span className="font-mono text-champagne">{row.household_code}</span></> : null}
          {row.primary_phone ? <> · {formatPhone(row.primary_phone)}</> : null}
          {" · "}{CUSTOMER_SEGMENT_LABELS[row.segment]} · {CUSTOMER_STAGE_LABELS[row.lifecycle_stage]}
        </p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {profile === null && !error ? <p className="text-sm text-soft-grey">Loading profile…</p> : null}
        {profile ? <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.filter(([, value]) => value).map(([label, value]) => (
              <div className="min-w-0" key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-soft-grey">{label}</dt><dd className="break-words text-sm text-champagne">{value}</dd></div>
            ))}
          </dl>
          {otherNames.length ? <p className="text-sm text-soft-grey">Other names: <span className="text-champagne">{otherNames.join(", ")}</span></p> : null}
          {otherPhones.length ? <p className="text-sm text-soft-grey">Other phones: <span className="text-champagne">{otherPhones.map((item) => `${formatPhone(item.phone)} (${item.kind})`).join(", ")}</span></p> : null}
          {family.length ? <p className="text-sm text-soft-grey">Family: <span className="text-champagne">{family.map((member) => `${member.name ?? "Unnamed"} (${member.client_code})`).join(", ")}</span></p> : null}
          {profile.needs_review_count > 0 ? <Notice>{profile.needs_review_count} newer answer{profile.needs_review_count === 1 ? "" : "s"} from a lower-priority source need a check.</Notice> : null}
        </> : null}

        <section aria-label="Timeline">
          <h3 className="mb-2 font-display text-lg font-semibold text-gold-secondary">Timeline</h3>
          {timeline === null && !error ? <p className="text-sm text-soft-grey">Loading timeline…</p> : null}
          {timeline?.length === 0 ? <p className="text-sm text-soft-grey">No interactions recorded yet.</p> : null}
          <ol className="space-y-2">
            {timeline?.map((entry) => (
              <li className="rounded-lg border border-task-border p-3" key={entry.interaction_id}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold text-champagne">{formatDateTime(entry.occurred_at)}</span>
                  <span className="text-soft-grey">{titleCase(entry.channel)} · {titleCase(entry.purpose)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${RESULT_TONE[entry.result]}`}>{RESULT_LABEL[entry.result]}</span>
                  <span className="ml-auto font-mono text-xs text-soft-grey">{entry.interaction_code}</span>
                </div>
                <p className="mt-1 text-sm text-champagne">
                  {entry.outcome ?? (entry.successful ? "Reached" : "Not reached")}
                  {entry.non_contact_reason ? ` (${entry.non_contact_reason})` : ""}
                </p>
                <p className="text-xs text-soft-grey">
                  {[entry.staff ? `By ${entry.staff}` : null, entry.attended_by ? `Attended by ${entry.attended_by}` : null, entry.branch, sourceLabel(options, entry.source)].filter(Boolean).join(" · ")}
                </p>
                {entry.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-soft-grey">{entry.notes}</p> : null}
                {entry.products.length ? <p className="mt-1 text-xs text-soft-grey">Products: {entry.products.map((product) => [product.code, product.category].filter(Boolean).join(" ")).join(", ")}</p> : null}
                {entry.follow_ups.map((followUp) => <p className="mt-1 text-xs text-soft-grey" key={followUp.code}>Follow-up {followUp.code}: {titleCase(followUp.kind)}, due {formatDate(followUp.due_at)} ({followUp.status})</p>)}
                {entry.appointments.map((appointment) => <p className="mt-1 text-xs text-soft-grey" key={appointment.code}>Appointment {appointment.code}: {titleCase(appointment.type)}, {formatDateTime(appointment.scheduled_at)} ({titleCase(appointment.status)})</p>)}
              </li>
            ))}
          </ol>
          {timeline && timeline.length > 0 && !reachedEnd ? <Button className="mt-3" disabled={loadingMore} onClick={() => void loadMore()} variant="secondary">{loadingMore ? "Loading…" : "Show older"}</Button> : null}
        </section>
      </div>
    </Modal>
  );
}

/** Customer master: every client and lead in one filtered list (/crm/master). */
export function CustomerMasterPage({ onOpenCrm }: { onOpenCrm: () => void }) {
  const [filters, setFilters] = useState<CustomerListFilters>(EMPTY_CUSTOMER_LIST_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<CustomerListPage | null>(null);
  const [options, setOptions] = useState<CustomerListFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerListRow | null>(null);
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

  // Filter values are optional detail: the list works without them.
  useEffect(() => {
    let current = true;
    loadCustomerListFilters().then((value) => { if (current) setOptions(value); }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((existing) => existing.query === searchText ? existing : { ...existing, query: searchText });
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const change = (patch: Partial<CustomerListFilters>) => { setFilters((existing) => ({ ...existing, ...patch })); setPage(0); };
  const clear = () => { setSearchText(""); setFilters(EMPTY_CUSTOMER_LIST_FILTERS); setPage(0); };
  const total = result?.total ?? 0;
  const first = total === 0 ? 0 : page * CUSTOMER_LIST_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * CUSTOMER_LIST_PAGE_SIZE);
  const activeFilters = activeCustomerFilterCount({ ...filters, query: searchText });
  const lastImport = options?.import.map((item) => item.last_run_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  return (
    <section className="w-full">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-gold-sheen p-2 text-on-gold shadow-gold"><Users className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h1 className="font-display text-[1.6rem] font-semibold leading-tight text-gold-secondary sm:text-[1.85rem]">Customer master</h1>
            <p className="text-sm text-soft-grey">
              {options ? `${options.total.toLocaleString("en-IN")} customers` : "Every client and lead in one list"}
              {lastImport ? ` · Sheets last read ${formatDateTime(lastImport)}` : ""}
              {options?.import.some((item) => item.failed) ? " · The last sheet read failed" : ""}
            </p>
          </div>
        </div>
        <Button onClick={onOpenCrm} variant="secondary">Open CRM</Button>
      </header>

      <div className="mb-3 space-y-3 rounded-xl border border-task-border p-3">
        <label className="relative block">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-grey" />
          <input aria-label="Search customers" className="field pl-9" onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search by name, phone, MKC, MKF or MKREF" type="search" value={searchText} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectFilter<CustomerSegment | ""> label="Type" onChange={(segment) => change({ segment })} value={filters.segment}>
            <option value="">All types</option>
            {(Object.keys(CUSTOMER_SEGMENT_LABELS) as CustomerSegment[]).map((key) => <option key={key} value={key}>{CUSTOMER_SEGMENT_LABELS[key]}{options?.segments[key] !== undefined ? ` (${options.segments[key]})` : ""}</option>)}
          </SelectFilter>
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
          <SelectFilter<CustomerContactWindow> label="Last reached" onChange={(contact) => change({ contact })} value={filters.contact}>
            {(Object.keys(CUSTOMER_CONTACT_LABELS) as CustomerContactWindow[]).map((key) => <option key={key} value={key}>{CUSTOMER_CONTACT_LABELS[key]}</option>)}
          </SelectFilter>
          <SelectFilter<CustomerListSort> label="Sort by" onChange={(sort) => change({ sort })} value={filters.sort}>
            {(Object.keys(CUSTOMER_SORT_LABELS) as CustomerListSort[]).map((key) => <option key={key} value={key}>{CUSTOMER_SORT_LABELS[key]}</option>)}
          </SelectFilter>
          <label className="flex min-h-10 items-center gap-3 self-end rounded-lg border border-gold/20 bg-obsidian p-3 text-sm text-champagne">
            <input checked={filters.followUpDue} onChange={(event) => change({ followUpDue: event.target.checked })} type="checkbox" />
            Follow-up due
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm text-soft-grey">
            {loading ? "Loading…" : total === 0 ? "No customers match." : `${first.toLocaleString("en-IN")}–${last.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
          </p>
          {activeFilters > 0 ? <Button onClick={clear} variant="ghost">Clear filters ({activeFilters})</Button> : null}
        </div>
      </div>

      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice><Button className="mt-3" onClick={() => void load()} variant="secondary">Retry</Button></div> : null}

      <ul className="divide-y divide-task-border rounded-xl border border-task-border">
        {result?.rows.map((row) => (
          <li key={row.client_id}>
            <button aria-label={`Open ${row.primary_name ?? row.client_code}`} className="grid w-full grid-cols-1 gap-x-4 gap-y-1 p-3 text-left hover:bg-gold/5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)]" onClick={() => setSelected(row)} type="button">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-champagne">{row.primary_name ?? "Unnamed"}</span>
                <span className="block text-xs text-soft-grey"><span className="font-mono">{row.client_code}</span>{row.primary_phone ? ` · ${formatPhone(row.primary_phone)}` : ""}</span>
              </span>
              <span className="min-w-0 text-sm text-soft-grey">
                <span className="block truncate text-champagne">{row.city ?? "No city"}</span>
                <span className="block truncate text-xs">{CUSTOMER_SEGMENT_LABELS[row.segment]} · {CUSTOMER_STAGE_LABELS[row.lifecycle_stage]}</span>
              </span>
              <span className="min-w-0 text-sm text-soft-grey">
                <span className="block truncate">{sourceLabel(options, row.first_source) || "No source"}</span>
                <span className="block truncate text-xs">{row.interaction_count} interaction{row.interaction_count === 1 ? "" : "s"}, {row.successful_interaction_count} reached</span>
              </span>
              <span className="min-w-0 text-sm text-soft-grey">
                <span className="block truncate text-champagne">{row.last_contacted_at ? `Reached ${daysAgoLabel(row.last_contacted_at)?.toLowerCase()}` : row.last_attempt_at ? "Tried, never reached" : "Never contacted"}</span>
                <span className="block truncate text-xs">{row.next_follow_up_at ? `Follow-up ${formatDate(row.next_follow_up_at)}` : "No follow-up pending"}</span>
              </span>
            </button>
          </li>
        ))}
        {result && result.rows.length === 0 && !loading ? <li className="p-6 text-center text-sm text-soft-grey">{activeFilters > 0 ? "No customers match these filters." : "No customers yet. They appear here as the sheets are read."}</li> : null}
        {result === null && loading ? <li className="p-6 text-center text-sm text-soft-grey">Loading customers…</li> : null}
      </ul>

      {total > CUSTOMER_LIST_PAGE_SIZE ? (
        <nav aria-label="Pages" className="mt-3 flex items-center justify-end gap-2">
          <Button disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))} variant="secondary"><ChevronLeft className="h-4 w-4" />Previous</Button>
          <Button disabled={last >= total || loading} onClick={() => setPage((value) => value + 1)} variant="secondary">Next<ChevronRight className="h-4 w-4" /></Button>
        </nav>
      ) : null}

      {selected ? <CustomerDetail onClose={() => setSelected(null)} options={options} row={selected} /> : null}
    </section>
  );
}
