import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, CheckSquare, ChevronDown, ChevronUp, CircleDot, Eye, FileUp, Hash, ListChecks, Mail, Minus, Pencil, Phone, Plus, Star, Trash2, Type } from "lucide-react";
import { FORM_SUBMIT_TARGET, normalizeFormDefinition, validateFormDefinition, type FormBranch, type FormFieldDefinition, type FormOption, type FormSectionDefinition, type FormTemplateDefinition, type Json, type UserRole } from "@jewelos/core";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { loadMasterOptions, toFormMasterOptions, type MasterOption } from "@/features/dropdowns/api";
import { saveDraft, savePublishedForm, type FormBundle } from "./api";
import { DropdownSourceEditor } from "./DropdownSourceEditor";
import { FormRenderer, type DynamicOptions } from "./FormRenderer";

const ROLES: UserRole[] = ["super_admin", "admin", "manager", "hr", "crm", "staff", "doer", "housekeeping"];
const OPTION_TYPES = new Set<FormFieldDefinition["type"]>(["select", "multiselect", "radio"]);
const BRANCH_TYPES = new Set<FormFieldDefinition["type"]>(["select", "radio"]);
const NUMBER_TYPES = new Set<FormFieldDefinition["type"]>(["number", "currency", "rating"]);
const TEXT_TYPES = new Set<FormFieldDefinition["type"]>(["text", "textarea"]);
// Text and Phone Number lead the palette; there is a single unified Text field.
const FIELD_KINDS = [
  { type: "text", label: "Text", icon: Type }, { type: "phone", label: "Phone Number", icon: Phone }, { type: "number", label: "Number", icon: Hash }, { type: "select", label: "Dropdown", icon: ChevronDown },
  { type: "date", label: "Date Picker", icon: CalendarDays }, { type: "checkbox", label: "Checkbox", icon: CheckSquare }, { type: "radio", label: "Radio Group", icon: CircleDot }, { type: "multiselect", label: "Multi-select", icon: ListChecks },
  { type: "email", label: "Email", icon: Mail }, { type: "currency", label: "Currency", icon: Banknote }, { type: "rating", label: "Rating", icon: Star }, { type: "file", label: "File Upload", icon: FileUp },
  { type: "section_header", label: "Heading", icon: Type }, { type: "divider", label: "Divider", icon: Minus },
] as const;
type FieldKind = (typeof FIELD_KINDS)[number];
// Legacy drafts may still hold a Long Text field; it keeps rendering and editing
// even though the palette now offers a single Text field.
const LEGACY_LABELS: Partial<Record<FormFieldDefinition["type"], string>> = { textarea: "Text (long)", datetime: "Date and time", user_dropdown: "User", branch_dropdown: "Branch", department_dropdown: "Department" };
const fieldLabel = (type: FormFieldDefinition["type"]) => FIELD_KINDS.find((item) => item.type === type)?.label ?? LEGACY_LABELS[type] ?? type.replaceAll("_", " ");
const fieldIcon = (type: FormFieldDefinition["type"]) => FIELD_KINDS.find((item) => item.type === type)?.icon ?? Type;
const DEFAULT_SECTION: FormSectionDefinition = { key: "section_1", title: "Section 1" };

const sectionKeyFor = (title: string, used: readonly string[]) => {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([^a-z])/, "s$1").slice(0, 60) || "section";
  let candidate = base;
  for (let suffix = 2; used.includes(candidate); suffix += 1) candidate = `${base}_${suffix}`;
  return candidate;
};
const newField = (type: FormFieldDefinition["type"], sortOrder: number, sectionKey: string): FormFieldDefinition => ({
  key: "field_" + (sortOrder + 1), label: fieldLabel(type), type, sortOrder, sectionKey, required: false, shown: true, editable: true,
  ...(OPTION_TYPES.has(type) ? { options: [] as readonly FormOption[] } : {}),
});
const initial = (bundle?: FormBundle): FormTemplateDefinition => ({
  name: bundle?.name ?? "", description: bundle?.description ?? "",
  sections: bundle?.sections?.length ? bundle.sections : [DEFAULT_SECTION],
  fields: (bundle?.fields ?? []).map((field) => ({ ...field, sectionKey: field.sectionKey ?? DEFAULT_SECTION.key })),
  permissions: { roles: ((bundle?.permissions as { roles?: UserRole[] } | null)?.roles) ?? ["staff"] },
});
const toDraftFields = (fields: readonly FormFieldDefinition[]) => fields.map(({ id: _id, sortOrder: _sortOrder, ...field }) => field);

