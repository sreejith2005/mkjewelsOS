import { useState } from "react";
import { Database, Plus } from "lucide-react";
import type { FormFieldDefinition, FormOption } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import { createMasterList, type MasterOption } from "@/features/dropdowns/api";
import { titleCase } from "@/lib/format";
import { OptionListEditor } from "./OptionListEditor";

const masterKey = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([^a-z])/, "list_$1").slice(0, 60);

/**
 * A dropdown either owns its options or references a Dropdown Master list.
 * Referencing stores only `{kind:"master",masterType}` so the master stays the
 * single source of truth — the options are never copied into the form.
 */
export function DropdownSourceEditor({ field, index, masterOptions, onPatch, onMasterCreated }: { field: FormFieldDefinition; index: number; masterOptions: MasterOption[]; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void; onMasterCreated: () => Promise<void> }) {
  const usingMaster = !!field.optionSource;
  const [publishName, setPublishName] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [addToMaster, setAddToMaster] = useState(false);
  const categories = [...new Set(masterOptions.map((item) => item.master_type))].sort();
  const referenced = masterOptions.filter((item) => item.master_type === field.optionSource?.masterType);
  const options = field.options ?? [];

  const publish = async () => {
    const key = masterKey(publishName);
    if (!key) { setPublishError("Give the new Dropdown Master list a name."); return; }
    if (!options.length) { setPublishError("Add at least one option first."); return; }
    setPublishing(true); setPublishError(null);
    try {
      const masterType = await createMasterList(key, options.map((option) => ({ value: option.value, label: option.label })));
      await onMasterCreated();
      // The field now references the master instead of holding its own copy.
      onPatch(index, { optionSource: { kind: "master", masterType }, options: undefined });
      setAddToMaster(false); setPublishName("");
    } catch (caught) { setPublishError(caught instanceof Error ? caught.message : "Could not add this list to Dropdown Master."); } finally { setPublishing(false); }
  };

  return <div className="space-y-3 rounded-lg border border-gold/15 bg-obsidian/40 p-3 sm:col-span-2">
    <span className="label mb-0">Dropdown options</span>
    <div className="flex flex-wrap gap-4">
      <label className="text-sm text-champagne"><input checked={!usingMaster} name={`source-${field.key}`} onChange={() => onPatch(index, { optionSource: undefined, options: options as readonly FormOption[] })} type="radio" /> Create new dropdown</label>
      <label className="text-sm text-champagne"><input checked={usingMaster} name={`source-${field.key}`} onChange={() => onPatch(index, { optionSource: { kind: "master", masterType: field.optionSource?.masterType ?? categories[0] ?? "" }, options: undefined })} type="radio" /> Use existing Dropdown Master</label>
    </div>

    {usingMaster ? <div className="space-y-2">
      <Field label="Dropdown Master list"><select className="field" onChange={(event) => onPatch(index, { optionSource: { kind: "master", masterType: event.target.value } })} value={field.optionSource?.masterType ?? ""}>
        <option disabled value="">Choose a list</option>
        {categories.map((category) => <option key={category} value={category}>{titleCase(category)}</option>)}
      </select></Field>
      {referenced.length ? <ul className="flex flex-wrap gap-1.5">{referenced.map((option) => <li className="rounded-full bg-gold/10 px-2.5 py-1 text-xs text-champagne" key={option.id}>{option.label}</li>)}</ul>
        : <Notice tone="danger">This list has no active options yet. Add them in Dropdown Master.</Notice>}
      <p className="flex items-center gap-1.5 text-xs text-soft-grey"><Database className="size-3.5" />Options stay in sync with Dropdown Master.</p>
    </div> : <div className="space-y-3">
      <OptionListEditor onChange={(next) => onPatch(index, { options: next })} options={options} />
      <label className="flex items-center gap-2 text-sm text-champagne"><input checked={addToMaster} disabled={!options.length} onChange={(event) => { setAddToMaster(event.target.checked); setPublishError(null); }} type="checkbox" /> Also add this dropdown to Dropdown Master</label>
      {addToMaster ? <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Dropdown Master list name"><input className="field" onChange={(event) => setPublishName(event.target.value)} placeholder="e.g. Lead Source" value={publishName} /></Field>
        <Button className="min-h-10" disabled={publishing} onClick={() => void publish()} type="button" variant="secondary"><Plus className="size-4" />{publishing ? "Adding…" : "Add to Dropdown Master"}</Button>
      </div> : null}
      {publishError ? <Notice tone="danger">{publishError}</Notice> : null}
    </div>}
  </div>;
}
