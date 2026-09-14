import { DEFAULT_FORM_SECTION, normalizeFormDefinition, type FormTemplateDefinition, type Json, type UserRole } from "@jewelos/core";
import { saveDraft, savePublishedForm, type FormBundle } from "@jewelos/data/forms/api";

export function newFormBuilderDefinition(): FormTemplateDefinition {
  return { name: "", description: "", sections: [DEFAULT_FORM_SECTION], fields: [], permissions: { roles: ["staff"] } };
}

export function formBuilderDefinition(bundle?: FormBundle): FormTemplateDefinition {
  if (!bundle) return newFormBuilderDefinition();
  return normalizeFormDefinition({
    name: bundle.name,
    description: bundle.description ?? "",
    sections: bundle.sections.length ? bundle.sections.map((section) => ({ ...section })) : [DEFAULT_FORM_SECTION],
    fields: bundle.fields.map((field) => ({ ...field, sectionKey: field.sectionKey ?? DEFAULT_FORM_SECTION.key })),
    permissions: { roles: ((bundle.permissions as { roles?: UserRole[] } | null)?.roles ?? ["staff"]) },
  });
}

type SaveApi = Readonly<{
  saveDraft: typeof saveDraft;
  savePublishedForm: typeof savePublishedForm;
}>;

const defaultApi: SaveApi = { saveDraft, savePublishedForm };

export async function saveFormBuilder(bundle: Pick<FormBundle, "id" | "lifecycle"> | undefined, definition: FormTemplateDefinition, api: SaveApi = defaultApi): Promise<string> {
  const normalized = normalizeFormDefinition(definition);
  const payload = {
    name: normalized.name,
    description: normalized.description ?? "",
    sections: normalized.sections ?? [],
    permissions: { roles: normalized.permissions?.roles ?? [] },
  } as unknown as Json;
  const fields = normalized.fields.map(({ id: _id, sortOrder: _sortOrder, ...field }) => field) as unknown as Json;
  if (bundle?.lifecycle === "published") { await api.savePublishedForm(bundle.id, payload, fields); return bundle.id; }
  return api.saveDraft(bundle?.id ?? null, payload, fields);
}
