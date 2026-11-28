import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Columns3, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_DATA_PROBLEM_LABELS, CUSTOMER_FILTER_OPERATOR_LABELS, CUSTOMER_TABLE_MAX_COLUMNS, CUSTOMER_TABLE_PAGE_SIZE, customerCellText, customerFilterCount,
  customerFilterOperators, customerFilterValueKind, DEFAULT_CUSTOMER_TABLE_COLUMNS, EMPTY_CUSTOMER_TABLE_STATE, formatPhone,
  type CustomerDataProblem, type CustomerFilterCondition, type CustomerFilterGroup, type CustomerFilterOperator, type CustomerTableField, type CustomerTableState,
} from "@jewelos/core";
import { loadCustomerTable, loadCustomerTableFields, loadCustomerTableValues, type CustomerTablePage } from "./api";

const SEARCH_DEBOUNCE_MS = 350;

/** The table a person left is the one they come back to while the app is open (never stored). */
let remembered: { state: CustomerTableState; page: number } | null = null;
/** Test hook: forget the remembered table. */
export function resetCustomerTableState(): void { remembered = null; }

let nextId = 0;
const newId = () => `f${++nextId}`;

type Item = CustomerFilterCondition | CustomerFilterGroup;
const isGroup = (item: Item): item is CustomerFilterGroup => "items" in item;

/** Replace one node of the filter tree, by id. */
function updateTree(group: CustomerFilterGroup, id: string, change: (item: Item) => Item | null): CustomerFilterGroup {
  const items: Item[] = [];
  for (const item of group.items) {
    if (item.id === id) {
      const next = change(item);
      if (next) items.push(next);
    } else {
      items.push(isGroup(item) ? updateTree(item, id, change) : item);
    }
  }
  return { ...group, items };
}

/**
 * The customer table (/crm/master/table, migration 0454): any fields as
 * columns, a filter tree of groups and conditions, sort by a column, 50 rows
 * a page. Everything is checked again by public.customer_table.
 */
