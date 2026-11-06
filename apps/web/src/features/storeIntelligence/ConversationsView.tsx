import { useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  activeFilterCount, conversationFiltersFromQuery, conversationFiltersToQuery, CONVERSATION_STAGES, groupByIstDay, OUTCOME_LABEL, SALES_OUTCOMES, STAGE_LABEL,
  type ConversationCard, type ConversationFilters, type ConversationStage, type SalesOutcome,
} from "@jewelos/core";
import { fetchConversationPage, fetchWorkspaceSettings, type ConversationCursor } from "@jewelos/data";
import { Button } from "@/components/ui";
import { siPath } from "./routes";
import { ConversationRow } from "./TodayView";
import { Drawer, EmptyState, ErrorState, SkeletonRows } from "./ui";
import { useLoad } from "./useLoad";

type Draft = { [K in keyof ConversationFilters]?: ConversationFilters[K] };

export function ConversationsView({ navigate, search, isReviewer }: { navigate: (path: string) => void; search: string; isReviewer: boolean }) {
  const filters = useMemo(() => conversationFiltersFromQuery(search), [search]);
  const query = conversationFiltersToQuery(filters);
  const [rows, setRows] = useState<readonly ConversationCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [text, setText] = useState(filters.q ?? "");
  const [drawer, setDrawer] = useState(false);
  const people = useLoad(async () => (isReviewer ? (await fetchWorkspaceSettings()).config.employees : []), [isReviewer]);

  useEffect(() => { setText(filters.q ?? ""); }, [filters.q]);
  // Typing searches after a short pause and keeps the search in the link.
  const typing = useRef<ReturnType<typeof setTimeout>>();
  const onType = (value: string) => {
    setText(value); clearTimeout(typing.current);
    typing.current = setTimeout(() => {
      const { q: _previous, ...rest } = filters;
      navigate(siPath.conversations(conversationFiltersToQuery(value.trim() ? { ...rest, q: value.trim() } : rest)));
    }, 350);
  };
  useEffect(() => () => clearTimeout(typing.current), []);

  useEffect(() => {
    let active = true; setLoading(true); setError(null);
    void fetchConversationPage(filters).then((page) => { if (active) { setRows(page.rows); setHasMore(page.has_more); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Conversations could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // The query string is the stable identity of the filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, nonce]);

  const more = async () => {
    const last = rows.at(-1); if (!last) return;
    setLoadingMore(true);
    try { const cursor: ConversationCursor = { before: last.created_at, beforeId: last.id }; const page = await fetchConversationPage(filters, cursor); setRows((previous) => [...previous, ...page.rows]); setHasMore(page.has_more); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "More conversations could not be loaded."); }
    finally { setLoadingMore(false); }
  };

  const apply = (next: ConversationFilters) => navigate(siPath.conversations(conversationFiltersToQuery(next)));
  const groups = groupByIstDay(rows);
  const count = activeFilterCount(filters);
  const chips = filterChips(filters, people.data ?? []);

  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-task-text">Conversations</h1>
        <p className="mt-0.5 text-sm text-task-text-muted">{isReviewer ? "Recorded in your branch." : "Your recorded conversations."}</p></div>
    </header>
    <div className="flex gap-2">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search conversations</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-task-text-muted" />
        <input className="field pl-9" onChange={(event) => onType(event.target.value)} placeholder={isReviewer ? "Search name, product or summary" : "Search product or summary"} type="search" value={text} />
      </label>
      <Button aria-label={count ? `Filters, ${count} on` : "Filters"} className="min-h-11 shrink-0" onClick={() => setDrawer(true)} type="button" variant="secondary">
        <SlidersHorizontal aria-hidden className="size-4" /><span className="hidden sm:inline">Filters</span>{count ? <span className="rounded-full bg-gold px-1.5 text-xs text-on-gold">{count}</span> : null}
      </Button>
    </div>
    {chips.length ? <ul aria-label="Filters in use" className="flex flex-wrap gap-2">
      {chips.map((chip) => <li key={chip.key}><button aria-label={`Remove filter: ${chip.label}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-task-border bg-task-bg px-3 text-xs font-medium text-task-text hover:border-gold/50" onClick={() => apply(chip.remove())} type="button">{chip.label}<X aria-hidden className="size-3.5" /></button></li>)}
      <li><button className="min-h-11 px-2 text-xs font-semibold text-task-text-muted underline-offset-2 hover:underline" onClick={() => apply({ ...(filters.q ? { q: filters.q } : {}) })} type="button">Clear all</button></li>
    </ul> : null}

    <p aria-live="polite" className="sr-only">{loading ? "Loading conversations" : `${rows.length}${hasMore ? " or more" : ""} conversations shown`}</p>
    {error && !rows.length ? <ErrorState message={error} onRetry={() => setNonce((value) => value + 1)} />
      : loading && !rows.length ? <SkeletonRows label="Loading conversations" rows={5} />
      : !rows.length ? (count || filters.q
        ? <EmptyState action={<Button onClick={() => apply({})} type="button" variant="secondary">Clear filters</Button>} title="Nothing matches">Try a wider date range or fewer filters.</EmptyState>
        : <EmptyState title="No conversations yet">Recorded conversations appear here with their summary and score.</EmptyState>)
      : <div className="space-y-5">
        {groups.map((group) => <section aria-labelledby={`day-${group.key}`} key={group.key}>
          <h2 className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-1 bg-task-muted/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wider text-task-text-muted backdrop-blur md:top-16" id={`day-${group.key}`}>{group.label}</h2>
          <ul className="divide-y divide-task-border rounded-2xl border border-task-border bg-task-bg shadow-card">
            {group.items.map((card) => <li key={card.id}><ConversationRow card={card} onOpen={(id) => navigate(siPath.conversation(id))} showEmployee={isReviewer} /></li>)}
          </ul>
        </section>)}
        {error ? <ErrorState message={error} /> : null}
        {hasMore ? <div className="flex justify-center"><Button disabled={loadingMore} onClick={() => void more()} type="button" variant="secondary">{loadingMore ? "Loading…" : "Load more"}</Button></div>
          : <p className="text-center text-xs text-task-text-muted">That is everything{count || filters.q ? " that matches" : ""}.</p>}
      </div>}

    {drawer ? <FilterDrawer filters={filters} isReviewer={isReviewer} onApply={(next) => { setDrawer(false); apply({ ...next, ...(filters.q ? { q: filters.q } : {}) }); }} onClose={() => setDrawer(false)} people={people.data ?? []} /> : null}
  </div>;
}

function filterChips(filters: ConversationFilters, people: readonly { id: string; name: string }[]): { key: string; label: string; remove: () => ConversationFilters }[] {
  const without = (...keys: (keyof ConversationFilters)[]) => () => Object.fromEntries(Object.entries(filters).filter(([key]) => !keys.includes(key as keyof ConversationFilters))) as ConversationFilters; // Subset of a valid filter object.
  const chips: { key: string; label: string; remove: () => ConversationFilters }[] = [];
  if (filters.date_from || filters.date_to) chips.push({ key: "date", label: filters.date_from === filters.date_to ? `On ${filters.date_from}` : `${filters.date_from ?? "Start"} – ${filters.date_to ?? "today"}`, remove: without("date_from", "date_to") });
  if (filters.employee_id) chips.push({ key: "employee", label: people.find((person) => person.id === filters.employee_id)?.name ?? "One salesperson", remove: without("employee_id") });
  if (filters.stage) chips.push({ key: "stage", label: STAGE_LABEL[filters.stage], remove: without("stage") });
  if (filters.outcome) chips.push({ key: "outcome", label: OUTCOME_LABEL[filters.outcome], remove: without("outcome") });
  if (filters.min_score !== undefined || filters.max_score !== undefined) chips.push({ key: "score", label: `Score ${filters.min_score ?? 0}–${filters.max_score ?? 100}`, remove: without("min_score", "max_score") });
  if (filters.min_minutes !== undefined || filters.max_minutes !== undefined) chips.push({ key: "minutes", label: `${filters.min_minutes ?? 0}–${filters.max_minutes ?? "any"} min`, remove: without("min_minutes", "max_minutes") });
  if (filters.product) chips.push({ key: "product", label: `Product: ${filters.product}`, remove: without("product") });
  if (filters.linked) chips.push({ key: "linked", label: "CRM walk-in linked", remove: without("linked") });
  if (filters.flagged) chips.push({ key: "flagged", label: "Flagged", remove: without("flagged") });
  return chips;
}

function FilterDrawer({ filters, onApply, onClose, isReviewer, people }: { filters: ConversationFilters; onApply: (filters: ConversationFilters) => void; onClose: () => void; isReviewer: boolean; people: readonly { id: string; name: string }[] }) {
  const [draft, setDraft] = useState<Draft>(() => { const { q: _search, ...rest } = filters; return rest; });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((previous) => ({ ...previous, [key]: value === "" ? undefined : value }));
  const numberOrUndefined = (value: string) => (value === "" ? undefined : Number(value));
  const clean = () => Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined && value !== "" && !(typeof value === "number" && Number.isNaN(value)))) as ConversationFilters; // Built from typed fields.
  return <Drawer footer={<><Button className="flex-1" onClick={() => setDraft({})} type="button" variant="ghost">Reset</Button><Button className="flex-1" data-autofocus onClick={() => onApply(clean())} type="button">Show results</Button></>} onClose={onClose} title="Filters">
    <div className="space-y-5">
      <fieldset className="grid grid-cols-2 gap-3"><legend className="label">Date</legend>
        <label className="text-sm text-task-text">From<input className="field mt-1" onChange={(event) => set("date_from", event.target.value)} type="date" value={draft.date_from ?? ""} /></label>
        <label className="text-sm text-task-text">To<input className="field mt-1" onChange={(event) => set("date_to", event.target.value)} type="date" value={draft.date_to ?? ""} /></label>
      </fieldset>
      {isReviewer ? <label className="block"><span className="label">Salesperson</span>
        <select className="field" onChange={(event) => set("employee_id", event.target.value)} value={draft.employee_id ?? ""}>
          <option value="">Everyone</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label> : null}
      <label className="block"><span className="label">Status</span>
        <select className="field" onChange={(event) => set("stage", event.target.value as ConversationStage)} value={draft.stage ?? ""}>
          <option value="">Any</option>{CONVERSATION_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABEL[stage]}</option>)}
        </select></label>
      <label className="block"><span className="label">What the customer said happened</span>
        <select className="field" onChange={(event) => set("outcome", event.target.value as SalesOutcome)} value={draft.outcome ?? ""}>
          <option value="">Any</option>{SALES_OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{OUTCOME_LABEL[outcome]}</option>)}
        </select>
        <span className="mt-1 block text-xs text-task-text-muted">Taken from the conversation, not from CRM sales.</span></label>
      <fieldset className="grid grid-cols-2 gap-3"><legend className="label">Score (0–100)</legend>
        <label className="text-sm text-task-text">Lowest<input className="field mt-1" inputMode="numeric" max={100} min={0} onChange={(event) => set("min_score", numberOrUndefined(event.target.value))} type="number" value={draft.min_score ?? ""} /></label>
        <label className="text-sm text-task-text">Highest<input className="field mt-1" inputMode="numeric" max={100} min={0} onChange={(event) => set("max_score", numberOrUndefined(event.target.value))} type="number" value={draft.max_score ?? ""} /></label>
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-3"><legend className="label">Length (minutes)</legend>
        <label className="text-sm text-task-text">At least<input className="field mt-1" inputMode="numeric" max={240} min={0} onChange={(event) => set("min_minutes", numberOrUndefined(event.target.value))} type="number" value={draft.min_minutes ?? ""} /></label>
        <label className="text-sm text-task-text">At most<input className="field mt-1" inputMode="numeric" max={240} min={0} onChange={(event) => set("max_minutes", numberOrUndefined(event.target.value))} type="number" value={draft.max_minutes ?? ""} /></label>
      </fieldset>
      <label className="block"><span className="label">Product mentioned</span>
        <input className="field" maxLength={100} onChange={(event) => set("product", event.target.value)} placeholder="For example: bangle" value={draft.product ?? ""} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm text-task-text"><input checked={draft.linked === true} className="size-5 accent-gold" onChange={(event) => set("linked", event.target.checked || undefined)} type="checkbox" />Only CRM-linked walk-ins</label>
      {isReviewer ? <label className="flex min-h-11 items-center gap-3 text-sm text-task-text"><input checked={draft.flagged === true} className="size-5 accent-gold" onChange={(event) => set("flagged", event.target.checked || undefined)} type="checkbox" />Only flagged</label> : null}
    </div>
  </Drawer>;
}
