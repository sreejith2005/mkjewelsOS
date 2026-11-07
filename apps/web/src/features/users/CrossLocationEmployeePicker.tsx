import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  type AssignmentLocations,
  type AssignmentLookupContext,
  type AssignmentRecipient,
} from "@jewelos/core";
import { loadAssignmentLocations, searchAssignmentRecipients } from "@jewelos/data/users/franchise";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 250;

type Props = Readonly<{
  /** Null while the form is unsaved (builder preview): the picker explains instead of loading. */
  context: AssignmentLookupContext | null;
  value: string;
  onChange: (userId: string) => void;
  /** Called with the chosen person's name, store and department (task assignment needs them). */
  onPick?: ((recipient: AssignmentRecipient) => void) | undefined;
  disabled?: boolean | undefined;
  labelledBy?: string | undefined;
  describedBy?: string | undefined;
  registerRef?: ((node: HTMLElement | null) => void) | undefined;
  /** Names the picker already knows (people in the person's own directory). */
  knownNames?: readonly { id: string; label: string }[] | undefined;
}>;

/**
 * Location -> Store -> Employee. Loads franchise and store names once, then at
 * most one page of people for the chosen store at a time; never the company
 * directory. The answer is only the employee's id, as for any Users question;
 * the server re-checks it against the saved question setting on submit.
 */
export function CrossLocationEmployeePicker({ context, value, onChange, onPick, disabled = false, labelledBy, describedBy, registerRef, knownNames = [] }: Props) {
  const uid = useId();
  const [locations, setLocations] = useState<AssignmentLocations | null>(null);
  const [locationKey, setLocationKey] = useState("");
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<readonly AssignmentRecipient[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<AssignmentRecipient | null>(null);
  const [changing, setChanging] = useState(!value);
  const request = useRef(0);
  const contextKey = context ? JSON.stringify(context) : "";

  // Locations: once per question.
  useEffect(() => {
    if (!context || disabled) return;
    let live = true;
    setError(null);
    loadAssignmentLocations(context).then((next) => {
      if (!live) return;
      setLocations(next);
      const own = next.locations.find((location) => location.stores.some((store) => store.id === next.ownBranchId));
      const first = own ?? next.locations[0];
      if (first) {
        setLocationKey(first.id ?? "");
        setStoreId(own && next.ownBranchId ? next.ownBranchId : first.stores.length === 1 ? first.stores[0]!.id : "");
      }
    }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : "Unable to load locations."); });
    return () => { live = false; };
    // contextKey stands for context: the object is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, disabled]);

  // People: one store, debounced search, first page.
  useEffect(() => {
    if (!context || !storeId || !changing) { setRows([]); setHasMore(false); return; }
    const ticket = ++request.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchAssignmentRecipients(context, storeId, search.trim(), 0, PAGE_SIZE).then((page) => {
        if (ticket !== request.current) return;
        setRows(page.rows); setHasMore(page.hasMore); setError(null);
      }).catch((caught: unknown) => {
        if (ticket === request.current) setError(caught instanceof Error ? caught.message : "Unable to load employees.");
      }).finally(() => { if (ticket === request.current) setLoading(false); });
    }, search ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, storeId, search, changing]);

  const loadMore = async () => {
    if (!context || !storeId) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const page = await searchAssignmentRecipients(context, storeId, search.trim(), rows.length, PAGE_SIZE);
      if (ticket === request.current) { setRows((current) => [...current, ...page.rows]); setHasMore(page.hasMore); }
    } catch (caught) {
      if (ticket === request.current) setError(caught instanceof Error ? caught.message : "Unable to load employees.");
    } finally { if (ticket === request.current) setLoading(false); }
  };

  if (!context) return <Notice>Choosing employees from other locations works once the form is published.</Notice>;

  const location = locations?.locations.find((item) => (item.id ?? "") === locationKey) ?? null;
  const selectedName = picked?.id === value ? picked.name : knownNames.find((item) => item.id === value)?.label ?? null;
  const selectedPlace = picked?.id === value ? [picked.franchiseName, picked.storeName].filter(Boolean).join(" · ") : null;

  if (value && !changing) {
    return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-task-border bg-task-surface px-3 py-2" ref={registerRef} tabIndex={-1}>
      <div className="min-w-0"><p className="truncate font-medium text-task-text">{selectedName ?? "Employee selected"}</p>{selectedPlace ? <p className="text-xs text-task-text-muted">{selectedPlace}</p> : null}</div>
      {disabled ? null : <Button onClick={() => setChanging(true)} type="button" variant="secondary">Change</Button>}
    </div>;
  }

  const listId = `${uid}-people`;
  return <div aria-describedby={describedBy} aria-labelledby={labelledBy} className="space-y-3" ref={registerRef} role="group" tabIndex={-1}>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {!locations ? (error ? null : <p className="text-sm text-task-text-muted">Loading locations…</p>) : locations.locations.length === 0 ? <p className="text-sm text-task-text-muted">No locations are available.</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="mb-1 block text-task-text-muted">Location</span>
          <select className="field" disabled={disabled} onChange={(event) => {
            const next = locations.locations.find((item) => (item.id ?? "") === event.target.value);
            setLocationKey(event.target.value); setStoreId(next?.stores.length === 1 ? next.stores[0]!.id : ""); setSearch(""); setRows([]);
            if (value) onChange("");
          }} value={locationKey}>
            {locations.locations.map((item) => <option key={item.id ?? "unmapped"} value={item.id ?? ""}>{item.name}</option>)}
          </select>
        </label>
        <label className="block text-sm"><span className="mb-1 block text-task-text-muted">Store</span>
          <select className="field" disabled={disabled || !location} onChange={(event) => { setStoreId(event.target.value); setSearch(""); setRows([]); if (value) onChange(""); }} value={storeId}>
            <option value="">Choose a store…</option>
            {location?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
      </div>
      {storeId ? <>
        <label className="relative block"><span className="sr-only">Search employees</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-task-text-muted" />
          <input aria-controls={listId} className="field pl-9" disabled={disabled} maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" type="search" value={search} />
        </label>
        <ul aria-busy={loading} aria-label="Employees" className="divide-y divide-task-border overflow-hidden rounded-xl border border-task-border" id={listId}>
          {rows.map((person) => <li key={person.id}>
            <button aria-pressed={person.id === value} className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-task-surface focus-visible:bg-task-surface", person.id === value && "bg-task-surface")} disabled={disabled}
              onClick={() => { setPicked(person); onChange(person.id); onPick?.(person); setChanging(false); }} type="button">
              <span className="min-w-0"><span className="block truncate font-medium text-task-text">{person.name}</span>{person.designation ? <span className="block text-xs text-task-text-muted">{person.designation}</span> : null}</span>
              <span className="shrink-0 text-xs text-task-text-muted">{person.storeName}</span>
            </button>
          </li>)}
          {!loading && rows.length === 0 ? <li className="px-3 py-3 text-sm text-task-text-muted">{search ? "No employee matches this search." : "No eligible employees in this store."}</li> : null}
          {loading ? <li className="px-3 py-3 text-sm text-task-text-muted">Loading…</li> : null}
        </ul>
        {hasMore && !loading ? <Button onClick={() => void loadMore()} type="button" variant="secondary">Show more</Button> : null}
      </> : null}
      {value ? <Button onClick={() => setChanging(false)} type="button" variant="ghost">Keep current choice</Button> : null}
    </>}
  </div>;
}
