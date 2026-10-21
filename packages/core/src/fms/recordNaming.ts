import type { FormFieldDefinition } from "../forms/types";

const SCALAR = new Set(["text", "number", "select", "radio", "date", "datetime", "user_dropdown"]);
const PRIVATE = /(?:password|secret|token|credential|private|remarks?|notes?|email|phone|mobile)/i;
/** Explicit selection can use any suitable scalar; automatic selection is narrower. */
export function eligibleRecordNameFields<T extends Readonly<{ key: string; label: string; type?: string | undefined; shown?: boolean | undefined }>>(fields: readonly T[]): T[] {
  return fields.filter(field => field.shown !== false && SCALAR.has(field.type ?? "text") && !PRIVATE.test(`${field.key} ${field.label}`));
}
export function automaticRecordNameField(fields: readonly FormFieldDefinition[]): FormFieldDefinition | undefined {
  const rank = (field: FormFieldDefinition) => {
    const text = `${field.key} ${field.label}`.toLowerCase().replaceAll("_", " ");
    if (/\b(customer|client) name\b/.test(text)) return 0;
    if (/\b(lead|enquiry|inquiry|record) name\b/.test(text)) return 1;
    if (/\b(order|enquiry|inquiry|lead|record) (number|no|reference|ref|id)\b/.test(text)) return 2;
    return 10;
  };
  return eligibleRecordNameFields(fields).filter(field => ["text", "number"].includes(field.type) && rank(field) < 10)
    .sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))[0];
}
export function normalizeRecordName(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const name = String(value).replace(/\s+/g, " ").trim();
  if (!name || /^(null|undefined|not provided)$/i.test(name) || /[{}]/.test(name)
    || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name)) return null;
  return name.slice(0, 120);
}
