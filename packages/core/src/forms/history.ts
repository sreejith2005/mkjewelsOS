import { normalizeFormDefinition } from "./definition.ts";
import type { FormTemplateDefinition } from "./types.ts";

export type FormDefinitionChange = Readonly<{ kind: "added" | "removed" | "changed"; property: string; label: string; fieldKey?: string; before?: unknown; after?: unknown }>;
/** Stable serialization deliberately ignores database field row IDs. */
export function formDefinitionValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formDefinitionValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([key, item]) => key !== "id" && item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${formDefinitionValue(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const FIELD_LABELS = { label: "Question name", type: "Field type", required: "Required status", options: "Answer choices", optionSource: "Dropdown source", validation: "Validation", condition: "Visibility condition", rule: "Visibility rules", branches: "Answer routes", sectionKey: "Question section", sortOrder: "Question order", placeholder: "Placeholder", helperText: "Help text", shown: "Visibility", editable: "Editing" } as const;
export function compareFormDefinitions(before: FormTemplateDefinition, after: FormTemplateDefinition): readonly FormDefinitionChange[] {
  const left = normalizeFormDefinition(before), right = normalizeFormDefinition(after);
  const changes: FormDefinitionChange[] = [];
  const compare = (property: string, label: string, a: unknown, b: unknown, fieldKey?: string) => {
    if (formDefinitionValue(a) !== formDefinitionValue(b)) changes.push({ kind: "changed", property, label, before: a, after: b, ...(fieldKey ? { fieldKey } : {}) });
  };
  for (const [property, label] of [["name", "Form name"], ["description", "Description"], ["permissions", "Role permissions"], ["recordNameFieldKey", "Record name"]] as const) compare(property, label, left[property], right[property]);
  const leftFields = new Map(left.fields.map(field => [field.key, field]));
  const rightFields = new Map(right.fields.map(field => [field.key, field]));
  for (const field of left.fields) if (!rightFields.has(field.key)) changes.push({ kind: "removed", property: "field", fieldKey: field.key, label: `Removed “${field.label}”`, before: field });
  for (const field of right.fields) {
    const previous = leftFields.get(field.key);
    if (!previous) { changes.push({ kind: "added", property: "field", fieldKey: field.key, label: `Added “${field.label}”`, after: field }); continue; }
    for (const property of Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS>) compare(property, `${FIELD_LABELS[property]} — ${field.label}`, previous[property], field[property], field.key);
  }
  const leftSections = new Map((left.sections ?? []).map(section => [section.key, section]));
  const rightSections = new Map((right.sections ?? []).map(section => [section.key, section]));
  for (const section of left.sections ?? []) if (!rightSections.has(section.key)) changes.push({ kind: "removed", property: "section", label: `Removed section “${section.title}”`, before: section });
  for (const section of right.sections ?? []) {
    const previous = leftSections.get(section.key);
    if (!previous) { changes.push({ kind: "added", property: "section", label: `Added section “${section.title}”`, after: section }); continue; }
    for (const property of ["title", "description", "next"] as const) compare(property, `Section ${property} — ${section.title}`, previous[property], section[property]);
  }
  compare("sectionOrder", "Section order", (left.sections ?? []).filter(s => rightSections.has(s.key)).map(s => s.key), (right.sections ?? []).filter(s => leftSections.has(s.key)).map(s => s.key));
  return changes;
}
