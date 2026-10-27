import type { FormAnswer, FormAnswers, FormFieldDefinition, FormTemplateDefinition } from "./types";
import { fieldSectionKey, formSections, reachableSectionKeys } from "./sections";
import { isFormFieldVisible } from "./visibility";
import { escapeSpreadsheetFormula } from "../reports/csv";

export const CUSTOMER_DESTINATIONS = ["primary_name", "primary_phone", "secondary_phone", "billing_phone", "crm_client_id", "instagram", "whatsapp", "email", "website_chat", "external_reference", "city", "dob", "anniversary", "communication_preference", "budget", "product_interest", "occasion", "requirement", "next_follow_up", "outcome", "contact_outcome", "note", "source"] as const;
export type CustomerDestination = typeof CUSTOMER_DESTINATIONS[number];
export type CustomerMappingMode = "operational" | "profile" | "history" | "both";
export const CUSTOMER_CONTACT_KINDS = ["CALL","MESSAGE","THANK_YOU","NOTE"] as const;
export const CUSTOMER_CONTACT_CHANNELS = ["PHONE","WHATSAPP","INSTAGRAM","EMAIL","IN_PERSON","OTHER"] as const;
export type CustomerFieldMapping = Readonly<{ fieldKey: string; mode: CustomerMappingMode; destination: CustomerDestination; contactConfirmedValues?: readonly string[] | undefined;contactKind?:typeof CUSTOMER_CONTACT_KINDS[number]|undefined;contactChannel?:typeof CUSTOMER_CONTACT_CHANNELS[number]|undefined }>;
export type CustomerFormMapping = Readonly<{ schemaVersion: 1; enabled: boolean; channel: string; identityScope: string; fields: readonly CustomerFieldMapping[] }>;
export type CustomerJson = string | number | boolean | null | readonly CustomerJson[] | { readonly [key: string]: CustomerJson };
export type CustomerAnswerSnapshot = Readonly<{ fieldKey: string; label: string; type: string; destination: CustomerDestination; mode: CustomerMappingMode; original: CustomerJson; normalized: CustomerJson; optionLabels: readonly string[] }>;

function accepts(field: FormFieldDefinition, destination: CustomerDestination): boolean {
  if (["dob", "anniversary", "next_follow_up"].includes(destination)) return field.type === "date";
  if (destination === "budget") return ["number", "currency"].includes(field.type);
  if (["primary_phone", "secondary_phone", "billing_phone"].includes(destination)) return ["phone", "text"].includes(field.type);
  return true;
}

/** Preview validation only; the database repeats this against saved questions. */
export function validateCustomerMapping(form: FormTemplateDefinition, mapping: CustomerFormMapping): readonly string[] {
  const issues: string[] = [];
  if (mapping.schemaVersion !== 1) issues.push("Unsupported mapping version");
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(mapping.channel)) issues.push("Choose a valid channel code");
  if (!mapping.identityScope.trim() || mapping.identityScope.length > 120) issues.push("Specify the source account scope");
  const seen = new Set<string>();
  for (const item of mapping.fields) {
    if (seen.has(item.fieldKey)) issues.push(`Duplicate question mapping: ${item.fieldKey}`);
    seen.add(item.fieldKey);
    const field = form.fields.find(f => f.key === item.fieldKey);
    if (!field) { issues.push(`Unknown question: ${item.fieldKey}`); continue; }
    if (item.mode === "operational") continue;
    if (["user_dropdown", "branch_dropdown", "department_dropdown", "section_header", "divider", "file"].includes(field.type)) issues.push(`Question ${item.fieldKey} is operational`);
    if (!CUSTOMER_DESTINATIONS.includes(item.destination) || !accepts(field, item.destination)) issues.push(`Question ${item.fieldKey} cannot supply ${item.destination}`);
    if (item.contactConfirmedValues?.some(value => item.destination !== "contact_outcome" || !field.options?.some(option => option.value === value))) issues.push(`Review the confirmed contact options for ${item.fieldKey}`);
    if (item.contactConfirmedValues?.length && (!item.contactKind || !item.contactChannel)) issues.push(`Choose the actual contact kind and channel for ${item.fieldKey}`);
  }
  return issues;
}

function json(value: unknown, depth = 0): value is CustomerJson {
  if (depth > 12) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(v => json(v, depth + 1));
  return typeof value === "object" && value !== null && Object.values(value).every(v => json(v, depth + 1));
}

function conditions(answers: Readonly<Record<string, unknown>>): FormAnswers {
  const result: Record<string, FormAnswer> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") result[key] = value;
    else if (Array.isArray(value) && value.every((v): v is string => typeof v === "string")) result[key] = value;
  }
  return result;
}

/** Preserve source values and labels; never infer meaning from a token or question label. */
export function customerAnswerSnapshot(form: FormTemplateDefinition, mapping: CustomerFormMapping, answers: Readonly<Record<string, unknown>>, sectionKey?: string): readonly CustomerAnswerSnapshot[] {
  if (!mapping.enabled || validateCustomerMapping(form, mapping).length) return [];
  const context = conditions(answers);
  const sections = formSections(form);
  const reached = sectionKey ? new Set([sectionKey]) : reachableSectionKeys(form, context);
  const result: CustomerAnswerSnapshot[] = [];
  for (const field of [...form.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const item = mapping.fields.find(m => m.fieldKey === field.key);
    const original = answers[field.key];
    if (!item || item.mode === "operational" || !json(original) || original === null || (typeof original === "string" && !original.trim()) || (Array.isArray(original) && !original.length) || !reached.has(fieldSectionKey(field, sections)) || !isFormFieldVisible(field, context)) continue;
    const values = Array.isArray(original) ? original : [original];
    result.push({ fieldKey: field.key, label: field.label, type: field.type, destination: item.destination, mode: item.mode, original,
      normalized: typeof original === "string" ? original.trim() : original,
      optionLabels: values.map(value => field.options?.find(option => option.value === value)?.label).filter((value): value is string => value !== undefined) });
  }
  return result;
}

/** Always quote CSV; prefix dangerous text/phones with an apostrophe understood by Sheets. */
export function customerCsvCell(value: CustomerJson, phone = false): string {
  let text = typeof value === "string" ? value : value === null ? "" : JSON.stringify(value);
  const escaped = escapeSpreadsheetFormula(text);
  text = text && phone && escaped === text ? `'${text}` : escaped;
  return `"${text.replaceAll('"', '""')}"`;
}
