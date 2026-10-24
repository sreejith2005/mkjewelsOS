import { approvedFormRoles, FORM_LIBRARY_ROLES, type FmsStageDefinition, type FormTemplateDefinition, type Json } from "@jewelos/core";
import { deleteForm, duplicateForm, loadTaskForms, publishForm, reviseForm, saveDraft, setFormLibraryVisibility, type FormBundle } from "@/features/forms/api";

/**
 * A step's questionnaire is a real Forms Library form, created and edited from
 * inside the FMS builder through the same audited Forms RPCs the library uses.
 * The step always runs an exact published version (`formTemplateId`); edits
 * are a draft of the next version (`sla.questionnaire.draftFormId`) until the
 * author chooses Use in workflow, which publishes the draft and pins it.
 *
 * Where the edits go depends on who owns the Form:
 * - nothing linked yet: a new Form, hidden from the staff library;
 * - a Form this step created (`origin: "stage"`): the next version of it;
 * - a library Form, or a step copied from another workflow: a private copy,
 *   so another stage or workflow using the original never changes.
 */
export type QuestionnaireTarget =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "draft"; draftId: string }>
  | Readonly<{ kind: "revise"; publishedId: string }>
  | Readonly<{ kind: "copy"; publishedId: string }>;

export function questionnaireTarget(stage: FmsStageDefinition): QuestionnaireTarget {
  const draftId = stage.sla.questionnaire?.draftFormId;
  if (draftId) return { kind: "draft", draftId };
  if (!stage.formTemplateId) return { kind: "new" };
  return stage.sla.questionnaire?.origin === "stage" ? { kind: "revise", publishedId: stage.formTemplateId } : { kind: "copy", publishedId: stage.formTemplateId };
}

/** The Form to open in the editor: the step's draft if one exists, otherwise its pinned version. */
export async function loadStageQuestionnaire(stage: FmsStageDefinition): Promise<FormBundle | null> {
  const id = stage.sla.questionnaire?.draftFormId ?? stage.formTemplateId;
  if (!id) return null;
  const { bundles } = await loadTaskForms([id], []);
  const bundle = bundles.find((item) => item.id === id);
  if (!bundle) throw new Error("This questionnaire is not visible in your authorized scope.");
  return bundle;
}

/** The full definition of a Form version, for importing one of its sections. */
export async function loadFormDefinition(id: string): Promise<FormTemplateDefinition> {
  const { bundles } = await loadTaskForms([id], []);
  const bundle = bundles.find((item) => item.id === id);
  if (!bundle) throw new Error("That Form is not visible in your authorized scope.");
  return { name: bundle.name, description: bundle.description ?? undefined, sections: bundle.sections, fields: bundle.fields };
}

/**
 * Saves the editor's content as the draft of the step's next questionnaire
 * version and returns the draft id. The id is returned as soon as the draft
 * exists, so the caller can attach it to the step before anything else can fail.
 */
/**
 * The server accepts only the approved Forms Library roles. A step's doer opens
 * its form through the assignment, not these roles, so they are cleaned here
 * rather than failing the save.
 */
function withApprovedRoles(payload: Json): Json {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const permissions = payload.permissions;
  const roles = permissions && typeof permissions === "object" && !Array.isArray(permissions) && Array.isArray(permissions.roles) ? permissions.roles.filter((role): role is string => typeof role === "string") : undefined;
  return { ...payload, permissions: { roles: [...approvedFormRoles(roles)] } };
}

export async function saveQuestionnaireDraft(target: QuestionnaireTarget, rawPayload: Json, fields: Json, name: string, onCreated: (draftId: string) => Promise<void>): Promise<string> {
  const payload = withApprovedRoles(rawPayload);
  if (target.kind === "draft") return saveDraft(target.draftId, payload, fields);
  if (target.kind === "new") {
    const id = await saveDraft(null, payload, fields);
    await onCreated(id);
    // Stage questionnaires are filled through their workflow, not picked from the staff library.
    await setFormLibraryVisibility(id, false).catch(() => undefined);
    return id;
  }
  const id = target.kind === "revise" ? await reviseForm(target.publishedId) : await duplicateForm(target.publishedId, name);
  await onCreated(id);
  if (target.kind === "copy") await setFormLibraryVisibility(id, false).catch(() => undefined);
  await saveDraft(id, payload, fields);
  return id;
}

/** Publishes the draft through the Forms publish contract; the server validates it. */
export async function publishQuestionnaireDraft(draftId: string): Promise<string> {
  await publishForm(draftId);
  return draftId;
}

/** Deletes an unpublished draft the author no longer wants. */
export async function discardQuestionnaireDraft(draftId: string): Promise<void> {
  await deleteForm(draftId);
}

/** A blank questionnaire named after its step. */
export function blankQuestionnaire(stageName: string, workflowName: string): FormTemplateDefinition {
  return {
    name: `${stageName || "Step"} — ${workflowName || "Workflow"}`.slice(0, 150),
    description: `Questions for the ${stageName || "workflow"} step.`,
    sections: [{ key: "section_1", title: "Section 1" }],
    fields: [],
    permissions: { roles: [...FORM_LIBRARY_ROLES] },
  };
}
