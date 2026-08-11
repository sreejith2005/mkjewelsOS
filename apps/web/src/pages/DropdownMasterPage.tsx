import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ListFilter, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { errorMessage, titleCase } from "@/lib/format";
import type { DropdownMaster } from "@/types";
import { invalidateMasterOptions } from "@/features/dropdowns/api";

const REQUIRED_EMPTY_CATEGORIES = ["designation", "week_off", "resignation_reason", "task_category", "task_priority", "crm_source", "client_type", "potential_category", "product_category", "buy_status", "not_bought_reason", "communication_preference"] as const;

type DropdownDraft = {
  master_type: string;
  label: string;
  value: string;
  sort_order: number;
  is_active: boolean;
};

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function DropdownEditor({ item, category, onClose, onSaved }: { item: DropdownMaster | null; category: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<DropdownDraft>(() => ({
    master_type: item?.master_type ?? category,
    label: item?.label ?? "",
    value: item?.value ?? "",
    sort_order: item?.sort_order ?? 0,
    is_active: item?.is_active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.value.trim() || slugify(draft.label);
    if (!draft.master_type.trim() || !draft.label.trim() || !value) return setError("Category, label, and value are required.");
    setSaving(true); setError(null);
    try {
      const { error: saveError } = await supabase.rpc("change_dropdown_with_audit", {
        p_operation: item ? "update" : "create", ...(item?.id ? { p_record_id: item.id } : {}), p_master_type: draft.master_type.trim(), p_label: draft.label.trim(), p_value: value, p_sort_order: draft.sort_order, p_is_active: draft.is_active,
      });
      if (saveError) setError(saveError.message); else { invalidateMasterOptions(); await onSaved(); onClose(); }
    } catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose} title={item ? "Edit dropdown item" : "Add dropdown item"}>
      <form className="space-y-4" onSubmit={submit}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="Category"><input className="field" onChange={(e) => setDraft((value) => ({ ...value, master_type: e.target.value }))} required value={draft.master_type} /></Field>
        <Field label="Label"><input className="field" onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value, value: item ? current.value : slugify(e.target.value) }))} required value={draft.label} /></Field>
        <Field label="Value"><input className="field font-mono" onChange={(e) => setDraft((value) => ({ ...value, value: e.target.value }))} required value={draft.value} /></Field>
        <Field label="Sort Order"><input className="field" onChange={(e) => setDraft((value) => ({ ...value, sort_order: Number(e.target.value) }))} type="number" value={draft.sort_order} /></Field>
        <label className="flex items-center gap-3 rounded-lg border border-gold/20 bg-obsidian p-3 text-sm text-champagne"><input checked={draft.is_active} onChange={(e) => setDraft((value) => ({ ...value, is_active: e.target.checked }))} type="checkbox" />Active</label>
        <div className="flex justify-end gap-3"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : "Save"}</Button></div>
      </form>
    </Modal>
  );
}

export function DropdownMasterPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<DropdownMaster[]>([]);
  const [category, setCategory] = useState("designation");
  const [editing, setEditing] = useState<DropdownMaster | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const { data, error: loadError } = await supabase.from("dropdown_masters").select("*").order("master_type").order("sort_order"); if (loadError) setError(loadError.message); else setItems(data ?? []); }
    catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => Array.from(new Set([...REQUIRED_EMPTY_CATEGORIES, ...items.map((item) => item.master_type)])).sort(), [items]);
  const categoryItems = useMemo(() => items.filter((item) => item.master_type === category && (status === "all" || (status === "active") === (item.is_active !== false)) && `${item.label} ${item.value} ${item.master_type}`.toLowerCase().includes(search.toLowerCase())), [category, items, search, status]);
  const activeCount = categoryItems.filter((item) => item.is_active !== false).length;

  const remove = async (item: DropdownMaster) => {
    if (!window.confirm(`Delete “${item.label}”? This cannot be undone.`)) return;
    try {
      const { error: deleteError } = await supabase.rpc("change_dropdown_with_audit", {
        p_operation: "update", p_record_id: item.id, p_master_type: item.master_type,
        p_label: item.label, p_value: item.value, p_sort_order: item.sort_order ?? 0,
        p_is_active: item.is_active === false,
      });
      if (deleteError) throw deleteError;
      invalidateMasterOptions(); await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (profile?.user_role !== "super_admin") {
    return <Notice tone="danger">Dropdown Master is restricted to super_admin users. Database RLS also rejects writes from every other role.</Notice>;
  }

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-gold p-2.5 text-obsidian"><ListFilter className="h-5 w-5" /></span><div><h1 className="font-display text-3xl text-gold">Dropdown Master</h1><p className="text-sm text-soft-grey">Manage real shared option lists</p></div></div>
        <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4" />Add item</Button>
      </header>
      {error ? <div className="mb-5"><Notice tone="danger">{error}</Notice><Button className="mt-3" onClick={() => void load()} variant="secondary">Retry</Button></div> : null}
      <div className="glass-card mb-5 rounded-xl p-4">
        <div className="mb-3 grid gap-3 sm:grid-cols-2"><label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-soft-grey" /><input className="field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search label, code, or category" value={search} /></label><select className="field" onChange={(event) => setStatus(event.target.value as typeof status)} value={status}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        <Field label="Category"><select className="field" onChange={(e) => setCategory(e.target.value)} value={category}>{categories.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></Field>
        <div className="mt-4 flex gap-3"><div className="rounded-lg border border-gold/20 bg-obsidian px-4 py-3"><p className="text-xl font-bold text-gold">{items.filter((item) => item.master_type === category).length}</p><p className="text-xs text-soft-grey">Total</p></div><div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3"><p className="text-xl font-bold text-success">{activeCount}</p><p className="text-xs text-soft-grey">Active</p></div><div className="rounded-lg border border-soft-grey/20 px-4 py-3"><p className="text-xl font-bold text-soft-grey">{items.filter((item) => item.master_type === category && item.is_active === false).length}</p><p className="text-xs text-soft-grey">Inactive</p></div></div>
      </div>
      {loading ? <p className="py-10 text-center text-gold">Loading dropdowns…</p> : categoryItems.length === 0 ? <div className="glass-card rounded-xl p-10 text-center text-soft-grey">No items in {titleCase(category)} yet.</div> : (
        <div className="space-y-3">{categoryItems.map((item) => <article className={`glass-card flex items-center gap-4 rounded-xl p-4 ${item.is_active === false ? "opacity-50" : ""}`} key={item.id}><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/10 text-sm font-bold text-gold">{item.sort_order ?? 0}</span><div className="min-w-0 flex-1"><h2 className="font-semibold text-white">{item.label}</h2><p className="truncate font-mono text-xs text-soft-grey">{item.value}</p></div><span className={`rounded px-2 py-1 text-[10px] uppercase ${item.is_active === false ? "bg-soft-grey/10 text-soft-grey" : "bg-success/10 text-success"}`}>{item.is_active === false ? "Inactive" : "Active"}</span><Button aria-label={`Edit ${item.label}`} className="h-9 w-9 p-0" onClick={() => setEditing(item)} variant="secondary"><Pencil className="h-4 w-4" /></Button><Button aria-label={`Delete ${item.label}`} className="h-9 w-9 p-0" onClick={() => void remove(item)} variant="danger"><Trash2 className="h-4 w-4" /></Button></article>)}</div>
      )}
      {editing !== undefined ? <DropdownEditor category={category} item={editing} onClose={() => setEditing(undefined)} onSaved={load} /> : null}
    </section>
  );
}
