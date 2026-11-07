// CRM forms built in the Form Builder (owner request 2026-11-03): the JewelOS half of the CRM
// forms host. It reads the active links (get_crm_form_bindings), opens a linked form with the
// shared FormRenderer, and owns CRM Form Settings, where a Super Admin picks a published form
// for each CRM registration and links its questions to CRM answers. Dialogs render into
// document.body: the CRM stylesheet resets every element inside the CRM root.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@jewelos/api-client";
import type { CrmFormLink, CrmFormLinks, CrmLeadSetup, CrmLinkedForm, CrmSubmittedForm } from "@jewelos/crm-ui";
import {
  CRM_FORM_PURPOSE_LABELS, checkCrmFormBinding, crmLinkedQuestions, crmTargetCandidates, displayFormAnswer, formChoiceValueFromText, isFormRepeatAnswer,
  resolveFormOptions, suggestCrmFieldMap,
  type CrmFieldMap, type CrmFormTarget, type FormAnswer, type FormAnswers, type FormCrmServices, type FormFieldDefinition, type FormTemplateDefinition, type Json,
} from "@jewelos/core";
import { CheckCircle2, ExternalLink, Eye, EyeOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { loadFormDynamicOptions, setFormLibraryVisibility, toDefinition, type FormField, type FormTemplate } from "@/features/forms/api";

type LinkablePurpose = "queue" | "lead" | "walkin";
type Targets = Readonly<Record<LinkablePurpose, readonly CrmFormTarget[]>>;

const fail = (label: string, error: { message: string } | null) => { if (error) throw new Error(`${label}: ${error.message}`); };

function linkedForm(template: FormTemplate, fields: FormField[]): CrmLinkedForm {
  return { templateId: template.id, familyId: template.family_id, version: template.version, name: template.name, definition: toDefinition(template, fields) };
}

/** The server's description of each active link (get_crm_form_bindings, migration 0373). */
type RawLinks = { canManage?: unknown; bindings?: Array<{ purpose: CrmFormLink["purpose"]; versionId: string; fieldMap: CrmFieldMap; savedAt: string; savedBy: string | null; form: { template: FormTemplate; fields: FormField[] } | null }> };

export async function loadCrmFormLinks(): Promise<CrmFormLinks> {
  const { data, error } = await supabase.rpc("get_crm_form_bindings");
  fail("Load CRM forms", error);
  // The function returns this exact jsonb shape; rows inside are form_templates/form_fields rows.
  const raw = (data ?? {}) as unknown as RawLinks;
  return {
    canManage: raw.canManage === true,
    links: (raw.bindings ?? []).map((link) => ({ purpose: link.purpose, versionId: link.versionId, fieldMap: link.fieldMap ?? {}, savedAt: link.savedAt, savedBy: link.savedBy, form: link.form ? linkedForm(link.form.template, link.form.fields ?? []) : null })),
  };
}

let dynamicOptionsRequest: Promise<DynamicOptions> | null = null;
/** The last loaded choices, kept on the device so a CRM form still opens when the network drops (no customer data). */
const FORM_CHOICES_CACHE_KEY = "jewelos.forms.choices.v1";
async function loadChoicesWithOfflineCopy(): Promise<DynamicOptions> {
  try {
    const loaded = await loadFormDynamicOptions();
    try { window.localStorage.setItem(FORM_CHOICES_CACHE_KEY, JSON.stringify(loaded)); } catch { /* storage full or unavailable: the online copy still works */ }
    return loaded;
  } catch (caught) {
    try {
      const stored = window.localStorage.getItem(FORM_CHOICES_CACHE_KEY);
      // Written above from a loaded DynamicOptions value on this device.
      if (stored) return JSON.parse(stored) as DynamicOptions;
    } catch { /* unreadable copy: report the original problem */ }
    throw caught;
  }
}
/** People, branches, departments and Dropdown Master choices, loaded once per page visit. */
function useFormChoices(): { options: DynamicOptions | null; error: string | null } {
  const [options, setOptions] = useState<DynamicOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    dynamicOptionsRequest ??= loadChoicesWithOfflineCopy();
    dynamicOptionsRequest.then((loaded) => { if (active) setOptions(loaded); }).catch((caught: unknown) => {
      dynamicOptionsRequest = null;
      if (active) setError(caught instanceof Error ? caught.message : "Could not load the form's choices.");
    });
    return () => { active = false; };
  }, []);
  return { options, error };
}

