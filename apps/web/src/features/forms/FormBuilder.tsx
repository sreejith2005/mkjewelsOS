import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { dropdownMasterKey, eligibleRecordNameFields } from "@jewelos/core";
import { ArrowLeft, Banknote, CalendarDays, CheckSquare, ChevronDown, ChevronUp, CircleDot, Copy, Eye, EyeOff, FileUp, Filter, GitBranch, Hash, ListChecks, Mail, Minus, Monitor, Pencil, Phone, Plus, RotateCcw, Smartphone, Split, Star, Trash2, Type, UserRound, X } from "lucide-react";
import { duplicateFormField, createFormField, formAnswerOptions, setQuestionAnswerCondition, describePublishedFormEdit, formRuleHasIncompletePredicate, FORM_SUBMIT_TARGET, nextFormFieldKey as sharedNextFormFieldKey, normalizeFormDefinition, pruneFormRules, updateFormField, validateFormDefinition, type FormAnswer, type FormBranch, type FormFieldDefinition, type FormOption, type FormRule, type FormRuleOperator, type FormSectionDefinition, type FormTemplateDefinition, type Json, type UserRole } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { createMasterList, loadMasterOptions, toFormMasterOptions, type MasterOption } from "@/features/dropdowns/api";
import { formUsageImpact, saveDraft, savePublishedForm, type FormBundle } from "./api";
import { DropdownSourceEditor } from "./DropdownSourceEditor";
import { FormRenderer, type DynamicOptions } from "./FormRenderer";
import { readAnswerRoutes, readGuidedConditionLinks, setAnswerRoute, type AnswerRoute } from "./guidedConditions";
import { convertFormFieldType, LAYOUT_FIELD_TYPES, OPTION_FIELD_TYPES } from "./fieldTypes";
import { CustomerIntegrationPanel } from "./CustomerIntegrationPanel";
import { FormOutline } from "./FormOutline";
import { FormRoutingMap } from "./FormRoutingMap";

/** Lists waiting to be added to Dropdown Master when the form is saved. */
type PendingMasterLists = Readonly<{ names: Readonly<Record<string, string>>; set: (key: string, name: string | undefined) => void }>;
import { defaultFormRulePredicate, FormRuleTreeEditor } from "./FormRuleTreeEditor";
import { FormAdvancedRoutes, FormDestinationSelect, FormSectionConditions } from "./FormRoutingControls";

const ROLES: UserRole[] = ["super_admin", "admin", "manager", "hr", "crm", "staff", "doer", "housekeeping"];
const OPTION_TYPES = OPTION_FIELD_TYPES;
const BRANCH_TYPES = new Set<FormFieldDefinition["type"]>(["select", "radio", "checkbox", "multiselect"]);
const NUMBER_TYPES = new Set<FormFieldDefinition["type"]>(["number", "currency", "rating"]);
const TEXT_TYPES = new Set<FormFieldDefinition["type"]>(["text", "textarea"]);
// Text and Phone Number lead the palette; there is a single unified Text field.
const FIELD_KINDS = [
  { type: "text", label: "Text", icon: Type }, { type: "phone", label: "Phone Number", icon: Phone }, { type: "number", label: "Number", icon: Hash }, { type: "select", label: "Dropdown", icon: ChevronDown }, { type: "user_dropdown", label: "Users", icon: UserRound },
  { type: "date", label: "Date Picker", icon: CalendarDays }, { type: "checkbox", label: "Checkbox", icon: CheckSquare }, { type: "radio", label: "Radio Group", icon: CircleDot },
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
const LAYOUT_TYPES = LAYOUT_FIELD_TYPES;

const sectionKeyFor = (title: string, used: readonly string[]) => {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([^a-z])/, "s$1").slice(0, 60) || "section";
  let candidate = base;
  for (let suffix = 2; used.includes(candidate); suffix += 1) candidate = `${base}_${suffix}`;
  return candidate;
};
export const nextFormFieldKey = sharedNextFormFieldKey;
const newField = (type: FormFieldDefinition["type"], fields: readonly FormFieldDefinition[], sectionKey: string): FormFieldDefinition => ({
  ...createFormField(type, fields, sectionKey), label: fieldLabel(type),
});
/** The editable definition of a saved Form (or a blank one), as the builder opens it. */
export const formBuilderDefinition = (bundle?: FormBundle): FormTemplateDefinition => ({
  name: bundle?.name ?? "", description: bundle?.description ?? "",
  recordNameFieldKey: bundle?.record_name_field_key ?? undefined,
  sections: bundle?.sections?.length ? bundle.sections : [DEFAULT_SECTION],
  fields: (bundle?.fields ?? []).map((field) => ({ ...field, sectionKey: field.sectionKey ?? DEFAULT_SECTION.key })),
  permissions: { roles: ((bundle?.permissions as { roles?: UserRole[] } | null)?.roles) ?? ["staff"] },
});
const toDraftFields = (fields: readonly FormFieldDefinition[]) => fields.map(({ id: _id, sortOrder: _sortOrder, ...field }) => field);

/** What a host persists: the payload and fields of the existing form draft RPCs, plus the definition they came from. */
export type FormBuilderSave = Readonly<{ definition: FormTemplateDefinition; payload: Json; fields: Json }>;
/**
 * Lets a host other than the Forms Library (the FMS questionnaire studio) reuse
 * this exact editor and preview. `persist` replaces the library save; it
 * returns "stay" to keep editing (the saved state becomes the new baseline) or
 * "close" when the host is done.
 */
