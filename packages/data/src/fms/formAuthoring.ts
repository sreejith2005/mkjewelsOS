import { resolveFormOptions, type FormTemplateDefinition, type FmsFlowDefinition } from "@jewelos/core";
import { loadForms, loadFormDynamicOptions, loadTaskForms } from "../forms/api";
export type FmsFormAuthoringAction = "create" | "edit" | "preview" | "published";
export type FmsFormAuthoringTarget = Readonly<{ flowId: string; stageKey: string; action: FmsFormAuthoringAction; formTemplateId?: string | undefined }>;

/** Save before leaving the workflow. Only persisted identity crosses into the
 * existing Forms workspace; the pinned version is never changed implicitly. */
export async function prepareFmsFormAuthoring(definition: FmsFlowDefinition, stageKey: string, action: FmsFormAuthoringAction, canManageForms: boolean, persist: () => Promise<string>): Promise<FmsFormAuthoringTarget> {
  const stage = definition.stages.find(stage => stage.key === stageKey);
  if (!stage) throw new Error("The workflow step is no longer available.");
  if ((action === "create" || action === "edit") && !canManageForms) throw new Error("Forms authoring permission is required.");
  if (action !== "create" && !stage.formTemplateId) throw new Error("Select a linked Form first.");
  const flowId = await persist();
  return { flowId, stageKey, action, ...(action !== "create" ? { formTemplateId: stage.formTemplateId } : {}) };
}

export async function loadFmsFormAuthoring(target: FmsFormAuthoringTarget) {
  const [forms, dynamicOptions] = await Promise.all([loadForms(), loadFormDynamicOptions()]);
  const pinned = target.formTemplateId ? forms.bundles.find(form => form.id === target.formTemplateId) : undefined;
  if (target.action !== "create" && !pinned) throw new Error("The linked Form is not visible in your authorized scope.");
  const bundle = target.action === "published"
    ? forms.bundles.filter(form => form.family_id === pinned?.family_id && form.lifecycle === "published").sort((a, b) => b.version - a.version)[0]
    : pinned;
  if (target.action === "published" && !bundle) throw new Error("This Form has no published version.");
  return { bundle, dynamicOptions };
}

export async function loadFmsSimulationForms(definition: FmsFlowDefinition): Promise<Readonly<Record<string, FormTemplateDefinition>>> {
  const ids = [...new Set(definition.stages.flatMap(stage => stage.formTemplateId ? [stage.formTemplateId] : []))];
  if (!ids.length) return {};
  const [forms, options] = await Promise.all([loadTaskForms(ids, []), loadFormDynamicOptions()]);
  if (ids.some(id => !forms.bundles.some(form => form.id === id))) throw new Error("A linked Form is unavailable in your authorized scope. Refresh the workflow before simulating.");
  return Object.fromEntries(forms.bundles.map(form => [form.id, resolveFormOptions({ name: form.name, description: form.description ?? undefined, sections: form.sections, fields: form.fields }, options.masters)]));
}