function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

const SHOWN_AS_WORDING = new Set<FormFieldDefinition["type"]>(["select", "radio", "checkbox", "multiselect", "user_dropdown", "branch_dropdown", "department_dropdown"]);

/** Each answer as the person saw it: a choice's label, a person's or branch's name. */
function displayAnswers(definition: FormTemplateDefinition, answers: FormAnswers, options: DynamicOptions): Record<string, string> {
  const resolved = resolveFormOptions(definition, options.masters);
  const lookups = {
    users: new Map(options.users.map((item) => [item.id, item.label])),
    branches: new Map(options.branches.map((item) => [item.id, item.label])),
    departments: new Map(options.departments.map((item) => [item.id, item.label])),
  };
  // Only choices and people/branch pickers are sent as their wording; dates, numbers, phone numbers
  // and text go to CRM as entered (CRM checks dates as YYYY-MM-DD).
  const display: Record<string, string> = {};
  for (const field of resolved.fields) {
    if (!SHOWN_AS_WORDING.has(field.type)) continue;
    const text = displayFormAnswer(field, answers[field.key], lookups);
    if (text) display[field.key] = text;
  }
  return display;
}

/** Answers given as people see them (choice labels) as the form stores them. */
function answersFromText(definition: FormTemplateDefinition, text: Readonly<Record<string, string>>, options: DynamicOptions): Record<string, FormAnswer> {
  const resolved = resolveFormOptions(definition, options.masters);
  const answers: Record<string, FormAnswer> = {};
  for (const field of resolved.fields) {
    const shown = text[field.key];
    if (shown === undefined || !shown.trim()) continue;
    if (field.type === "select" || field.type === "radio") answers[field.key] = formChoiceValueFromText(field.options, shown);
    else if ((field.type === "checkbox" && field.options?.length) || field.type === "multiselect") answers[field.key] = shown.split(",").map((part) => formChoiceValueFromText(field.options, part.trim())).filter(Boolean);
    else if (field.type === "number" || field.type === "currency") answers[field.key] = Number(shown);
    else if (field.type === "repeat" || field.type === "crm_photo" || field.type === "checkbox") continue;
    else answers[field.key] = shown;
  }
  return answers;
}

/** Each repeating group's rows with choice labels instead of stored values. */
function rowLabels(definition: FormTemplateDefinition, answers: FormAnswers, options: DynamicOptions): Record<string, Array<Record<string, string>>> {
  const resolved = resolveFormOptions(definition, options.masters);
  const result: Record<string, Array<Record<string, string>>> = {};
  for (const field of resolved.fields) {
    const value = answers[field.key];
    if (field.type !== "repeat" || !isFormRepeatAnswer(value)) continue;
    const subs = field.validation?.repeat?.fields ?? [];
    result[field.key] = value.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, cell]) => {
      const sub = subs.find((item) => item.key === key);
      return [key, sub?.options?.find((option) => option.value === cell)?.label ?? cell];
    })));
  }
  return result;
}

export function LinkedFormDialog({ title, description, form, onClose, onSubmit, initialText, initialAnswers, onAnswersChange, crm, submitLabel }: { title: string; description?: string | undefined; form: CrmLinkedForm; onClose: () => void; onSubmit: (submitted: CrmSubmittedForm) => Promise<void>; initialText?: Readonly<Record<string, string>> | undefined; initialAnswers?: FormAnswers | undefined; onAnswersChange?: ((answers: FormAnswers) => void) | undefined; crm?: FormCrmServices | undefined; submitLabel?: string | undefined }) {
  const { options, error } = useFormChoices();
  // A saved draft wins over the prefill for the questions it answered.
  const startAnswers = useMemo(() => options ? { ...(initialText ? answersFromText(form.definition, initialText, options) : {}), ...(initialAnswers ?? {}) } : {}, [form.definition, initialAnswers, initialText, options]);
  return <Portal><Modal mobileFullscreen onClose={onClose} stickyHeader title={title} wide>
    {description ? <p className="-mt-3 mb-4 text-sm text-soft-grey">{description}</p> : null}
    {error ? <Notice tone="danger">{error}</Notice>
      : options ? <FormRenderer crm={crm} definition={form.definition} dynamicOptions={options} initialAnswers={startAnswers} onAnswersChange={onAnswersChange} onSubmit={async (answers) => { await onSubmit({ answers, display: displayAnswers(form.definition, answers, options), rowDisplay: rowLabels(form.definition, answers, options) }); return true; }} submitLabel={submitLabel ?? title} templateId={form.templateId} />
      : <div aria-label="Loading the form" className="grid gap-3"><div className="skeleton h-24 rounded-2xl" /><div className="skeleton h-24 rounded-2xl" /></div>}
  </Modal></Portal>;
}