export function CustomerTableView({ onBack, onOpenClient }: { onBack: () => void; onOpenClient: (clientCode: string) => void }) {
  const [fields, setFields] = useState<CustomerTableField[] | null>(null);
  const [state, setState] = useState<CustomerTableState>(() => remembered?.state ?? EMPTY_CUSTOMER_TABLE_STATE);
  const [page, setPage] = useState(() => remembered?.page ?? 0);
  const [searchText, setSearchText] = useState(() => remembered?.state.query ?? "");
  const [result, setResult] = useState<CustomerTablePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"columns" | "filters" | null>(null);
  const request = useRef(0);

  useEffect(() => { remembered = { state, page }; }, [state, page]);
  useEffect(() => {
    let current = true;
    loadCustomerTableFields().then((value) => { if (current) setFields(value); }).catch((reason: unknown) => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchText !== state.query) { setState((value) => ({ ...value, query: searchText })); setPage(0); }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText, state.query]);
  useEffect(() => {
    const mine = ++request.current;
    setLoading(true);
    loadCustomerTable(state, page)
      .then((value) => { if (mine === request.current) { setResult(value); setError(null); } })
      .catch((reason: unknown) => { if (mine === request.current) setError(errorMessage(reason)); })
      .finally(() => { if (mine === request.current) setLoading(false); });
  }, [state, page]);

  const byKey = useMemo(() => new Map((fields ?? []).map((field) => [field.key, field])), [fields]);
  const change = (next: Partial<CustomerTableState>) => { setState((value) => ({ ...value, ...next })); setPage(0); };
  const sortBy = (key: string) => {
    const now = state.sort[0];
    change({ sort: [{ field: key, dir: now?.field === key && now.dir === "asc" ? "desc" : "asc" }] });
  };
  const total = result?.total ?? 0;
  const first = total === 0 ? 0 : page * CUSTOMER_TABLE_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * CUSTOMER_TABLE_PAGE_SIZE);
  const filterCount = customerFilterCount(state.filter);

  return (
    <section className="w-full">
      <Button className="-ml-2" onClick={onBack} variant="ghost"><ArrowLeft className="h-4 w-4" />Customer list</Button>
      <header className="mb-3 mt-1">
        <h1 className="font-display text-[1.9rem] font-semibold leading-tight text-task-text sm:text-[2.2rem]">Customer table</h1>
        <p className="text-sm text-task-text-muted">Choose any fields as columns and filter on any of them. Customers with data problems stay out unless you include them or filter on Data problems.</p>
      </header>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search customers</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-task-text-muted" />
          <input className="field pl-9" onChange={(event) => setSearchText(event.target.value)} placeholder="Search by name, phone or MKC code" value={searchText} />
        </label>
        <Button aria-expanded={panel === "columns"} onClick={() => setPanel(panel === "columns" ? null : "columns")} variant="secondary">
          <Columns3 className="h-4 w-4" />Columns ({state.columns.length})
        </Button>
        <Button aria-expanded={panel === "filters"} onClick={() => setPanel(panel === "filters" ? null : "filters")} variant="secondary">
          <SlidersHorizontal className="h-4 w-4" />Filters{filterCount ? ` (${filterCount})` : ""}
        </Button>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-task-border px-3 text-sm font-medium text-task-text">
          <input checked={state.includeDataProblems} className="h-5 w-5" onChange={(event) => change({ includeDataProblems: event.target.checked })} type="checkbox" />
          Include data problems
        </label>
        <Button onClick={() => { setSearchText(""); change({ ...EMPTY_CUSTOMER_TABLE_STATE }); }} variant="ghost">Reset</Button>
      </div>

      {panel === "columns" && fields ? (
        <ColumnPicker columns={state.columns} fields={fields} onChange={(columns) => change({ columns })} onClose={() => setPanel(null)} />
      ) : null}
      {panel === "filters" && fields ? (
        <div className="mb-3 rounded-2xl border border-task-border bg-task-bg p-3 shadow-card">
          <GroupEditor depth={0} fields={fields} franchise={state.franchise} group={state.filter} onChange={(filter) => change({ filter })} />
          <div className="mt-3 flex justify-end gap-2">
            {filterCount ? <Button onClick={() => change({ filter: { id: "root", match: "all", items: [] } })} variant="ghost">Clear filters</Button> : null}
            <Button onClick={() => setPanel(null)} variant="secondary">Done</Button>
          </div>
        </div>
      ) : null}

      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
      <p aria-live="polite" className="mb-2 text-sm text-task-text-muted">
        {loading && !result ? "Loading…" : total === 0 ? "No customers match." : `${first.toLocaleString("en-IN")}–${last.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
      </p>

      <div className={cn("overflow-x-auto rounded-2xl border border-task-border bg-task-bg shadow-card", loading && "opacity-70")}>
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <thead className="bg-obsidian/60">
            <tr>
              <th className="sticky left-0 z-10 border-b border-task-border bg-task-bg px-3 py-2 font-semibold text-task-text" scope="col">Code</th>
              {state.columns.map((key) => {
                const field = byKey.get(key);
                const sorted = state.sort[0]?.field === key ? state.sort[0].dir : null;
                return (
                  <th aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined} className="border-b border-task-border px-3 py-2 font-semibold text-task-text" key={key} scope="col">
                    {field?.sortable ? (
                      <button className="inline-flex items-center gap-1 hover:text-gold-secondary" onClick={() => sortBy(key)} type="button">
                        {field.label}{sorted === "asc" ? <ArrowUp aria-hidden className="h-3.5 w-3.5" /> : sorted === "desc" ? <ArrowDown aria-hidden className="h-3.5 w-3.5" /> : null}
                      </button>
                    ) : field?.label ?? key}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(result?.rows ?? []).map((row) => (
              <tr className="border-b border-task-border/60 last:border-0 hover:bg-gold/5" key={row.client_code}>
                <td className="sticky left-0 z-10 bg-task-bg px-3 py-2">
                  <button className="font-semibold text-gold-secondary underline underline-offset-2" onClick={() => onOpenClient(row.client_code)} type="button">{row.client_code}</button>
                </td>
                {state.columns.map((key) => {
                  const field = byKey.get(key);
                  const raw = row.values[key];
                  const text = key === "phone" && typeof raw === "string" ? formatPhone(raw)
                    : key === "data_problems" && Array.isArray(raw) ? raw.map((item) => CUSTOMER_DATA_PROBLEM_LABELS[String(item) as CustomerDataProblem] ?? String(item)).join(", ")
                    : customerCellText(field?.type, raw);
                  return <td className="max-w-[18rem] truncate px-3 py-2 text-task-text" key={key} title={text}>{text || <span className="text-task-text-muted">–</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > CUSTOMER_TABLE_PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button disabled={page === 0 || loading} onClick={() => setPage(page - 1)} variant="secondary"><ChevronLeft className="h-4 w-4" />Previous</Button>
          <span className="text-sm text-task-text-muted">Page {page + 1} of {Math.ceil(total / CUSTOMER_TABLE_PAGE_SIZE).toLocaleString("en-IN")}</span>
          <Button disabled={last >= total || loading} onClick={() => setPage(page + 1)} variant="secondary">Next<ChevronRight className="h-4 w-4" /></Button>
        </div>
      ) : null}
    </section>
  );
}

/** Which fields are columns, and their order. */
function ColumnPicker({ fields, columns, onChange, onClose }: {
  fields: readonly CustomerTableField[]; columns: readonly string[]; onChange: (columns: string[]) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const shown = fields.filter((field) => !query.trim() || field.label.toLowerCase().includes(query.trim().toLowerCase()));
  const cards = [...new Set(shown.map((field) => field.card))];
  const toggle = (key: string) => onChange(columns.includes(key) ? columns.filter((item) => item !== key) : [...columns, key].slice(0, CUSTOMER_TABLE_MAX_COLUMNS));
  const move = (index: number, by: number) => {
    const next = [...columns];
    const [item] = next.splice(index, 1);
    if (item !== undefined) next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
    onChange(next);
  };
  return (
    <div className="mb-3 grid gap-3 rounded-2xl border border-task-border bg-task-bg p-3 shadow-card md:grid-cols-2">
      <div className="min-w-0">
        <input aria-label="Find a field" className="field mb-2" onChange={(event) => setQuery(event.target.value)} placeholder="Find a field" value={query} />
        <div className="max-h-80 overflow-y-auto pr-1">
          {cards.map((card) => (
            <fieldset className="mb-2" key={card}>
              <legend className="text-xs font-semibold uppercase tracking-wide text-task-text-muted">{card}</legend>
              {shown.filter((field) => field.card === card).map((field) => (
                <label className="flex min-h-9 items-center gap-2 text-sm text-task-text" key={field.key}>
                  <input checked={columns.includes(field.key)} className="h-4 w-4" onChange={() => toggle(field.key)} type="checkbox" />{field.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-sm font-semibold text-task-text">Shown, in order ({columns.length})</p>
        <ol className="max-h-80 overflow-y-auto">
          {columns.map((key, index) => (
            <li className="flex min-h-9 items-center gap-1 text-sm text-task-text" key={key}>
              <span className="flex-1 truncate">{byKey.get(key)?.label ?? key}</span>
              <Button aria-label={`Move ${byKey.get(key)?.label ?? key} up`} disabled={index === 0} onClick={() => move(index, -1)} variant="ghost"><ArrowUp className="h-4 w-4" /></Button>
              <Button aria-label={`Move ${byKey.get(key)?.label ?? key} down`} disabled={index === columns.length - 1} onClick={() => move(index, 1)} variant="ghost"><ArrowDown className="h-4 w-4" /></Button>
              <Button aria-label={`Remove ${byKey.get(key)?.label ?? key}`} onClick={() => toggle(key)} variant="ghost"><X className="h-4 w-4" /></Button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => onChange([...DEFAULT_CUSTOMER_TABLE_COLUMNS])} variant="ghost">Default columns</Button>
          <Button onClick={onClose} variant="secondary">Done</Button>
        </div>
      </div>
    </div>
  );
}

/** A group of conditions joined by all/any; groups nest one level. */
function GroupEditor({ group, fields, franchise, depth, onChange }: {
  group: CustomerFilterGroup; fields: readonly CustomerTableField[]; franchise: string; depth: number; onChange: (group: CustomerFilterGroup) => void;
}) {
  const filterable = fields.filter((field) => field.filterable);
  const addCondition = () => {
    const field = filterable[0];
    if (!field) return;
    onChange({ ...group, items: [...group.items, { id: newId(), field: field.key, op: customerFilterOperators(field.type)[0] ?? "is_empty", value: null }] });
  };
  const addGroup = () => onChange({ ...group, items: [...group.items, { id: newId(), match: "any", items: [] }] });
  const replace = (id: string, next: Item | null) => onChange(updateTree(group, id, () => next));
  return (
    <div className={cn(depth > 0 && "rounded-xl border border-task-border p-2")}>
      <label className="mb-2 flex flex-wrap items-center gap-2 text-sm text-task-text">
        Show customers matching
        <select aria-label="Match" className="field w-auto" onChange={(event) => onChange({ ...group, match: event.target.value === "any" ? "any" : "all" })} value={group.match}>
          <option value="all">all of these</option>
          <option value="any">any of these</option>
        </select>
      </label>
      {group.items.length === 0 ? <p className="mb-2 text-sm text-task-text-muted">No conditions yet.</p> : null}
      <ul className="space-y-2">
        {group.items.map((item) => (
          <li key={item.id}>
            {isGroup(item)
              ? (
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1"><GroupEditor depth={depth + 1} fields={fields} franchise={franchise} group={item} onChange={(next) => replace(item.id, next)} /></div>
                  <Button aria-label="Remove group" onClick={() => replace(item.id, null)} variant="ghost"><X className="h-4 w-4" /></Button>
                </div>
              )
              : <ConditionEditor condition={item} fields={filterable} franchise={franchise} onChange={(next) => replace(item.id, next)} onRemove={() => replace(item.id, null)} />}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={addCondition} variant="secondary"><Plus className="h-4 w-4" />Add condition</Button>
        {depth === 0 ? <Button onClick={addGroup} variant="ghost"><Plus className="h-4 w-4" />Add group</Button> : null}
      </div>
    </div>
  );
}

function ConditionEditor({ condition, fields, franchise, onChange, onRemove }: {
  condition: CustomerFilterCondition; fields: readonly CustomerTableField[]; franchise: string;
  onChange: (condition: CustomerFilterCondition) => void; onRemove: () => void;
}) {
  const field = fields.find((item) => item.key === condition.field);
  const operators = field ? customerFilterOperators(field.type) : [];
  const kind = customerFilterValueKind(condition.op);
  const cards = [...new Set(fields.map((item) => item.card))];
  const setField = (key: string) => {
    const next = fields.find((item) => item.key === key);
    if (next) onChange({ ...condition, field: key, op: customerFilterOperators(next.type)[0] ?? "is_empty", value: null });
  };
  const range = Array.isArray(condition.value) ? condition.value : ["", ""];
  const dateLike = field?.type === "date" || field?.type === "datetime";
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(10rem,14rem)_minmax(9rem,12rem)_1fr_auto] sm:items-start">
      <select aria-label="Field" className="field" onChange={(event) => setField(event.target.value)} value={condition.field}>
        {cards.map((card) => (
          <optgroup key={card} label={card}>
            {fields.filter((item) => item.card === card).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </optgroup>
        ))}
      </select>
      <select aria-label="Condition" className="field" onChange={(event) => onChange({ ...condition, op: event.target.value as CustomerFilterOperator, value: null })} value={condition.op}>
        {/* The options are exactly the operators listed for this field type. */}
        {operators.map((op) => <option key={op} value={op}>{CUSTOMER_FILTER_OPERATOR_LABELS[op]}</option>)}
      </select>
      <div className="min-w-0">
        {kind === "values" && field ? <ValuesPicker field={field} franchise={franchise} onChange={(value) => onChange({ ...condition, value })} value={Array.isArray(condition.value) ? condition.value : []} /> : null}
        {kind === "text" ? <input aria-label="Text" className="field" onChange={(event) => onChange({ ...condition, value: event.target.value })} value={typeof condition.value === "string" ? condition.value : ""} /> : null}
        {kind === "number" || kind === "days" ? (
          <input aria-label={kind === "days" ? "Days" : "Number"} className="field" inputMode="numeric" min={0} onChange={(event) => onChange({ ...condition, value: event.target.value })} type="number" value={condition.value === null || Array.isArray(condition.value) ? "" : String(condition.value)} />
        ) : null}
        {kind === "date" ? <input aria-label="Date" className="field" onChange={(event) => onChange({ ...condition, value: event.target.value })} type="date" value={typeof condition.value === "string" ? condition.value : ""} /> : null}
        {kind === "range" ? (
          <div className="flex items-center gap-2">
            <input aria-label="From" className="field" onChange={(event) => onChange({ ...condition, value: [event.target.value, String(range[1] ?? "")] })} type={dateLike ? "date" : "number"} value={String(range[0] ?? "")} />
            <span className="text-sm text-task-text-muted">and</span>
            <input aria-label="To" className="field" onChange={(event) => onChange({ ...condition, value: [String(range[0] ?? ""), event.target.value] })} type={dateLike ? "date" : "number"} value={String(range[1] ?? "")} />
          </div>
        ) : null}
      </div>
      <Button aria-label="Remove condition" onClick={onRemove} variant="ghost"><X className="h-4 w-4" /></Button>
    </div>
  );
}

/** Pick values of a text or list field from the values the data holds, most common first. */
function ValuesPicker({ field, franchise, value, onChange }: {
  field: CustomerTableField; franchise: string; value: readonly string[]; onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<{ value: string; count: number }[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      loadCustomerTableValues(field.key, query, franchise)
        .then((rows) => { if (current) { setOptions(rows); setFailure(null); } })
        .catch((reason: unknown) => { if (current) setFailure(errorMessage(reason)); });
    }, SEARCH_DEBOUNCE_MS);
    return () => { current = false; window.clearTimeout(timer); };
  }, [field.key, query, franchise]);
  const chosen = new Set(value);
  const toggle = (item: string) => onChange(chosen.has(item) ? value.filter((other) => other !== item) : [...value, item]);
  return (
    <div className="rounded-lg border border-task-border p-2">
      {value.length ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {value.map((item) => (
            <button aria-label={`Remove ${item}`} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-gold/50 bg-gold/10 pl-2 pr-1 text-xs font-medium text-task-text" key={item} onClick={() => toggle(item)} type="button">
              {item}<X aria-hidden className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      ) : null}
      <input aria-label={`Find a value of ${field.label}`} className="field mb-1" onChange={(event) => setQuery(event.target.value)} placeholder="Find a value" value={query} />
      {failure ? <p className="text-xs text-danger">{failure}</p> : null}
      <div className="max-h-48 overflow-y-auto">
        {(options ?? []).map((option) => (
          <label className="flex min-h-8 items-center gap-2 text-sm text-task-text" key={option.value}>
            <input checked={chosen.has(option.value)} className="h-4 w-4" onChange={() => toggle(option.value)} type="checkbox" />
            <span className="flex-1 truncate">{option.value}</span>
            <span className="text-xs text-task-text-muted">{option.count.toLocaleString("en-IN")}</span>
          </label>
        ))}
        {options && options.length === 0 ? <p className="text-xs text-task-text-muted">No values.</p> : null}
      </div>
    </div>
  );
}
