import type { FormAnswer, FormFieldDefinition, FormTemplateDefinition } from "./types.ts";

const LAYOUT = new Set<FormFieldDefinition["type"]>(["section_header", "divider"]);
const MULTI = new Set<FormFieldDefinition["type"]>(["multiselect"]);
const NUMBER = new Set<FormFieldDefinition["type"]>(["number", "currency", "rating"]);

function compatible(field: FormFieldDefinition, value: FormAnswer): boolean {
  if (LAYOUT.has(field.type)) return false;
  const multi = MULTI.has(field.type) || (field.type === "checkbox" && !!(field.options?.length || field.optionSource));
  if (multi !== Array.isArray(value)) return false;
  if (field.type === "checkbox" && !multi) return typeof value === "boolean";
  if (NUMBER.has(field.type)) return typeof value === "number" || value === "";
  // Inline options are known here; a Dropdown Master list is resolved by the renderer.
  if (field.options?.length && !field.optionSource) {
    const allowed = new Set(field.options.map((option) => option.value));
    return Array.isArray(value) ? value.every((item) => allowed.has(item)) : value === "" || allowed.has(String(value));
  }
  return true;
}

/**
 * Keeps the sample answers a live preview can still use after the author edits
 * the Form, and drops the rest: a removed question, a renamed choice, or a
 * question whose type changed. Visibility and sections are then re-evaluated
 * by the renderer from what remains. Nothing here is ever submitted.
 */
export function reconcileFormPreviewAnswers(definition: FormTemplateDefinition, answers: Readonly<Record<string, FormAnswer>>): Readonly<Record<string, FormAnswer>> {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  let changed = false;
  const kept: Record<string, FormAnswer> = {};
  for (const [key, value] of Object.entries(answers)) {
    const field = byKey.get(key);
    if (field && compatible(field, value)) kept[key] = value; else changed = true;
  }
  return changed ? kept : answers;
}
