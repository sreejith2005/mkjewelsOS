import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Import } from "lucide-react";
import { fmsStageFormDefinition, formDefinitionForSection, importFormSectionCopy, type FmsStageDefinition, type FormTemplateDefinition } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import { FormBuilder, formBuilderDefinition } from "@/features/forms/FormBuilder";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { loadFormDynamicOptions, type FormBundle } from "@/features/forms/api";
import type { FmsData } from "./api";
import { FmsImportSectionDialog } from "./FmsImportSectionDialog";
import { blankQuestionnaire, loadFormDefinition, loadStageQuestionnaire, publishQuestionnaireDraft, questionnaireTarget, saveQuestionnaireDraft } from "./questionnaire";

/**
 * The questionnaire editor for one FMS step, opened over the canvas so the
 * workflow, the selected step and the undo history stay exactly where they
 * were. It is the Forms Library builder itself (same editor, same live
 * preview, same validation and draft/publish RPCs), hosted with step-aware
 * saving: Save draft keeps the work on the step; Use in workflow publishes it
 * and pins the published version to the step.
 */
export function FmsQuestionnaireStudio({ stage, workflowName, data, seed, onClose, onDraftAttached, onUse }: {
  stage: FmsStageDefinition;
  workflowName: string;
  data: FmsData;
  /** Content to start from instead of the step's own (an imported section). */
  seed?: FormTemplateDefinition | undefined;
  onClose: () => void;
  /** The draft now exists: record it on the step and save the workflow, so a reload keeps it. */
  onDraftAttached: (draftId: string) => Promise<void>;
  /** The draft is published: pin it to the step, save the workflow and refresh question data. */
  onUse: (formId: string) => Promise<void>;
}) {
  const [bundle, setBundle] = useState<FormBundle | null | undefined>(undefined);
  const [options, setOptions] = useState<DynamicOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<((next: FormTemplateDefinition) => void) | null>(null);
  const [current, setCurrent] = useState<FormTemplateDefinition | null>(null);
  const target = questionnaireTarget(stage);

  useEffect(() => {
    let active = true;
    void Promise.all([seed ? Promise.resolve(null) : loadStageQuestionnaire(stage), loadFormDynamicOptions()])
      .then(([loaded, dynamic]) => { if (!active) return; setBundle(loaded); setOptions(dynamic); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Could not open the questionnaire"); });
    return () => { active = false; };
    // The studio loads once per opening; later stage edits (the attached draft id) must not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initial = useMemo(() => {
    if (seed) return seed;
    if (bundle === undefined) return undefined;
    if (!bundle) return blankQuestionnaire(stage.name, workflowName);
    const definition = formBuilderDefinition(bundle);
    if (target.kind !== "copy") return definition;
    // A copy for this step asks what the step asked: only its linked section, if it had one.
    const scoped = stage.sla.formSectionKey ? formDefinitionForSection(definition, stage.sla.formSectionKey) ?? definition : definition;
    return { ...scoped, name: `${stage.name || "Step"} — ${workflowName || bundle.name}`.slice(0, 150) };
  }, [bundle, seed, stage.name, stage.sla.formSectionKey, target.kind, workflowName]);

  const dialog = (content: ReactNode) => <div aria-label={`Questionnaire for ${stage.name || "step"}`} aria-modal="true" className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-obsidian px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6" role="dialog">{content}</div>;
  if (error) return dialog(<div className="mx-auto max-w-xl space-y-3 py-10"><Notice tone="danger">{error}</Notice><Button onClick={onClose}>Back to the workflow</Button></div>);
  if (!initial || !options) return dialog(<div className="mx-auto max-w-xl py-10"><Notice>Opening the questionnaire…</Notice></div>);

  const subtitle = target.kind === "copy" ? "Editing a copy for this step. The original Form is not changed."
    : target.kind === "revise" ? "Changes become the next version when you choose Use in workflow."
    : target.kind === "draft" ? "Unpublished changes. Use in workflow when ready."
    : "Questions for this step. Use in workflow when ready.";

  return dialog(<>
    <FormBuilder
      dynamicOptions={options}
      host={{
        title: `${stage.name || "Step"} · Questions`,
        subtitle,
        initialDefinition: initial,
        initialDirty: !!seed || target.kind === "copy",
        draftLabel: "Save draft",
        useLabel: "Use in workflow",
        persist: async (save, intent) => {
          setCurrent(save.definition);
          const draftId = await saveQuestionnaireDraft(questionnaireTarget(stage), save.payload, save.fields, save.definition.name, onDraftAttached);
          if (intent === "draft") return "stay";
          await publishQuestionnaireDraft(draftId);
          await onUse(draftId);
          return "close";
        },
        extraActions: ({ replace, form }) => <Button aria-label="Import section" onClick={() => { setCurrent(form); setImporting(() => replace); }} type="button" variant="ghost"><Import className="size-4" /><span className="hidden sm:inline">Import section</span></Button>,
      }}
      onClose={onClose}
      onSaved={async () => undefined}
    />
    {importing ? <FmsImportSectionDialog data={data} mode="copy" onClose={() => setImporting(null)} onCopy={(source, sectionKey) => {
      const result = importFormSectionCopy(current ?? initial, source, sectionKey);
      if (result) importing(result.definition);
      setImporting(null);
    }} /> : null}
  </>);
}

/** The step's form exactly as its doer will see it: its own section only, when it has one. */
export function FmsQuestionnairePreview({ stage, onClose }: { stage: FmsStageDefinition; onClose: () => void }) {
  const [definition, setDefinition] = useState<FormTemplateDefinition | null>(null);
  const [options, setOptions] = useState<DynamicOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!stage.formTemplateId) return;
    void Promise.all([loadFormDefinition(stage.formTemplateId), loadFormDynamicOptions()])
      .then(([form, dynamic]) => { if (!active) return; setDefinition(fmsStageFormDefinition(stage, form) ?? form); setOptions(dynamic); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load the form"); });
    return () => { active = false; };
  }, [stage]);
  return <Modal onClose={onClose} title={`Preview: ${stage.name || "Step"}`} wide>
    {error ? <Notice tone="danger">{error}</Notice> : !definition || !options ? <Notice>Loading…</Notice> : <FormRenderer definition={definition} dynamicOptions={options} preview />}
  </Modal>;
}
