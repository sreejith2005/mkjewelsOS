import { useState } from "react";
import { Database, ExternalLink, Plus } from "lucide-react";
import type { FormFieldDefinition, FormOption } from "@jewelos/core";
import { dropdownMasterKey } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import { createMasterList, type MasterOption } from "@/features/dropdowns/api";
import { titleCase } from "@/lib/format";
import { OptionListEditor } from "./OptionListEditor";

/** Where a Dropdown Master list is edited. Opens in a new tab so the form being built is kept. */
export const dropdownMasterListPath = (masterType: string) => `/dropdown-master?category=${encodeURIComponent(masterType)}`;

/**
 * A dropdown either owns its options or references a Dropdown Master list.
 * Referencing stores only `{kind:"master",masterType}` so the master stays the
 * single source of truth — the options are never copied into the form.
 *
 * "Also add this dropdown to Dropdown Master" is remembered by the builder
 * (`pendingName`), so the list is created when the form is saved even if the
 * author never presses "Add now".
 */
export function DropdownSourceEditor({ field, index, masterOptions, onPatch, onMasterCreated, pendingName, onPendingNameChange }: {
  field: FormFieldDefinition;
  index: number;
  masterOptions: MasterOption[];
  onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void;
  onMasterCreated: () => Promise<void>;
  pendingName?: string | undefined;
  onPendingNameChange?: ((name: string | undefined) => void) | undefined;
}) {
  const usingMaster = !!field.optionSource;
  const checkbox = field.type === "checkbox";
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const categories = [...new Set(masterOptions.map((item) => item.master_type))].sort();
  const referenced = masterOptions.filter((item) => item.master_type === field.optionSource?.masterType);
  const options = field.options ?? [];
  const addToMaster = pendingName !== undefined;
  const pendingKey = dropdownMasterKey(pendingName ?? "");
  const nameTaken = addToMaster && !!pendingKey && categories.includes(pendingKey);

  const publish = async () => {
    if (!pendingKey) { setPublishError("Give the new Dropdown Master list a name."); return; }
    if (!options.length) { setPublishError("Add at least one option first."); return; }
    setPublishing(true); setPublishError(null);
    try {
      const masterType = await createMasterList(pendingKey, options.map((option) => ({ value: option.value, label: option.label })));
      await onMasterCreated();
      // The field now references the master instead of holding its own copy.
      onPatch(index, { optionSource: { kind: "master", masterType }, options: undefined });
      onPendingNameChange?.(undefined);
      setAdded(masterType);
    } catch (caught) { setPublishError(caught instanceof Error ? caught.message : "Could not add this list to Dropdown Master."); } finally { setPublishing(false); }
  };

  return <div className="space-y-3 rounded-lg border border-gold/15 bg-obsidian/40 p-3 sm:col-span-2">
    <span className="label mb-0">{checkbox ? "Answer choices" : "Dropdown options"}</span>
    <div className="flex flex-wrap gap-4">
      <label className="text-sm text-champagne"><input checked={!usingMaster} name={`source-${field.key}`} onChange={() => onPatch(index, { optionSource: undefined, options: options as readonly FormOption[] })} type="radio" /> {checkbox ? "Create answer choices" : "Create new dropdown"}</label>
      <label className="text-sm text-champagne"><input checked={usingMaster} name={`source-${field.key}`} onChange={() => { onPendingNameChange?.(undefined); onPatch(index, { optionSource: { kind: "master", masterType: field.optionSource?.masterType ?? categories[0] ?? "" }, options: undefined }); }} type="radio" /> Use existing Dropdown Master</label>
    </div>

    {usingMaster ? <div className="space-y-2">
      {added && added === field.optionSource?.masterType ? <Notice tone="success">Added to Dropdown Master as &ldquo;{titleCase(added)}&rdquo;.</Notice> : null}
      <Field label="Dropdown Master list"><select className="field" onChange={(event) => onPatch(index, { optionSource: { kind: "master", masterType: event.target.value } })} value={field.optionSource?.masterType ?? ""}>
        <option disabled value="">Choose a list</option>
        {categories.map((category) => <option key={category} value={category}>{titleCase(category)}</option>)}
      </select></Field>
      {referenced.length ? <ul className="flex flex-wrap gap-1.5">{referenced.map((option) => <li className="rounded-full bg-gold/10 px-2.5 py-1 text-xs text-champagne" key={option.id}>{option.label}</li>)}</ul>
        : <Notice tone="danger">This list has no active options yet. Add them in Dropdown Master.</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-soft-grey"><Database className="size-3.5" />Options stay in sync with Dropdown Master.</p>
        {field.optionSource?.masterType ? <a className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-gold-secondary underline-offset-2 hover:underline" href={dropdownMasterListPath(field.optionSource.masterType)} rel="noopener" target="_blank"><ExternalLink className="size-3.5" />Open in Dropdown Master</a> : null}
      </div>
    </div> : <div className="space-y-3">
      <OptionListEditor onChange={(next) => onPatch(index, { options: next })} options={options} />
      <label className="flex items-center gap-2 text-sm text-champagne"><input checked={addToMaster} disabled={!options.length} onChange={(event) => { setPublishError(null); onPendingNameChange?.(event.target.checked ? titleCase(field.label.trim()) : undefined); }} type="checkbox" /> {checkbox ? "Also add these choices to Dropdown Master" : "Also add this dropdown to Dropdown Master"}</label>
      {addToMaster ? <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Dropdown Master list name"><input className="field" onChange={(event) => onPendingNameChange?.(event.target.value)} placeholder="e.g. Lead Source" value={pendingName ?? ""} /></Field>
          <Button className="min-h-10" disabled={publishing || !pendingKey || nameTaken} onClick={() => void publish()} type="button" variant="secondary"><Plus className="size-4" />{publishing ? "Adding…" : "Add now"}</Button>
        </div>
        {nameTaken ? <Notice tone="danger">A Dropdown Master list called &ldquo;{titleCase(pendingKey)}&rdquo; already exists. Choose &ldquo;Use existing Dropdown Master&rdquo; to use it, or give this list another name.</Notice>
          : <p className="text-xs text-soft-grey">The list is added to Dropdown Master when you save the form. Press &ldquo;Add now&rdquo; to add it straight away.</p>}
      </div> : null}
      {publishError ? <Notice tone="danger">{publishError}</Notice> : null}
    </div>}
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-gold/15 bg-charcoal/40 p-3 text-sm text-champagne">
      <input checked={field.validation?.allowOther === true} className="mt-0.5 size-5 shrink-0 accent-gold" onChange={(event) => onPatch(index, { validation: { ...(field.validation ?? {}), allowOther: event.target.checked ? true : undefined } })} type="checkbox" />
      <span><span className="font-semibold">Add an &ldquo;Other&rdquo; choice</span><span className="block text-xs text-soft-grey">People filling the form can pick Other and type their own answer.</span></span>
    </label>
  </div>;
}
