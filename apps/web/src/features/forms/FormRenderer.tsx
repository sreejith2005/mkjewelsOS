import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import { describeFormRule, evaluateFormNavigation, displayFormAnswer, reconcileFormPreviewAnswers, formCompletionProgress, formUsesSteps, isFinalFormStep, nextFormStepKey, normalizeFormAnswers, previousFormStepKey, resolveFormOptions, updateVisibleFormAnswers, validateCompleteForm, validateFormStep, visibleFormSections, type FormAnswer, type FormAnswers, type FormFieldDefinition, type FormMasterOption, type FormTemplateDefinition, type FormValidationIssue } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { signedFormFileUrl, uploadFormFile } from "./api";
import { RatingField } from "./RatingField";

export type DynamicOptions = { users: Array<{ id: string; label: string }>; branches: Array<{ id: string; label: string }>; departments: Array<{ id: string; branchId: string | null; label: string }>; masters: FormMasterOption[] };
const EMPTY_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };
const NUMBER_TYPES = new Set(["number", "currency", "rating"]);
const SELECT_TYPES = new Set(["select", "user_dropdown", "branch_dropdown", "department_dropdown"]);
const LAYOUT_TYPES = new Set(["section_header", "divider"]);
const OPTION_ROW = "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-task-border bg-task-bg px-3 py-2 text-sm text-task-text transition hover:border-gold/50 has-[:checked]:border-gold has-[:checked]:bg-gold/10 has-[:disabled]:cursor-not-allowed";

/** The question text: readable sentence case, with a visible marker for required answers. */
function QuestionText({ field, id }: { field: FormFieldDefinition; id?: string }) {
  return <span className="question-label" id={id}>{field.label}{field.required ? <span aria-hidden="true" className="ml-1 text-danger">*</span> : null}</span>;
}

/** A file field's answer is the id of a row already registered via `register_form_upload` — the upload happens up front, ahead of the eventual `onSubmit`. */
function FileFieldControl({ describedBy, disabled, field, labelledBy, onChange, registerRef, templateId, value }: { describedBy?: string | undefined; disabled: boolean; field: FormFieldDefinition; labelledBy: string; onChange: (value: FormAnswer) => void; registerRef: (node: HTMLElement | null) => void; templateId?: string | undefined; value: FormAnswer | undefined }) {
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
      ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-task-text">
          <Paperclip aria-hidden="true" className="size-4 shrink-0 text-success" />
          <span className="min-w-0 flex-1 break-words">{name ?? "File uploaded"}</span>
          <Button disabled={viewing} onClick={() => void view()} type="button" variant="secondary">{viewing ? "Opening..." : "View"}</Button>
          {!disabled ? <Button onClick={() => { onChange(""); setName(null); }} type="button" variant="ghost">Replace</Button> : null}
        </div>
      : disabled ? <span className="text-sm text-soft-grey">No file uploaded</span>
      : <>
          <input accept="image/jpeg,image/png,image/webp,application/pdf" aria-describedby={describedBy} aria-labelledby={labelledBy} className="block w-full text-sm text-task-text file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-gold file:px-4 file:text-sm file:font-semibold file:text-on-gold" disabled={uploading} onChange={(event) => void onFile(event)} ref={registerRef} type="file" />
          <span className="text-xs text-task-text-muted">Photo (JPG, PNG, WebP) or PDF.</span>
        </>}
    {uploading ? <span className="text-xs text-task-text-muted" role="status">Uploading...</span> : null}
    {error ? <span className="text-sm text-danger">{error}</span> : null}
  </div>;
}

