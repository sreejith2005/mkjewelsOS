import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useFillViewport } from "@/lib/useFillViewport";
import { ArrowLeft, Eye, EyeOff, FileText, ListFilter, Pencil, Plus, Search } from "lucide-react";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { errorMessage, titleCase } from "@/lib/format";
import type { DropdownMaster } from "@/types";
import { invalidateMasterOptions, loadDropdownListInsights, loadDropdownMasterRows, type DropdownListInsights, type DropdownListOrigin } from "@/features/dropdowns/api";
import { dropdownMasterCounts, dropdownMasterKey, filterDropdownMasterItems, hasPermission, isDropdownMasterItemActive } from "@jewelos/core";

const REQUIRED_EMPTY_CATEGORIES = ["designation", "week_off", "resignation_reason", "task_category", "task_priority", "crm_source", "client_type", "potential_category", "product_category", "buy_status", "not_bought_reason", "communication_preference"] as const;
const EMPTY_INSIGHTS: DropdownListInsights = { madeInForms: new Map(), builtIn: new Set(), usedBy: new Map(), complete: true };

const ORIGIN_LABEL: Record<DropdownListOrigin, string> = { master: "Made in Dropdown Master", form: "Made in a form", built_in: "Built-in" };
const ORIGIN_FILTERS: { value: DropdownListOrigin | "all"; label: string }[] = [
  { value: "all", label: "All lists" }, { value: "master", label: "Made here" }, { value: "form", label: "Made in forms" }, { value: "built_in", label: "Built-in" },
];

type DropdownDraft = {
  master_type: string;
  label: string;
  value: string;
  sort_order: number;
  is_active: boolean;
};

/** One list's summary on the overview. */
type ListSummary = Readonly<{ key: string; total: number; active: number; origin: DropdownListOrigin; createdAt: string | null; forms: number; matches: readonly string[] }>;

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const formatDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

/**
 * Where a list came from. "Made in a form" comes from the audit record the
 * form editor writes; built-in lists are the system categories or rows the
 * app seeded (no author). Everything else was made on this page.
 */
function listOrigin(key: string, rows: readonly DropdownMaster[], insights: DropdownListInsights): DropdownListOrigin {
  if (insights.madeInForms.has(key)) return "form";
  if (insights.builtIn.has(key) || (REQUIRED_EMPTY_CATEGORIES as readonly string[]).includes(key) || (rows.length > 0 && rows.every((row) => !row.created_by))) return "built_in";
  return "master";
}

function DropdownEditor({ item, category, existingLists, onClose, onSaved }: { item: DropdownMaster | null; category: string | null; existingLists: readonly string[]; onClose: () => void; onSaved: (list: string) => Promise<void> }) {
  const newList = !item && category === null;
  const [draft, setDraft] = useState<DropdownDraft>(() => ({
    master_type: item?.master_type ?? category ?? "",
    label: item?.label ?? "",
    value: item?.value ?? "",
    sort_order: item?.sort_order ?? 0,
    is_active: item?.is_active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // List keys share one format with lists made in the form editor, so a list
  // typed here as "Lead Source" is the same list a form finds as lead_source.
  const listKey = item || !newList ? draft.master_type : dropdownMasterKey(draft.master_type);
  const listExists = newList && !!listKey && existingLists.includes(listKey);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.value.trim() || slugify(draft.label);
    if (!listKey.trim() || !draft.label.trim() || !value) return setError("List, label, and value are required.");
    setSaving(true); setError(null);
    try {
      const { error: saveError } = await supabase.rpc("change_dropdown_with_audit", {
        p_operation: item ? "update" : "create", ...(item?.id ? { p_record_id: item.id } : {}), p_master_type: listKey.trim(), p_label: draft.label.trim(), p_value: value, p_sort_order: draft.sort_order, p_is_active: draft.is_active,
      });
      if (saveError) setError(saveError.message); else { invalidateMasterOptions(); await onSaved(listKey.trim()); onClose(); }
    } catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose} title={item ? "Edit dropdown item" : newList ? "New list" : `Add item to ${titleCase(draft.master_type)}`}>
      <form className="space-y-4" onSubmit={submit}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {newList ? <>
          <Field label="List name"><input className="field" onChange={(e) => setDraft((value) => ({ ...value, master_type: e.target.value }))} placeholder="e.g. Lead Source" required value={draft.master_type} /></Field>
          {listExists ? <Notice>&ldquo;{titleCase(listKey)}&rdquo; already exists. This item will be added to it.</Notice> : null}
          <p className="text-xs text-soft-grey">Add the first item now. Open the list afterwards to add more.</p>
        </> : <p className="text-sm text-soft-grey">List: <span className="font-semibold text-champagne">{titleCase(draft.master_type)}</span></p>}
        <Field label="Label"><input className="field" onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value, value: item ? current.value : slugify(e.target.value) }))} required value={draft.label} /></Field>
        <Field label="Value"><input className="field font-mono" onChange={(e) => setDraft((value) => ({ ...value, value: e.target.value }))} required value={draft.value} /></Field>
        <Field label="Sort Order"><input className="field" onChange={(e) => setDraft((value) => ({ ...value, sort_order: Number(e.target.value) }))} type="number" value={draft.sort_order} /></Field>
        <label className="flex items-center gap-3 rounded-lg border border-gold/20 bg-obsidian p-3 text-sm text-champagne"><input checked={draft.is_active} onChange={(e) => setDraft((value) => ({ ...value, is_active: e.target.checked }))} type="checkbox" />Active</label>
        <div className="flex justify-end gap-3"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : "Save"}</Button></div>
      </form>
    </Modal>
  );
}

