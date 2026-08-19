import type { FormAnswer, FormFieldDefinition } from "./types";

export function formatFormAnswer(field: FormFieldDefinition, value: FormAnswer | null | undefined, locale = "en-IN"): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "checkbox") return value === true ? "Yes" : "No";
  if (field.type === "currency" && typeof value === "number") return new Intl.NumberFormat(locale, { style: "currency", currency: "INR" }).format(value);
  if (field.type === "multiselect" && Array.isArray(value)) return value.join(", ");
  if (field.type === "rating") return `${value}/5`;
  return String(value);
}

export function formatFormSubmission(fields: readonly FormFieldDefinition[], answers: Readonly<Record<string, FormAnswer>>): readonly Readonly<{ key: string; label: string; value: string }>[] {
  return fields.filter((field) => answers[field.key] !== undefined).sort((a, b) => a.sortOrder - b.sortOrder).map((field) => Object.freeze({
    key: field.key,
    label: field.label,
    value: formatFormAnswer(field, answers[field.key]),
  }));
}
