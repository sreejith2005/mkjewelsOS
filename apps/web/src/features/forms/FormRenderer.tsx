import { useMemo, useRef, useState, type FormEvent } from "react";
import { normalizeFormAnswers, validateCompleteForm, type FormAnswer, type FormAnswers, type FormTemplateDefinition, isFormFieldVisible } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";

export type DynamicOptions = { users: Array<{ id: string; label: string }>; branches: Array<{ id: string; label: string }>; departments: Array<{ id: string; branchId: string | null; label: string }> };
const EMPTY_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [] };
const NUMBER_TYPES = new Set(["number", "currency", "rating"]);
const SELECT_TYPES = new Set(["select", "user_dropdown", "branch_dropdown", "department_dropdown"]);

export function FormRenderer({ definition, dynamicOptions = EMPTY_OPTIONS, initialAnswers = {}, onSubmit, preview = false, readOnly = false }: { definition: FormTemplateDefinition; dynamicOptions?: DynamicOptions; initialAnswers?: FormAnswers; onSubmit?: (answers: FormAnswers) => Promise<void>; preview?: boolean; readOnly?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>(() => Object.fromEntries(Object.entries(initialAnswers).filter((entry): entry is [string, FormAnswer] => entry[1] !== null && entry[1] !== undefined)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const fieldRefs = useRef(new Map<string, HTMLElement>());
  const normalized = useMemo(() => normalizeFormAnswers(definition, answers), [answers, definition]);
  const branchFieldKey = useMemo(() => definition.fields.find((field) => field.type === "branch_dropdown")?.key, [definition]);
  const optionsFor = (type: string) => type === "user_dropdown" ? dynamicOptions.users : type === "branch_dropdown" ? dynamicOptions.branches : type === "department_dropdown" ? dynamicOptions.departments.filter((item) => !branchFieldKey || !answers[branchFieldKey] || item.branchId === answers[branchFieldKey]) : [];
  const set = (key: string, value: FormAnswer) => setAnswers((current) => ({ ...current, [key]: value }));
  const register = (key: string) => (node: HTMLElement | null) => { if (node) fieldRefs.current.set(key, node); else fieldRefs.current.delete(key); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateCompleteForm(definition, answers);
    if (!result.valid) {
      const issue = result.issues.find((item) => item.fieldKey && fieldRefs.current.has(item.fieldKey)) ?? result.issues[0];
      setError(issue?.message ?? "Check the form");
      requestAnimationFrame(() => { if (issue?.fieldKey) fieldRefs.current.get(issue.fieldKey)?.focus(); });
      return;
    }
    if (!onSubmit || preview) return;
    setBusy(true); setError(null);
    try { await onSubmit(normalized); setSuccess(true); } catch (caught) { setError(caught instanceof Error ? caught.message : "Submission failed"); } finally { setBusy(false); }
  };

  return <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
    {preview ? <Notice>Preview mode — nothing is saved.</Notice> : null}
    {error ? <div aria-live="assertive" role="alert"><Notice tone="danger">{error}</Notice></div> : null}
    {success ? <Notice tone="success">Form submitted successfully.</Notice> : null}
    {definition.fields.length === 0 ? <Notice tone="danger">This form version has no saved questions. Close it and edit the draft before publishing.</Notice> : null}
    {definition.fields.map((field) => {
      if (!isFormFieldVisible(field, normalized)) return null;
      if (field.type === "section_header") return <h3 className="text-lg font-semibold text-gold" key={field.key}>{field.label}</h3>;
      if (field.type === "divider") return <hr className="border-gold/20" key={field.key} />;
      if (field.type === "file") return <Notice key={field.key} tone="danger">File fields are unavailable until private upload storage is approved.</Notice>;
      const value = answers[field.key]; const disabled = readOnly || field.editable === false; const dynamic = optionsFor(field.type); const staticOptions = field.options ?? [];
      const selectOptions = dynamic.length ? dynamic : staticOptions.map((label) => ({ id: label, label })); const inputType = NUMBER_TYPES.has(field.type) ? "number" : field.type === "datetime" ? "datetime-local" : field.type;
      const onText = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { const raw = event.target.value; set(field.key, NUMBER_TYPES.has(field.type) ? (raw === "" ? "" : Number(raw)) : raw); };
      return <label className="block" key={field.key}><span className="label">{field.label}{field.required ? " *" : ""}</span>{field.helperText ? <span className="mb-1 block text-xs text-soft-grey">{field.helperText}</span> : null}
        {field.type === "textarea" ? <textarea className="field" disabled={disabled} id={field.key} onChange={onText} placeholder={field.placeholder} ref={register(field.key)} value={typeof value === "string" ? value : ""} />
          : SELECT_TYPES.has(field.type) ? <select className="field" disabled={disabled} id={field.key} onChange={onText} ref={register(field.key)} value={typeof value === "string" ? value : ""}><option value="">Select</option>{selectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          : field.type === "checkbox" ? <input checked={value === true} disabled={disabled} id={field.key} onChange={(event) => set(field.key, event.target.checked)} ref={register(field.key)} type="checkbox" />
          : field.type === "multiselect" ? <select className="field" disabled={disabled} id={field.key} multiple onChange={(event) => set(field.key, [...event.target.selectedOptions].map((option) => option.value))} ref={register(field.key)} value={Array.isArray(value) ? value : []}>{staticOptions.map((option) => <option key={option}>{option}</option>)}</select>
          : field.type === "radio" ? <span className="flex flex-wrap gap-3">{staticOptions.map((option, index) => <label className="text-sm text-champagne" key={option}><input checked={value === option} disabled={disabled} name={field.key} onChange={() => set(field.key, option)} ref={index === 0 ? register(field.key) : undefined} type="radio" /> {option}</label>)}</span>
          : <input className="field" disabled={disabled} id={field.key} onChange={onText} placeholder={field.placeholder} ref={register(field.key)} step={NUMBER_TYPES.has(field.type) ? "any" : undefined} type={inputType} value={typeof value === "string" || typeof value === "number" ? value : ""} />}
      </label>;
    })}
    {!readOnly && definition.fields.length > 0 ? <Button disabled={busy || preview || success} type="submit">{busy ? "Submitting..." : "Submit form"}</Button> : null}
  </form>;
}
