import { workUploadFormDefinition, type Json } from "@jewelos/core";
import { publishForm, saveDraft } from "./api";

/** Author action; the ordinary audited Forms draft/publish contracts own persistence. */
export async function installWorkUploadForm(): Promise<string> {
  const definition = workUploadFormDefinition;
  const payload = {
    name: definition.name,
    description: definition.description,
    sections: definition.sections,
    permissions: definition.permissions,
  } as Json;
  const fields = definition.fields.map(({ id: _id, sortOrder: _sortOrder, ...field }) => field) as Json;
  const id = await saveDraft(null, payload, fields);
  await publishForm(id);
  return id;
}
