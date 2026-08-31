import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Banknote, CalendarDays, CheckSquare, ChevronDown, ChevronUp, CircleDot, Eye, FileUp, Filter, Hash, ListChecks, Mail, Minus, Pencil, Phone, Plus, Split, Star, Trash2, Type } from "lucide-react";
import { describeFormRule, FORM_LIST_OPERATORS, formRuleHasIncompletePredicate, FORM_OPERATOR_LABELS, FORM_SUBMIT_TARGET, FORM_VALUELESS_OPERATORS, normalizeFormDefinition, operatorsForFieldType, pruneFormRules, renameFormRuleField, validateFormDefinition, type FormAnswer, type FormBranch, type FormFieldDefinition, type FormOption, type FormRule, type FormRuleOperator, type FormRulePredicate, type FormSectionDefinition, type FormTemplateDefinition, type Json, type UserRole } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import { loadMasterOptions, toFormMasterOptions, type MasterOption } from "@/features/dropdowns/api";
import { saveDraft, savePublishedForm, type FormBundle } from "./api";
import { DropdownSourceEditor } from "./DropdownSourceEditor";
import { FormRenderer, type DynamicOptions } from "./FormRenderer";
import { readAnswerRoutes, readGuidedConditionLinks, setAnswerRoute, type AnswerRoute } from "./guidedConditions";

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
// Headings and dividers hold no answer, so nothing can be shown based on them.
const LAYOUT_TYPES = new Set<FormFieldDefinition["type"]>(["section_header", "divider"]);
const DATE_TYPES = new Set<FormFieldDefinition["type"]>(["date", "datetime"]);