type PublishedForm = { id: string; family_id: string; name: string; version: number; library_visible: boolean };

async function loadPublishedForms(): Promise<PublishedForm[]> {
  const { data, error } = await supabase.from("form_templates").select("id,family_id,name,version,library_visible").eq("lifecycle", "published").order("name").limit(500);
  fail("Load published forms", error);
  return data ?? [];
}

async function loadPublishedDefinition(templateId: string): Promise<CrmLinkedForm> {
  const [template, fields] = await Promise.all([
    supabase.from("form_templates").select("*").eq("id", templateId).single(),
    supabase.from("form_fields").select("*").eq("form_template_id", templateId).order("sort_order").limit(500),
  ]);
  fail("Load form", template.error); fail("Load form questions", fields.error);
  return linkedForm(template.data!, fields.data ?? []);
}

const TYPE_NAMES: Partial<Record<FormFieldDefinition["type"], string>> = { text: "Short text", textarea: "Long text", phone: "Phone", select: "Dropdown", radio: "Single choice", date: "Date", number: "Number", currency: "Amount", email: "Email" };
const typeName = (field: FormFieldDefinition) => TYPE_NAMES[field.type] ?? field.type.replaceAll("_", " ");

// CRM uses only Form Builder forms here (owner request 2026-11-07): the "Copy today's CRM form" and
// "Use the standard CRM form" choices were removed. `leadSetup` stays in the forms host contract.
export function CrmFormSettingsDialog({ links, targets, onClose, onSaved, onEditForm }: { links: CrmFormLinks; targets: Targets; leadSetup?: CrmLeadSetup; onClose: () => void; onSaved: () => void; onEditForm: (familyId: string) => void }) {
  const [purpose, setPurpose] = useState<LinkablePurpose>("queue");
  const [forms, setForms] = useState<PublishedForm[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState("");
  const [chosen, setChosen] = useState<CrmLinkedForm | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, string | readonly string[]>>({});
  const [busy, setBusy] = useState<"" | "load" | "save" | "hide">("");
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [preview, setPreview] = useState(false);
  const [currentLinks, setCurrentLinks] = useState(links);
  const { options } = useFormChoices();

  const linkable: LinkablePurpose = purpose;
  const active = linkable ? currentLinks.links.find((link) => link.purpose === linkable) ?? null : null;
  const purposeTargets = linkable ? targets[linkable] : [];
  const activeIssues = active?.form ? checkCrmFormBinding(active.form.definition, active.fieldMap, purposeTargets) : active ? [{ message: "The linked form has no published version." }] : [];
  const issues = chosen ? checkCrmFormBinding(chosen.definition, fieldMap, purposeTargets) : [];
  const publishedRow = forms?.find((form) => form.family_id === familyId);
  const unchanged = active?.form?.familyId === familyId && JSON.stringify(active.fieldMap) === JSON.stringify(fieldMap);

  const refreshForms = () => loadPublishedForms().then(setForms).catch((caught: unknown) => setListError(caught instanceof Error ? caught.message : "Could not load forms."));
  useEffect(() => { void refreshForms(); }, []);

  // Each purpose opens on what CRM uses now.
  useEffect(() => {
    setError(null); setChecked(false); setPreview(false);
    if (!linkable) { setFamilyId(""); setChosen(null); setFieldMap({}); return; }
    const link = currentLinks.links.find((item) => item.purpose === linkable);
    setFamilyId(link?.form?.familyId ?? "");
    setChosen(link?.form ?? null);
    setFieldMap({ ...(link?.fieldMap ?? {}) });
  }, [linkable, currentLinks]);

  const choose = async (nextFamily: string, presetMap?: Record<string, string | readonly string[]>) => {
    setFamilyId(nextFamily); setChecked(false); setPreview(false); setError(null);
    if (!nextFamily || !linkable) { setChosen(null); setFieldMap({}); return; }
    const row = (await loadPublishedForms().then((rows) => { setForms(rows); return rows; })).find((form) => form.family_id === nextFamily);
    if (!row) { setChosen(null); setError("That form is no longer published."); return; }
    setBusy("load");
    try {
      const form = await loadPublishedDefinition(row.id);
      setChosen(form);
      setFieldMap(presetMap ?? suggestCrmFieldMap(form.definition, purposeTargets, active?.form?.familyId === nextFamily ? active.fieldMap : {}));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load the form."); }
    finally { setBusy(""); }
  };

  const reloadLinks = async () => { const next = await loadCrmFormLinks(); setCurrentLinks(next); onSaved(); };

  const save = async () => {
    if (!linkable || !chosen || issues.length) { setChecked(true); return; }
    setBusy("save"); setError(null);
    try {
      const mapped = Object.fromEntries(Object.entries(fieldMap).filter(([, key]) => key));
      const { error: saveError } = await supabase.rpc("save_crm_form_binding", { p_purpose: linkable, p_form_family_id: chosen.familyId, p_field_map: mapped as unknown as Json, ...(active ? { p_expected_version_id: active.versionId } : {}) });
      fail("Save CRM form", saveError);
      await reloadLinks();
      toast.success(`CRM now uses "${chosen.name}" for ${CRM_FORM_PURPOSE_LABELS[linkable].toLowerCase()}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message.replace(/^Save CRM form: /, "") : "Could not save."); }
    finally { setBusy(""); }
  };

  const hideFromLibrary = async () => {
    if (!publishedRow) return;
    setBusy("hide");
    try { await setFormLibraryVisibility(publishedRow.id, false); await refreshForms(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not hide the form."); }
    finally { setBusy(""); }
  };

  const tabs: Array<{ key: LinkablePurpose; label: string; badge?: string }> = [
    { key: "queue", label: "Client queue" }, { key: "lead", label: "Lead" }, { key: "walkin", label: "Walk-in visit" },
  ];

  return <Portal><Modal mobileFullscreen onClose={onClose} stickyHeader title="CRM Form Settings" tone="light" wide>
    <p className="-mt-2 mb-4 text-sm text-task-text-muted">Pick the Form Builder form CRM shows for each registration and say which question fills which CRM answer. Questions, order, sections and widths are edited in the Form Builder; each new published version is used from its next opening.</p>
    <div aria-label="CRM form" className="mb-5 grid grid-cols-3 gap-1 rounded-2xl border border-task-border bg-task-muted p-1" role="group">
      {tabs.map((tab) => <button aria-pressed={purpose === tab.key} className={cn("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition", purpose === tab.key ? "bg-task-bg text-task-text shadow-sm" : "text-task-text-muted hover:text-task-text")} key={tab.key} onClick={() => setPurpose(tab.key)} type="button">{tab.label}{tab.badge ? <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-secondary">{tab.badge}</span> : null}</button>)}
    </div>

    {<div className="grid gap-5">
      <section aria-label="Now in use" className="rounded-2xl border border-task-border bg-task-muted/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-task-text-muted">Now in use</p>
        {active?.form ? <>
          <p className="mt-1 font-semibold text-task-text">{active.form.name} <span className="font-normal text-task-text-muted">· version {active.form.version}</span></p>
          <p className="text-sm text-task-text-muted">Linked{active.savedBy ? ` by ${active.savedBy}` : ""} on {new Date(active.savedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
          {activeIssues.length ? <p className="mt-2 flex items-start gap-1.5 text-sm text-danger"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />Needs attention: {activeIssues[0]!.message}</p>
            : <p className="mt-2 flex items-center gap-1.5 text-sm text-success"><CheckCircle2 aria-hidden className="size-4" />Active in CRM</p>}
        </> : <p className="mt-1 font-semibold text-task-text">No form chosen yet <span className="font-normal text-task-text-muted">· choose a Form Builder form below</span></p>}
      </section>

      <section aria-labelledby="crm-form-choose" className="grid gap-3">
        <h3 className="text-base font-semibold text-task-text" id="crm-form-choose">1. Choose the form</h3>
        <select aria-label="Published form" className="field min-h-12" disabled={!forms || busy !== ""} onChange={(event) => void choose(event.target.value)} value={familyId}>
          <option value="">{forms ? "Choose a form from the Form Builder" : "Loading forms…"}</option>
          {(forms ?? []).map((form) => <option key={form.family_id} value={form.family_id}>{form.name} (version {form.version})</option>)}
        </select>
        <p className="text-xs text-task-text-muted">Build or change the form in Forms Library → Form Builder, publish it, then choose it here. Each published version is used from its next opening.</p>
        {listError ? <Notice tone="danger">{listError}</Notice> : null}
        {chosen ? <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-task-text-muted">Version {chosen.version} · {chosen.definition.fields.filter((field) => field.type !== "section_header" && field.type !== "divider").length} questions</span>
          <Button className="min-h-10" onClick={() => setPreview((value) => !value)} type="button" variant="ghost">{preview ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}{preview ? "Hide preview" : "Preview form"}</Button>
          <Button className="min-h-10" onClick={() => onEditForm(chosen.familyId)} type="button" variant="ghost"><ExternalLink aria-hidden className="size-4" />Edit in Form Builder</Button>
        </div> : null}
        {publishedRow?.library_visible ? <Notice tone="task">This form is also listed in Forms Library. Answers given there do not register anyone in CRM. <button className="font-semibold text-gold-secondary underline" disabled={busy !== ""} onClick={() => void hideFromLibrary()} type="button">Hide it from Forms Library</button></Notice> : null}
        {preview && chosen ? <div className="rounded-2xl border border-dashed border-gold/40 p-3 sm:p-4">{options ? <FormRenderer definition={chosen.definition} dynamicOptions={options} preview /> : <div className="skeleton h-32 rounded-2xl" />}</div> : null}
      </section>

      {chosen ? <section aria-labelledby="crm-form-link" className="grid gap-3">
        <div><h3 className="text-base font-semibold text-task-text" id="crm-form-link">2. Link the questions to CRM answers</h3><p className="mt-1 text-xs text-task-text-muted">Questions with matching names are linked for you when you choose the form. Change any link below.</p></div>
        <ul className="grid gap-2">
          {purposeTargets.map((target) => {
            const candidates = crmTargetCandidates(chosen.definition, target);
            const issue = issues.find((item) => item.targetKey === target.key);
            return <li className={cn("grid gap-2 rounded-xl border bg-task-bg p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center", issue && checked ? "border-danger/60" : "border-task-border")} key={target.key}>
              <div className="min-w-0"><p className="font-medium text-task-text">{target.label}{target.required ? <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold-secondary">Required</span> : null}</p><p className="text-xs text-task-text-muted">CRM answer: {target.key}{crmLinkedQuestions(fieldMap, target.key).length > 1 ? ` · also from: ${crmLinkedQuestions(fieldMap, target.key).slice(1).map((key) => chosen.definition.fields.find((field) => field.key === key)?.label ?? key).join(", ")} (whichever is shown)` : ""}</p></div>
              <div className="min-w-0"><select aria-label={`Question for ${target.label}`} className="field" onChange={(event) => { setFieldMap((current) => { const next = { ...current }; if (event.target.value) next[target.key] = event.target.value; else delete next[target.key]; return next; }); setChecked(false); }} value={crmLinkedQuestions(fieldMap, target.key)[0] ?? ""}>
                <option value="">{target.required ? "Choose a question" : "Not asked in this form"}</option>
                {candidates.map((field) => <option key={field.key} value={field.key}>{field.label || field.key} · {typeName(field)}</option>)}
              </select>{issue && checked ? <p className="mt-1 text-xs font-medium text-danger">{issue.message}</p> : null}</div>
            </li>;
          })}
        </ul>
      </section> : null}

      {chosen ? <section aria-labelledby="crm-form-check" className="grid gap-3">
        <h3 className="text-base font-semibold text-task-text" id="crm-form-check">3. Check and save</h3>
        <div aria-live="polite">{checked || issues.length === 0 ? issues.length ? <Notice tone="danger"><p className="font-semibold">Fix these before CRM can use the form:</p><ul className="mt-1 list-disc pl-5">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></Notice>
          : <Notice tone="success">Every CRM answer is linked. {unchanged ? "This is what CRM uses now." : "Ready to use."}</Notice> : null}</div>
        {error ? <div role="alert"><Notice tone="danger">{error}</Notice></div> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button className="min-h-12" disabled={busy !== ""} onClick={() => setChecked(true)} type="button" variant="secondary">Validate mapping</Button>
          <Button className="min-h-12" disabled={busy !== "" || issues.length > 0 || unchanged} onClick={() => void save()} type="button">{busy === "save" ? "Saving…" : unchanged ? "In use" : "Save and use this form"}</Button>
        </div>
      </section> : null}
    </div>}
  </Modal></Portal>;
}
