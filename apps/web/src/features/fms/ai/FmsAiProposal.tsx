import { useMemo, useState } from "react";
import { CheckCircle2, FilePlus2, RotateCcw, Wand2 } from "lucide-react";
import {
  applyFmsAiOperations, diffFmsDefinitions, fmsAiFormSpecToDefinition, fmsAiIdFactory, fmsDefaultPathTrace, fmsDefinitionFingerprint,
  normalizeFormDefinition, validateFmsDefinition, validateFormDefinition,
  type FmsAiFormSpec, type FmsAiOperation, type FmsFlowDefinition, type Json,
} from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import type { FmsData } from "../api";
import { saveDraft } from "@/features/forms/api";
import { fmsAiCatalogFromData } from "./catalog";

export type FmsAiProposalSource = Readonly<{
  /** The request id seeds route ids, so this compile matches the server's byte for byte. */
  seed: string;
  operations: readonly FmsAiOperation[];
  baseDefinition: FmsFlowDefinition;
  expectedFingerprint: string | null;
  title: string;
}>;

/**
 * Review before apply. The browser recompiles the operations with the same
 * core compiler and its own copy of the catalog, refuses when the draft has
 * changed since the request, and applies with exactly one editor commit.
 */
export function FmsAiProposalReview({ source, current, data, readOnly, canManageForms = false, formsToCreate = [], onApply, onRegenerate, onCreateRevision }: {
  source: FmsAiProposalSource; current: FmsFlowDefinition; data: FmsData; readOnly: boolean; canManageForms?: boolean; formsToCreate?: readonly FmsAiFormSpec[];
  onApply?: ((next: FmsFlowDefinition) => void) | undefined; onRegenerate?: (() => void) | undefined; onCreateRevision?: (() => void) | undefined;
}) {
  const [applied, setApplied] = useState(false);
  const [formState, setFormState] = useState<Record<string, string>>({});
  const compiled = useMemo(() => applyFmsAiOperations(source.baseDefinition, source.operations, fmsAiCatalogFromData(data), fmsAiIdFactory(source.seed)), [data, source]);
  const conflict = fmsDefinitionFingerprint(current) !== fmsDefinitionFingerprint(source.baseDefinition);
  const mismatch = compiled.ok && source.expectedFingerprint !== null && fmsDefinitionFingerprint(compiled.definition) !== source.expectedFingerprint;
  const diff = compiled.ok ? diffFmsDefinitions(source.baseDefinition, compiled.definition) : null;
  const readiness = compiled.ok ? validateFmsDefinition(compiled.definition, { formFields: data.formFields, availableFormIds: data.forms.map((form) => form.id) }) : [];
  const trace = compiled.ok ? fmsDefaultPathTrace(compiled.definition) : null;
  const people = new Map(data.users.map((user) => [user.id, user.employee_name]));
  const names = new Map((compiled.ok ? compiled.definition : source.baseDefinition).stages.map((stage) => [stage.key, stage.name]));

  const createForm = async (spec: FmsAiFormSpec) => {
    const definition = normalizeFormDefinition(fmsAiFormSpecToDefinition(spec));
    const issues = validateFormDefinition(definition);
    if (issues.length) { setFormState((state) => ({ ...state, [spec.ref]: issues[0]!.message })); return; }
    if (!window.confirm(`Create a draft Form "${spec.name}"? It will not be published. Review and publish it in Forms, then link it here.`)) return;
    setFormState((state) => ({ ...state, [spec.ref]: "Creating draft…" }));
    try {
      const payload = { name: definition.name, description: definition.description ?? "", record_name_field_key: null, sections: definition.sections ?? [], permissions: { roles: definition.permissions?.roles ?? [] } } as unknown as Json; // the same payload shape FormBuilder sends
      await saveDraft(null, payload, definition.fields.map(({ id: _id, sortOrder: _sortOrder, ...field }) => field) as unknown as Json);
      setFormState((state) => ({ ...state, [spec.ref]: "Draft created. Open Forms to review and publish it; then ask me to link it, or link it in the step." }));
    } catch (caught) {
      setFormState((state) => ({ ...state, [spec.ref]: caught instanceof Error ? caught.message : "Could not create the Form draft." }));
    }
  };

  return <section aria-label={`Review: ${source.title}`} className="space-y-3 rounded-xl border border-gold/30 bg-charcoal/60 p-3 text-sm">
    <h4 className="flex items-center gap-2 font-semibold text-white"><Wand2 aria-hidden className="size-4 text-gold-secondary" />{source.title}</h4>
    {source.operations.length && !compiled.ok ? <Notice tone="danger">These changes cannot be applied: {compiled.errors.map((error) => error.message).join(" ")}</Notice> : null}
    {conflict && !applied && source.operations.length ? <Notice tone="danger">You changed the workflow after asking, so this preview is out of date. Nothing was overwritten. {onRegenerate ? <button className="underline" onClick={onRegenerate} type="button">Ask again with the current draft</button> : null}</Notice> : null}
    {mismatch ? <Notice tone="danger">The preview no longer matches the Forms or people you can see. Reload the builder and ask again.</Notice> : null}
    {diff && source.operations.length ? <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-champagne">Changes</p>
      <ul className="mt-1 space-y-1 text-xs text-soft-grey">
        {diff.workflow.map((change) => <li key={change.field}>{change.label}: {change.before} → <b className="text-white">{change.after}</b></li>)}
        {diff.added.map((stage) => <li key={`a-${stage.key}`} className="text-success">+ Add {stage.name} ({stage.type.replaceAll("_", " ")})</li>)}
        {diff.removed.map((stage) => <li key={`r-${stage.key}`} className="text-danger">− Remove {stage.name}</li>)}
        {diff.changed.map((stage) => <li key={`c-${stage.key}`}>~ {stage.name}: {stage.changes.map((change) => change.label).join(", ")}</li>)}
        {!diff.workflow.length && !diff.added.length && !diff.removed.length && !diff.changed.length ? <li>No changes.</li> : null}
      </ul>
    </div> : null}
    {trace?.events.length ? <details><summary className="cursor-pointer text-xs font-semibold text-champagne">Sample path (simulation, creates no work)</summary><ol className="mt-1 space-y-0.5 text-xs text-soft-grey">{trace.events.map((event, index) => <li key={index}>{names.get(event.stageKey) ?? event.stageKey} · {event.status}{event.selectedUserIds.length ? ` · ${event.selectedUserIds.map((id) => people.get(id) ?? "employee").join(", ")}` : ""}{event.note ? ` · ${event.note}` : ""}</li>)}</ol></details> : null}
    {compiled.ok && readiness.length ? <Notice>After applying, {readiness.length} publish-readiness item{readiness.length === 1 ? "" : "s"} will still need your attention: {readiness.slice(0, 3).map((issue) => `${issue.stageKey ? `${names.get(issue.stageKey) ?? issue.stageKey}: ` : ""}${issue.message}`).join("; ")}{readiness.length > 3 ? "…" : ""}</Notice> : null}
    {formsToCreate.map((spec) => <div className="rounded-lg border border-gold/20 p-2 text-xs" key={spec.ref}>
      <p className="font-semibold text-white">Form must be created and published first: {spec.name}</p>
      <p className="text-soft-grey">{spec.fields.map((field) => `${field.label}${field.required ? " *" : ""}`).join(", ")}</p>
      {canManageForms && !readOnly ? <Button className="mt-2 min-h-9 px-3 text-xs" onClick={() => void createForm(spec)} variant="secondary"><FilePlus2 className="size-3" />Create Form draft</Button> : <p className="mt-1 text-soft-grey">Ask a Forms author to create and publish it.</p>}
      {formState[spec.ref] ? <p className="mt-1 text-champagne" role="status">{formState[spec.ref]}</p> : null}
    </div>)}
    {!source.operations.length ? null : readOnly ? (onCreateRevision ? <Button onClick={onCreateRevision} variant="secondary"><RotateCcw className="size-4" />Create a new version to apply this</Button> : <p className="text-xs text-soft-grey">This version is read-only.</p>)
      : applied ? <Notice tone="success"><CheckCircle2 className="mr-1 inline size-4" />Applied to the editor. Use Undo to revert. Save draft and Publish when you are ready.</Notice>
      : <Button disabled={!compiled.ok || conflict || mismatch || !onApply} onClick={() => { if (compiled.ok && onApply) { onApply(compiled.definition); setApplied(true); } }}>Apply to editor</Button>}
  </section>;
}
