import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { planFormSectionImport, type FormSectionImportPlan, type FormTemplateDefinition } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FmsData } from "./api";
import { loadFormDefinition } from "./questionnaire";

/**
 * Choose a Form, then one of its sections, see its questions, and either
 * import an editable copy (the source Form never changes) or link the section
 * as-is (the step uses that exact published version). The two are separate
 * modes with separate buttons so they are never confused.
 */
export function FmsImportSectionDialog({ data, mode, onClose, onCopy, onLink }: {
  data: FmsData;
  mode: "copy" | "link";
  onClose: () => void;
  onCopy?: ((source: FormTemplateDefinition, sectionKey: string) => void) | undefined;
  onLink?: ((formId: string, sectionKey: string | undefined) => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const [formId, setFormId] = useState<string | null>(null);
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  const [source, setSource] = useState<FormTemplateDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const forms = useMemo(() => data.forms.filter((form) => form.lifecycle === "published" && form.name.toLowerCase().includes(query.trim().toLowerCase())), [data.forms, query]);
  const form = data.forms.find((item) => item.id === formId);
  const sections = formId ? data.formSections?.[formId] ?? [] : [];
  /** A Form without sections is one section; it can be copied but only linked whole. */
  const choices = sections.length ? sections : formId ? [{ key: "section_1", title: "All questions", questionCount: (data.formFields[formId] ?? []).length }] : [];
  const questions = formId && sectionKey ? (data.formFields[formId] ?? []).filter((field) => !sections.length || field.sectionKey === sectionKey) : [];
  const plan: FormSectionImportPlan | undefined = source && sectionKey ? planFormSectionImport(source, sectionKey) : undefined;

  useEffect(() => {
    setSource(null); setError(null);
    if (mode !== "copy" || !formId) return;
    let active = true;
    void loadFormDefinition(formId).then((definition) => { if (active) setSource(definition); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load that Form"); });
    return () => { active = false; };
  }, [formId, mode]);

  return <Modal onClose={onClose} title={mode === "copy" ? "Import a section" : "Link a form section"} wide>
    <div className="space-y-3">
      <p className="text-xs text-soft-grey">{mode === "copy" ? "Copies the section's questions into this step's questionnaire. You can edit them; the original Form is not changed." : "This step will ask exactly that section of the published Form version. Edit it in the Forms Library."}</p>
      {!formId ? <>
        <label className="relative block"><Search aria-hidden className="absolute left-3 top-3 size-4 text-soft-grey" /><input aria-label="Search forms" autoFocus className="field pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search forms" value={query} /></label>
        <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">{forms.map((item) => <li key={item.id}><button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-gold/15 px-3 text-left text-sm hover:border-gold/60" onClick={() => { setFormId(item.id); setSectionKey((data.formSections?.[item.id] ?? [])[0]?.key ?? "section_1"); }} type="button"><span className="min-w-0 truncate font-semibold text-white">{item.name}</span><span className="shrink-0 text-xs text-soft-grey">v{item.version} · {(data.formSections?.[item.id] ?? []).length || 1} section{(data.formSections?.[item.id] ?? []).length > 1 ? "s" : ""}</span></button></li>)}
          {!forms.length ? <li className="text-sm text-soft-grey">No published forms match.</li> : null}</ul>
      </> : <>
        <button className="inline-flex items-center gap-1 text-xs font-semibold text-gold-secondary" onClick={() => { setFormId(null); setSectionKey(null); }} type="button"><ArrowLeft className="size-3.5" />{form?.name ?? "Forms"}</button>
        <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="space-y-1" role="radiogroup" aria-label="Section">{choices.map((section) => <button aria-checked={sectionKey === section.key} className={cn("flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm", sectionKey === section.key ? "border-gold bg-gold/10 text-white" : "border-gold/15 text-champagne")} key={section.key} onClick={() => setSectionKey(section.key)} role="radio" type="button"><span className="truncate">{section.title}</span><span className="shrink-0 text-xs text-soft-grey">{section.questionCount}</span></button>)}</div>
          <div className="min-w-0 space-y-2 rounded-lg border border-gold/15 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-soft-grey">Questions included</p>
            <ol className="max-h-56 list-decimal space-y-1 overflow-y-auto pl-5 text-sm text-champagne">{questions.filter((field) => field.type !== "section_header" && field.type !== "divider").map((field) => <li key={field.key}>{field.label}{field.required ? <span className="text-danger"> *</span> : null}</li>)}</ol>
            {!questions.length ? <p className="text-sm text-soft-grey">This section has no questions.</p> : null}
            {plan?.externalDependencies.length ? <Notice tone="danger">{plan.externalDependencies.map((item) => `"${item.label}" is shown based on ${item.dependsOn.map((dependency) => `"${dependency.label}"`).join(", ")}, which is in another section`).join(". ")}. That part of the condition is not imported, so {plan.externalDependencies.length === 1 ? "that question" : "those questions"} will be asked unless you add a new condition.</Notice> : null}
            {plan?.droppedJumps ? <p className="text-xs text-soft-grey">"Skip to another section" jumps are not copied.</p> : null}
          </div>
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">Cancel</Button>
          {mode === "copy" ? <Button disabled={!source || !sectionKey || !questions.length} onClick={() => { if (source && sectionKey) onCopy?.(source, sectionKey); }} type="button">Import a copy</Button>
            : <Button disabled={!formId || !sectionKey} onClick={() => { if (formId) onLink?.(formId, sections.length ? sectionKey ?? undefined : undefined); }} type="button">{sections.length ? "Link this section" : "Link this form"}</Button>}
        </div>
      </>}
    </div>
  </Modal>;
}