export function FormBuilder({ bundle, dynamicOptions, onClose, onSaved }: { bundle?: FormBundle | undefined; dynamicOptions: DynamicOptions; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState(() => initial(bundle)); const [saving, setSaving] = useState(false); const [preview, setPreview] = useState(false); const [error, setError] = useState<string | null>(null); const [masterOptions, setMasterOptions] = useState<MasterOption[]>([]); const [editing, setEditing] = useState<number | null>(null);
  const [target, setTarget] = useState(DEFAULT_SECTION.key);
  const sections = form.sections?.length ? form.sections : [DEFAULT_SECTION];
  const baseline = useMemo(() => JSON.stringify(normalizeFormDefinition(initial(bundle))), [bundle]); const dirty = JSON.stringify(normalizeFormDefinition(form)) !== baseline; const issues = useMemo(() => validateFormDefinition(normalizeFormDefinition(form)), [form]);
  const refreshMasters = () => loadMasterOptions([], true).then(setMasterOptions).catch(() => setMasterOptions([]));
  useEffect(() => { void refreshMasters(); }, []);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const previewOptions = useMemo<DynamicOptions>(() => ({ ...dynamicOptions, masters: toFormMasterOptions(masterOptions) }), [dynamicOptions, masterOptions]);

  const reindex = (fields: readonly FormFieldDefinition[]) => fields.map((field, position) => ({ ...field, sortOrder: position }));
  const add = (type: FieldKind["type"]) => setForm((current) => {
    const sectionKey = sections.some((section) => section.key === target) ? target : sections[0]!.key;
    const fields = [...current.fields];
    const lastInSection = fields.map((field) => field.sectionKey).lastIndexOf(sectionKey);
    const insertAt = lastInSection === -1 ? fields.length : lastInSection + 1;
    fields.splice(insertAt, 0, newField(type, fields.length, sectionKey));
    setEditing(insertAt);
    return { ...current, fields: reindex(fields) };
  });
  const patchField = (index: number, patch: Partial<FormFieldDefinition>) => setForm((current) => ({
    ...current,
    fields: current.fields.map((field, position) => {
      if (position !== index) return field;
      const next = { ...field, ...patch };
      // Deleting an option must not leave a branch pointing at an answer that
      // no longer exists, and moving a question invalidates its old targets.
      if (!next.branches?.length) return next;
      const values = new Set((next.options ?? []).map((option) => option.value));
      const sectionIndex = sections.findIndex((section) => section.key === next.sectionKey);
      const branches = next.branches.filter((branch) =>
        (next.optionSource || typeof branch.value !== "string" || values.has(branch.value))
        && (branch.targetSectionKey === FORM_SUBMIT_TARGET || sections.findIndex((section) => section.key === branch.targetSectionKey) > sectionIndex));
      return { ...next, ...(branches.length ? { branches } : { branches: undefined }) };
    }),
  }));
  const move = (index: number, direction: number) => setForm((current) => {
    const next = [...current.fields]; const to = index + direction;
    if (to < 0 || to >= next.length || next[to]!.sectionKey !== next[index]!.sectionKey) return current;
    [next[index], next[to]] = [next[to]!, next[index]!]; setEditing(to);
    return { ...current, fields: reindex(next) };
  });
  const remove = (index: number) => setForm((current) => {
    setEditing((selected) => selected === index ? null : selected !== null && selected > index ? selected - 1 : selected);
    return { ...current, fields: reindex(current.fields.filter((_, position) => position !== index)) };
  });

  const patchSection = (key: string, patch: Partial<FormSectionDefinition>) => setForm((current) => ({ ...current, sections: (current.sections ?? []).map((section) => section.key === key ? { ...section, ...patch } : section) }));
  const addSection = () => setForm((current) => {
    const existing = current.sections ?? [DEFAULT_SECTION];
    const title = `Section ${existing.length + 1}`;
    return { ...current, sections: [...existing, { key: sectionKeyFor(title, existing.map((section) => section.key)), title }] };
  });
  const moveSection = (index: number, direction: number) => setForm((current) => {
    const next = [...(current.sections ?? [])]; const to = index + direction;
    if (to < 0 || to >= next.length) return current;
    [next[index], next[to]] = [next[to]!, next[index]!];
    return { ...current, sections: next, fields: reindex([...current.fields].sort((a, b) => next.findIndex((section) => section.key === a.sectionKey) - next.findIndex((section) => section.key === b.sectionKey))) };
  });
  const removeSection = (key: string) => setForm((current) => {
    const remaining = (current.sections ?? []).filter((section) => section.key !== key);
    if (!remaining.length) return current;
    const fallback = remaining[0]!.key;
    setEditing(null);
    if (target === key) setTarget(fallback);
    return {
      ...current,
      // Dropping a section also drops every branch and field that pointed at it.
      sections: remaining.map((section) => section.next === key ? { ...section, next: undefined } : section),
      fields: reindex(current.fields.filter((field) => field.sectionKey !== key).map((field) => field.branches?.some((branch) => branch.targetSectionKey === key)
        ? { ...field, branches: field.branches.filter((branch) => branch.targetSectionKey !== key) } : field)),
    };
  });

  const save = async () => {
    if (issues.length) { setError(issues[0]?.message ?? "Fix the highlighted form settings before saving."); return; }
    setSaving(true); setError(null);
    try {
      const normalized = normalizeFormDefinition(form);
      const payload = { name: normalized.name, description: normalized.description ?? "", sections: normalized.sections ?? [], permissions: { roles: normalized.permissions?.roles ?? [] } } as unknown as Json;
      const fields = toDraftFields(normalized.fields) as unknown as Json;
      if (bundle?.lifecycle === "published") await savePublishedForm(bundle.id, payload, fields); else await saveDraft(bundle?.id ?? null, payload, fields);
      await onSaved(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save the form."); } finally { setSaving(false); }
  };

  return <div className="space-y-5">{error ? <Notice tone="danger">{error}</Notice> : null}
    <section className="rounded-xl border border-gold/20 p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="Form name"><input className="field" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Customer Onboarding" value={form.name} /></Field><Field label="Description"><input className="field" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What is this form for?" value={form.description ?? ""} /></Field></div><details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-soft-grey">Who can use this form</summary><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{ROLES.map((role) => <label className="text-xs text-champagne" key={role}><input checked={form.permissions?.roles.includes(role) ?? false} onChange={(event) => setForm((current) => ({ ...current, permissions: { roles: event.target.checked ? [...new Set([...(current.permissions?.roles ?? []), role])] : (current.permissions?.roles ?? []).filter((value) => value !== role) } }))} type="checkbox" /> {role}</label>)}</div></details></section>

    <section aria-label="Sections"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-xl font-semibold text-gold">Sections</h3><Button onClick={addSection} type="button" variant="secondary"><Plus />Add section</Button></div>
      <p className="mb-2 text-xs text-soft-grey">A question can send the respondent to a later section. Only the sections the answers lead to are shown while filling the form.</p>
      <div className="space-y-2">{sections.map((section, index) => <article className="grid gap-2 rounded-xl border border-gold/20 bg-charcoal/30 p-3 sm:grid-cols-[1fr_1fr_auto]" key={section.key}>
        <Field label={`Section ${index + 1} title`}><input className="field" onChange={(event) => patchSection(section.key, { title: event.target.value })} value={section.title} /></Field>
        <Field label="After this section"><select className="field" onChange={(event) => patchSection(section.key, { next: event.target.value || undefined })} value={section.next ?? ""}>
          <option value="">Continue to the next section</option>
          {sections.slice(index + 1).map((option) => <option key={option.key} value={option.key}>Go to {option.title}</option>)}
          <option value={FORM_SUBMIT_TARGET}>Submit the form</option>
        </select></Field>
        <div className="flex items-end gap-1"><Button aria-label="Move section up" className="size-9 min-h-9 p-0" disabled={index === 0} onClick={() => moveSection(index, -1)} type="button" variant="ghost"><ChevronUp className="size-4" /></Button><Button aria-label="Move section down" className="size-9 min-h-9 p-0" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)} type="button" variant="ghost"><ChevronDown className="size-4" /></Button><Button aria-label={`Delete ${section.title}`} className="size-9 min-h-9 p-0" disabled={sections.length === 1} onClick={() => { if (window.confirm(`Delete "${section.title}" and its questions?`)) removeSection(section.key); }} type="button" variant="danger"><Trash2 className="size-4" /></Button></div>
      </article>)}</div>
    </section>

    <section aria-label="Add fields"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-gold text-obsidian"><Plus className="size-4" /></span><h3 className="text-xl font-semibold text-gold">Add fields</h3></div>
      {sections.length > 1 ? <label className="flex items-center gap-2 text-xs text-soft-grey">Add to<select aria-label="Add fields to section" className="field h-9 w-auto" onChange={(event) => setTarget(event.target.value)} value={target}>{sections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}</select></label> : null}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{FIELD_KINDS.map((kind) => <FieldPaletteButton key={kind.type} kind={kind} onAdd={add} />)}</div></section>

    <section aria-label="Fields"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ListChecks className="size-5 text-gold" /><h3 className="text-xl font-semibold text-gold">Fields</h3></div><span className="rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">{form.fields.length} added</span></div>
      {form.fields.length === 0 ? <Notice>Add a field above to begin your form.</Notice> : <div className="space-y-4">{sections.map((section) => <div key={section.key}>
        {sections.length > 1 ? <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-soft-grey">{section.title}</h4> : null}
        <div className="space-y-2">{form.fields.map((field, index) => ({ field, index })).filter((entry) => (entry.field.sectionKey ?? sections[0]!.key) === section.key).map(({ field, index }) => <CompactFieldRow editing={editing === index} field={field} index={index} key={field.key + "-" + index} masterOptions={masterOptions} onEdit={() => setEditing((current) => current === index ? null : index)} onMasterCreated={refreshMasters} onMove={move} onPatch={patchField} onRemove={remove} sections={sections} />)}</div>
        {form.fields.every((field) => (field.sectionKey ?? sections[0]!.key) !== section.key) ? <p className="text-xs text-soft-grey">No questions in this section yet.</p> : null}
      </div>)}</div>}</section>

    {issues.length ? <Notice tone="danger">{issues[0]?.message}</Notice> : null}
    <div className="flex flex-wrap justify-end gap-2 border-t border-gold/15 pt-4"><Button onClick={() => setPreview(true)} type="button" variant="secondary"><Eye />Preview</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : bundle?.lifecycle === "published" ? "Save changes" : "Save draft"}</Button><Button onClick={() => { if (!dirty || window.confirm("Discard unsaved form changes?")) onClose(); }} type="button" variant="ghost">Cancel</Button></div>
    {preview ? <Modal onClose={() => setPreview(false)} title="Form preview" wide><FormRenderer definition={normalizeFormDefinition(form)} dynamicOptions={previewOptions} preview /></Modal> : null}</div>;
}

function FieldPaletteButton({ kind, onAdd }: { kind: FieldKind; onAdd: (type: FieldKind["type"]) => void }) { const Icon = kind.icon; return <button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-gold/20 bg-charcoal/40 px-2 text-center text-sm font-semibold text-champagne transition hover:border-gold hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" onClick={() => onAdd(kind.type)} type="button"><span className="grid size-9 place-items-center rounded-full bg-gold/10 text-gold"><Icon className="size-5" /></span>{kind.label}</button>; }

function CompactFieldRow({ field, index, editing, masterOptions, sections, onEdit, onPatch, onMove, onRemove, onMasterCreated }: { field: FormFieldDefinition; index: number; editing: boolean; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onEdit: () => void; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void; onMove: (index: number, direction: number) => void; onRemove: (index: number) => void; onMasterCreated: () => Promise<void> }) {
  const Icon = fieldIcon(field.type);
  return <article className="overflow-hidden rounded-xl border border-gold/20 bg-charcoal/30"><div className="flex items-center gap-2 p-2 sm:p-3">
    <div className="flex flex-col"><button aria-label="Move field up" className="text-soft-grey hover:text-gold" onClick={() => onMove(index, -1)} type="button"><ChevronUp className="size-4" /></button><button aria-label="Move field down" className="text-soft-grey hover:text-gold" onClick={() => onMove(index, 1)} type="button"><ChevronDown className="size-4" /></button></div>
    <span className="grid size-8 place-items-center rounded-full bg-gold/10 text-gold"><Icon className="size-4" /></span>
    <button className="min-w-0 flex-1 text-left" onClick={onEdit} type="button"><span className="block truncate font-semibold text-champagne">{field.label || fieldLabel(field.type)}</span><span className="text-xs text-soft-grey">{fieldLabel(field.type)}{field.required ? " · required" : ""}{field.branches?.length ? ` · ${field.branches.length} branch${field.branches.length === 1 ? "" : "es"}` : ""}</span></button>
    <Button aria-label="Edit field" className="size-9 min-h-9 p-0" onClick={onEdit} type="button" variant="ghost"><Pencil className="size-4" /></Button>
    <Button aria-label="Remove field" className="size-9 min-h-9 p-0" onClick={() => onRemove(index)} type="button" variant="danger"><Trash2 className="size-4" /></Button>
  </div>{editing ? <FieldEditor field={field} index={index} masterOptions={masterOptions} onMasterCreated={onMasterCreated} onPatch={onPatch} sections={sections} /> : null}</article>;
}

function FieldEditor({ field, index, masterOptions, sections, onPatch, onMasterCreated }: { field: FormFieldDefinition; index: number; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void; onMasterCreated: () => Promise<void> }) {
  const validation = field.validation ?? {};
  const updateValidation = (key: "min" | "max" | "minLength" | "maxLength", raw: string) => onPatch(index, { validation: { ...validation, [key]: raw === "" ? undefined : Number(raw) } });
  return <div className="grid gap-3 border-t border-gold/15 p-3 sm:grid-cols-2">
    <Field label="Question"><input className="field" onChange={(event) => onPatch(index, { label: event.target.value })} value={field.label} /></Field>
    <Field label="Internal key"><input className="field" onChange={(event) => onPatch(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} value={field.key} /></Field>
    <Field label="Placeholder"><input className="field" onChange={(event) => onPatch(index, { placeholder: event.target.value })} value={field.placeholder ?? ""} /></Field>
    <Field label="Helper text"><input className="field" onChange={(event) => onPatch(index, { helperText: event.target.value })} value={field.helperText ?? ""} /></Field>
    {sections.length > 1 ? <Field label="Section"><select className="field" onChange={(event) => onPatch(index, { sectionKey: event.target.value })} value={field.sectionKey ?? sections[0]?.key ?? ""}>{sections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}</select></Field> : null}
    {OPTION_TYPES.has(field.type) ? <DropdownSourceEditor field={field} index={index} masterOptions={masterOptions} onMasterCreated={onMasterCreated} onPatch={onPatch} /> : null}
    {BRANCH_TYPES.has(field.type) ? <ConditionalLogicEditor field={field} index={index} masterOptions={masterOptions} onPatch={onPatch} sections={sections} /> : null}
    {NUMBER_TYPES.has(field.type) ? <><Field label="Minimum"><input className="field" onChange={(event) => updateValidation("min", event.target.value)} type="number" value={validation.min ?? ""} /></Field><Field label="Maximum"><input className="field" onChange={(event) => updateValidation("max", event.target.value)} type="number" value={validation.max ?? ""} /></Field></> : null}
    {TEXT_TYPES.has(field.type) ? <><Field label="Minimum length"><input className="field" onChange={(event) => updateValidation("minLength", event.target.value)} type="number" value={validation.minLength ?? ""} /></Field><Field label="Maximum length"><input className="field" onChange={(event) => updateValidation("maxLength", event.target.value)} type="number" value={validation.maxLength ?? ""} /></Field></> : null}
    <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
      <label className="text-sm text-champagne"><input checked={field.required === true} onChange={(event) => onPatch(index, { required: event.target.checked })} type="checkbox" /> Required</label>
      <label className="text-sm text-champagne"><input checked={field.shown !== false} onChange={(event) => onPatch(index, { shown: event.target.checked })} type="checkbox" /> Shown</label>
      <label className="text-sm text-champagne"><input checked={field.editable !== false} onChange={(event) => onPatch(index, { editable: event.target.checked })} type="checkbox" /> Editable</label>
    </div>
  </div>;
}

/** IF <this question> <operator> <answer> THEN go to <section>, as many times as needed. */
function ConditionalLogicEditor({ field, index, masterOptions, sections, onPatch }: { field: FormFieldDefinition; index: number; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void }) {
  const branches = field.branches ?? [];
  const options: readonly FormOption[] = field.optionSource
    ? masterOptions.filter((option) => option.master_type === field.optionSource?.masterType).map((option) => ({ value: option.value, label: option.label }))
    : field.options ?? [];
  const sectionIndex = sections.findIndex((section) => section.key === field.sectionKey);
  const laterSections = sections.slice(sectionIndex + 1);
  const setBranches = (next: readonly FormBranch[]) => onPatch(index, { branches: next.length ? next : undefined });
  const patchBranch = (position: number, patch: Partial<FormBranch>) => setBranches(branches.map((branch, item) => item === position ? { ...branch, ...patch } : branch));
  const enabled = branches.length > 0;
  const canBranch = laterSections.length > 0 && options.length > 0;
  return <div className="space-y-2 rounded-lg border border-gold/15 bg-obsidian/40 p-3 sm:col-span-2">
    <div className="flex items-center justify-between gap-2">
      <span className="label mb-0">Conditional logic</span>
      <label className="text-xs text-champagne"><input checked={enabled} disabled={!canBranch && !enabled} onChange={(event) => setBranches(event.target.checked && options[0] ? [{ operator: "equals", value: options[0].value, targetSectionKey: laterSections[0]?.key ?? "" }] : [])} type="checkbox" /> Enable conditional logic</label>
    </div>
    {!canBranch && !enabled ? <p className="text-xs text-soft-grey">Add at least one option and one later section to send answers down different paths.</p> : null}
    {enabled ? <>{branches.map((branch, position) => <div className="grid gap-2 rounded-lg border border-gold/10 p-2 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end" key={position}>
      <span className="text-xs font-semibold text-soft-grey sm:pb-3">IF</span>
      <Field label="Answer"><select className="field" onChange={(event) => patchBranch(position, { operator: "equals", value: event.target.value })} value={typeof branch.value === "string" ? branch.value : ""}>
        <option disabled value="">Choose an answer</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></Field>
      <Field label="Then go to"><select className="field" onChange={(event) => patchBranch(position, { targetSectionKey: event.target.value })} value={branch.targetSectionKey}>
        <option disabled value="">Choose a section</option>
        {laterSections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}
        <option value={FORM_SUBMIT_TARGET}>Submit the form</option>
      </select></Field>
      <Button aria-label="Remove branch" className="size-9 min-h-9 p-0" onClick={() => setBranches(branches.filter((_, item) => item !== position))} type="button" variant="danger"><Trash2 className="size-4" /></Button>
    </div>)}
    <Button className="min-h-9" disabled={!canBranch} onClick={() => setBranches([...branches, { operator: "equals", value: options[0]?.value ?? "", targetSectionKey: laterSections[0]?.key ?? FORM_SUBMIT_TARGET }])} type="button" variant="secondary"><Plus className="size-4" />Add branch</Button></> : null}
  </div>;
}