export type FormBuilderHost = Readonly<{
  title?: string | undefined;
  subtitle?: string | undefined;
  initialDefinition?: FormTemplateDefinition | undefined;
  /** Seeded content the host has not saved yet, so it counts as an unsaved change. */
  initialDirty?: boolean | undefined;
  draftLabel?: string | undefined;
  useLabel: string;
  persist: (save: FormBuilderSave, intent: "draft" | "use") => Promise<"stay" | "close">;
  extraActions?: ((api: Readonly<{ form: FormTemplateDefinition; replace: (next: FormTemplateDefinition) => void }>) => ReactNode) | undefined;
}>;

export function FormBuilder({ bundle, dynamicOptions, onClose, onSaved, host }: { bundle?: FormBundle | undefined; dynamicOptions: DynamicOptions; onClose: () => void; onSaved: () => Promise<void>; host?: FormBuilderHost | undefined }) {
  const [form, setForm] = useState(() => host?.initialDefinition ?? formBuilderDefinition(bundle)); const [saving, setSaving] = useState(false); const [previewVersion, setPreviewVersion] = useState(0); const [error, setError] = useState<string | null>(null); const [masterOptions, setMasterOptions] = useState<MasterOption[]>([]); const [editing, setEditing] = useState<number | null>(null); const [addMenu, setAddMenu] = useState<{ after: number | null; sectionKey: string } | null>(null); const [routingMap, setRoutingMap] = useState(false);
  /** Wide screens edit and preview side by side; narrow screens switch between the two over the same live state. */
  const wide = useMediaQuery("(min-width: 1024px)");
  const [previewShown, setPreviewShown] = useState(true);
  const [narrowView, setNarrowView] = useState<"edit" | "preview">("edit");
  const [previewViewport, setPreviewViewport] = useState<"desktop" | "mobile">("desktop");
  /** Very wide screens also keep the question outline open beside the editor and preview. */
  const roomy = useMediaQuery("(min-width: 1720px)");
  // The side panels stay pinned just below the builder's own header, whatever its height.
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeaderHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const sections = form.sections?.length ? form.sections : [DEFAULT_SECTION];
  const [baseline, setBaseline] = useState(() => host?.initialDirty ? "" : JSON.stringify(normalizeFormDefinition(host?.initialDefinition ?? formBuilderDefinition(bundle)))); const dirty = JSON.stringify(normalizeFormDefinition(form)) !== baseline; const issues = useMemo(() => [
    ...validateFormDefinition(form),
    // Normalization drops a predicate with no answer, which would quietly turn
    // "only when ..." back into "always asked". Refuse to save it instead.
    ...form.fields.filter((field) => formRuleHasIncompletePredicate(field.rule)).map((field) => ({
      code: "incomplete_rule", fieldKey: field.key,
      message: `Finish or remove the "show this question" condition on ${field.label || field.key}`,
    })),
  ], [form]);
  const refreshMasters = () => loadMasterOptions([], true).then(setMasterOptions).catch(() => setMasterOptions([]));
  // Questions whose author ticked "Also add ... to Dropdown Master", keyed by
  // question key. Kept here, not in the question editor, so collapsing the
  // question does not lose it and saving the form creates the list.
  const [pendingLists, setPendingLists] = useState<Readonly<Record<string, string>>>({});
  const pendingMasterLists: PendingMasterLists = {
    names: pendingLists,
    set: (key, name) => setPendingLists((current) => {
      const { [key]: _previous, ...rest } = current;
      return name === undefined ? rest : { ...rest, [key]: name };
    }),
  };
  useEffect(() => { void refreshMasters(); }, []);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const previewOptions = useMemo<DynamicOptions>(() => ({ ...dynamicOptions, masters: toFormMasterOptions(masterOptions) }), [dynamicOptions, masterOptions]);

  // Every structural edit funnels through here: positions are renumbered and
  // each visibility rule is re-checked against the questions that now precede
  // it, so reordering or deleting a question can never leave a dangling rule.
  const settle = (fields: readonly FormFieldDefinition[]) => pruneFormRules(fields.map((field, position) => ({ ...field, sortOrder: position })));
  const add = (type: FieldKind["type"]) => setForm((current) => {
    const placement = addMenu ?? { after: null, sectionKey: sections[0]!.key };
    const sectionKey = sections.some((section) => section.key === placement.sectionKey) ? placement.sectionKey : sections[0]!.key;
    const fields = [...current.fields];
    const lastInSection = fields.map((field) => field.sectionKey).lastIndexOf(sectionKey);
    const insertAt = placement.after !== null && fields[placement.after]?.sectionKey === sectionKey ? placement.after + 1 : lastInSection === -1 ? fields.length : lastInSection + 1;
    fields.splice(insertAt, 0, newField(type, fields, sectionKey));
    setEditing(insertAt);
    setAddMenu(null);
    return { ...current, fields: settle(fields) };
  });
  const patchField = (index: number, patch: Partial<FormFieldDefinition>) => {
    if (patch.options) {
      const retained = new Set(patch.options.map((option) => option.value));
      const removed = (form.fields[index]?.options ?? []).filter((option) => !retained.has(option.value));
      if (removed.length) setError(`Removed ${removed.map((option) => `“${option.label}”`).join(", ")} and cleared any answer paths that referenced it.`);
    }
    // A pending Dropdown Master list follows its question when the key is renamed.
    const renamedFrom = form.fields[index]?.key;
    if (patch.key !== undefined && renamedFrom !== undefined && patch.key !== renamedFrom) {
      const renamedTo = patch.key;
      setPendingLists((pending) => {
        if (!(renamedFrom in pending)) return pending;
        const { [renamedFrom]: name = "", ...rest } = pending;
        return { ...rest, [renamedTo]: name };
      });
    }
    setForm(current => {
      const field = current.fields[index];
      return field ? updateFormField(current, field.key, patch) : current;
    });
  };

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
  const duplicate = (index: number) => setForm((current) => {
    const source = current.fields[index]; if (!source) return current;
    setEditing(index + 1); setAddMenu(null);
    return duplicateFormField(current, source.key);
  });
  const changeFieldType = (index: number, type: FormFieldDefinition["type"]) => {
    const conversion = convertFormFieldType(form.fields, index, type);
    if (conversion.cleared.length && !window.confirm(`Changing the field type will clear incompatible ${conversion.cleared.join(" and ")}. Continue?`)) return;
    setForm((current) => ({ ...current, fields: settle(convertFormFieldType(current.fields, index, type).fields) }));
  };
  const selectField = (key: string) => {
    const index = form.fields.findIndex((field) => field.key === key); if (index < 0) return;
    setEditing(index); setAddMenu(null);
    requestAnimationFrame(() => document.getElementById(`form-field-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  };
  const setRoute = (sourceKey: string, optionValue: FormAnswer, route: AnswerRoute) => setForm((current) => ({
    ...current,
    fields: settle(setAnswerRoute(current.fields, sourceKey, optionValue, route)),
  }));
  const setQuestionCondition = (targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined) => setForm((current) => {
    return { ...current, fields: settle(setQuestionAnswerCondition(current.fields, targetKey, sourceKey, optionValue)) };
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
    setEditing(null);
    return {
      ...current,
      // Dropping a section also drops every branch and field that pointed at it.
      sections: remaining.map((section) => section.next === key ? { ...section, next: undefined } : section),
      fields: settle(current.fields.filter((field) => field.sectionKey !== key).map((field) => field.branches?.some((branch) => branch.targetSectionKey === key)
        ? { ...field, branches: field.branches.filter((branch) => branch.targetSectionKey !== key) } : field)),
    };
  });

  /**
   * Creates every list the author asked to add to Dropdown Master and points
   * those questions at it, so the master stays the single copy of the options.
   * Each success is kept even if a later list or the save itself fails.
   */
  const createPendingMasterLists = async (): Promise<FormTemplateDefinition> => {
    let next = form;
    let created = false;
    try {
      for (const [key, name] of Object.entries(pendingLists)) {
        const position = next.fields.findIndex((field) => field.key === key);
        const field = next.fields[position];
        if (!field || field.optionSource || !OPTION_TYPES.has(field.type) || !field.options?.length) continue;
        const question = field.label.trim() || key;
        const masterKey = dropdownMasterKey(name);
        if (!masterKey) throw new Error(`Give a Dropdown Master list name for "${question}", or untick "Also add to Dropdown Master".`);
        let masterType: string;
        try { masterType = await createMasterList(masterKey, field.options.map((option) => ({ value: option.value, label: option.label }))); }
        catch (caught) { throw new Error(`"${question}": ${caught instanceof Error ? caught.message : "could not add the list to Dropdown Master."}`); }
        const { options: _copied, ...rest } = field;
        next = { ...next, fields: next.fields.map((item, at) => at === position ? { ...rest, optionSource: { kind: "master" as const, masterType } } : item) };
        created = true;
        setForm(next);
        pendingMasterLists.set(key, undefined);
      }
    } finally { if (created) await refreshMasters(); }
    return next;
  };

  const save = async (intent: "draft" | "use" = "use") => {
    if (issues.length) { setError(issues[0]?.message ?? "Fix the highlighted form settings before saving."); return; }
    setSaving(true); setError(null);
    try {
      const normalized = normalizeFormDefinition(await createPendingMasterLists());
      const payload = { name: normalized.name, description: normalized.description ?? "", record_name_field_key: normalized.recordNameFieldKey ?? null, sections: normalized.sections ?? [], permissions: { roles: normalized.permissions?.roles ?? [] } } as unknown as Json;
      const fields = toDraftFields(normalized.fields) as unknown as Json;
      if (host) {
        const next = await host.persist({ definition: normalized, payload, fields }, intent);
        setBaseline(JSON.stringify(normalized));
        if (next === "close") onClose();
        return;
      }
      if (bundle?.lifecycle === "published") {
        const impact = await formUsageImpact(bundle.id);
        if (!window.confirm(describePublishedFormEdit(impact))) return;
        await savePublishedForm(bundle.id, payload, fields);
      } else await saveDraft(bundle?.id ?? null, payload, fields);
      await onSaved(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save the form."); } finally { setSaving(false); }
  };

  const previewDefinition = useMemo(() => normalizeFormDefinition(form), [form]);
  const showPreview = wide ? previewShown : narrowView === "preview";
  const showEditor = wide || narrowView === "edit";
  const outlineColumn = wide && (!showPreview || roomy);
  // The library builder sits under the app's top bar; the FMS studio is its own full-screen dialog.
  const appBar = host ? "0px" : "4rem";
  const panelStyle: CSSProperties = { top: `calc(${appBar} + ${headerHeight}px + 0.75rem)`, maxHeight: `calc(100dvh - ${appBar} - ${headerHeight}px - 1.5rem)` };
  const layout = !wide ? "max-w-3xl"
    : showPreview ? cn("grid max-w-[120rem] items-start gap-5", roomy ? "grid-cols-[15rem_minmax(0,1.1fr)_minmax(26rem,1fr)]" : "grid-cols-[minmax(0,1.1fr)_minmax(22rem,1fr)]")
    : "grid max-w-[90rem] grid-cols-[15rem_minmax(0,1fr)] items-start gap-6";
  const close = () => { if (!dirty || window.confirm("Discard unsaved form changes?")) onClose(); };
  /**
   * The respondent's real form, rendered by the same FormRenderer employees
   * use, from the editor's unsaved state. It updates on every edit, keeps the
   * sample answers that still fit, and never submits anything.
   */
  const previewPanel = <aside aria-label="Live preview" className={cn("min-w-0", wide && "sticky overflow-y-auto overscroll-contain rounded-2xl border border-gold/20 bg-charcoal/30")} style={wide ? panelStyle : undefined}>
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-gold/15 bg-obsidian/95 px-3 py-2 backdrop-blur">
      <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold text-champagne"><span aria-hidden className="size-2 rounded-full bg-success" />Live preview</span>
      <div aria-label="Preview size" className="flex rounded-lg border border-gold/20 p-0.5" role="group">
        <button aria-label="Desktop preview" aria-pressed={previewViewport === "desktop"} className={cn("grid size-8 place-items-center rounded-md", previewViewport === "desktop" ? "bg-gold/15 text-gold-secondary" : "text-soft-grey")} onClick={() => setPreviewViewport("desktop")} title="Desktop" type="button"><Monitor className="size-4" /></button>
        <button aria-label="Mobile preview" aria-pressed={previewViewport === "mobile"} className={cn("grid size-8 place-items-center rounded-md", previewViewport === "mobile" ? "bg-gold/15 text-gold-secondary" : "text-soft-grey")} onClick={() => setPreviewViewport("mobile")} title="Mobile" type="button"><Smartphone className="size-4" /></button>
      </div>
      <Button aria-label="Start preview again" className="size-9 min-h-9 p-0" onClick={() => setPreviewVersion((current) => current + 1)} title="Reset preview" type="button" variant="ghost"><RotateCcw className="size-4" /></Button>
      {wide ? <Button aria-label="Hide preview" className="size-9 min-h-9 p-0" onClick={() => setPreviewShown(false)} title="Hide preview" type="button" variant="ghost"><EyeOff className="size-4" /></Button>
        : <Button aria-label="Close preview" className="min-h-9 px-2 text-xs" onClick={() => setNarrowView("edit")} type="button" variant="ghost"><ArrowLeft className="size-4" />Edit</Button>}
    </div>
    <div className={cn("p-3 sm:p-4", previewViewport === "mobile" && "mx-auto max-w-[390px]")}>
      {previewViewport === "mobile" ? <div className="rounded-[1.75rem] border-4 border-charcoal p-3 shadow-xl"><FormRenderer definition={previewDefinition} dynamicOptions={previewOptions} key={previewVersion} preview /></div>
        : <FormRenderer definition={previewDefinition} dynamicOptions={previewOptions} key={previewVersion} preview />}
    </div>
  </aside>;

  return <section className="min-h-[calc(100dvh-8rem)]" data-wide-page><header className={cn("sticky top-0 z-40 mb-5 flex flex-wrap items-center gap-2 border-b border-gold/20 bg-obsidian/95 py-3 backdrop-blur", host ? "-mx-2 px-2" : "-mx-4 -mt-4 px-4 sm:-mx-6 sm:-mt-6 sm:px-6 md:top-16 md:z-20")} ref={headerRef}><Button aria-label={host ? "Close questionnaire editor" : undefined} onClick={close} type="button" variant="ghost"><ArrowLeft className="size-4" />{host ? "Close" : "Back"}</Button><div className="mr-auto min-w-0"><h2 className="truncate text-lg font-semibold text-white">{host?.title ?? (form.name || "New form")}</h2><p className="text-xs text-soft-grey">{dirty ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-gold" />Unsaved changes</span> : host?.subtitle ?? "Build the questions and answer paths for this form."}</p></div>{host?.extraActions?.({ form, replace: (next) => setForm({ ...next, fields: settle(next.fields) }) })}<Button aria-label="Open routing map" onClick={() => setRoutingMap(true)} type="button" variant="ghost"><GitBranch className="size-4" /><span className="hidden sm:inline">Routes</span></Button>{wide ? (previewShown ? null : <Button aria-label="Show preview" onClick={() => setPreviewShown(true)} type="button" variant="secondary"><Eye className="size-4" />Preview</Button>) : narrowView === "edit" ? <Button aria-label="Preview form" onClick={() => setNarrowView("preview")} type="button" variant="secondary"><Eye className="size-4" />Preview</Button> : null}{host ? <>{host.draftLabel ? <Button disabled={saving} onClick={() => void save("draft")} type="button" variant="secondary">{host.draftLabel}</Button> : null}<Button disabled={saving} onClick={() => void save("use")}>{saving ? "Saving..." : host.useLabel}</Button></> : <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : bundle?.lifecycle === "published" ? "Save changes" : "Save draft"}</Button>}</header><div className={cn("mx-auto", layout)}>{outlineColumn ? <FormOutline {...(editing !== null && form.fields[editing]?.key ? { activeKey: form.fields[editing].key } : {})} fields={form.fields} onSelect={selectField} panelStyle={panelStyle} sections={sections} variant="panel" /> : null}{showEditor ? <div className="min-w-0 space-y-5">{error ? <Notice tone="danger">{error}</Notice> : null}
    <section aria-label="Form settings" className="rounded-xl border border-gold/20 p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="Form name"><input className="field" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Customer Onboarding" value={form.name} /></Field><Field label="Description"><input className="field" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What is this form for?" value={form.description ?? ""} /></Field><div className="space-y-1.5 sm:col-span-2"><Field label="Use this question as the record name"><select className="field" value={form.recordNameFieldKey ?? ""} onChange={event => setForm(current => ({ ...current, recordNameFieldKey: event.target.value || undefined }))}><option value="">Automatic</option>{eligibleRecordNameFields(form.fields).map(field => <option key={field.key} value={field.key}>{field.label || field.key}</option>)}</select></Field><p className="text-xs text-soft-grey">An optional default for FMS work using this form. Each workflow can select its own question. Changing a used published form's default requires a new revision.</p></div></div><details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-soft-grey">Who can use this form</summary><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{ROLES.map((role) => <label className="inline-flex min-h-9 items-center gap-1.5 text-xs capitalize text-champagne" key={role}><input checked={form.permissions?.roles.includes(role) ?? false} onChange={(event) => setForm((current) => ({ ...current, permissions: { roles: event.target.checked ? [...new Set([...(current.permissions?.roles ?? []), role])] : (current.permissions?.roles ?? []).filter((value) => value !== role) } }))} type="checkbox" /> {role.replaceAll("_", " ")}</label>)}</div></details></section>

    <details className="rounded-xl border border-gold/20 p-4"><summary className="cursor-pointer text-sm font-semibold text-gold-secondary">Manage sections</summary><section aria-label="Sections" className="mt-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-semibold text-gold-secondary">Sections</h3><Button onClick={addSection} type="button" variant="secondary"><Plus />Add section</Button></div>
      <p className="mb-2 text-xs text-soft-grey">A question can send the respondent to a later section. Only the sections the answers lead to are shown while filling the form.</p>
      <div className="space-y-2">{sections.map((section, index) => <article className="grid gap-2 rounded-xl border border-gold/20 bg-charcoal/30 p-3 sm:grid-cols-[1fr_1fr_auto]" key={section.key}>
        <Field label={`Section ${index + 1} title`}><input className="field" onChange={(event) => patchSection(section.key, { title: event.target.value })} value={section.title} /></Field>
        <FormDestinationSelect label="After this section" fields={form.fields} sections={sections} sectionKey={section.key} value={section.next ?? "__continue__"} onChange={next => patchSection(section.key, { next: next === "__continue__" ? undefined : next })} />
        <div className="flex items-end gap-1"><Button aria-label="Move section up" className="size-11 min-h-11 p-0" disabled={index === 0} onClick={() => moveSection(index, -1)} type="button" variant="ghost"><ChevronUp className="size-4" /></Button><Button aria-label="Move section down" className="size-11 min-h-11 p-0" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)} type="button" variant="ghost"><ChevronDown className="size-4" /></Button><Button aria-label={`Delete ${section.title}`} className="size-11 min-h-11 p-0" disabled={sections.length === 1} onClick={() => { if (window.confirm(`Delete "${section.title}" and its questions?`)) removeSection(section.key); }} type="button" variant="danger"><Trash2 className="size-4" /></Button></div>
        <FormSectionConditions section={section} fields={form.fields} sections={sections} dynamicOptions={previewOptions} masterOptions={masterOptions} onChange={patch => patchSection(section.key, patch)} />
      </article>)}</div>
    </section></details>


    {outlineColumn ? null : <FormOutline {...(editing !== null && form.fields[editing]?.key ? { activeKey: form.fields[editing].key } : {})} fields={form.fields} onSelect={selectField} sections={sections} variant="select" />}
    <section aria-label="Fields"><CustomerIntegrationPanel definition={normalizeFormDefinition(form)} templateId={bundle?.id} unsaved={dirty}/><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ListChecks className="size-5 text-gold-secondary" /><h3 className="text-xl font-semibold text-gold-secondary">Questions</h3></div><span className="rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold-secondary">{form.fields.length} added</span></div>
      {form.fields.length === 0 ? <Notice>Use Add question below to begin your form.</Notice> : null}<div className="space-y-5">{sections.map((section) => <div key={section.key}>
        {sections.length > 1 ? <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-soft-grey">{section.title}</h4> : null}
        <div className="space-y-2">{form.fields.map((field, index) => ({ field, index })).filter((entry) => (entry.field.sectionKey ?? sections[0]!.key) === section.key).map(({ field, index }) => <div key={field.key}><CompactFieldRow dynamicOptions={previewOptions} editing={editing === index} field={field} fields={form.fields} index={index} masterOptions={masterOptions} onAddAfter={() => setAddMenu({ after: index, sectionKey: section.key })} onChangeType={changeFieldType} onDuplicate={duplicate} onEdit={() => setEditing((current) => current === index ? null : index)} onMasterCreated={refreshMasters} onMove={move} pendingMasterLists={pendingMasterLists} onPatch={patchField} onRemove={remove} onSetQuestionCondition={setQuestionCondition} onSetRoute={setRoute} sections={sections} />{addMenu?.after === index && addMenu.sectionKey === section.key ? <AddFieldMenu onAdd={add} onClose={() => setAddMenu(null)} /> : null}</div>)}</div>
        {form.fields.every((field) => (field.sectionKey ?? sections[0]!.key) !== section.key) ? <p className="text-xs text-soft-grey">No questions in this section yet.</p> : null}
        <Button className="mt-2 w-full border-dashed" onClick={() => { const indices = form.fields.map((field, index) => ({ field, index })).filter((entry) => (entry.field.sectionKey ?? sections[0]!.key) === section.key).map((entry) => entry.index); setAddMenu({ after: indices.at(-1) ?? null, sectionKey: section.key }); }} type="button" variant="secondary"><Plus className="size-4" />Add question to {section.title}</Button>
        {addMenu?.sectionKey === section.key && addMenu.after === null ? <AddFieldMenu onAdd={add} onClose={() => setAddMenu(null)} /> : null}
      </div>)}</div></section>

    {issues.length ? <Notice tone="danger">{issues[0]?.message}</Notice> : null}
  </div> : null}{showPreview ? previewPanel : null}</div>{routingMap ? <FormRoutingMap fields={form.fields} onClose={() => setRoutingMap(false)} onNavigate={selectField} sections={sections} /> : null}</section>;
}

function AddFieldMenu({ onAdd, onClose }: { onAdd: (type: FieldKind["type"]) => void; onClose: () => void }) { return <section aria-label="Choose question type" className="mt-2 rounded-xl border border-gold/30 bg-charcoal/80 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-champagne">Choose a question type</p><Button aria-label="Close question types" className="size-11 min-h-11 p-0" onClick={onClose} type="button" variant="ghost"><X className="size-4" /></Button></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{FIELD_KINDS.map((kind) => <FieldPaletteButton key={kind.type} kind={kind} onAdd={onAdd} />)}</div></section>; }

function FieldPaletteButton({ kind, onAdd }: { kind: FieldKind; onAdd: (type: FieldKind["type"]) => void }) { const Icon = kind.icon; return <button className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-gold/20 bg-charcoal/40 px-2 text-center text-xs font-semibold text-champagne transition hover:border-gold hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" onClick={() => onAdd(kind.type)} type="button"><span className="grid size-8 place-items-center rounded-full bg-gold/10 text-gold-secondary"><Icon className="size-4" /></span>{kind.label}</button>; }

function CompactFieldRow({ field, fields, index, editing, dynamicOptions, masterOptions, sections, onAddAfter, onChangeType, onDuplicate, onEdit, onPatch, onMove, onRemove, onSetQuestionCondition, onSetRoute, onMasterCreated, pendingMasterLists }: { field: FormFieldDefinition; fields: readonly FormFieldDefinition[]; index: number; editing: boolean; dynamicOptions: DynamicOptions; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onAddAfter: () => void; onChangeType: (index: number, type: FormFieldDefinition["type"]) => void; onDuplicate: (index: number) => void; onEdit: () => void; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void; onMove: (index: number, direction: number) => void; onRemove: (index: number) => void; onSetQuestionCondition: (targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined) => void; onSetRoute: (sourceKey: string, optionValue: FormAnswer, route: AnswerRoute) => void; onMasterCreated: () => Promise<void>; pendingMasterLists: PendingMasterLists }) {
  const Icon = fieldIcon(field.type);
  const name = field.label || fieldLabel(field.type);
  const links = readGuidedConditionLinks(field);
  const summary = links === null ? "Advanced condition" : links.length ? `Shown after: ${links.map((link) => `${fields.find((item) => item.key === link.sourceKey)?.label ?? link.sourceKey} = ${String(link.optionValue)}`).join(" or ")}` : "";
  const optionPreview = field.options?.slice(0, 2).map((option) => option.label).join(" · ");
  return <article className={`overflow-hidden rounded-xl border bg-charcoal/30 ${editing ? "border-gold ring-1 ring-gold/20" : "border-gold/20"}`} id={`form-field-${field.key}`}><div className="flex items-center gap-2 p-2 sm:p-3">
    <div className="flex flex-col"><button aria-label={`Move ${name} up`} className="text-soft-grey hover:text-gold-secondary" onClick={() => onMove(index, -1)} type="button"><ChevronUp className="size-4" /></button><button aria-label={`Move ${name} down`} className="text-soft-grey hover:text-gold-secondary" onClick={() => onMove(index, 1)} type="button"><ChevronDown className="size-4" /></button></div>
    <span aria-hidden="true" className="hidden size-8 shrink-0 place-items-center rounded-full bg-gold/10 text-gold-secondary sm:grid"><Icon className="size-4" /></span>
    <button className="min-h-11 min-w-0 flex-1 text-left" onClick={onEdit} type="button"><span className="block truncate font-semibold text-champagne">{name}</span><span className="block truncate text-xs text-soft-grey">{fieldLabel(field.type)}{field.required ? " · required" : ""}{field.branches?.length ? ` · ${field.branches.length} branch${field.branches.length === 1 ? "" : "es"}` : ""}</span>{summary ? <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-xs text-gold-secondary"><Filter className="size-3 shrink-0" /><span className="truncate">Shown when {summary}</span></span> : null}</button>
    {optionPreview ? <span className="hidden max-w-40 truncate text-xs text-soft-grey xl:block">{optionPreview}</span> : null}
    <Button aria-label={`Edit ${name}`} className="size-11 min-h-11 p-0" onClick={onEdit} type="button" variant="ghost"><Pencil className="size-4" /></Button>
    <Button aria-label={`Duplicate ${name}`} className="size-11 min-h-11 p-0" onClick={() => onDuplicate(index)} type="button" variant="ghost"><Copy className="size-4" /></Button>
    <Button aria-label={`Remove ${name}`} className="size-11 min-h-11 p-0" onClick={() => onRemove(index)} type="button" variant="danger"><Trash2 className="size-4" /></Button>
  </div>{editing ? <><FieldEditor dynamicOptions={dynamicOptions} field={field} fields={fields} index={index} masterOptions={masterOptions} onChangeType={onChangeType} onMasterCreated={onMasterCreated} onPatch={onPatch} onSetQuestionCondition={onSetQuestionCondition} onSetRoute={onSetRoute} pendingMasterLists={pendingMasterLists} sections={sections} /><button aria-label={`Add question after ${name}`} className="flex w-full items-center justify-center gap-1 border-t border-dashed border-gold/20 py-2 text-xs font-medium text-gold-secondary hover:bg-gold/5" onClick={onAddAfter} type="button"><Plus className="size-3.5" />Add question here</button></> : null}</article>;
}

function FieldEditor({ field, fields, index, dynamicOptions, masterOptions, sections, onChangeType, onPatch, onSetQuestionCondition, onSetRoute, onMasterCreated, pendingMasterLists }: { field: FormFieldDefinition; fields: readonly FormFieldDefinition[]; index: number; dynamicOptions: DynamicOptions; masterOptions: MasterOption[]; sections: readonly FormSectionDefinition[]; onChangeType: (index: number, type: FormFieldDefinition["type"]) => void; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void; onSetQuestionCondition: (targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined) => void; onSetRoute: (sourceKey: string, optionValue: FormAnswer, route: AnswerRoute) => void; onMasterCreated: () => Promise<void>; pendingMasterLists: PendingMasterLists }) {
  const validation = field.validation ?? {};
  const updateValidation = (key: "min" | "max" | "minLength" | "maxLength", raw: string) => onPatch(index, { validation: { ...validation, [key]: raw === "" ? undefined : Number(raw) } });
  return <div className="grid gap-3 border-t border-gold/15 p-3 sm:grid-cols-2">
    <Field label="Question"><input className="field" onChange={(event) => onPatch(index, { label: event.target.value })} value={field.label} /></Field>
    <Field label="Field type"><select aria-label="Field type" className="field" onChange={(event) => onChangeType(index, event.target.value as FormFieldDefinition["type"])} value={field.type}>{FIELD_KINDS.some((kind) => kind.type === field.type) ? null : <option value={field.type}>{fieldLabel(field.type)} (legacy)</option>}{FIELD_KINDS.map((kind) => <option key={kind.type} value={kind.type}>{kind.label}</option>)}</select></Field>
    {OPTION_TYPES.has(field.type) ? <DropdownSourceEditor field={field} index={index} masterOptions={masterOptions} onMasterCreated={onMasterCreated} onPatch={onPatch} onPendingNameChange={(name) => pendingMasterLists.set(field.key, name)} pendingName={pendingMasterLists.names[field.key]} /> : null}
    {!LAYOUT_TYPES.has(field.type) ? <div className="flex flex-wrap items-center gap-4 sm:col-span-2"><label className="text-sm text-champagne"><input checked={field.required === true} onChange={(event) => onPatch(index, { required: event.target.checked })} type="checkbox" /> Required</label></div> : null}
    {!LAYOUT_TYPES.has(field.type) ? <details className="rounded-lg border border-gold/15 bg-obsidian/30 p-3 sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold text-champagne">Conditions &amp; Routing</summary><div className="mt-3 grid gap-3"><VisibilityRuleEditor field={field} index={index} sources={fields.slice(0, index).filter(f => !LAYOUT_TYPES.has(f.type))} masterOptions={masterOptions} dynamicOptions={dynamicOptions} onPatch={onPatch} />{field.type === "checkbox" && (field.options?.length ?? 0) > 0 ? <Notice>When several checked answers route to sections or the end, the first selected routed option in the option order wins. Question visibility can match every selected answer.</Notice> : null}{BRANCH_TYPES.has(field.type) ? <AnswerRoutingEditor dynamicOptions={dynamicOptions} field={field} fields={fields} index={index} masterOptions={masterOptions} onSetRoute={onSetRoute} sections={sections} /> : null}<OptionMappedConditionEditor dynamicOptions={dynamicOptions} field={field} fields={fields} index={index} masterOptions={masterOptions} onSetQuestionCondition={onSetQuestionCondition} /><FormAdvancedRoutes field={field} fields={fields} sections={sections} masterOptions={masterOptions} dynamicOptions={dynamicOptions} onChange={branches => onPatch(index, { branches })} /></div></details> : null}
    <details className="rounded-lg border border-gold/15 bg-obsidian/30 p-3 sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold text-champagne">Advanced settings</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{field.type !== "divider" ? <Field label="Helper text"><input className="field" onChange={(event) => onPatch(index, { helperText: event.target.value })} value={field.helperText ?? ""} /></Field> : null}{!LAYOUT_TYPES.has(field.type) ? <Field label="Placeholder"><input className="field" onChange={(event) => onPatch(index, { placeholder: event.target.value })} value={field.placeholder ?? ""} /></Field> : null}{sections.length > 1 ? <Field label="Section"><select className="field" onChange={(event) => onPatch(index, { sectionKey: event.target.value })} value={field.sectionKey ?? sections[0]?.key ?? ""}>{sections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}</select></Field> : null}{NUMBER_TYPES.has(field.type) && field.type !== "rating" ? <><Field label="Minimum"><input className="field" onChange={(event) => updateValidation("min", event.target.value)} type="number" value={validation.min ?? ""} /></Field><Field label="Maximum"><input className="field" onChange={(event) => updateValidation("max", event.target.value)} type="number" value={validation.max ?? ""} /></Field></> : null}{TEXT_TYPES.has(field.type) ? <><Field label="Minimum length"><input className="field" onChange={(event) => updateValidation("minLength", event.target.value)} type="number" value={validation.minLength ?? ""} /></Field><Field label="Maximum length"><input className="field" onChange={(event) => updateValidation("maxLength", event.target.value)} type="number" value={validation.maxLength ?? ""} /></Field></> : null}{!LAYOUT_TYPES.has(field.type) ? <div className="flex flex-wrap items-center gap-4 sm:col-span-2"><label className="text-sm text-champagne"><input checked={field.shown !== false} onChange={(event) => onPatch(index, { shown: event.target.checked })} type="checkbox" /> Shown</label><label className="text-sm text-champagne"><input checked={field.editable !== false} onChange={(event) => onPatch(index, { editable: event.target.checked })} type="checkbox" /> Editable</label></div> : null}</div></details>
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
    <div><h4 className="font-medium text-champagne">What happens after each answer?</h4><p className="mt-1 text-xs text-soft-grey">Map each answer to a later question, a later section, or the end of the form.{field.validation?.allowOther ? " An answer typed under Other continues normally." : ""}</p></div>
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
        {route.kind !== "continue" ? <p className="text-xs text-gold-secondary sm:col-span-2">{option.label} -&gt; {routeDescription(route, fields, sections)}</p> : null}
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
    {links.length > 1 ? <p className="text-xs text-gold-secondary sm:col-span-2">This question is also mapped from other answers. Change either control to replace those mappings.</p> : null}
  </section>;
}

/** The rule a question is shown by, including the single legacy condition. */
function visibilityRule(field: FormFieldDefinition): FormRule | undefined {
  if (field.rule) return field.rule;
  return field.condition ? { kind: "predicate", ...field.condition } : undefined;
}

/** The answers a question can offer, or null when it is answered freely. */
function answerOptions(source: FormFieldDefinition, masterOptions: MasterOption[], dynamicOptions: DynamicOptions): readonly FormOption[] | null {
  return formAnswerOptions(source, { ...dynamicOptions, masters: toFormMasterOptions(masterOptions) });
}

/**
 * "Show this question only when ..." - the rule that decides whether a question
 * is asked at all. It reads any earlier answer, so the questions ahead change as
 * the respondent fills the form in.
 */
export function VisibilityRuleEditor({ field, index, sources, masterOptions, dynamicOptions, onPatch }: { field: FormFieldDefinition; index: number; sources: readonly FormFieldDefinition[]; masterOptions: MasterOption[]; dynamicOptions: DynamicOptions; onPatch: (index: number, patch: Partial<FormFieldDefinition>) => void }) {
  const rule = visibilityRule(field);
  const mode = !rule ? "always" : rule.negate ? "unless" : "when";
  const write = (next: FormRule | undefined) => onPatch(index, { rule: next, condition: undefined });
  return <section className="space-y-3 rounded-lg border border-gold/15 p-3 sm:col-span-2">
    <h4 className="font-semibold text-champagne">Visibility Conditions</h4>
    <Field label="When should this question appear?"><select className="field" value={mode} onChange={event => {
      if (event.target.value === "always") { write(undefined); return; }
      const first = sources[0];
      if (rule) write({ ...rule, negate: event.target.value === "unless" });
      else if (first) write({ ...defaultFormRulePredicate(first, answerOptions(first, masterOptions, dynamicOptions)), negate: event.target.value === "unless" });
    }}><option value="always">Always show</option><option value="when" disabled={!sources.length}>Show only when conditions match</option><option value="unless" disabled={!sources.length}>Hide when conditions match</option></select></Field>
    {rule ? <FormRuleTreeEditor hideNegation rule={{ ...rule, negate: undefined }} sources={sources} masterOptions={masterOptions} dynamicOptions={dynamicOptions} onChange={next => write(next ? { ...next, negate: mode === "unless" } : undefined)} /> : <p className="text-xs text-soft-grey">Always asked.</p>}
  </section>;
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
  const branchOperator: FormRuleOperator = field.type === "checkbox" || field.type === "multiselect" ? "contains" : "equals";
  return <div className="space-y-2 rounded-lg border border-gold/15 bg-obsidian/40 p-3 sm:col-span-2">
    <div className="flex items-center justify-between gap-2">
      <span className="label mb-0 flex items-center gap-1"><Split className="size-4 text-gold-secondary" />Skip to a section</span>
      <label className="text-xs text-champagne"><input checked={enabled} disabled={!canBranch && !enabled} onChange={(event) => setBranches(event.target.checked && options[0] ? [{ operator: branchOperator, value: options[0].value, targetSectionKey: laterSections[0]?.key ?? "" }] : [])} type="checkbox" /> Send answers down different paths</label>
    </div>
    {!canBranch && !enabled ? <p className="text-xs text-soft-grey">Add at least one option and one later section to send answers down different paths.</p> : null}
    {enabled ? <>{branches.map((branch, position) => <div className="grid gap-2 rounded-lg border border-gold/10 p-2 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end" key={position}>
      <span className="text-xs font-semibold text-soft-grey sm:pb-3">IF</span>
      <Field label="Answer"><select className="field" onChange={(event) => patchBranch(position, { operator: branchOperator, value: event.target.value })} value={typeof branch.value === "string" ? branch.value : ""}>
        <option disabled value="">Choose an answer</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></Field>
      <Field label="Then go to"><select className="field" onChange={(event) => patchBranch(position, { targetSectionKey: event.target.value })} value={branch.targetSectionKey}>
        <option disabled value="">Choose a section</option>
        {laterSections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}
        <option value={FORM_SUBMIT_TARGET}>Submit the form</option>
      </select></Field>
      <Button aria-label="Remove branch" className="size-11 min-h-11 p-0" onClick={() => setBranches(branches.filter((_, item) => item !== position))} type="button" variant="danger"><Trash2 className="size-4" /></Button>
    </div>)}
    <Button className="min-h-9" disabled={!canBranch} onClick={() => setBranches([...branches, { operator: branchOperator, value: options[0]?.value ?? "", targetSectionKey: laterSections[0]?.key ?? FORM_SUBMIT_TARGET }])} type="button" variant="secondary"><Plus className="size-4" />Add branch</Button></> : null}
  </div>;
}
