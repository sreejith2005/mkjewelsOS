import { workUploadFormDefinition, type Json } from "@jewelos/core";
import { publishForm, saveDraft } from "./api";

type InstallationApi = {
  saveDraft: (id: string | null, payload: Json, fields: Json) => Promise<string>;
  publishForm: (id: string) => Promise<void>;
};

/** Both clients install the maintained form using the audited draft/publish contracts. */
export async function installWorkUploadForm(api: InstallationApi = { saveDraft, publishForm }): Promise<string> {
  const definition = workUploadFormDefinition;
  const payload = { name: definition.name, description: definition.description,
    sections: definition.sections, permissions: definition.permissions } as Json;
  const fields = definition.fields.map(({ id: _id, sortOrder: _sortOrder, ...field }) => field) as Json;
  const id = await api.saveDraft(null, payload, fields);
  await api.publishForm(id);
  return id;
}
