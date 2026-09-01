import { validateFormDefinition } from "./definition";
import type { FormTemplateDefinition, FormValidationResult } from "./types";

export function checkFormPublishability(template: FormTemplateDefinition): FormValidationResult {
  const issues = [...validateFormDefinition(template)];
  if (template.fields.length === 0) issues.push({ code: "empty_form", message: "A published form must contain at least one field" });
  return { valid: issues.length === 0, issues };
}
