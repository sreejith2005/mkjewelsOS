import { formatFormAnswer } from "./format";
import { formOptionLabel } from "./options";
import type { FormAnswer, FormFieldDefinition } from "./types";

/** Shown when a stored roster, branch or department reference no longer resolves. */
export const UNAVAILABLE_REFERENCE_LABEL = "No longer available";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const ZONED_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type FormAnswerLookups = Readonly<{
  users?: ReadonlyMap<string, string> | undefined;
  branches?: ReadonlyMap<string, string> | undefined;
  departments?: ReadonlyMap<string, string> | undefined;
  /** Time zone for answers stored with an offset. Wall-clock answers are shown as entered. */
  timeZone?: string | undefined;
}>;

// ICU may separate "pm" with a narrow no-break space; keep plain spaces for readers and tests.
const tidy = (text: string) => text.replace(/[  ]/g, " ");

function namedValue(value: object): string | null {
  const record = value as Record<string, unknown>;
  for (const key of ["name", "label", "title", "value"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Turns any stored JSON answer into a value the form helpers understand. Legacy
 * or hand-imported submissions can hold objects or mixed arrays; those become
 * their readable name instead of failing the whole screen.
 */
export function coerceFormAnswer(value: unknown): FormAnswer | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const coerced = coerceFormAnswer(item);
      if (coerced === null) return [];
      return Array.isArray(coerced) ? [...coerced] : [String(coerced)];
    });
    return items;
  }
  if (typeof value === "object") return namedValue(value) ?? "Provided";
  return null;
}

function formatDate(value: string): string | null {
  const match = DATE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return tidy(new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date));
}

function formatDateTime(value: string, timeZone: string): string | null {
  const local = LOCAL_DATETIME.exec(value);
  const format = (date: Date, zone: string) => tidy(new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone }).format(date));
  if (local) {
    // A datetime-local answer has no zone: show exactly the wall-clock time the employee entered.
    const date = new Date(Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5])));
    return Number.isNaN(date.getTime()) ? null : format(date, "UTC");
  }
  if (!ZONED_DATETIME.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : format(date, timeZone);
}

function referenceLabel(value: string, names: ReadonlyMap<string, string> | undefined): string {
  const name = names?.get(value);
  if (name) return name;
  return UUID.test(value) ? UNAVAILABLE_REFERENCE_LABEL : value;
}

/**
 * The read-only text for one answer: option labels instead of stored values,
 * names instead of identifiers, readable dates, and never a raw object. An
 * empty answer returns "" so the caller decides how to show "not answered".
 */
export function displayFormAnswer(field: FormFieldDefinition, raw: unknown, lookups: FormAnswerLookups = {}): string {
  const value = coerceFormAnswer(raw);
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.type === "file") return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? namedValue(raw) ?? "File attached" : "File attached";
  if (field.type === "user_dropdown" && typeof value === "string") return referenceLabel(value, lookups.users);
  if (field.type === "branch_dropdown" && typeof value === "string") return referenceLabel(value, lookups.branches);
  if (field.type === "department_dropdown" && typeof value === "string") return referenceLabel(value, lookups.departments);
  if (field.type === "date" && typeof value === "string") return formatDate(value) ?? value;
  if (field.type === "datetime" && typeof value === "string") return formatDateTime(value, lookups.timeZone ?? "Asia/Kolkata") ?? value;
  if (Array.isArray(value)) return value.map((item) => formOptionLabel(field.options, item)).join(", ");
  return tidy(formatFormAnswer(field, value));
}
