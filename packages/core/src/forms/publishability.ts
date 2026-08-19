import { validateFormDefinition } from "./definition";
import type { FormTemplateDefinition, FormValidationResult } from "./types";

export function checkFormPublishability(template: FormTemplateDefinition): FormValidationResult {
  const issues = [...validateFormDefinition(template)];
  if (template.fields.length === 0) issues.push({ code: "empty_form", message: "A published form must contain at least one field" });
  for (const field of template.fields) {
    if (field.type === "file") issues.push({ code: "file_storage_deferred", fieldKey: field.key, message: "File fields cannot be published until a private Storage lifecycle is implemented" });
  }
  return { valid: issues.length === 0, issues };
}
