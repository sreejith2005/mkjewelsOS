// Automatic client details in any form (owner request 2026-11-04): when someone with CRM access
// types a phone number that belongs to a registered client or lead, the form fills every question
// it recognises with what CRM knows about that person. Nothing is configured per question: a
// question is recognised by its key or its wording (Client name, Gender, City, Date of birth...).
// Only empty questions are filled, and the person can still change every answer.
import type { FormFieldDefinition } from "./types.ts";

/** The client details CRM returns for a phone number (clientProfileAutofill keys). */
export const CLIENT_PROFILE_KEYS = [
  "primary_name", "gender", "dob", "anniversary", "community", "community_other", "address", "pincode", "country", "state", "city", "city_other",
  "beverage", "sugar", "snack", "billing_phone", "communication_preference", "client_potential_category", "high_potential_reason", "next_visit_date",
  "occupation", "occupation_other", "bridal_or_non_bridal", "wedding_month", "wedding_year", "beverage_other", "sugar_other", "snack_other",
] as const;
export type ClientProfileKey = (typeof CLIENT_PROFILE_KEYS)[number];

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** How each client detail is usually asked. The first match wins, so the more specific wording comes first. */
const PROFILE_WORDING: ReadonlyArray<readonly [ClientProfileKey, readonly string[]]> = [
  ["primary_name", ["primary name", "client name", "customer name", "full name", "name of the client", "name of client", "name"]],
  ["billing_phone", ["billing phone", "billing mobile", "billing number"]],
  ["gender", ["gender", "sex"]],
  ["dob", ["dob", "date of birth", "birth date", "birthday"]],
  ["anniversary", ["anniversary", "wedding anniversary", "anniversary date"]],
  ["community_other", ["community other", "caste other"]],
  ["community", ["community", "caste", "community caste"]],
  ["address", ["address", "full address", "residential address"]],
  ["pincode", ["pincode", "pin code", "pin", "postal code", "zip code"]],
  ["country", ["country"]],
  ["state", ["state"]],
  ["city_other", ["city other"]],
  ["city", ["city", "town", "place"]],
  ["occupation_other", ["occupation other"]],
  ["occupation", ["occupation", "profession"]],
  ["bridal_or_non_bridal", ["bridal or non bridal", "bridal non bridal", "bridal"]],
  ["wedding_month", ["wedding month"]],
  ["wedding_year", ["wedding year"]],
  ["communication_preference", ["communication preference", "preferred communication", "contact preference"]],
  ["client_potential_category", ["client potential category", "potential category"]],
  ["high_potential_reason", ["why high potential", "high potential reason"]],
  ["next_visit_date", ["next visit date"]],
  ["beverage_other", ["other beverage", "beverage other"]],
  ["beverage", ["beverage", "drink"]],
  ["sugar_other", ["other sugar preference", "sugar other"]],
  ["sugar", ["sugar"]],
  ["snack_other", ["other snack", "snack other"]],
  ["snack", ["snack"]],
];

const ANSWER_TYPES = new Set<FormFieldDefinition["type"]>(["text", "textarea", "phone", "email", "number", "date", "datetime", "select", "radio", "multiselect", "checkbox"]);

/** The client detail a question asks for, from its key or its wording, or null. */
export function clientProfileKeyFor(field: FormFieldDefinition): ClientProfileKey | null {
  if (!ANSWER_TYPES.has(field.type)) return null;
  if ((CLIENT_PROFILE_KEYS as readonly string[]).includes(field.key)) return field.key as ClientProfileKey;
  const asked = [words(field.key), words(field.label)];
  for (const [key, wording] of PROFILE_WORDING) if (asked.some((text) => wording.includes(text))) return key;
  return null;
}

const PHONE_WORDING = ["mobile", "mobile number", "mobile no", "phone", "phone number", "contact number", "whatsapp number", "client mobile", "customer mobile", "client phone", "customer phone", "primary phone"];

/** A question that holds the client's phone number: any phone question, or a text question worded as one. */
export function isClientPhoneQuestion(field: FormFieldDefinition): boolean {
  if (field.type === "phone") return !words(field.label).includes("billing") && !words(field.label).includes("reference") && !words(field.label).includes("referral");
  return field.type === "text" && (PHONE_WORDING.includes(words(field.label)) || PHONE_WORDING.includes(words(field.key)));
}

/** A question that holds a pincode (fills city, state and country). */
export function isPincodeQuestion(field: FormFieldDefinition): boolean {
  return clientProfileKeyFor(field) === "pincode";
}

/**
 * The answers to fill for a client's details: question key -> the detail as people see it.
 * Each detail fills at most one question, the first one that asks for it.
 */
export function clientDetailsForForm(fields: readonly FormFieldDefinition[], details: Readonly<Partial<Record<ClientProfileKey, string | null>>>): Record<string, string> {
  const filled: Record<string, string> = {};
  const used = new Set<ClientProfileKey>();
  for (const field of [...fields].sort((left, right) => left.sortOrder - right.sortOrder)) {
    if (isClientPhoneQuestion(field)) continue;
    const key = clientProfileKeyFor(field);
    const value = key ? details[key]?.toString().trim() : undefined;
    if (!key || !value || used.has(key)) continue;
    filled[field.key] = value;
    used.add(key);
  }
  return filled;
}
