import { useMemo, useRef, useState, type FormEvent } from "react";
import { normalizeFormAnswers, resolveFormOptions, validateCompleteForm, visibleFormSections, type FormAnswer, type FormAnswers, type FormFieldDefinition, type FormMasterOption, type FormTemplateDefinition } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { signedFormFileUrl, uploadFormFile } from "./api";
import { RatingField } from "./RatingField";

export type DynamicOptions = { users: Array<{ id: string; label: string }>; branches: Array<{ id: string; label: string }>; departments: Array<{ id: string; branchId: string | null; label: string }>; masters: FormMasterOption[] };
const EMPTY_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };
const NUMBER_TYPES = new Set(["number", "currency", "rating"]);
const SELECT_TYPES = new Set(["select", "user_dropdown", "branch_dropdown", "department_dropdown"]);

/** A file field's answer is the id of a row already registered via `register_form_upload` — the upload happens up front, ahead of the eventual `onSubmit`. */
function FileFieldControl({ disabled, field, onChange, registerRef, templateId, value }: { disabled: boolean; field: FormFieldDefinition; onChange: (value: FormAnswer) => void; registerRef: (node: HTMLElement | null) => void; templateId?: string | undefined; value: FormAnswer | undefined }) {
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileId = typeof value === "string" && value ? value : null;

  if (!templateId) return <Notice>File upload isn't available until the form is saved.</Notice>;

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setUploading(true); setError(null);
    try { const uploaded = await uploadFormFile(templateId, field.key, file); setName(uploaded.name); onChange(uploaded.id); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed"); }
    finally { setUploading(false); }
  };
  const view = async () => {
    if (!fileId) return;
    setViewing(true); setError(null);
    try { window.open(await signedFormFileUrl(fileId), "_blank", "noopener"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open file"); }
    finally { setViewing(false); }
  };

  return <div className="flex flex-col gap-2">
    {fileId
      ? <div className="flex flex-wrap items-center gap-2 text-sm text-champagne">
          <span>{name ?? "File uploaded"}</span>
          <Button disabled={viewing} onClick={() => void view()} type="button" variant="secondary">{viewing ? "Opening..." : "View"}</Button>
          {!disabled ? <Button onClick={() => { onChange(""); setName(null); }} type="button" variant="ghost">Replace</Button> : null}
        </div>
      : disabled ? <span className="text-sm text-soft-grey">No file uploaded</span>
      : <input accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full text-sm text-champagne file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-gold file:px-4 file:text-sm file:font-semibold file:text-obsidian" disabled={uploading} onChange={(event) => void onFile(event)} ref={registerRef} type="file" />}
    {uploading ? <span className="text-xs text-soft-grey">Uploading...</span> : null}
    {error ? <span className="text-xs text-red-400">{error}</span> : null}
  </div>;
}

export function FormRenderer({ definition, dynamicOptions = EMPTY_OPTIONS, initialAnswers = {}, onSubmit, preview = false, readOnly = false, templateId, workflowHint = false }: { definition: FormTemplateDefinition; dynamicOptions?: DynamicOptions; initialAnswers?: FormAnswers; onSubmit?: (answers: FormAnswers) => Promise<void>; preview?: boolean; readOnly?: boolean; templateId?: string; workflowHint?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>(() => Object.fromEntries(Object.entries(initialAnswers).filter((entry): entry is [string, FormAnswer] => entry[1] !== null && entry[1] !== undefined)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const fieldRefs = useRef(new Map<string, HTMLElement>());
  // Dropdown Master questions store only a reference; resolve it for rendering
  // and validation so every option field behaves identically here.
  const resolved = useMemo(() => resolveFormOptions(definition, dynamicOptions.masters), [definition, dynamicOptions.masters]);
  const normalized = useMemo(() => normalizeFormAnswers(resolved, answers), [answers, resolved]);
  const sections = useMemo(() => visibleFormSections(resolved, answers), [answers, resolved]);
  const showSectionTitles = (resolved.sections?.length ?? 0) > 1;
  const branchFieldKey = useMemo(() => resolved.fields.find((field) => field.type === "branch_dropdown")?.key, [resolved]);
  const optionsFor = (type: string) => type === "user_dropdown" ? dynamicOptions.users : type === "branch_dropdown" ? dynamicOptions.branches : type === "department_dropdown" ? dynamicOptions.departments.filter((item) => !branchFieldKey || !answers[branchFieldKey] || item.branchId === answers[branchFieldKey]) : [];
  const set = (key: string, value: FormAnswer) => setAnswers((current) => ({ ...current, [key]: value }));
  const register = (key: string) => (node: HTMLElement | null) => { if (node) fieldRefs.current.set(key, node); else fieldRefs.current.delete(key); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateCompleteForm(resolved, answers);
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

  const renderField = (field: FormFieldDefinition) => {
    if (field.type === "section_header") return <h3 className="text-lg font-semibold text-gold" key={field.key}>{field.label}</h3>;
    if (field.type === "divider") return <hr className="border-gold/20" key={field.key} />;
    if (field.type === "file") { const disabled = readOnly || field.editable === false; return <label className="block" key={field.key}><span className="label">{field.label}{field.required ? " *" : ""}</span>{field.helperText ? <span className="mb-1 block text-xs text-soft-grey">{field.helperText}</span> : null}
      <FileFieldControl disabled={disabled} field={field} onChange={(next) => set(field.key, next)} registerRef={register(field.key)} templateId={templateId} value={answers[field.key]} />
    </label>; }
    const value = answers[field.key]; const disabled = readOnly || field.editable === false; const dynamic = optionsFor(field.type); const staticOptions = field.options ?? [];
    const checkboxOptions = staticOptions.length ? staticOptions : dynamic.map((option) => ({ value: option.id, label: option.label }));
    if (field.type === "checkbox" && checkboxOptions.length) {
      const selected = Array.isArray(value) ? value : [];
      return <fieldset className="space-y-2" key={field.key}><legend className="label">{field.label}{field.required ? " *" : ""}</legend>{field.helperText ? <p className="text-xs text-soft-grey">{field.helperText}</p> : null}
        <div className="grid gap-2">{checkboxOptions.map((option, index) => <label className="flex min-h-12 items-center gap-3 rounded-lg border border-gold/15 px-3 py-2 text-sm text-champagne transition hover:border-gold/40" key={option.value}><input checked={selected.includes(option.value)} disabled={disabled} onChange={(event) => set(field.key, event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))} ref={index === 0 ? register(field.key) : undefined} type="checkbox" />{option.label}</label>)}</div>
      </fieldset>;
    }
    if (field.type === "rating") return <fieldset className="space-y-2" key={field.key}><legend className="label">{field.label}{field.required ? " *" : ""}</legend>{field.helperText ? <p className="text-xs text-soft-grey">{field.helperText}</p> : null}<RatingField disabled={disabled} label={field.label} onChange={(next) => set(field.key, next)} registerRef={register(field.key)} value={typeof value === "number" ? value : undefined} /></fieldset>;
    const selectOptions = dynamic.length ? dynamic : staticOptions.map((option) => ({ id: option.value, label: option.label })); const inputType = NUMBER_TYPES.has(field.type) ? "number" : field.type === "datetime" ? "datetime-local" : field.type;
    const onText = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { const raw = event.target.value; set(field.key, NUMBER_TYPES.has(field.type) ? (raw === "" ? "" : Number(raw)) : raw); };
    return <label className="block" key={field.key}><span className="label">{field.label}{field.required ? " *" : ""}</span>{field.helperText ? <span className="mb-1 block text-xs text-soft-grey">{field.helperText}</span> : null}
      {field.type === "textarea" ? <textarea className="field" disabled={disabled} id={field.key} onChange={onText} placeholder={field.placeholder} ref={register(field.key)} value={typeof value === "string" ? value : ""} />
        : SELECT_TYPES.has(field.type) ? <select className="field" disabled={disabled} id={field.key} onChange={onText} ref={register(field.key)} value={typeof value === "string" ? value : ""}><option value="">Select</option>{selectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        : field.type === "checkbox" ? <span className="flex min-h-12 items-center gap-3 rounded-lg border border-gold/15 px-3 py-2 text-sm text-champagne"><input checked={value === true} disabled={disabled} id={field.key} onChange={(event) => set(field.key, event.target.checked)} ref={register(field.key)} type="checkbox" /><span>{field.placeholder ?? "Yes"}</span></span>
        : field.type === "multiselect" ? <select className="field" disabled={disabled} id={field.key} multiple onChange={(event) => set(field.key, [...event.target.selectedOptions].map((option) => option.value))} ref={register(field.key)} value={Array.isArray(value) ? value : []}>{staticOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : field.type === "radio" ? <span className="grid gap-2">{staticOptions.map((option, index) => <label className="flex min-h-12 items-center gap-3 rounded-lg border border-gold/15 px-3 py-2 text-sm text-champagne transition hover:border-gold/40" key={option.value}><input checked={value === option.value} disabled={disabled} name={field.key} onChange={() => set(field.key, option.value)} ref={index === 0 ? register(field.key) : undefined} type="radio" /><span>{option.label}</span></label>)}</span>
        : <input className="field" disabled={disabled} id={field.key} onChange={onText} placeholder={field.placeholder} ref={register(field.key)} step={NUMBER_TYPES.has(field.type) ? "any" : undefined} type={inputType} value={typeof value === "string" || typeof value === "number" ? value : ""} />}
    </label>;
  };

  return <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
    {workflowHint && !preview ? <Notice><span className="font-semibold text-white">Workflow form?</span> If this form is linked to an FMS process, submit once and the next step starts automatically for the right person.</Notice> : null}
    {preview ? <Notice>Preview mode — nothing is saved.</Notice> : null}
    {error ? <div aria-live="assertive" role="alert"><Notice tone="danger">{error}</Notice></div> : null}
    {success ? <Notice tone="success">Form submitted successfully.</Notice> : null}
    {resolved.fields.length === 0 ? <Notice tone="danger">This form version has no saved questions. Close it and edit the draft before publishing.</Notice> : null}
    {sections.map(({ section, fields }) => <section aria-label={section.title} className={showSectionTitles ? "rounded-xl border border-gold/15 p-4" : ""} key={section.key}>
      {showSectionTitles ? <header className="mb-3"><h3 className="text-base font-semibold text-gold">{section.title}</h3>{section.description ? <p className="text-xs text-soft-grey">{section.description}</p> : null}</header> : null}
      <div className="flex flex-col gap-4">{fields.map(renderField)}</div>
    </section>)}
    {!readOnly && resolved.fields.length > 0 ? <div className="sticky bottom-0 -mx-1 mt-2 border-t border-gold/15 bg-task-bg/95 px-1 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"><Button className="min-h-12 w-full sm:w-auto" disabled={busy || preview || success} type="submit">{busy ? "Submitting..." : "Submit form"}</Button></div> : null}
  </form>;
}