const originBadge = (origin: DropdownListOrigin) => <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${origin === "form" ? "bg-gold/15 text-gold-secondary" : origin === "built_in" ? "bg-soft-grey/10 text-soft-grey" : "bg-success/10 text-success"}`}>{ORIGIN_LABEL[origin]}</span>;

export function DropdownMasterPage() {
  const { access, profile } = useAuth();
  const [items, setItems] = useState<DropdownMaster[]>([]);
  const [insights, setInsights] = useState<DropdownListInsights>(EMPTY_INSIGHTS);
  // null = the overview of every list. "Open in Dropdown Master" in the form
  // builder links straight to one list with ?category=<list>.
  const [category, setCategoryState] = useState<string | null>(() => new URLSearchParams(window.location.search).get("category")?.trim() || null);
  const [editing, setEditing] = useState<DropdownMaster | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [originFilter, setOriginFilter] = useState<DropdownListOrigin | "all">("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");

  const setCategory = (next: string | null) => {
    setCategoryState(next); setSearch(""); setStatus("all");
    const params = new URLSearchParams(window.location.search);
    if (next) params.set("category", next); else params.delete("category");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rows, facts] = await Promise.all([loadDropdownMasterRows(), loadDropdownListInsights().catch(() => ({ ...EMPTY_INSIGHTS, complete: false }))]);
      setItems(rows); setInsights(facts);
    } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["organization", "settings"], refresh: load });

  const byList = useMemo(() => {
    const lists = new Map<string, DropdownMaster[]>(REQUIRED_EMPTY_CATEGORIES.map((key) => [key, []]));
    for (const item of items) lists.set(item.master_type, [...(lists.get(item.master_type) ?? []), item]);
    return lists;
  }, [items]);
  const listKeys = useMemo(() => [...byList.keys()].sort(), [byList]);

  const summaries = useMemo<ListSummary[]>(() => {
    const needle = listSearch.trim().toLowerCase();
    return listKeys.map((key) => {
      const rows = byList.get(key) ?? [];
      const createdAt = insights.madeInForms.get(key) || rows.reduce<string | null>((first, row) => !row.created_at ? first : !first || row.created_at < first ? row.created_at : first, null);
      const matches = needle && !`${key} ${titleCase(key)}`.toLowerCase().includes(needle)
        ? rows.filter((row) => `${row.label} ${row.value}`.toLowerCase().includes(needle)).map((row) => row.label) : [];
      return { key, total: rows.length, active: rows.filter(isDropdownMasterItemActive).length, origin: listOrigin(key, rows, insights), createdAt, forms: insights.usedBy.get(key)?.length ?? 0, matches };
    }).filter((list) => (originFilter === "all" || list.origin === originFilter)
      && (!needle || `${list.key} ${titleCase(list.key)}`.toLowerCase().includes(needle) || list.matches.length > 0));
  }, [byList, insights, listKeys, listSearch, originFilter]);

  const totals = useMemo(() => {
    const all = listKeys.map((key) => listOrigin(key, byList.get(key) ?? [], insights));
    return {
      lists: listKeys.length,
      options: items.length,
      madeHere: all.filter((origin) => origin === "master").length,
      madeInForms: all.filter((origin) => origin === "form").length,
      builtIn: all.filter((origin) => origin === "built_in").length,
      usedByForms: listKeys.filter((key) => insights.usedBy.has(key)).length,
    };
  }, [byList, insights, items.length, listKeys]);

  const categoryItems = useMemo(() => category ? filterDropdownMasterItems(items, category, status, search) as DropdownMaster[] : [], [category, items, search, status]);
  const counts = useMemo(() => dropdownMasterCounts(items, category ?? "", categoryItems), [categoryItems, category, items]);

  // Items are switched off rather than deleted: forms, tasks and saved
  // answers keep pointing at their stable value.
  const toggleActive = async (item: DropdownMaster) => {
    const turningOff = item.is_active !== false;
    if (turningOff && !window.confirm(`Turn off “${item.label}”? It stops appearing in forms and lists. Saved answers keep it, and you can turn it back on at any time.`)) return;
    try {
      const { error: changeError } = await supabase.rpc("change_dropdown_with_audit", {
        p_operation: "update", p_record_id: item.id, p_master_type: item.master_type,
        p_label: item.label, p_value: item.value, p_sort_order: item.sort_order ?? 0,
        p_is_active: !turningOff,
      });
      if (changeError) throw changeError;
      invalidateMasterOptions(); await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const wide = useMediaQuery("(min-width: 1280px)");
  const panes = useFillViewport<HTMLDivElement>({ enabled: wide, minHeight: 420 });
  /** "New list" starts a list even while another list is open. */
  const [newList, setNewList] = useState(false);
  if (!hasPermission(access, "dropdowns.manage")) {
    return <Notice tone="danger">Changing dropdown values requires the Dropdown Master permission. The database rejects writes from everyone else.</Notice>;
  }

  const currentRows = category ? byList.get(category) ?? [] : [];
  const currentOrigin = category ? listOrigin(category, currentRows, insights) : null;
  const currentForms = category ? insights.usedBy.get(category) ?? [] : [];

  const statLine = <p className="text-xs text-soft-grey tabular-nums">{[["lists", totals.lists], ["options", totals.options], ["made here", totals.madeHere], ["made in forms", totals.madeInForms], ["built-in", totals.builtIn], ["used by forms", totals.usedByForms]].map(([label, value]) => `${value} ${label}`).join(" · ")}</p>;
  const listTools = <div className="space-y-2">
    <label className="relative block"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-grey" /><input aria-label="Search lists and options" className="field pl-9" onChange={(event) => setListSearch(event.target.value)} placeholder="Search lists and options" type="search" value={listSearch} /></label>
    <div className="scroll-x no-scrollbar flex gap-1.5" role="group" aria-label="Filter lists by origin">{ORIGIN_FILTERS.map((filter) => <button aria-pressed={originFilter === filter.value} className={`min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium ${originFilter === filter.value ? "border-gold bg-gold/15 text-gold-secondary" : "border-task-border text-soft-grey hover:text-champagne"}`} key={filter.value} onClick={() => setOriginFilter(filter.value)} type="button">{filter.label}</button>)}</div>
    {!insights.complete ? <p className="text-xs text-soft-grey">Some details (where a list came from or which forms use it) could not be loaded. The lists themselves are complete.</p> : null}
  </div>;
  // One compact row per list; the open one is highlighted.
  const listRows = loading ? <p className="py-10 text-center text-gold-secondary">Loading dropdowns…</p> : summaries.length === 0 ? <p className="p-10 text-center text-soft-grey">No lists match.</p> : (
    <ul className="divide-y divide-task-border">{summaries.map((list) => <li key={list.key}>
      <button aria-current={category === list.key ? "true" : undefined} aria-label={`Open ${titleCase(list.key)}`} className={`relative flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold ${category === list.key ? "bg-gold/10 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gold" : ""}`} onClick={() => setCategory(list.key)} type="button">
        <span className="flex w-full items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold text-white">{titleCase(list.key)}</span>{originBadge(list.origin)}</span>
        <span className="text-xs text-soft-grey">{list.active} active{list.total > list.active ? ` · ${list.total - list.active} off` : ""}{list.forms ? ` · used in ${list.forms} form${list.forms === 1 ? "" : "s"}` : ""}{list.createdAt ? ` · created ${formatDate(list.createdAt)}` : ""}</span>
        {list.matches.length ? <span className="truncate text-xs text-gold-secondary">Matches: {list.matches.slice(0, 4).join(", ")}{list.matches.length > 4 ? "…" : ""}</span> : null}
      </button>
    </li>)}</ul>
  );
  const detailHead = category === null ? null : <div className="space-y-2 border-b border-task-border px-4 py-3">
    <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-champagne">{titleCase(category)}</h2>{currentOrigin ? originBadge(currentOrigin) : null}<Button className="min-h-10" onClick={() => { setNewList(false); setEditing(null); }}><Plus className="h-4 w-4" />Add item</Button></div>
    {currentForms.length ? <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-soft-grey">Used in forms</span>{currentForms.map((form) => <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2.5 py-0.5 text-xs text-champagne" key={form.formTemplateId} title={`Questions: ${form.questions.join(", ")}`}><FileText className="size-3" />{form.name}{form.lifecycle === "draft" ? " (draft)" : ""}</span>)}</div>
      : <p className="text-xs text-soft-grey">No form questions use this list yet. It may still be used by Tasks, Users, Leave or CRM.</p>}
    <div className="flex flex-wrap items-center gap-2"><label className="relative min-w-[12rem] flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-grey" /><input aria-label="Search this list" className="field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search label or code" type="search" value={search} /></label><select aria-label="Status" className="field w-auto" onChange={(event) => setStatus(event.target.value as typeof status)} value={status}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select><span className="text-xs text-soft-grey tabular-nums">{counts.total} total · <span className="text-success">{counts.active} active</span> · {counts.inactive} inactive</span></div>
  </div>;
  // Options as compact rows: order, label and code, status, then Edit and on/off in one place.
  const optionRows = category === null ? null : loading ? <p className="py-10 text-center text-gold-secondary">Loading dropdowns…</p> : categoryItems.length === 0 ? <p className="p-10 text-center text-soft-grey">No items in {titleCase(category)} yet.</p> : (
    <ul className="divide-y divide-task-border">{categoryItems.map((item) => <li className={`flex items-center gap-3 px-4 py-2 ${item.is_active === false ? "opacity-60" : ""}`} key={item.id}>
      <span className="w-8 shrink-0 text-center text-xs font-semibold text-gold-secondary tabular-nums">{item.sort_order ?? 0}</span>
      <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold text-white">{item.label}</h3><p className="truncate font-mono text-xs text-soft-grey">{item.value}</p></div>
      <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] uppercase ${item.is_active === false ? "bg-soft-grey/10 text-soft-grey" : "bg-success/10 text-success"}`}>{item.is_active === false ? "Inactive" : "Active"}</span>
      <div className="flex shrink-0 gap-1"><Button aria-label={`Edit ${item.label}`} className="size-10 min-h-10 p-0" onClick={() => setEditing(item)} variant="ghost"><Pencil className="h-4 w-4" /></Button>{item.is_active === false
        ? <Button aria-label={`Turn on ${item.label}`} className="size-10 min-h-10 p-0" onClick={() => void toggleActive(item)} variant="ghost"><Eye className="h-4 w-4" /></Button>
        : <Button aria-label={`Turn off ${item.label}`} className="size-10 min-h-10 p-0" onClick={() => void toggleActive(item)} variant="ghost"><EyeOff className="h-4 w-4 text-danger" /></Button>}</div>
    </li>)}</ul>
  );

  return (
    <section className="w-full">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-gold-sheen p-2 text-on-gold shadow-gold"><ListFilter className="h-5 w-5" /></span><div className="min-w-0"><h1 className="font-display text-[1.6rem] font-semibold leading-tight text-gold-secondary sm:text-[1.85rem]">Dropdown Master</h1>{statLine}</div></div>
        {wide || category === null ? <Button className="w-full sm:w-auto" onClick={() => { setNewList(true); setEditing(null); }}><Plus className="h-4 w-4" />New list</Button> : null}
      </header>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice><Button className="mt-3" onClick={() => void load()} variant="secondary">Retry</Button></div> : null}

      {/* Wide screens: two panes that fill the window and scroll on their own, so switching lists never means scrolling back up. */}
      {wide ? <div className="-mx-4 grid grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] border-y border-task-border bg-task-bg sm:-mx-6" ref={panes.ref} style={panes.style}>
        <div className="flex min-h-0 flex-col border-r border-task-border">
          <div className="border-b border-task-border p-3">{listTools}</div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{listRows}</div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">{category === null ? <p className="m-auto p-10 text-center text-soft-grey">Select a list to see and edit its options.</p> : <>
          {detailHead}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{optionRows}</div>
        </>}</div>
      </div> : category === null ? <div className="-mx-4 border-y border-task-border bg-task-bg sm:-mx-6">
        <div className="border-b border-task-border p-3">{listTools}</div>
        {listRows}
      </div> : <div className="-mx-4 border-y border-task-border bg-task-bg sm:-mx-6">
        <div className="px-2 pt-2"><Button className="min-h-10 px-2" onClick={() => setCategory(null)} variant="ghost"><ArrowLeft className="h-4 w-4" />All lists</Button></div>
        {detailHead}
        {optionRows}
      </div>}
      {editing !== undefined ? <DropdownEditor category={newList ? null : category} existingLists={listKeys} item={editing} onClose={() => setEditing(undefined)} onSaved={async (list) => { await load(); if (newList || !category) setCategory(list); }} /> : null}
    </section>
  );
}