export function FormRenderer({ definition, dynamicOptions = EMPTY_OPTIONS, initialAnswers = {}, onSubmit, preview = false, readOnly = false, templateId, workflowHint = false, selectedFieldKey, onEditField }: { definition: FormTemplateDefinition; dynamicOptions?: DynamicOptions; initialAnswers?: FormAnswers; onSubmit?: (answers: FormAnswers) => Promise<void | boolean>; preview?: boolean; readOnly?: boolean; templateId?: string; workflowHint?: boolean; selectedFieldKey?: string | undefined; onEditField?: ((key: string) => void) | undefined }) {
  const uid = useId();
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>(() => Object.fromEntries(Object.entries(initialAnswers).filter((entry): entry is [string, FormAnswer] => entry[1] !== null && entry[1] !== undefined)));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [previewChecked, setPreviewChecked] = useState(false);
  const [stepKey, setStepKey] = useState<string | null>(null);
  const fieldRefs = useRef(new Map<string, HTMLElement>());
  const formRef = useRef<HTMLFormElement>(null);
  // Dropdown Master questions store only a reference; resolve it for rendering
  // and validation so every option field behaves identically here.
  const resolved = useMemo(() => resolveFormOptions(definition, dynamicOptions.masters), [definition, dynamicOptions.masters]);
  const previousDefinition = useRef(resolved);
  useEffect(() => {
    if (!preview || previousDefinition.current === resolved) return;
    const previous = previousDefinition.current;
    previousDefinition.current = resolved;
    setAnswers(current => {
      const compatible = Object.fromEntries(Object.entries(current).filter(([key, value]) => {
        const next = resolved.fields.find(field => field.key === key);
        if (!next || previous.fields.find(field => field.key === key)?.type !== next.type) return false;
        if ((next.type === "select" || next.type === "radio") && next.options && typeof value === "string") return next.options.some(option => option.value === value);
        if ((next.type === "multiselect" || next.type === "checkbox") && Array.isArray(value)) return value.every(item => next.options?.some(option => option.value === item));
        return true;
      }));
      const next = normalizeFormAnswers(resolved, compatible);
      return Object.fromEntries(Object.entries(next).filter((entry): entry is [string, FormAnswer] => entry[1] !== undefined && entry[1] !== null));
    });
    setFieldErrors({}); setError(null); setPreviewChecked(false);
  }, [preview, resolved]);
  useEffect(() => {
    if (preview && selectedFieldKey) fieldRefs.current.get(selectedFieldKey)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [preview, selectedFieldKey]);
  const normalized = useMemo(() => normalizeFormAnswers(resolved, answers), [answers, resolved]);
  const sections = useMemo(() => visibleFormSections(resolved, answers), [answers, resolved]);
  const navigation = useMemo(() => evaluateFormNavigation(resolved, answers, stepKey ?? undefined), [resolved, answers, stepKey]);
  const progress = useMemo(() => formCompletionProgress(resolved, answers), [answers, resolved]);
  const stepped = formUsesSteps(resolved) && !readOnly;
  const activeStep = stepped ? sections.find(({ section }) => section.key === stepKey) ?? sections[0] : undefined;
  const currentStepKey = activeStep?.section.key;
  const stepIndex = activeStep ? sections.findIndex(({ section }) => section.key === activeStep.section.key) : -1;
  const nextStepKey = currentStepKey ? nextFormStepKey(resolved, answers, currentStepKey) : undefined;
  const previousStepKey = currentStepKey ? previousFormStepKey(resolved, answers, currentStepKey) : undefined;
  // An unanswered branching question means the next step is not known yet; that is not the last step.
  const finalStep = currentStepKey ? isFinalFormStep(resolved, answers, currentStepKey) : true;
  const renderedSections = stepped ? activeStep ? [activeStep] : [] : sections;
  const showSectionTitles = (resolved.sections?.length ?? 0) > 1;
  const branchFieldKey = useMemo(() => resolved.fields.find((field) => field.type === "branch_dropdown")?.key, [resolved]);
  const lookups = useMemo(() => ({
    users: new Map(dynamicOptions.users.map((item) => [item.id, item.label])),
    branches: new Map(dynamicOptions.branches.map((item) => [item.id, item.label])),
    departments: new Map(dynamicOptions.departments.map((item) => [item.id, item.label])),
  }), [dynamicOptions]);
  const optionsFor = (type: string) => type === "user_dropdown" ? dynamicOptions.users : type === "branch_dropdown" ? dynamicOptions.branches : type === "department_dropdown" ? dynamicOptions.departments.filter((item) => !branchFieldKey || !answers[branchFieldKey] || item.branchId === answers[branchFieldKey]) : [];

  // A live preview follows an editor: sample answers the edited Form can no longer
  // hold (a removed question or choice, a changed type) are dropped.
  useEffect(() => { if (preview) setAnswers((current) => reconcileFormPreviewAnswers(resolved, current) as Record<string, FormAnswer>); }, [preview, resolved]);

  // A new step starts at its first question, not wherever the last one was scrolled to.
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (!stepped) return;
    if (firstStepRender.current) { firstStepRender.current = false; return; }
    formRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [currentStepKey, stepped]);

  const set = (key: string, value: FormAnswer) => {
    setPreviewChecked(false);
    setAnswers((current) => updateVisibleFormAnswers(resolved, current, key, value, initialAnswers));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current }; delete next[key]; return next;
    });
    setError(null);
  };
  const showIssues = (issues: readonly FormValidationIssue[], fallback: string) => {
    const byField: Record<string, string> = {};
    for (const issue of issues) if (issue.fieldKey && byField[issue.fieldKey] === undefined) byField[issue.fieldKey] = issue.message;
    const issue = issues.find((item) => item.fieldKey && fieldRefs.current.has(item.fieldKey)) ?? issues[0];
    const others = Object.keys(byField).length - 1;
    setFieldErrors(byField);
    setError(issue ? `${issue.message}${others > 0 ? ` — ${others} more ${others === 1 ? "answer needs" : "answers need"} attention below.` : ""}` : fallback);
    requestAnimationFrame(() => { if (issue?.fieldKey) fieldRefs.current.get(issue.fieldKey)?.focus(); });
  };
  const goToStep = (key: string) => { setError(null); setFieldErrors({}); setStepKey(key); };
  const advance = () => {
    if (!currentStepKey) return;
    const result = validateFormStep(resolved, answers, currentStepKey);
    if (!result.valid) { showIssues(result.issues, "Check this step"); return; }
    if (nextStepKey) goToStep(nextStepKey);
    else if (finalStep) void submitAnswers();
    else setError("Choose an answer to continue.");
  };
  const register = (key: string) => (node: HTMLElement | null) => { if (node) fieldRefs.current.set(key, node); else fieldRefs.current.delete(key); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (stepped && currentStepKey && !finalStep) { advance(); return; }
    void submitAnswers();
  };
  const submitAnswers = async () => {
    const result = validateCompleteForm(resolved, answers);
    if (!result.valid) { showIssues(result.issues, "Check the form"); return; }
    if (preview) { setPreviewChecked(true); setError(null); setFieldErrors({}); return; }
    if (!onSubmit) return;
    setBusy(true); setError(null); setFieldErrors({});
    try { if (await onSubmit(normalized) !== false) setSuccess(true); } catch (caught) { setError(caught instanceof Error ? caught.message : "Submission failed"); } finally { setBusy(false); }
  };

  const renderField = (field: FormFieldDefinition) => {
    if (field.type === "section_header") return <h3 className="text-lg font-semibold text-gold-secondary" key={field.key}>{field.label}</h3>;
    if (field.type === "divider") return <hr className="border-gold/20" key={field.key} />;
    const value = answers[field.key]; const disabled = readOnly || field.editable === false;
    const invalid = fieldErrors[field.key];
    const labelId = `${uid}-${field.key}-label`; const helpId = `${uid}-${field.key}-help`; const errorId = `${uid}-${field.key}-error`;
    const describedBy = [field.helperText ? helpId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;
    const aria = { "aria-describedby": describedBy, "aria-invalid": invalid ? true : undefined, "aria-required": field.required ? true : undefined } as const;
    const helper = field.helperText ? <span className="mb-2 block text-sm text-task-text-muted" id={helpId}>{field.helperText}</span> : null;
    const errorText = invalid ? <span className="mt-1.5 block text-sm font-medium text-danger" id={errorId}>{invalid}</span> : null;
    const shell = (content: ReactNode) => <div className={cn("rounded-xl transition-colors", invalid && "-mx-2 bg-danger/5 px-2 py-2", preview && selectedFieldKey === field.key && "ring-2 ring-gold p-2")} key={field.key}>{preview && onEditField ? <Button className="mb-2" onClick={() => onEditField(field.key)} type="button" variant="ghost">Edit this field<span className="sr-only">: {field.label}</span></Button> : null}{content}</div>;

    if (field.type === "file") return shell(<div><QuestionText field={field} id={labelId} />{helper}
      {preview ? <Notice>Test mode: file uploads are disabled. No file will be stored.</Notice> : <FileFieldControl describedBy={describedBy} disabled={disabled} field={field} labelledBy={labelId} onChange={(next) => set(field.key, next)} registerRef={register(field.key)} templateId={templateId} value={answers[field.key]} />}{errorText}
    </div>);
    const dynamic = optionsFor(field.type); const staticOptions = field.options ?? [];
    const checkboxOptions = staticOptions.length ? staticOptions : dynamic.map((option) => ({ value: option.id, label: option.label }));
    // Multi-answer questions are a tappable list on every device: a native multi-select is unusable on Android.
    if ((field.type === "checkbox" && checkboxOptions.length) || field.type === "multiselect") {
      const selected = Array.isArray(value) ? value : [];
      const choices = field.type === "multiselect" ? staticOptions : checkboxOptions;
      return shell(<fieldset aria-describedby={describedBy} className="space-y-2"><legend className="mb-1"><QuestionText field={field} /></legend>{helper}
        <p className="text-xs text-task-text-muted">Choose all that apply.</p>
        <div className="grid gap-2">{choices.map((option, index) => <label className={OPTION_ROW} key={option.value}><input checked={selected.includes(option.value)} disabled={disabled} onChange={(event) => set(field.key, event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))} ref={index === 0 ? register(field.key) : undefined} type="checkbox" /><span className="min-w-0 break-words">{option.label}</span></label>)}</div>{errorText}
      </fieldset>);
    }
    if (field.type === "rating") return shell(<fieldset aria-describedby={describedBy} className="space-y-2"><legend className="mb-1"><QuestionText field={field} /></legend>{helper}<RatingField disabled={disabled} label={field.label} onChange={(next) => set(field.key, next)} registerRef={register(field.key)} value={typeof value === "number" ? value : undefined} />{errorText}</fieldset>);
    if (field.type === "radio") return shell(<fieldset aria-describedby={describedBy} className="space-y-2"><legend className="mb-1"><QuestionText field={field} /></legend>{helper}
      <div className="grid gap-2">{staticOptions.map((option, index) => <label className={OPTION_ROW} key={option.value}><input checked={value === option.value} disabled={disabled} name={`${uid}-${field.key}`} onChange={() => set(field.key, option.value)} ref={index === 0 ? register(field.key) : undefined} type="radio" /><span className="min-w-0 break-words">{option.label}</span></label>)}</div>{errorText}
    </fieldset>);

    const selectOptions = dynamic.length ? dynamic : staticOptions.map((option) => ({ id: option.value, label: option.label }));
    const onText = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { const raw = event.target.value; set(field.key, NUMBER_TYPES.has(field.type) ? (raw === "" ? "" : Number(raw)) : raw); };
    const inputType = NUMBER_TYPES.has(field.type) ? "number" : field.type === "datetime" ? "datetime-local" : field.type === "phone" ? "tel" : field.type;
    const inputMode = field.type === "phone" ? "tel" : field.type === "email" ? "email" : NUMBER_TYPES.has(field.type) ? "decimal" : undefined;
    const textValue = typeof value === "string" || typeof value === "number" ? value : "";
    const control = field.type === "textarea" ? <textarea {...aria} className="field min-h-24" disabled={disabled} maxLength={field.validation?.maxLength} onChange={onText} placeholder={field.placeholder} ref={register(field.key)} rows={3} value={typeof value === "string" ? value : ""} />
      : SELECT_TYPES.has(field.type) ? <select {...aria} className="field" disabled={disabled} onChange={onText} ref={register(field.key)} value={typeof value === "string" ? value : ""}><option value="">Choose an answer</option>{selectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
      : field.type === "checkbox" ? <span className={OPTION_ROW}><input {...aria} checked={value === true} disabled={disabled} onChange={(event) => set(field.key, event.target.checked)} ref={register(field.key)} type="checkbox" /><span>{field.placeholder ?? "Yes"}</span></span>
      : field.type === "currency" ? <span className="relative block"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-task-text-muted">₹</span><input {...aria} className="field pl-7" disabled={disabled} inputMode="decimal" onChange={onText} placeholder={field.placeholder} ref={register(field.key)} step="any" type="number" value={textValue} /></span>
      : <input {...aria} autoComplete={field.type === "phone" ? "tel" : field.type === "email" ? "email" : undefined} className="field" disabled={disabled} inputMode={inputMode} maxLength={field.validation?.maxLength} onChange={onText} placeholder={field.placeholder} ref={register(field.key)} step={NUMBER_TYPES.has(field.type) ? "any" : undefined} type={inputType} value={textValue} />;
    return shell(<label className="block"><span className="mb-1.5 block"><QuestionText field={field} /></span>{helper}{control}{errorText}</label>);
  };

  const reviewRows = stepped && finalStep && stepIndex > 0
    ? sections.map(({ section, fields }) => ({ section, rows: fields.filter((field) => !LAYOUT_TYPES.has(field.type)).map((field) => ({ field, text: displayFormAnswer(field, answers[field.key], lookups) })) })).filter(({ rows }) => rows.length)
    : [];
  const requiredPercent = progress.requiredTotal ? Math.round((progress.requiredAnswered / progress.requiredTotal) * 100) : 0;

  return <form className="flex flex-col gap-5" onSubmit={submit} ref={formRef}>
    {workflowHint && !preview ? <Notice>When you submit, your answers are saved and you will see who receives the next step.</Notice> : null}
    {preview ? <><Notice>Preview mode - nothing is saved.</Notice><details className="min-w-0 rounded-lg border border-task-border p-3"><summary className="cursor-pointer text-sm font-medium text-task-text">Routing simulation</summary><div className="mt-3 space-y-2 text-xs text-task-text-muted">
      {resolved.sections?.map(section => <p key={section.key}>{section.title}: {navigation.reachedSectionKeys.includes(section.key) ? "on selected path" : "skipped"}{section.rule ? ` - ${section.visibility === "unless" ? "hide when" : "eligible when"} ${describeFormRule(section.rule, key => resolved.fields.find(f => f.key === key)?.label ?? key)}` : section.visibility === "routed" ? " - routing only" : ""}</p>)}
      {navigation.routes.map((route, i) => <p key={i}>{route.name || (route.fieldKey ? resolved.fields.find(f => f.key === route.fieldKey)?.label : resolved.sections?.find(s => s.key === route.sectionKey)?.title)} -&gt; {route.target === "__submit__" ? "Submit form" : route.target === "__stage_end__" ? "End current form stage" : resolved.sections?.find(s => s.key === route.target)?.title ?? resolved.fields.find(f => "__question__:" + f.key === route.target)?.label ?? route.target}</p>)}
      <p>{navigation.submissionAllowed ? "The selected path ends with form submission." : "Waiting for a routing answer."}</p>
      {navigation.issues.map((issue, i) => <p className="text-danger" key={i}>{issue.message}</p>)}
      <Button type="button" variant="secondary" onClick={() => { setAnswers({}); setStepKey(null); setFieldErrors({}); setError(null); setPreviewChecked(false); }}>Reset simulation</Button>
    </div></details></> : null}
    {resolved.fields.length === 0 ? <Notice tone="danger">This form version has no saved questions. Close it and edit the draft before publishing.</Notice> : null}
    {!readOnly && progress.requiredTotal > 0 ? <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-task-text-muted"><span>Questions marked <span className="text-danger">*</span> must be answered.</span><span className="tabular-nums">{progress.requiredAnswered} of {progress.requiredTotal} required answered</span></div>
      <div aria-label="Required questions answered" aria-valuemax={progress.requiredTotal} aria-valuemin={0} aria-valuenow={progress.requiredAnswered} className="h-1.5 overflow-hidden rounded-full bg-task-muted" role="progressbar"><div className="h-full rounded-full bg-gold transition-[width] duration-300" style={{ width: `${requiredPercent}%` }} /></div>
    </div> : null}
    {stepped && activeStep ? <nav aria-label="Form steps" className="space-y-2">
      <p className="text-sm font-semibold text-task-text" role="status">Step {stepIndex + 1}</p>
      {stepIndex > 0 ? <ol className="no-scrollbar scroll-x -mx-1 flex gap-2 px-1 pb-1">{sections.slice(0, stepIndex + 1).map(({ section }, index) => <li className="shrink-0" key={section.key}>
        {index < stepIndex
          ? <button aria-label={`Go back to step ${index + 1}: ${section.title}`} className="inline-flex min-h-9 max-w-[14rem] items-center gap-1.5 rounded-full border border-task-border bg-task-bg px-3 text-xs text-task-text-muted transition hover:border-gold/50 hover:text-task-text" disabled={busy || success} onClick={() => goToStep(section.key)} type="button"><Check aria-hidden="true" className="size-3.5 shrink-0 text-success" /><span className="truncate">{index + 1}. {section.title}</span></button>
          : <span aria-current="step" className="inline-flex min-h-9 max-w-[14rem] items-center rounded-full border border-gold/60 bg-gold/10 px-3 text-xs font-semibold text-task-text"><span className="truncate">{index + 1}. {section.title}</span></span>}
      </li>)}</ol> : null}
    </nav> : null}
    {renderedSections.map(({ section, fields }) => <section aria-label={section.title} className={showSectionTitles ? "rounded-xl border border-task-border p-4" : ""} key={section.key}>
      {showSectionTitles ? <header className="mb-4"><h3 className="text-base font-semibold text-gold-secondary">{section.title}</h3>{section.description ? <p className="mt-0.5 text-sm text-task-text-muted">{section.description}</p> : null}</header> : null}
      <div className="flex flex-col gap-5">{fields.map(renderField)}</div>
    </section>)}
    {reviewRows.length ? <details className="rounded-xl border border-task-border bg-task-muted/40 p-3">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-task-text">Check your answers before submitting</summary>
      <div className="mt-2 space-y-4">{reviewRows.map(({ section, rows }) => <div key={section.key}>
        <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-semibold uppercase tracking-wider text-task-text-muted">{section.title}</h4>{section.key !== currentStepKey ? <Button className="min-h-9 px-2 text-xs" disabled={busy || success} onClick={() => goToStep(section.key)} type="button" variant="ghost">Change</Button> : null}</div>
        <dl className="mt-1 divide-y divide-task-border">{rows.map(({ field, text }) => <div className="grid gap-0.5 py-2 sm:grid-cols-[minmax(8rem,1fr)_2fr] sm:gap-3" key={field.key}><dt className="text-sm text-task-text-muted">{field.label}</dt><dd className={cn("min-w-0 whitespace-pre-wrap break-words text-sm", text ? "text-task-text" : "italic text-task-text-muted")}>{text || "Not answered"}</dd></div>)}</dl>
      </div>)}</div>
    </details> : null}
    {error ? <div aria-live="assertive" role="alert"><Notice tone="danger">{error}</Notice></div> : null}
    {success ? <Notice tone="success">Form submitted successfully.</Notice> : null}
    {previewChecked ? <Notice tone="success">Test validation passed. No data was submitted.</Notice> : null}
    {!readOnly && resolved.fields.length > 0 ? <div className="form-actions sticky z-10 -mx-1 mt-1 flex gap-2 border-t border-task-border bg-task-bg/95 px-1 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
      {stepped && previousStepKey ? <Button className="min-h-12 shrink-0" disabled={busy || success} onClick={() => goToStep(previousStepKey)} type="button" variant="secondary"><ChevronLeft aria-hidden="true" className="size-4" />Back</Button> : null}
      {/* Keep navigation separate: reusing Next as Submit can submit during the same native click. */}
      {stepped && (nextStepKey || !finalStep) ? <Button className="min-h-12 flex-1 sm:flex-none" disabled={busy || success} key="next" onClick={advance} type="button">Next<ChevronRight aria-hidden="true" className="size-4" /></Button>
        : <Button className="min-h-12 flex-1 sm:flex-none" disabled={busy || success} key="submit" type="submit">{busy ? "Submitting..." : preview ? "Test validation" : "Submit form"}</Button>}
    </div> : null}
  </form>;
}
