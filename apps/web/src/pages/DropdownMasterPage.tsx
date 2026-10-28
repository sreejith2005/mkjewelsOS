import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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

  if (!hasPermission(access, "dropdowns.manage")) {
    return <Notice tone="danger">Changing dropdown values requires the Dropdown Master permission. The database rejects writes from everyone else.</Notice>;
  }

  const currentRows = category ? byList.get(category) ?? [] : [];
  const currentOrigin = category ? listOrigin(category, currentRows, insights) : null;
  const currentForms = category ? insights.usedBy.get(category) ?? [] : [];

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-gold-sheen p-2.5 text-on-gold shadow-gold"><ListFilter className="h-5 w-5" /></span><div><h1 className="font-display text-[1.85rem] font-semibold leading-tight sm:text-[2.1rem] text-gold-secondary">Dropdown Master</h1><p className="text-sm text-soft-grey">One shared set of lists for Forms, FMS, Tasks, Users and CRM</p></div></div>
        <Button className="w-full sm:w-auto" onClick={() => setEditing(null)}><Plus className="h-4 w-4" />{category ? "Add item" : "New list"}</Button>
      </header>
      {error ? <div className="mb-5"><Notice tone="danger">{error}</Notice><Button className="mt-3" onClick={() => void load()} variant="secondary">Retry</Button></div> : null}

      {category === null ? <>
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[["Lists", totals.lists], ["Options", totals.options], ["Made here", totals.madeHere], ["Made in forms", totals.madeInForms], ["Built-in", totals.builtIn], ["Used by forms", totals.usedByForms]].map(([label, value]) => <div className="rounded-lg border border-gold/20 bg-obsidian px-4 py-3" key={label}><p className="text-xl font-bold text-gold-secondary">{value}</p><p className="text-xs text-soft-grey">{label}</p></div>)}
        </div>
        <div className="glass-card mb-5 space-y-3 rounded-xl p-4">
          <label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-soft-grey" /><input aria-label="Search lists and options" className="field pl-9" onChange={(event) => setListSearch(event.target.value)} placeholder="Search lists and options" value={listSearch} /></label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter lists by origin">{ORIGIN_FILTERS.map((filter) => <button aria-pressed={originFilter === filter.value} className={`min-h-10 rounded-full border px-3 text-sm ${originFilter === filter.value ? "border-gold bg-gold/15 text-gold-secondary" : "border-gold/20 text-soft-grey hover:text-champagne"}`} key={filter.value} onClick={() => setOriginFilter(filter.value)} type="button">{filter.label}</button>)}</div>
          {!insights.complete ? <p className="text-xs text-soft-grey">Some details (where a list came from or which forms use it) could not be loaded. The lists themselves are complete.</p> : null}
        </div>
        {loading ? <p className="py-10 text-center text-gold-secondary">Loading dropdowns…</p> : summaries.length === 0 ? <div className="glass-card rounded-xl p-10 text-center text-soft-grey">No lists match.</div> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{summaries.map((list) => <li key={list.key}>
            <button aria-label={`Open ${titleCase(list.key)}`} className="glass-card flex h-full w-full flex-col gap-2 rounded-xl p-4 text-left transition hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" onClick={() => setCategory(list.key)} type="button">
              <div className="flex w-full items-start justify-between gap-2"><h2 className="min-w-0 break-words font-semibold text-white">{titleCase(list.key)}</h2>{originBadge(list.origin)}</div>
              <p className="text-sm text-soft-grey">{list.active} active{list.total > list.active ? ` · ${list.total - list.active} off` : ""}{list.forms ? ` · used in ${list.forms} form${list.forms === 1 ? "" : "s"}` : ""}</p>
              {list.createdAt ? <p className="text-xs text-soft-grey">Created {formatDate(list.createdAt)}</p> : null}
              {list.matches.length ? <p className="truncate text-xs text-gold-secondary">Matches: {list.matches.slice(0, 4).join(", ")}{list.matches.length > 4 ? "…" : ""}</p> : null}
            </button>
          </li>)}</ul>
        )}
      </> : <>
        <Button className="mb-4" onClick={() => setCategory(null)} variant="secondary"><ArrowLeft className="h-4 w-4" />All lists</Button>
        <div className="glass-card mb-5 rounded-xl p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-semibold text-champagne">{titleCase(category)}</h2>{currentOrigin ? originBadge(currentOrigin) : null}</div>
          {currentForms.length ? <div className="mb-3"><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-soft-grey">Used in forms</p><ul className="flex flex-wrap gap-1.5">{currentForms.map((form) => <li className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2.5 py-1 text-xs text-champagne" key={form.formTemplateId} title={`Questions: ${form.questions.join(", ")}`}><FileText className="size-3" />{form.name}{form.lifecycle === "draft" ? " (draft)" : ""}</li>)}</ul></div>
            : <p className="mb-3 text-xs text-soft-grey">No form questions use this list yet. It may still be used by Tasks, Users, Leave or CRM.</p>}
          <div className="mb-3 grid gap-3 sm:grid-cols-2"><label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-soft-grey" /><input aria-label="Search this list" className="field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search label or code" value={search} /></label><select aria-label="Status" className="field" onChange={(event) => setStatus(event.target.value as typeof status)} value={status}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-3"><div className="rounded-lg border border-gold/20 bg-obsidian px-4 py-3"><p className="text-xl font-bold text-gold-secondary">{counts.total}</p><p className="text-xs text-soft-grey">Total</p></div><div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3"><p className="text-xl font-bold text-success">{counts.active}</p><p className="text-xs text-soft-grey">Active</p></div><div className="rounded-lg border border-soft-grey/20 px-4 py-3"><p className="text-xl font-bold text-soft-grey">{counts.inactive}</p><p className="text-xs text-soft-grey">Inactive</p></div></div>
        </div>
        {loading ? <p className="py-10 text-center text-gold-secondary">Loading dropdowns…</p> : categoryItems.length === 0 ? <div className="glass-card rounded-xl p-10 text-center text-soft-grey">No items in {titleCase(category)} yet.</div> : (
          <div className="space-y-3">{categoryItems.map((item) => <article className={`glass-card flex flex-wrap items-center gap-3 rounded-xl p-4 sm:flex-nowrap sm:gap-4 ${item.is_active === false ? "opacity-50" : ""}`} key={item.id}><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-sm font-bold text-gold-secondary">{item.sort_order ?? 0}</span><div className="min-w-0 flex-1"><h3 className="break-words font-semibold text-white">{item.label}</h3><p className="truncate font-mono text-xs text-soft-grey">{item.value}</p></div><span className={`shrink-0 rounded px-2 py-1 text-[10px] uppercase ${item.is_active === false ? "bg-soft-grey/10 text-soft-grey" : "bg-success/10 text-success"}`}>{item.is_active === false ? "Inactive" : "Active"}</span><div className="ml-auto flex shrink-0 gap-2"><Button aria-label={`Edit ${item.label}`} className="size-11 min-h-11 p-0" onClick={() => setEditing(item)} variant="secondary"><Pencil className="h-4 w-4" /></Button>{item.is_active === false
            ? <Button aria-label={`Turn on ${item.label}`} className="size-11 min-h-11 p-0" onClick={() => void toggleActive(item)} variant="secondary"><Eye className="h-4 w-4" /></Button>
            : <Button aria-label={`Turn off ${item.label}`} className="size-11 min-h-11 p-0" onClick={() => void toggleActive(item)} variant="danger"><EyeOff className="h-4 w-4" /></Button>}</div></article>)}</div>
        )}
      </>}
      {editing !== undefined ? <DropdownEditor category={category} existingLists={listKeys} item={editing} onClose={() => setEditing(undefined)} onSaved={async (list) => { await load(); if (!category) setCategory(list); }} /> : null}
    </section>
  );
}