const sectionKeyFor = (title: string, used: readonly string[]) => {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([^a-z])/, "s$1").slice(0, 60) || "section";
  let candidate = base;
  for (let suffix = 2; used.includes(candidate); suffix += 1) candidate = `${base}_${suffix}`;
  return candidate;
};
export const nextFormFieldKey = (fields: readonly Pick<FormFieldDefinition, "key">[]) => {
  const used = new Set(fields.map((field) => field.key));
  for (let suffix = 1; ; suffix += 1) {
    const key = `field_${suffix}`;
    if (!used.has(key)) return key;
  }
};
const newField = (type: FormFieldDefinition["type"], fields: readonly FormFieldDefinition[], sectionKey: string): FormFieldDefinition => ({
  key: nextFormFieldKey(fields), label: fieldLabel(type), type, sortOrder: fields.length, sectionKey, required: false, shown: true, editable: true,
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
  const [form, setForm] = useState(() => initial(bundle)); const [saving, setSaving] = useState(false); const [preview, setPreview] = useState(false); const [previewVersion, setPreviewVersion] = useState(0); const [error, setError] = useState<string | null>(null); const [masterOptions, setMasterOptions] = useState<MasterOption[]>([]); const [editing, setEditing] = useState<number | null>(null);
  const [target, setTarget] = useState(DEFAULT_SECTION.key);
  const sections = form.sections?.length ? form.sections : [DEFAULT_SECTION];
  const baseline = useMemo(() => JSON.stringify(normalizeFormDefinition(initial(bundle))), [bundle]); const dirty = JSON.stringify(normalizeFormDefinition(form)) !== baseline; const issues = useMemo(() => [
    ...validateFormDefinition(normalizeFormDefinition(form)),
    // Normalization drops a predicate with no answer, which would quietly turn
    // "only when ..." back into "always asked". Refuse to save it instead.
    ...form.fields.filter((field) => formRuleHasIncompletePredicate(field.rule)).map((field) => ({
      code: "incomplete_rule", fieldKey: field.key,
      message: `Finish or remove the "show this question" condition on ${field.label || field.key}`,
    })),
  ], [form]);
  const refreshMasters = () => loadMasterOptions([], true).then(setMasterOptions).catch(() => setMasterOptions([]));
  useEffect(() => { void refreshMasters(); }, []);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const previewOptions = useMemo<DynamicOptions>(() => ({ ...dynamicOptions, masters: toFormMasterOptions(masterOptions) }), [dynamicOptions, masterOptions]);

  // Every structural edit funnels through here: positions are renumbered and
  // each visibility rule is re-checked against the questions that now precede
  // it, so reordering or deleting a question can never leave a dangling rule.
  const settle = (fields: readonly FormFieldDefinition[]) => pruneFormRules(fields.map((field, position) => ({ ...field, sortOrder: position })));
  const add = (type: FieldKind["type"]) => setForm((current) => {
    const sectionKey = sections.some((section) => section.key === target) ? target : sections[0]!.key;
    const fields = [...current.fields];
    const lastInSection = fields.map((field) => field.sectionKey).lastIndexOf(sectionKey);
    const insertAt = lastInSection === -1 ? fields.length : lastInSection + 1;
    fields.splice(insertAt, 0, newField(type, fields, sectionKey));
    setEditing(insertAt);
    return { ...current, fields: settle(fields) };
  });
  const patchField = (index: number, patch: Partial<FormFieldDefinition>) => setForm((current) => {
    const previousKey = current.fields[index]?.key;
    // Renaming a question must carry every rule that reads it along, otherwise
    // the dependants would silently lose their condition.
    // Half-typed keys pass through here one character at a time, so an empty
    // key is a rename like any other rather than "no rename".
    const rename = patch.key !== undefined && previousKey !== undefined && patch.key !== previousKey
      ? { from: previousKey, to: patch.key } : null;
    const fields = current.fields.map((field, position) => {
      if (position !== index) {
        if (!rename) return field;
        const rule = renameFormRuleField(field.rule, rename.from, rename.to);
        const condition = field.condition?.fieldKey === rename.from ? { ...field.condition, fieldKey: rename.to } : field.condition;
        return rule === field.rule && condition === field.condition ? field : { ...field, rule, condition };
      }
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
    });
    return { ...current, fields: pruneFormRules(fields) };
  });
  const move = (index: number, direction: number) => setForm((current) => {
    const next = [...current.fields]; const to = index + direction;
    if (to < 0 || to >= next.length || next[to]!.sectionKey !== next[index]!.sectionKey) return current;
    [next[index], next[to]] = [next[to]!, next[index]!]; setEditing(to);
    return { ...current, fields: settle(next) };
  });
  const remove = (index: number) => setForm((current) => {
    setEditing((selected) => selected === index ? null : selected !== null && selected > index ? selected - 1 : selected);
    return { ...current, fields: settle(current.fields.filter((_, position) => position !== index)) };
  });
  const setRoute = (sourceKey: string, optionValue: FormAnswer, route: AnswerRoute) => setForm((current) => ({
    ...current,
    fields: settle(setAnswerRoute(current.fields, sourceKey, optionValue, route)),
  }));
  const setQuestionCondition = (targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined) => setForm((current) => {
    const target = current.fields.find((field) => field.key === targetKey);
    const existing = target ? readGuidedConditionLinks(target) : null;
    if (existing === null) return current;
    let fields = current.fields;
    for (const link of existing) fields = setAnswerRoute(fields, link.sourceKey, link.optionValue, { kind: "continue" });
    if (sourceKey && optionValue !== undefined) fields = setAnswerRoute(fields, sourceKey, optionValue, { kind: "question", questionKey: targetKey });
    return { ...current, fields: settle(fields) };
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
    return { ...current, sections: next, fields: settle([...current.fields].sort((a, b) => next.findIndex((section) => section.key === a.sectionKey) - next.findIndex((section) => section.key === b.sectionKey))) };
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
      fields: settle(current.fields.filter((field) => field.sectionKey !== key).map((field) => field.branches?.some((branch) => branch.targetSectionKey === key)
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

  if (preview) return <section className="min-h-[calc(100dvh-8rem)]"><header className="sticky top-0 z-40 -mx-2 mb-6 flex flex-wrap items-center gap-2 border-b border-gold/20 bg-obsidian/95 px-2 py-3 backdrop-blur"><Button aria-label="Close preview" onClick={() => setPreview(false)} type="button" variant="ghost"><ArrowLeft className="size-4" />Close preview</Button><div className="mr-auto min-w-0"><h2 className="truncate text-lg font-semibold text-white">Preview: {form.name || "Untitled form"}</h2><p className="text-xs text-soft-grey">This is exactly what a person filling the form will see.</p></div><Button aria-label="Start preview again" onClick={() => setPreviewVersion((current) => current + 1)} type="button" variant="secondary">Start again</Button></header><div className="mx-auto max-w-4xl rounded-2xl border border-gold/20 bg-charcoal/30 p-4 sm:p-6"><FormRenderer definition={normalizeFormDefinition(form)} dynamicOptions={previewOptions} key={previewVersion} preview /></div></section>;

  return <section className="min-h-[calc(100dvh-8rem)]"><header className="sticky top-0 z-40 -mx-2 mb-6 flex flex-wrap items-center gap-2 border-b border-gold/20 bg-obsidian/95 px-2 py-3 backdrop-blur"><Button onClick={() => { if (!dirty || window.confirm("Discard unsaved form changes?")) onClose(); }} type="button" variant="ghost"><ArrowLeft className="size-4" />Back</Button><div className="mr-auto min-w-0"><h2 className="truncate text-lg font-semibold text-white">{form.name || "New form"}</h2><p className="text-xs text-soft-grey">{dirty ? "Unsaved changes" : "Build the questions and answer paths for this form."}</p></div><Button aria-label="Preview form" onClick={() => setPreview(true)} type="button" variant="secondary"><Eye className="size-4" />Preview</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : bundle?.lifecycle === "published" ? "Save changes" : "Save draft"}</Button></header><div className="mx-auto max-w-7xl space-y-5">{error ? <Notice tone="danger">{error}</Notice> : null}
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
        <div className="space-y-2">{form.fields.map((field, index) => ({ field, index })).filter((entry) => (entry.field.sectionKey ?? sections[0]!.key) === section.key).map(({ field, index }) => <CompactFieldRow dynamicOptions={previewOptions} editing={editing === index} field={field} fields={form.fields} index={index} key={index} masterOptions={masterOptions} onEdit={() => setEditing((current) => current === index ? null : index)} onMasterCreated={refreshMasters} onMove={move} onPatch={patchField} onRemove={remove} onSetQuestionCondition={setQuestionCondition} onSetRoute={setRoute} sections={sections} />)}</div>
        {form.fields.every((field) => (field.sectionKey ?? sections[0]!.key) !== section.key) ? <p className="text-xs text-soft-grey">No questions in this section yet.</p> : null}
      </div>)}</div>}</section>

    <RoutingOverview dynamicOptions={previewOptions} fields={form.fields} masterOptions={masterOptions} sections={sections} />
    {issues.length ? <Notice tone="danger">{issues[0]?.message}</Notice> : null}
  </div></section>;
}

function FieldPaletteButton({ kind, onAdd }: { kind: FieldKind; onAdd: (type: FieldKind["type"]) => void }) { const Icon = kind.icon; return <button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-gold/20 bg-charcoal/40 px-2 text-center text-sm font-semibold text-champagne transition hover:border-gold hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" onClick={() => onAdd(kind.type)} type="button"><span className="grid size-9 place-items-center rounded-full bg-gold/10 text-gold"><Icon className="size-5" /></span>{kind.label}</button>; }

function CompactFieldRow({ field, fields, index, editing, dynamicOptions, masterOptions, sections, onEdit, onPatch, onMove, onRemove, onSetQuestionCondition, onSetRoute, onMasterCreated }: { field: FormFieldDefinition; fields: readonly FormFieldDefinition[]; index: number; editing: boolean; dynamicOptions: DynamicOptions; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onEdit: () => void; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void; onMove: (index: number, direction: number) => void; onRemove: (index: number) => void; onSetQuestionCondition: (targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined) => void; onSetRoute: (sourceKey: string, optionValue: FormAnswer, route: AnswerRoute) => void; onMasterCreated: () => Promise<void> }) {
  const Icon = fieldIcon(field.type);
  const name = field.label || fieldLabel(field.type);
  const links = readGuidedConditionLinks(field);
  const summary = links === null ? "Advanced condition" : links.length ? `Shown after: ${links.map((link) => `${fields.find((item) => item.key === link.sourceKey)?.label ?? link.sourceKey} = ${String(link.optionValue)}`).join(" or ")}` : "";
  return <article className="overflow-hidden rounded-xl border border-gold/20 bg-charcoal/30"><div className="flex items-center gap-2 p-2 sm:p-3">
    <div className="flex flex-col"><button aria-label={`Move ${name} up`} className="text-soft-grey hover:text-gold" onClick={() => onMove(index, -1)} type="button"><ChevronUp className="size-4" /></button><button aria-label={`Move ${name} down`} className="text-soft-grey hover:text-gold" onClick={() => onMove(index, 1)} type="button"><ChevronDown className="size-4" /></button></div>
    <span className="grid size-8 place-items-center rounded-full bg-gold/10 text-gold"><Icon className="size-4" /></span>
    <button className="min-w-0 flex-1 text-left" onClick={onEdit} type="button"><span className="block truncate font-semibold text-champagne">{name}</span><span className="block truncate text-xs text-soft-grey">{fieldLabel(field.type)}{field.required ? " · required" : ""}{field.branches?.length ? ` · ${field.branches.length} branch${field.branches.length === 1 ? "" : "es"}` : ""}</span>{summary ? <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-xs text-gold"><Filter className="size-3 shrink-0" /><span className="truncate">Shown when {summary}</span></span> : null}</button>
    <Button aria-label={`Edit ${name}`} className="size-9 min-h-9 p-0" onClick={onEdit} type="button" variant="ghost"><Pencil className="size-4" /></Button>
    <Button aria-label={`Remove ${name}`} className="size-9 min-h-9 p-0" onClick={() => onRemove(index)} type="button" variant="danger"><Trash2 className="size-4" /></Button>
  </div>{editing ? <FieldEditor dynamicOptions={dynamicOptions} field={field} fields={fields} index={index} masterOptions={masterOptions} onMasterCreated={onMasterCreated} onPatch={onPatch} onSetQuestionCondition={onSetQuestionCondition} onSetRoute={onSetRoute} sections={sections} /> : null}</article>;
}

function FieldEditor({ field, fields, index, dynamicOptions, masterOptions, sections, onPatch, onSetQuestionCondition, onSetRoute, onMasterCreated }: { field: FormFieldDefinition; fields: readonly FormFieldDefinition[]; index: number; dynamicOptions: DynamicOptions; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void; onSetQuestionCondition: (targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined) => void; onSetRoute: (sourceKey: string, optionValue: FormAnswer, route: AnswerRoute) => void; onMasterCreated: () => Promise<void> }) {
  const validation = field.validation ?? {};
  const updateValidation = (key: "min" | "max" | "minLength" | "maxLength", raw: string) => onPatch(index, { validation: { ...validation, [key]: raw === "" ? undefined : Number(raw) } });
  return <div className="grid gap-3 border-t border-gold/15 p-3 sm:grid-cols-2">
    <Field label="Question"><input className="field" onChange={(event) => onPatch(index, { label: event.target.value })} value={field.label} /></Field>
    <Field label="Helper text"><input className="field" onChange={(event) => onPatch(index, { helperText: event.target.value })} value={field.helperText ?? ""} /></Field>
    <Field label="Placeholder"><input className="field" onChange={(event) => onPatch(index, { placeholder: event.target.value })} value={field.placeholder ?? ""} /></Field>
    {OPTION_TYPES.has(field.type) ? <DropdownSourceEditor field={field} index={index} masterOptions={masterOptions} onMasterCreated={onMasterCreated} onPatch={onPatch} /> : null}
    {BRANCH_TYPES.has(field.type) ? <AnswerRoutingEditor dynamicOptions={dynamicOptions} field={field} fields={fields} index={index} masterOptions={masterOptions} onSetRoute={onSetRoute} sections={sections} /> : null}
    <OptionMappedConditionEditor dynamicOptions={dynamicOptions} field={field} fields={fields} index={index} masterOptions={masterOptions} onSetQuestionCondition={onSetQuestionCondition} />
    {sections.length > 1 ? <Field label="Section"><select className="field" onChange={(event) => onPatch(index, { sectionKey: event.target.value })} value={field.sectionKey ?? sections[0]?.key ?? ""}>{sections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}</select></Field> : null}
    {NUMBER_TYPES.has(field.type) ? <><Field label="Minimum"><input className="field" onChange={(event) => updateValidation("min", event.target.value)} type="number" value={validation.min ?? ""} /></Field><Field label="Maximum"><input className="field" onChange={(event) => updateValidation("max", event.target.value)} type="number" value={validation.max ?? ""} /></Field></> : null}
    {TEXT_TYPES.has(field.type) ? <><Field label="Minimum length"><input className="field" onChange={(event) => updateValidation("minLength", event.target.value)} type="number" value={validation.minLength ?? ""} /></Field><Field label="Maximum length"><input className="field" onChange={(event) => updateValidation("maxLength", event.target.value)} type="number" value={validation.maxLength ?? ""} /></Field></> : null}
    <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
      <label className="text-sm text-champagne"><input checked={field.required === true} onChange={(event) => onPatch(index, { required: event.target.checked })} type="checkbox" /> Required</label>
      <label className="text-sm text-champagne"><input checked={field.shown !== false} onChange={(event) => onPatch(index, { shown: event.target.checked })} type="checkbox" /> Shown</label>
      <label className="text-sm text-champagne"><input checked={field.editable !== false} onChange={(event) => onPatch(index, { editable: event.target.checked })} type="checkbox" /> Editable</label>
    </div>
  </div>;
}

function routeValue(route: AnswerRoute | undefined): string {
  if (!route || route.kind === "continue") return "continue";
  if (route.kind === "question") return `question:${route.questionKey}`;
  if (route.kind === "section") return `section:${route.sectionKey}`;
  return "submit";
}

function routeDescription(route: AnswerRoute, fields: readonly FormFieldDefinition[], sections: readonly FormSectionDefinition[]): string {
  if (route.kind === "continue") return "Continue normally";
  if (route.kind === "question") return `Ask ${fields.find((field) => field.key === route.questionKey)?.label || "a later question"}`;
  if (route.kind === "section") return `Skip to ${sections.find((section) => section.key === route.sectionKey)?.title || "a later section"}`;
  return "Submit the form";
}

function routeFromValue(value: string): AnswerRoute {
  if (value.startsWith("question:")) return { kind: "question", questionKey: value.slice("question:".length) };
  if (value.startsWith("section:")) return { kind: "section", sectionKey: value.slice("section:".length) };
  return value === "submit" ? { kind: "submit" } : { kind: "continue" };
}

/** Maps every actual answer choice to exactly one forward action. */
function AnswerRoutingEditor({ field, fields, index, masterOptions, dynamicOptions, sections, onSetRoute }: { field: FormFieldDefinition; fields: readonly FormFieldDefinition[]; index: number; masterOptions: MasterOption[]; dynamicOptions: DynamicOptions; sections: readonly FormSectionDefinition[]; onSetRoute: (sourceKey: string, optionValue: FormAnswer, route: AnswerRoute) => void }) {
  const options = answerOptions(field, masterOptions, dynamicOptions) ?? [];
  const laterFields = fields.slice(index + 1).filter((candidate) => !LAYOUT_TYPES.has(candidate.type) && readGuidedConditionLinks(candidate) !== null);
  const sectionIndex = sections.findIndex((section) => section.key === field.sectionKey);
  const laterSections = sections.slice(sectionIndex + 1);
  const routes = readAnswerRoutes(fields, sections, field.key);
  if (!options.length) return <div className="sm:col-span-2"><Notice>Add answer choices first, then map what happens after each answer.</Notice></div>;
  return <section className="space-y-3 rounded-lg border border-gold/20 bg-gold/5 p-3 sm:col-span-2">
    <div><h4 className="font-medium text-champagne">What happens after each answer?</h4><p className="mt-1 text-xs text-soft-grey">Map each answer to a later question, a later section, or the end of the form.</p></div>
    {options.map((option) => {
      const route = routes.get(option.value) ?? { kind: "continue" as const };
      return <div className="grid gap-2 rounded-lg border border-gold/10 p-2 sm:grid-cols-[minmax(11rem,0.7fr)_minmax(0,1fr)]" key={option.value}>
        <p className="self-end text-sm font-medium text-champagne">{option.label}</p>
        <Field label={`Route after ${option.label}`}><select className="field" onChange={(event) => onSetRoute(field.key, option.value, routeFromValue(event.target.value))} value={routeValue(route)}>
          <option value="continue">Continue normally</option>
          {laterFields.map((candidate) => <option key={candidate.key} value={`question:${candidate.key}`}>Ask {candidate.label || fieldLabel(candidate.type)}</option>)}
          {laterSections.map((section) => <option key={section.key} value={`section:${section.key}`}>Skip to {section.title}</option>)}
          <option value="submit">Submit the form</option>
        </select></Field>
        {route.kind !== "continue" ? <p className="text-xs text-gold sm:col-span-2">{option.label} -&gt; {routeDescription(route, fields, sections)}</p> : null}
      </div>;
    })}
  </section>;
}

/** Edits a question's direct answer condition using the source's real options. */
function OptionMappedConditionEditor({ field, fields, index, masterOptions, dynamicOptions, onSetQuestionCondition }: { field: FormFieldDefinition; fields: readonly FormFieldDefinition[]; index: number; masterOptions: MasterOption[]; dynamicOptions: DynamicOptions; onSetQuestionCondition: (targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined) => void }) {
  const sources = fields.slice(0, index).filter((source) => !LAYOUT_TYPES.has(source.type) && (answerOptions(source, masterOptions, dynamicOptions)?.length ?? 0) > 0);
  const links = readGuidedConditionLinks(field);
  const label = field.label || fieldLabel(field.type);
  if (!sources.length) return <div className="rounded-lg border border-gold/15 bg-obsidian/40 p-3 text-xs text-soft-grey sm:col-span-2">Add a choose-one question before this one to show it only for selected answers.</div>;
  if (links === null) return <Notice tone="danger"><strong>{label}</strong> has an existing complex condition. It is preserved and will still run, but it cannot be changed with answer mapping.</Notice>;
  const selected = links[0];
  const source = sources.find((candidate) => candidate.key === selected?.sourceKey);
  const options = source ? answerOptions(source, masterOptions, dynamicOptions) ?? [] : [];
  return <section className="grid gap-3 rounded-lg border border-gold/15 bg-obsidian/40 p-3 sm:col-span-2 sm:grid-cols-2">
    <div className="sm:col-span-2"><h4 className="font-medium text-champagne">Show this question when...</h4><p className="mt-1 text-xs text-soft-grey">Choose an earlier question, then choose one of its actual answers. No text needs to be typed.</p></div>
    <Field label={`Show ${label} when question`}><select className="field" onChange={(event) => {
      const next = sources.find((candidate) => candidate.key === event.target.value);
      const firstOption = next ? answerOptions(next, masterOptions, dynamicOptions)?.[0] : undefined;
      onSetQuestionCondition(field.key, next?.key, firstOption?.value);
    }} value={source?.key ?? ""}>
      <option value="">Always show this question</option>
      {sources.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label || fieldLabel(candidate.type)}</option>)}
    </select></Field>
    <Field label={`Show ${label} when answer`}><select className="field" disabled={!source} onChange={(event) => onSetQuestionCondition(field.key, source?.key, event.target.value)} value={selected?.optionValue === undefined ? "" : String(selected.optionValue)}>
      <option value="">Choose an answer</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></Field>
    {links.length > 1 ? <p className="text-xs text-gold sm:col-span-2">This question is also mapped from other answers. Change either control to replace those mappings.</p> : null}
  </section>;
}

function RoutingOverview({ fields, sections, masterOptions, dynamicOptions }: { fields: readonly FormFieldDefinition[]; sections: readonly FormSectionDefinition[]; masterOptions: MasterOption[]; dynamicOptions: DynamicOptions }) {
  const groups = fields.flatMap((field) => {
    if (!BRANCH_TYPES.has(field.type)) return [];
    const options = answerOptions(field, masterOptions, dynamicOptions) ?? [];
    const routes = readAnswerRoutes(fields, sections, field.key);
    const entries = options.flatMap((option) => {
      const route = routes.get(option.value);
      return route && route.kind !== "continue" ? [{ option, route }] : [];
    });
    return entries.length ? [{ field, entries }] : [];
  });
  return <section aria-label="Routing overview" className="rounded-xl border border-gold/20 bg-charcoal/30 p-4"><div className="mb-3"><h3 className="text-xl font-semibold text-gold">Routing overview</h3><p className="text-xs text-soft-grey">This shows the paths people will take through the form.</p></div>{groups.length === 0 ? <p className="text-sm text-soft-grey">No answer paths are mapped yet.</p> : <div className="grid gap-3 lg:grid-cols-2">{groups.map(({ field, entries }) => <article className="rounded-lg border border-gold/15 bg-obsidian/40 p-3" key={field.key}><h4 className="font-medium text-champagne">{field.label || fieldLabel(field.type)}</h4><ul className="mt-2 space-y-1 text-sm text-gold">{entries.map(({ option, route }) => <li key={option.value}>{option.label} -&gt; {routeDescription(route, fields, sections)}</li>)}</ul></article>)}</div>}</section>;
}

/** The rule a question is shown by, including the single legacy condition. */
function visibilityRule(field: FormFieldDefinition): FormRule | undefined {
  if (field.rule) return field.rule;
  return field.condition ? { kind: "predicate", ...field.condition } : undefined;
}

type EditableGroup = Readonly<{ kind: "all" | "any"; rules: readonly FormRulePredicate[] }>;

/**
 * The editor authors a flat ALL/ANY list, which is what respondents can reason
 * about. A deeper tree stays valid and keeps evaluating, but is shown read-only
 * rather than silently flattened into something that means something else.
 */
function toEditableGroup(rule: FormRule | undefined): EditableGroup | null {
  if (!rule) return null;
  if (rule.kind === "predicate") return { kind: "all", rules: [rule as FormRulePredicate] };
  return rule.rules.every((child) => child.kind === "predicate")
    ? { kind: rule.kind, rules: rule.rules as readonly FormRulePredicate[] }
    : null;
}

/** The answers a question can offer, or null when it is answered freely. */
function answerOptions(source: FormFieldDefinition, masterOptions: MasterOption[], dynamicOptions: DynamicOptions): readonly FormOption[] | null {
  if (source.type === "checkbox") return [{ value: "true", label: "Checked" }, { value: "false", label: "Not checked" }];
  if (source.optionSource) return masterOptions.filter((option) => option.master_type === source.optionSource?.masterType).map((option) => ({ value: option.value, label: option.label }));
  if (source.options?.length) return source.options;
  if (source.type === "user_dropdown") return dynamicOptions.users.map((user) => ({ value: user.id, label: user.label }));
  if (source.type === "branch_dropdown") return dynamicOptions.branches.map((branch) => ({ value: branch.id, label: branch.label }));
  if (source.type === "department_dropdown") return dynamicOptions.departments.map((department) => ({ value: department.id, label: department.label }));
  return null;
}

function defaultPredicate(source: FormFieldDefinition, options: readonly FormOption[] | null): FormRulePredicate {
  const operator = operatorsForFieldType(source.type)[0] ?? "equals";
  if (FORM_VALUELESS_OPERATORS.has(operator)) return { kind: "predicate", fieldKey: source.key, operator };
  if (FORM_LIST_OPERATORS.has(operator)) return { kind: "predicate", fieldKey: source.key, operator, value: options?.[0] ? [options[0].value] : [] };
  if (source.type === "checkbox") return { kind: "predicate", fieldKey: source.key, operator, value: true };
  return { kind: "predicate", fieldKey: source.key, operator, value: options?.[0]?.value ?? "" };
}

/** Keeps as much of the authored answer as the new operator can still use. */
function withOperator(predicate: FormRulePredicate, operator: FormRuleOperator): FormRulePredicate {
  if (FORM_VALUELESS_OPERATORS.has(operator)) return { kind: "predicate", fieldKey: predicate.fieldKey, operator };
  const value = predicate.value;
  if (FORM_LIST_OPERATORS.has(operator)) {
    const list = Array.isArray(value) ? value : value === undefined || value === "" ? [] : [value];
    return { kind: "predicate", fieldKey: predicate.fieldKey, operator, value: list };
  }
  return { kind: "predicate", fieldKey: predicate.fieldKey, operator, value: Array.isArray(value) ? value[0] ?? "" : value ?? "" };
}

/**
 * "Show this question only when ..." - the rule that decides whether a question
 * is asked at all. It reads any earlier answer, so the questions ahead change as
 * the respondent fills the form in.
 */
export function VisibilityRuleEditor({ field, index, sources, masterOptions, dynamicOptions, onPatch }: { field: FormFieldDefinition; index: number; sources: readonly FormFieldDefinition[]; masterOptions: MasterOption[]; dynamicOptions: DynamicOptions; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void }) {
  const rule = visibilityRule(field);
  const group = toEditableGroup(rule);
  const labelFor = (key: string) => sources.find((source) => source.key === key)?.label || key;
  const write = (next: EditableGroup | null) => onPatch(index, {
    rule: next && next.rules.length ? { kind: next.kind, rules: next.rules } : undefined,
    condition: undefined,
  });
  const setPredicate = (position: number, predicate: FormRulePredicate) =>
    write({ kind: group?.kind ?? "all", rules: (group?.rules ?? []).map((item, slot) => slot === position ? predicate : item) });
  const addPredicate = () => {
    const source = sources[0];
    if (!source) return;
    write({ kind: group?.kind ?? "all", rules: [...(group?.rules ?? []), defaultPredicate(source, answerOptions(source, masterOptions, dynamicOptions))] });
  };

  return <div className="space-y-2 rounded-lg border border-gold/15 bg-obsidian/40 p-3 sm:col-span-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="label mb-0 flex items-center gap-1"><Filter className="size-4 text-gold" />Show this question</span>
      {sources.length ? <label className="text-xs text-champagne"><input checked={rule !== undefined} onChange={(event) => event.target.checked ? addPredicate() : write(null)} type="checkbox" /> Only when earlier answers match</label> : null}
    </div>
    {!sources.length ? <p className="text-xs text-soft-grey">Add a question before this one to show or hide it based on the answer.</p>
      : rule === undefined ? <p className="text-xs text-soft-grey">Always asked.</p>
      : !group ? <div className="space-y-2"><p className="text-xs text-soft-grey">Shown when {describeFormRule(rule, labelFor)}. This grouped condition was not built here, so it is shown read-only.</p>
        <Button className="min-h-9" onClick={() => write(null)} type="button" variant="secondary">Replace with a new condition</Button></div>
      : <>
        {group.rules.length > 1 ? <label className="flex items-center gap-2 text-xs text-soft-grey">Match<select aria-label="Match all or any condition" className="field h-9 w-auto" onChange={(event) => write({ kind: event.target.value === "any" ? "any" : "all", rules: group.rules })} value={group.kind}>
          <option value="all">all of these</option>
          <option value="any">any of these</option>
        </select>conditions</label> : null}
        {group.rules.map((predicate, position) => <PredicateRow
          dynamicOptions={dynamicOptions}
          key={position}
          lead={position === 0 ? "IF" : group.kind === "all" ? "AND" : "OR"}
          masterOptions={masterOptions}
          onChange={(next) => setPredicate(position, next)}
          onRemove={() => write({ kind: group.kind, rules: group.rules.filter((_, slot) => slot !== position) })}
          predicate={predicate}
          sources={sources}
        />)}
        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-9" onClick={addPredicate} type="button" variant="secondary"><Plus className="size-4" />Add condition</Button>
          <p className="text-xs text-soft-grey">Shown when {describeFormRule({ kind: group.kind, rules: group.rules }, labelFor)}</p>
        </div>
      </>}
  </div>;
}

function PredicateRow({ predicate, sources, lead, masterOptions, dynamicOptions, onChange, onRemove }: { predicate: FormRulePredicate; sources: readonly FormFieldDefinition[]; lead: string; masterOptions: MasterOption[]; dynamicOptions: DynamicOptions; onChange: (predicate: FormRulePredicate) => void; onRemove: () => void }) {
  const source = sources.find((item) => item.key === predicate.fieldKey) ?? sources[0]!;
  const options = answerOptions(source, masterOptions, dynamicOptions);
  const operators = operatorsForFieldType(source.type);
  const valueless = FORM_VALUELESS_OPERATORS.has(predicate.operator);
  return <div className="grid gap-2 rounded-lg border border-gold/10 p-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto] sm:items-end">
    <span className="text-xs font-semibold text-soft-grey sm:pb-3">{lead}</span>
    <Field label="Question"><select className="field" onChange={(event) => {
      const next = sources.find((item) => item.key === event.target.value);
      if (next) onChange(defaultPredicate(next, answerOptions(next, masterOptions, dynamicOptions)));
    }} value={source.key}>{sources.map((item) => <option key={item.key} value={item.key}>{item.label || item.key}</option>)}</select></Field>
    <Field label="Condition"><select className="field" onChange={(event) => onChange(withOperator(predicate, event.target.value as FormRuleOperator))} value={predicate.operator}>
      {operators.map((operator) => <option key={operator} value={operator}>{FORM_OPERATOR_LABELS[operator]}</option>)}
    </select></Field>
    {valueless ? <span aria-hidden className="hidden sm:block" /> : <Field label="Answer"><PredicateValueInput onChange={(value) => onChange({ ...predicate, value })} options={options} predicate={predicate} source={source} /></Field>}
    <Button aria-label="Remove condition" className="size-9 min-h-9 p-0" onClick={onRemove} type="button" variant="danger"><Trash2 className="size-4" /></Button>
  </div>;
}

function PredicateValueInput({ predicate, source, options, onChange }: { predicate: FormRulePredicate; source: FormFieldDefinition; options: readonly FormOption[] | null; onChange: (value: FormAnswer | readonly FormAnswer[]) => void }) {
  const list = FORM_LIST_OPERATORS.has(predicate.operator);
  const selected = (Array.isArray(predicate.value) ? predicate.value : []).map(String);
  if (options && list) return <select className="field" multiple onChange={(event) => onChange([...event.target.selectedOptions].map((option) => option.value))} value={selected}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
  if (list) return <input className="field" onChange={(event) => onChange(event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean))} placeholder="Comma separated answers" value={selected.join(", ")} />;
  const current = predicate.value === undefined || Array.isArray(predicate.value) ? "" : String(predicate.value);
  if (options) {
    // An option deleted after the rule was written stays visible so the author
    // can see what broke instead of the rule silently pointing at nothing.
    const known = options.some((option) => option.value === current);
    return <select className="field" onChange={(event) => onChange(source.type === "checkbox" ? event.target.value === "true" : event.target.value)} value={current}>
      <option value="">Choose an answer</option>
      {current && !known ? <option value={current}>{current} (removed)</option> : null}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  }
  if (NUMBER_TYPES.has(source.type)) return <input className="field" onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} step="any" type="number" value={current} />;
  if (DATE_TYPES.has(source.type)) return <input className="field" onChange={(event) => onChange(event.target.value)} type={source.type === "datetime" ? "datetime-local" : "date"} value={current} />;
  return <input className="field" onChange={(event) => onChange(event.target.value)} placeholder="Answer to match" value={current} />;
}

/** IF <this question> <operator> <answer> THEN go to <section>, as many times as needed. */
export function SectionBranchEditor({ field, index, masterOptions, sections, onPatch }: { field: FormFieldDefinition; index: number; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void }) {
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
      <span className="label mb-0 flex items-center gap-1"><Split className="size-4 text-gold" />Skip to a section</span>
      <label className="text-xs text-champagne"><input checked={enabled} disabled={!canBranch && !enabled} onChange={(event) => setBranches(event.target.checked && options[0] ? [{ operator: "equals", value: options[0].value, targetSectionKey: laterSections[0]?.key ?? "" }] : [])} type="checkbox" /> Send answers down different paths</label>
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
